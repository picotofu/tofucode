<script setup>
import { Editor as TinyMDE } from 'tiny-markdown-editor';
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AskUserQuestionModal from '../components/AskUserQuestionModal.vue';
import ChatMessages from '../components/ChatMessages.vue';
import DebugPopover from '../components/DebugPopover.vue';
import FileEditor from '../components/FileEditor.vue';
import FileExplorer from '../components/FileExplorer.vue';
import GitDiffModal from '../components/GitDiffModal.vue';
import TerminalOutput from '../components/TerminalOutput.vue';
import { useDebugMode } from '../composables/useDebugMode';
import { useChatWebSocket, useWebSocket } from '../composables/useWebSocket';
import { matchesSearch } from '../utils/fileSearch.js';
import { getShortPath } from '../utils/format.js';

// Get sidebar and settings from App.vue
const sidebar = inject('sidebar');
const settingsContext = inject('settings');
const fileReference = inject('fileReference');

const router = useRouter();
const route = useRoute();

// Get recent sessions and terminal counts from global WebSocket
const { recentSessions, sessionStatuses, terminalCounts } = useWebSocket();

// Use scoped WebSocket - each ChatView gets its own connection
const {
  connected,
  messages,
  taskStatus,
  currentSession,
  sessionTitle,
  projectStatus,
  hasOlderMessages,
  summaryCount,
  sessionActiveElsewhere,
  terminalProcesses,
  contextReady,
  loadingOlderMessages,
  totalTurns,
  loadedTurns,
  connect,
  selectProject,
  selectSession,
  loadFullHistory,
  loadOlderMessages,
  newSession,
  sendPrompt,
  cancelTask,
  clearMessages,
  getProjectStatus,
  setSessionTitle,
  execCommand,
  killProcess,
  listProcesses,
  clearTerminal,
  removeWatchProcess,
  clearTaskStatus,
  pendingQuestion,
  answerQuestion,
  send,
  sendAndWait,
  onMessage,
} = useChatWebSocket();

// Debug mode
const debugModeEnabled = computed(() => settingsContext.debugMode());
const { hoveredElement, popoverPosition, popoverData } =
  useDebugMode(debugModeEnabled);

// Auto-save files setting
const autoSaveFilesEnabled = computed(() => settingsContext.autoSaveFiles());

// Recent sessions switcher - show 2 recent sessions excluding current
const displayedRecentSessions = computed(() => {
  const recent = recentSessions.value || [];
  const filtered = recent.filter((s) => s.sessionId !== currentSession.value);
  return filtered.slice(0, 2);
});

function getSessionDisplayTitle(session) {
  const projectName = session.projectName || 'Unknown';
  const title = session.title || session.firstPrompt || 'Untitled';
  return `${projectName} / ${title}`;
}

function getSessionUrl(session) {
  // Route format: /project/:project/session/:session
  const projectSlug =
    session.projectSlug ||
    session.projectPath?.replace(/\//g, '-').replace(/^-/, '-');
  return `/project/${projectSlug}/session/${session.sessionId}`;
}

// Mode state: 'chat' | 'terminal' | 'files'
const currentMode = ref('chat');
const terminalSubTab = ref('history'); // 'bookmarks' | 'active' | 'history'
const bookmarks = ref({ global: [], project: [] });
const watchEnabledIds = ref(new Set()); // Set<bookmarkId> — which bookmarks have watch enabled
const terminalInput = ref('');
const terminalCwd = ref(''); // Editable CWD for terminal commands
const terminalInputRef = ref(null);
const terminalOutputRef = ref(null);
const pathEditInputRef = ref(null);
const manualExpandState = ref(new Map()); // Map<processId, boolean> for user-toggled items

// Computed for backwards compatibility
const terminalMode = computed(() => currentMode.value === 'terminal');
const filesMode = computed(() => currentMode.value === 'files');

// Filtered files list based on search, dotfiles toggle, and MD mode
const filteredFilesItems = computed(() => {
  let items = filesItems.value;

  // Filter dotfiles if toggle is off
  if (!showDotfiles.value) {
    items = items.filter((item) => !item.name.startsWith('.'));
  }

  // Filter for .md files only in MD mode (show directories that contain .md files)
  if (mdMode.value) {
    items = items.filter(
      (item) =>
        (item.isDirectory && item.hasMarkdown) ||
        item.name.toLowerCase().endsWith('.md'),
    );
  }

  // Apply fuzzy/glob search filter
  if (filesFilter.value.trim()) {
    items = items.filter((item) => matchesSearch(item.name, filesFilter.value));
  }

  return items;
});

// Files mode state
const filesCurrentPath = ref('');
const filesItems = ref([]);
const filesLoading = ref(false);
const filesFilter = ref(''); // Filter text for file list
const showDotfiles = ref(false); // Toggle to show/hide dotfiles
const openedFile = ref(null); // { path, content, loading }
const fileEditorRef = ref(null);

const openedFileName = computed(() => {
  if (!openedFile.value?.path) return '';
  return openedFile.value.path.split('/').pop();
});

// File statistics
const fileSize = computed(() => {
  if (!openedFile.value?.content) return '0 B';
  const bytes = new Blob([openedFile.value.content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

const totalLines = computed(() => {
  if (!openedFile.value?.content) return 0;
  return openedFile.value.content.split('\n').length;
});

const totalChars = computed(() => {
  if (!openedFile.value?.content) return 0;
  return openedFile.value.content.length;
});

// MD mode - filter for .md files only, with auto-save
const mdModeKey = 'tofucode:md-mode';
const mdMode = ref(localStorage.getItem(mdModeKey) === 'true');

watch(mdMode, (newValue) => {
  localStorage.setItem(mdModeKey, newValue ? 'true' : 'false');
});
const fileModals = ref({
  createFile: false,
  createFileName: '',
  createFolder: false,
  createFolderName: '',
  rename: null,
  renameNewName: '',
  delete: null,
  editPath: false,
  editPathValue: '',
  pendingFileToOpen: null, // Track file to open after creation
});

// Git Diff Modal
const showGitDiffModal = ref(false);

function openGitDiffModal() {
  // Only open if we have git changes and a valid project path
  if (
    projectStatus.value.gitChanges &&
    fileChangesText.value &&
    projectStatus.value.cwd
  ) {
    showGitDiffModal.value = true;
  }
}

function closeGitDiffModal() {
  showGitDiffModal.value = false;
}

// AskUserQuestion Modal
const showQuestionModal = ref(false);
const questionModalData = ref(null); // { toolUseId, questions }

function handleAnswerQuestion(message) {
  questionModalData.value = {
    toolUseId: message.id || pendingQuestion.value?.toolUseId,
    questions:
      message.input?.questions || pendingQuestion.value?.questions || [],
  };
  showQuestionModal.value = true;
}

function handleQuestionSubmit(toolUseId, answers) {
  answerQuestion(toolUseId, answers);
  showQuestionModal.value = false;
  questionModalData.value = null;
}

function closeQuestionModal() {
  showQuestionModal.value = false;
  questionModalData.value = null;
}

// Auto-open question modal when server sends ask_user_question
watch(pendingQuestion, (question) => {
  if (question) {
    questionModalData.value = {
      toolUseId: question.toolUseId,
      questions: question.questions,
    };
    showQuestionModal.value = true;
  }
});

function handleTerminalTabClick() {
  currentMode.value = 'terminal';
}

// Flag to prevent auto-save during session transitions
let isLoadingSession = false;

// Terminal command history
const MAX_HISTORY = 100;
const terminalHistoryIndex = ref(-1); // -1 means not browsing history
const terminalHistoryTemp = ref(''); // Stores current input when browsing history

function getTerminalHistoryKey() {
  return `terminal-history:${projectSlug.value}`;
}

function getTerminalHistory() {
  try {
    const stored = localStorage.getItem(getTerminalHistoryKey());
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addToTerminalHistory(command) {
  const history = getTerminalHistory();
  // Don't add duplicates of the last command
  if (history.length > 0 && history[history.length - 1] === command) {
    return;
  }
  history.push(command);
  // Trim to max size
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  localStorage.setItem(getTerminalHistoryKey(), JSON.stringify(history));
}

// Auto-expand the latest history item
const latestHistoryId = computed(() => {
  const history = terminalProcesses.value.filter((p) => p.status !== 'running');
  if (history.length === 0) return null;
  // Find most recent by endedAt
  return history.reduce(
    (latest, p) =>
      !latest || (p.endedAt || 0) > (latest.endedAt || 0) ? p : latest,
    null,
  )?.id;
});

// Compute expanded set: auto-expand latest, respect manual toggles
const expandedHistory = computed(() => {
  const expanded = new Set();
  for (const proc of terminalProcesses.value) {
    if (proc.status === 'running') continue;

    if (manualExpandState.value.has(proc.id)) {
      // User manually set state - respect it
      if (manualExpandState.value.get(proc.id)) {
        expanded.add(proc.id);
      }
    } else if (proc.id === latestHistoryId.value) {
      // Auto-expand the latest history item
      expanded.add(proc.id);
    }
  }
  return expanded;
});

// Session title editing
const editingSessionTitle = ref(false);
const editingTitleValue = ref('');
const titleInputRef = ref(null);

// Keyboard shortcuts
function handleKeydown(e) {
  // Escape: Close modals first, then blur input
  if (e.key === 'Escape') {
    // Close any open modals first (highest priority)
    if (fileModals.value.createFile) {
      fileModals.value.createFile = false;
      return;
    }
    if (fileModals.value.createFolder) {
      fileModals.value.createFolder = false;
      return;
    }
    if (fileModals.value.rename) {
      fileModals.value.rename = null;
      return;
    }
    if (fileModals.value.delete) {
      fileModals.value.delete = null;
      return;
    }
    if (fileModals.value.editPath) {
      cancelEditPath();
      return;
    }
    if (editingSessionTitle.value) {
      cancelEditingSessionTitle();
      return;
    }
    // Close memo overlay and refocus chat input
    if (memoOpen.value) {
      closeMemo();
      nextTick(() => {
        const editable = editorEl.value?.querySelector('[contenteditable]');
        if (editable) {
          editable.focus();
          // Move cursor to end
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(editable);
          range.collapse(false); // false = collapse to end
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
      return;
    }
    // Fallback: blur active input
    document.activeElement?.blur();
    return;
  }

  // Mode switching: Ctrl/Cmd+1/2/3
  if (e.ctrlKey || e.metaKey) {
    if (e.key === '1') {
      e.preventDefault();
      currentMode.value = 'chat';
      nextTick(() => {
        // Wait for TinyMDE editor to be ready in the DOM
        setTimeout(() => {
          const editable = editorEl.value?.querySelector('[contenteditable]');
          if (editable) {
            editable.focus();
          }
        }, 50);
      });
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      // If already in terminal mode, cycle through history → active → bookmarks
      if (currentMode.value === 'terminal') {
        const tabs = ['history', 'active', 'bookmarks'];
        const idx = tabs.indexOf(terminalSubTab.value);
        terminalSubTab.value = tabs[(idx + 1) % tabs.length];
      } else {
        currentMode.value = 'terminal';
      }
      nextTick(() => {
        // Initialize CWD if needed
        if (!terminalCwd.value && projectStatus.value.cwd) {
          terminalCwd.value = projectStatus.value.cwd;
        }
        terminalInputRef.value?.focus();
      });
      return;
    }
    if (e.key === '3') {
      e.preventDefault();
      currentMode.value = 'files';
      nextTick(() => {
        // Focus search input in files mode
        const searchInput = document.querySelector('.files-filter-input');
        searchInput?.focus();
      });
      return;
    }

    // Ctrl+M or Cmd+M: Toggle memo (if enabled)
    if (e.key === 'm' && settingsContext?.enableMemo?.()) {
      e.preventDefault();
      toggleMemo();
      return;
    }

    // Ctrl+L or Cmd+L: Scroll to bottom (clear view)
    if (e.key === 'l') {
      e.preventDefault();
      if (terminalMode.value) {
        // In terminal mode: scroll terminal output to bottom
        terminalOutputRef.value?.scrollHistoryToBottom();
      } else {
        // In chat mode: scroll chat to bottom
        scrollToBottom();
      }
      return;
    }

    // Cmd+Up: Navigate to previous turn/command
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentMode.value === 'chat') {
        chatMessagesRef.value?.goToPreviousTurn();
      } else if (currentMode.value === 'terminal') {
        terminalOutputRef.value?.goToPreviousCommand();
      }
      return;
    }

    // Cmd+Down: Navigate to next turn/command
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMode.value === 'chat') {
        chatMessagesRef.value?.goToNextTurn();
      } else if (currentMode.value === 'terminal') {
        terminalOutputRef.value?.goToNextCommand();
      }
      return;
    }

    // Cmd+N: Create new session from current project
    if (e.key === 'n') {
      e.preventDefault();
      if (projectSlug.value) {
        window.location.href = `/project/${projectSlug.value}/session/new`;
      }
      return;
    }

    // Cmd+J: Jump to next session (cycle through displayed recent sessions)
    if (e.key === 'j') {
      e.preventDefault();
      const displayed = displayedRecentSessions.value || [];
      if (displayed.length === 0) return;

      // Rotate through displayed recent sessions (max 2)
      // Since current session is already excluded from displayedRecentSessions,
      // we just take the first one and cycle
      const nextSession = displayed[0];
      if (nextSession) {
        window.location.href = getSessionUrl(nextSession);
      }
      return;
    }
  }
}

// Connect on mount and register keyboard shortcuts
onMounted(() => {
  connect();
  document.addEventListener('keydown', handleKeydown);

  // Restore state from URL query params BEFORE initializing
  const query = route.query;

  // Restore mode (chat, terminal, files)
  if (query.mode && ['chat', 'terminal', 'files'].includes(query.mode)) {
    currentMode.value = query.mode;
  }

  // Restore terminal sub-tab
  if (
    query.terminalTab &&
    ['active', 'history', 'bookmarks'].includes(query.terminalTab)
  ) {
    terminalSubTab.value = query.terminalTab;
  }

  // Initialize based on current mode (wait for DOM)
  nextTick(() => {
    if (currentMode.value === 'chat') {
      // Initialize TinyMDE for chat input
      initTinyMDE();
    }
    // Terminal and files mode initialization happens via watchers (see below)
  });
});

// Load saved chat input from localStorage
function loadChatInput() {
  if (chatInputStorageKey.value) {
    const saved = localStorage.getItem(chatInputStorageKey.value);
    if (saved) {
      inputValue.value = saved;
    }
  }

  // Check if there's a backup and update state
  if (chatInputBackupKey.value) {
    const backup = localStorage.getItem(chatInputBackupKey.value);
    hasBackupState.value = backup !== null && backup !== '';
  }
}

// Save chat input to localStorage
function saveChatInput() {
  if (chatInputStorageKey.value) {
    if (inputValue.value) {
      localStorage.setItem(chatInputStorageKey.value, inputValue.value);
      // Clear backup when user starts typing new content (only if there's actual text being typed)
      // This ensures backup persists when input is cleared via the clear button
      if (
        chatInputBackupKey.value &&
        hasBackup.value &&
        inputValue.value.trim() !== ''
      ) {
        localStorage.removeItem(chatInputBackupKey.value);
        hasBackupState.value = false;
      }
    } else {
      // Clear storage when input is empty
      localStorage.removeItem(chatInputStorageKey.value);
    }
  }
}

// Clear saved chat input from localStorage
function clearChatInput() {
  if (chatInputStorageKey.value) {
    localStorage.removeItem(chatInputStorageKey.value);
  }
}

// Reactive backup state (since localStorage isn't reactive)
const hasBackupState = ref(false);

// Check if there's a backup available for undo
const hasBackup = computed(() => {
  return hasBackupState.value;
});

// Show clear button if there's current input, undo button if there's backup but no input
const showClearButton = computed(() => {
  return inputValue.value.trim() !== '';
});

const showUndoButton = computed(() => {
  return !showClearButton.value && hasBackup.value;
});

// Clear current input and save it as backup
function handleClearInput() {
  const current = inputValue.value.trim();
  if (!current) return;

  // Save current input as backup
  if (chatInputBackupKey.value) {
    localStorage.setItem(chatInputBackupKey.value, current);
    hasBackupState.value = true;
  }

  // Clear current input
  inputValue.value = '';
  if (editorInstance.value) {
    editorInstance.value.setContent('');
  }

  // Clear storage
  clearChatInput();
}

// Restore input from backup
function handleUndoClear() {
  if (!chatInputBackupKey.value) return;

  const backup = localStorage.getItem(chatInputBackupKey.value);
  if (!backup) return;

  // Restore the backup
  inputValue.value = backup;
  if (editorInstance.value) {
    editorInstance.value.setContent(backup);
  }

  // Save to current storage
  saveChatInput();

  // Clear the backup
  localStorage.removeItem(chatInputBackupKey.value);
  hasBackupState.value = false;
}

// Focus the chat input editor when clicking on the form area
function focusChatInput(event) {
  // Don't interfere with button clicks
  if (event.target.closest('button')) return;
  // Focus the contenteditable element inside TinyMDE
  const editable = editorEl.value?.querySelector('[contenteditable]');
  editable?.focus();
}

// Handle Tab key for chat input markdown editor
function handleChatInputTab(event) {
  if (!editorInstance.value) return;

  const selection = editorInstance.value.getSelection();
  if (!selection) return;

  const content = editorInstance.value.getContent();
  const lines = content.split('\n');
  const currentLine = lines[selection.row];

  // Check if current line is a list item
  const listMatch = currentLine.match(/^(\s*)([+*-]|\d+[.)])\s/);

  if (event.shiftKey) {
    // Shift+Tab: Dedent
    if (listMatch) {
      // Dedent list item (remove up to 2 spaces from beginning)
      const leadingSpaces = listMatch[1];
      if (leadingSpaces.length >= 2) {
        const newLine = currentLine.replace(/^ {2}/, '');
        lines[selection.row] = newLine;
        editorInstance.value.setContent(lines.join('\n'));

        // Restore cursor position (adjusted for removed spaces)
        const newCol = Math.max(0, selection.col - 2);
        editorInstance.value.setSelection({ row: selection.row, col: newCol });
      }
    } else {
      // Not a list - remove up to 2 spaces from beginning
      if (currentLine.startsWith('  ')) {
        const newLine = currentLine.replace(/^ {2}/, '');
        lines[selection.row] = newLine;
        editorInstance.value.setContent(lines.join('\n'));

        // Restore cursor position
        const newCol = Math.max(0, selection.col - 2);
        editorInstance.value.setSelection({ row: selection.row, col: newCol });
      }
    }
  } else {
    // Tab: Indent
    if (listMatch) {
      // Indent list item (add 2 spaces at beginning)
      const newLine = `  ${currentLine}`;
      lines[selection.row] = newLine;
      editorInstance.value.setContent(lines.join('\n'));

      // Restore cursor position (adjusted for added spaces)
      editorInstance.value.setSelection({
        row: selection.row,
        col: selection.col + 2,
      });
    } else {
      // Not a list - insert 2 spaces at cursor
      editorInstance.value.paste('  ');
    }
  }

  // Update inputValue
  inputValue.value = editorInstance.value.getContent();
}

// Initialize TinyMDE editor
function initTinyMDE() {
  nextTick(() => {
    if (editorEl.value && !editorInstance.value) {
      // Load saved input before initializing
      loadChatInput();

      editorInstance.value = new TinyMDE({
        element: editorEl.value,
        content: inputValue.value,
      });

      // Sync editor content to inputValue using TinyMDE's change event
      editorInstance.value.addEventListener('change', (event) => {
        inputValue.value = event.content;
      });

      // Handle Ctrl+Enter / Cmd+Enter and Tab in editor via DOM event
      editorEl.value.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          handleChatInputTab(e);
        }
      });
    }
  });
}

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  // Cleanup TinyMDE instance
  if (editorInstance.value) {
    editorInstance.value = null;
  }
});

const inputValue = ref('');
const chatMessagesRef = ref(null); // ChatMessages component ref
const textareaEl = ref(null);
const editorEl = ref(null); // TinyMDE container
const editorInstance = ref(null); // TinyMDE instance
const permissionMode = ref('default');
const modelSelection = ref('sonnet'); // 'sonnet' | 'opus' | 'haiku'

const projectSlug = computed(() => route.params.project);
const sessionParam = computed(() => route.params.session);

// Storage key for permission mode
const permissionStorageKey = computed(() => {
  if (sessionParam.value && sessionParam.value !== 'new') {
    return `permissionMode:${sessionParam.value}`;
  }
  return null;
});

// Storage key for chat input
const chatInputStorageKey = computed(() => {
  if (projectSlug.value && sessionParam.value) {
    return `chat-input:${projectSlug.value}:${sessionParam.value}`;
  }
  return null;
});

// Storage key for backup chat input (for undo after clear)
const chatInputBackupKey = computed(() => {
  if (projectSlug.value && sessionParam.value) {
    return `chat-input-backup:${projectSlug.value}:${sessionParam.value}`;
  }
  return null;
});

// Load permission mode from localStorage or query param
function loadPermissionMode() {
  // First check localStorage for this session
  if (permissionStorageKey.value) {
    const stored = localStorage.getItem(permissionStorageKey.value);
    if (stored) {
      permissionMode.value = stored;
      return;
    }
  }
  // Fall back to query param
  if (route.query.dangerouslySkipPermissions === '1') {
    permissionMode.value = 'skip';
  } else {
    permissionMode.value = 'default';
  }
}

// Save permission mode to localStorage when changed
watch(permissionMode, (newMode) => {
  if (permissionStorageKey.value) {
    localStorage.setItem(permissionStorageKey.value, newMode);
  }
});

// Save permission mode and update URL when new session gets its ID
watch(currentSession, (newSessionId) => {
  if (newSessionId && isNewSession.value) {
    localStorage.setItem(
      `permissionMode:${newSessionId}`,
      permissionMode.value,
    );
    // Update URL from /new to actual session ID without page refresh
    router.replace({
      name: 'chat',
      params: { project: projectSlug.value, session: newSessionId },
    });
  }
});

// Load permission mode when session changes
watch(
  sessionParam,
  (newSession, oldSession) => {
    loadPermissionMode();

    // Save input from old session before switching
    // Note: chatInputStorageKey already reflects newSession, so we build the old key manually
    if (oldSession && oldSession !== 'new' && projectSlug.value) {
      const oldKey = `chat-input:${projectSlug.value}:${oldSession}`;
      if (inputValue.value) {
        localStorage.setItem(oldKey, inputValue.value);
      } else {
        localStorage.removeItem(oldKey);
      }
    }

    // Load input for new session
    if (newSession !== oldSession) {
      // Prevent the inputValue watcher from overwriting during transition
      isLoadingSession = true;

      // Clear current input first
      inputValue.value = '';

      // Need to wait for chatInputStorageKey to update (it depends on sessionParam)
      nextTick(() => {
        loadChatInput();
        if (editorInstance.value) {
          editorInstance.value.setContent(inputValue.value);
        }
        // Re-enable auto-save after loading is complete
        isLoadingSession = false;
      });
    }
  },
  { immediate: true },
);

// Model selection - persisted globally (not per-session)
const MODEL_STORAGE_KEY = 'claude-web:model';

function loadModelSelection() {
  const stored = localStorage.getItem(MODEL_STORAGE_KEY);
  if (stored && ['sonnet', 'opus', 'haiku'].includes(stored)) {
    modelSelection.value = stored;
  }
}

watch(modelSelection, (newModel) => {
  localStorage.setItem(MODEL_STORAGE_KEY, newModel);
});

// Load model on mount
loadModelSelection();

// Auto-clear completed status after 3 seconds
let completedStatusTimer = null;
watch(taskStatus, (newStatus) => {
  // Clear any existing timer
  if (completedStatusTimer) {
    clearTimeout(completedStatusTimer);
    completedStatusTimer = null;
  }

  // If task completed successfully, auto-clear after 3 seconds
  if (newStatus === 'completed') {
    completedStatusTimer = setTimeout(() => {
      clearTaskStatus();
      completedStatusTimer = null;
    }, 3000);
  }
});

const isRunning = computed(() => taskStatus.value === 'running');
const isNewSession = computed(() => sessionParam.value === 'new');

// Load session when connected
watch(
  [connected, projectSlug, sessionParam],
  ([isConnected, slug, session], [, prevSlug, prevSession]) => {
    if (isConnected && slug) {
      // Always select project first to set server-side context
      selectProject(slug);

      // Get project status (git branch, file changes)
      nextTick(() => getProjectStatus());

      // Track if we need to reload terminal processes
      const shouldReloadTerminal = slug !== prevSlug || session !== prevSession;
      if (shouldReloadTerminal && slug !== prevSlug) {
        manualExpandState.value = new Map(); // Clear expand state for new project
      }

      if (session === 'new') {
        clearMessages();
        // Wait for project selection to complete before creating new session
        nextTick(() => {
          newSession({
            dangerouslySkipPermissions: permissionMode.value === 'skip',
          });
        });
      } else if (session) {
        // Check if we're transitioning from 'new' to the actual session ID
        const isTransitionFromNew = prevSession === 'new';

        if (isTransitionFromNew) {
          // Transitioning from 'new' to actual session ID
          // Session is already selected (created by newSession()), don't re-select
          // Just update currentSession to match the new ID (should already be set by session_info)
          // Don't clear messages or call selectSession - preserve the conversation
        } else {
          // Switching to a different session
          // Clear messages immediately to prevent race condition
          clearMessages();
          // Wait for project selection to complete before selecting session
          // This prevents race condition where select_session arrives before project is selected
          nextTick(() => selectSession(session));
        }
      }

      // Reload terminal processes AFTER session selection to avoid race condition
      // Use nextTick to ensure project_selected message is processed first
      if (shouldReloadTerminal) {
        nextTick(() => listProcesses());
      }

      // Always fetch bookmarks when connected or project changes (project-scoped, cheap)
      nextTick(() =>
        send({ type: 'terminal:get_bookmarks', projectSlug: slug }),
      );
    }
  },
  { immediate: true },
);

// Watch for query params to handle file opening from file picker
watch(
  () => route.query,
  (query) => {
    // Handle mode switching from query param
    if (query.mode && ['chat', 'terminal', 'files'].includes(query.mode)) {
      currentMode.value = query.mode;
    }

    // Handle folder navigation from file picker (Cmd+P)
    if (query.folder && query.mode === 'files') {
      // If switching to Files mode for the first time, wait for component to mount
      // Use nextTick to ensure DOM updates and FileExplorer is ready
      nextTick(() => {
        // Add small delay to ensure FileExplorer is fully mounted and listening
        setTimeout(() => {
          send({
            type: 'files:browse',
            path: query.folder,
          });
        }, 100);
      });
      // Note: Keep folder param in URL so it stays after refresh
    }

    // Handle file opening from file picker (Cmd+P)
    if (query.file && query.mode === 'files') {
      // If switching to Files mode for the first time, wait for component to mount
      // Use nextTick to ensure DOM updates and FileEditor is ready
      nextTick(() => {
        // Add small delay to ensure FileEditor is fully mounted
        setTimeout(() => {
          // Open the file in the editor
          openedFile.value = { path: query.file, content: '', loading: true };

          // Request file content
          send({
            type: 'files:read',
            path: query.file,
          });
        }, 100);
      });
      // Note: Keep file param in URL so it stays after refresh
    }
  },
  { immediate: true },
);

function goBack() {
  router.push({ name: 'sessions', params: { project: projectSlug.value } });
}

// Session title editing
function startEditingSessionTitle() {
  editingSessionTitle.value = true;
  editingTitleValue.value = sessionTitle.value || '';
  nextTick(() => {
    titleInputRef.value?.focus();
    titleInputRef.value?.select();
  });
}

function saveSessionTitle() {
  if (editingSessionTitle.value) {
    setSessionTitle(editingTitleValue.value);
    editingSessionTitle.value = false;
    editingTitleValue.value = '';
  }
}

function cancelEditingSessionTitle() {
  editingSessionTitle.value = false;
  editingTitleValue.value = '';
}

function handleSubmit() {
  const prompt = inputValue.value.trim();
  if (!prompt || isRunning.value) return;

  // Check if server context is ready (prevents lost messages after reconnect)
  if (!contextReady.value) {
    console.warn(
      '[ChatView] Cannot send prompt - server context not ready (reconnecting?)',
    );
    // Don't clear input - user can retry after reconnect completes
    return;
  }

  inputValue.value = '';

  // Clear TinyMDE editor content
  if (editorInstance.value) {
    editorInstance.value.setContent('');
  }

  // Clear saved input on successful submit
  clearChatInput();

  const options = {
    model: modelSelection.value,
  };
  if (permissionMode.value === 'skip') {
    options.dangerouslySkipPermissions = true;
  } else if (permissionMode.value === 'bypass') {
    options.permissionMode = 'bypassPermissions';
  } else if (permissionMode.value === 'plan') {
    options.permissionMode = 'plan';
  }

  sendPrompt(prompt, options);
}

function scrollToBottom() {
  chatMessagesRef.value?.scrollToBottom();
}

// Note: Auto-scroll on messages and isRunning are now handled by ChatMessages component

// Initialize terminal mode when connection is ready
watch(connected, (isConnected) => {
  if (isConnected && currentMode.value === 'terminal') {
    listProcesses();
  }
});

// Watch for file reference from FilePicker (Cmd+P -> Reference button)
watch(fileReference, (path) => {
  if (path) {
    const reference = `@${path}`;
    const currentContent = inputValue.value;

    // Check if we need to add a space before the reference
    let needsSpace = false;
    if (currentContent.length > 0) {
      const lastChar = currentContent[currentContent.length - 1];
      // Add space if the last character is not a whitespace or newline
      needsSpace = lastChar !== ' ' && lastChar !== '\n' && lastChar !== '\t';
    }

    // Append the reference
    const newContent = currentContent + (needsSpace ? ' ' : '') + reference;
    inputValue.value = newContent;

    // Update TinyMDE editor (chat input always uses TinyMDE)
    if (editorInstance.value) {
      editorInstance.value.setContent(newContent);
    }

    // Save to localStorage
    saveChatInput();

    // Switch to chat mode if not already there
    if (currentMode.value !== 'chat') {
      currentMode.value = 'chat';
    }

    // Focus the input
    nextTick(() => {
      // Chat input always uses TinyMDE (contenteditable div)
      const editorDiv = editorEl.value?.querySelector('.TinyMDE');
      if (editorDiv) {
        editorDiv.focus();
        // Move cursor to end
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorDiv);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });

    // Clear the reference after processing
    fileReference.value = null;
  }
});

// Auto-scroll and reinitialize TinyMDE when switching modes
watch(currentMode, (mode, oldMode) => {
  if (mode === 'chat') {
    // Clear editor instance since DOM was destroyed
    editorInstance.value = null;
    nextTick(() => {
      scrollToBottom();
      // Reinitialize TinyMDE after DOM is ready
      initTinyMDE();
    });
  } else if (oldMode === 'chat') {
    // Save input when switching away from chat
    saveChatInput();
  }

  if (mode === 'terminal' && connected.value) {
    // Refresh terminal processes when switching to terminal mode
    listProcesses();
  }
});

// Save input to localStorage as user types (debounced by browser)
watch(inputValue, () => {
  // Skip saving during session transitions to avoid overwriting the new session's saved input
  if (!isLoadingSession) {
    saveChatInput();
  }
});

// Format file changes for display
const fileChangesText = computed(() => {
  const changes = projectStatus.value.gitChanges;
  if (!changes) return null;

  const parts = [];
  if (changes.added > 0) parts.push(`+${changes.added}`);
  if (changes.modified > 0) parts.push(`~${changes.modified}`);
  if (changes.deleted > 0) parts.push(`-${changes.deleted}`);

  return parts.length > 0 ? parts.join(' ') : null;
});

// Get branch color class based on branch name patterns
const branchColorClass = computed(() => {
  const branch = projectStatus.value.gitBranch;
  if (!branch) return '';

  const lower = branch.toLowerCase();

  // Main/master branches - green
  if (lower === 'main' || lower === 'master') {
    return 'branch-main';
  }

  // WIP/hotfix branches - orange
  if (lower.includes('wip') || lower.includes('hotfix')) {
    return 'branch-wip';
  }

  // Feature branches - yellow
  if (lower.includes('feature') || lower.includes('feat')) {
    return 'branch-feature';
  }

  // Default - no special color
  return '';
});

// Permission mode sync - watch for EnterPlanMode/ExitPlanMode tool usage
watch(
  () => messages.value,
  (msgs) => {
    // Look for recent plan mode changes in the last few messages
    for (let i = msgs.length - 1; i >= Math.max(0, msgs.length - 5); i--) {
      const msg = msgs[i];
      if (msg.type === 'tool_use') {
        if (msg.tool === 'EnterPlanMode') {
          permissionMode.value = 'plan';
          break;
        }
        if (msg.tool === 'ExitPlanMode') {
          // Exiting plan mode returns to default
          permissionMode.value = 'default';
          break;
        }
      }
    }
  },
  { deep: true },
);

// Note: groupedMessages computed is now inside ChatMessages component

// Auto-refresh git status when task completes
watch(isRunning, (running, wasRunning) => {
  // When task stops running (completes or errors)
  if (wasRunning && !running) {
    // Refresh git status after a brief delay to allow file operations to complete
    setTimeout(() => {
      getProjectStatus();
    }, 500);
  }
});

// Terminal functions
function toggleTerminalMode() {
  currentMode.value = currentMode.value === 'terminal' ? 'chat' : 'terminal';
  if (currentMode.value === 'terminal') {
    // Initialize CWD to project path if not set
    if (!terminalCwd.value && projectStatus.value.cwd) {
      terminalCwd.value = projectStatus.value.cwd;
    }
    // Fetch current processes when entering terminal mode
    listProcesses();
    nextTick(() => {
      terminalInputRef.value?.focus();
    });
  }
}

function handleTerminalSubmit() {
  const command = terminalInput.value.trim();
  if (!command) return;

  addToTerminalHistory(command);
  terminalHistoryIndex.value = -1;
  terminalHistoryTemp.value = '';

  // Use custom CWD if set, otherwise use project CWD
  const cwd = terminalCwd.value || projectStatus.value.cwd;
  execCommand(command, cwd);
  terminalInput.value = '';
}

function handleCwdFocus(e) {
  // If CWD is empty, fill it with the project CWD
  if (!terminalCwd.value && projectStatus.value.cwd) {
    terminalCwd.value = projectStatus.value.cwd;
  }
  // Select all text for easy editing
  e.target.select();
}

function handleTerminalKeydown(e) {
  const textarea = terminalInputRef.value;
  if (!textarea) return;

  // Terminal-specific Ctrl shortcuts (only Ctrl, not Cmd)
  if (e.ctrlKey && !e.metaKey) {
    const cursorPos = textarea.selectionStart;
    const value = textarea.value;

    switch (e.key) {
      case 'c': {
        // Ctrl+C: Clear current input
        e.preventDefault();
        e.stopPropagation(); // Prevent global handler
        terminalInput.value = '';
        terminalHistoryIndex.value = -1;
        terminalHistoryTemp.value = '';
        return;
      }
      case 'u': {
        // Ctrl+U: Clear from cursor to start
        e.preventDefault();
        e.stopPropagation();
        terminalInput.value = value.substring(cursorPos);
        nextTick(() => {
          textarea.selectionStart = 0;
          textarea.selectionEnd = 0;
        });
        return;
      }
      case 'k': {
        // Ctrl+K: Clear from cursor to end
        e.preventDefault();
        e.stopPropagation(); // Prevent session selector from opening
        terminalInput.value = value.substring(0, cursorPos);
        return;
      }
      case 'a': {
        // Ctrl+A: Move cursor to start
        e.preventDefault();
        e.stopPropagation();
        textarea.selectionStart = 0;
        textarea.selectionEnd = 0;
        return;
      }
      case 'e': {
        // Ctrl+E: Move cursor to end
        e.preventDefault();
        e.stopPropagation();
        textarea.selectionStart = value.length;
        textarea.selectionEnd = value.length;
        return;
      }
      case 'l': {
        // Ctrl+L: Clear input (existing behavior)
        e.preventDefault();
        terminalInput.value = '';
        terminalHistoryIndex.value = -1;
        terminalHistoryTemp.value = '';
        return;
      }
    }
  }

  // Up arrow: Navigate history backwards
  if (e.key === 'ArrowUp') {
    const history = getTerminalHistory();
    if (history.length === 0) return;

    e.preventDefault();

    if (terminalHistoryIndex.value === -1) {
      // Starting to browse history, save current input
      terminalHistoryTemp.value = terminalInput.value;
      terminalHistoryIndex.value = history.length - 1;
    } else if (terminalHistoryIndex.value > 0) {
      terminalHistoryIndex.value--;
    }

    terminalInput.value = history[terminalHistoryIndex.value] || '';
    // Move cursor to end
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    });
    return;
  }

  // Down arrow: Navigate history forwards
  if (e.key === 'ArrowDown') {
    if (terminalHistoryIndex.value === -1) return;

    e.preventDefault();

    const history = getTerminalHistory();
    if (terminalHistoryIndex.value < history.length - 1) {
      terminalHistoryIndex.value++;
      terminalInput.value = history[terminalHistoryIndex.value] || '';
    } else {
      // Back to current input
      terminalHistoryIndex.value = -1;
      terminalInput.value = terminalHistoryTemp.value;
      terminalHistoryTemp.value = '';
    }

    // Move cursor to end
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    });
    return;
  }

  // Enter handling for submit
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;

  const value = textarea.value;
  const cursorAtEnd = textarea.selectionStart === value.length;

  // If cursor is at the end and text doesn't end with \, submit
  if (cursorAtEnd && !value.trimEnd().endsWith('\\')) {
    e.preventDefault();
    handleTerminalSubmit();
  }
  // Otherwise, let default behavior insert newline
}

function handleTerminalKill(processId) {
  // Watch processes manage their own state via terminal:watch:* events.
  // Skipping the post-kill listProcesses() refresh avoids racing with those
  // broadcasts and preventing duplicate entries in the process list.
  const proc = terminalProcesses.value.find((p) => p.id === processId);
  const skipRefresh = proc?.isWatch ?? false;
  killProcess(processId, undefined, skipRefresh);
}

function handleTerminalClear(processId) {
  clearTerminal(processId);
}

function handleTerminalReplay(command, cwd) {
  // Execute the command again as if user ran it
  execCommand(command, cwd);
}

function handleAddBookmark(scope, command, cwd) {
  send({
    type: 'terminal:add_bookmark',
    scope,
    projectSlug: projectSlug.value,
    command,
    cwd,
  });
}

function handleRemoveBookmark(scope, id) {
  send({
    type: 'terminal:remove_bookmark',
    scope,
    projectSlug: projectSlug.value,
    id,
  });
}

function handlePlayBookmark(command, cwd) {
  terminalSubTab.value = 'history';
  execCommand(command, cwd || terminalCwd.value);
}

function handleWatchUpdate(bookmarkId, scope, watch) {
  const wasAlreadyActive = watchEnabledIds.value.has(bookmarkId);
  send({
    type: 'terminal:watch:update',
    bookmarkId,
    scope,
    projectSlug: projectSlug.value,
    watch,
  });
  // Only switch to active tab when newly enabling a watch (not reconfiguring one already running)
  if (watch?.enabled && !wasAlreadyActive) {
    terminalSubTab.value = 'active';
  }
}

function toggleHistoryExpand(processId) {
  const currentlyExpanded = expandedHistory.value.has(processId);
  const newMap = new Map(manualExpandState.value);
  newMap.set(processId, !currentlyExpanded);
  manualExpandState.value = newMap;
}

// Count running processes for badge (use global terminalCounts for immediate display on page load)
const runningProcessCount = computed(() => {
  return terminalCounts.value.get(projectSlug.value) || 0;
});

// Files mode computed
const filesBreadcrumbs = computed(() => {
  if (!filesCurrentPath.value) return [];
  const parts = filesCurrentPath.value.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    name: part,
    path: `/${parts.slice(0, index + 1).join('/')}`,
  }));
});

// Files mode functions
function goUpDirectory() {
  if (!filesCurrentPath.value || filesCurrentPath.value === '/') return;
  const parentPath =
    filesCurrentPath.value.split('/').slice(0, -1).join('/') || '/';
  handleFilesNavigate(parentPath);
}

function handleFilesNavigate(path) {
  filesCurrentPath.value = path;
  filesLoading.value = true;

  send({
    type: 'files:browse',
    path,
  });
}

function handleFileSelect(file) {
  // file.path is already absolute from backend
  openedFile.value = { path: file.path, content: '', loading: true };

  send({
    type: 'files:read',
    path: file.path,
  });
}

// Memo modal/sidebar state
const memoOpen = ref(false);
const quickAccessFile = ref(null); // { path, content, loading }
let memoAttempt = null;

function openMemo() {
  if (!projectStatus.value?.cwd) {
    return;
  }

  // Always default to TODO.md if not configured
  const filename = settingsContext?.quickAccessFile?.() || 'TODO.md';

  // Construct full path (assuming file is in project root)
  const fullPath = `${projectStatus.value.cwd}/${filename}`;

  // Mark this as a memo attempt
  memoAttempt = fullPath;

  // Open the modal/sidebar
  memoOpen.value = true;
  quickAccessFile.value = { path: fullPath, content: '', loading: true };

  // Request file content
  send({
    type: 'files:read',
    path: fullPath,
  });
}

function closeMemo() {
  memoOpen.value = false;
  quickAccessFile.value = null;
  memoAttempt = null;
}

function toggleMemo() {
  if (memoOpen.value) {
    closeMemo();
    // Refocus chat input
    nextTick(() => {
      const editable = editorEl.value?.querySelector('[contenteditable]');
      if (editable) {
        editable.focus();
        // Move cursor to end
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  } else {
    openMemo();
  }
}

function handleMemoSave(data) {
  send({
    type: 'files:write',
    path: data.path,
    content: data.content,
  });
}

const quickAccessFileName = computed(() => {
  if (!quickAccessFile.value?.path) return '';
  return quickAccessFile.value.path.split('/').pop();
});

const quickAccessFileSize = computed(() => {
  if (!quickAccessFile.value?.content) return '0 B';
  const bytes = new Blob([quickAccessFile.value.content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

const memoTotalLines = computed(() => {
  if (!quickAccessFile.value?.content) return 0;
  return quickAccessFile.value.content.split('\n').length;
});

const memoTotalChars = computed(() => {
  if (!quickAccessFile.value?.content) return 0;
  return quickAccessFile.value.content.length;
});

// Focus memo editor when content loads
watch(
  () => quickAccessFile.value?.loading,
  (isLoading, wasLoading) => {
    // When loading changes from true to false, content just loaded
    if (wasLoading && !isLoading && memoOpen.value && quickAccessFile.value) {
      nextTick(() => {
        // Wait for FileEditor/TinyMDE to fully render
        setTimeout(() => {
          // TinyMDE uses contenteditable div, not textarea
          const editorDiv = document.querySelector(
            '.memo-container .TinyMDE[contenteditable]',
          );
          if (editorDiv) {
            editorDiv.focus();
            // Move cursor to end of contenteditable
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(editorDiv);
            range.collapse(false); // false = collapse to end
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }, 150);
      });
    }
  },
);

function handleFileSave(data) {
  send({
    type: 'files:write',
    path: data.path,
    content: data.content,
  });
}

function handleFileClose() {
  openedFile.value = null;
}

function handleCreateFile() {
  fileModals.value.createFile = true;
}

function handleCreateFolder() {
  fileModals.value.createFolder = true;
}

function handleReference(item) {
  const reference = `@${item.path}`;
  const currentContent = inputValue.value;

  // Check if we need to add a space before the reference
  let needsSpace = false;
  if (currentContent.length > 0) {
    const lastChar = currentContent[currentContent.length - 1];
    // Add space if the last character is not a whitespace or newline
    needsSpace = lastChar !== ' ' && lastChar !== '\n' && lastChar !== '\t';
  }

  // Append the reference
  const newContent = currentContent + (needsSpace ? ' ' : '') + reference;
  inputValue.value = newContent;

  // Save to localStorage first
  saveChatInput();

  // Switch to chat mode (will reinitialize editor with saved content)
  currentMode.value = 'chat';

  // Focus the editor after it's ready
  nextTick(() => {
    nextTick(() => {
      const editable = editorEl.value?.querySelector('[contenteditable]');
      if (editable) {
        editable.focus();
        // Move cursor to end
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  });
}

function handleRename(item) {
  fileModals.value.rename = item;
  fileModals.value.renameNewName = item.name; // Pre-fill with current name
}

function handleDelete(item) {
  fileModals.value.delete = item;
}

function handleEditPath() {
  // Open inline path editing
  fileModals.value.editPath = true;
  fileModals.value.editPathValue = filesCurrentPath.value;
  nextTick(() => {
    pathEditInputRef.value?.focus();
    pathEditInputRef.value?.select();
  });
}

function cancelEditPath() {
  fileModals.value.editPath = false;
  fileModals.value.editPathValue = '';
}

// Modal confirmation functions
function confirmCreateFile() {
  const fileName = fileModals.value.createFileName.trim();
  if (!fileName) return;

  const filePath = `${filesCurrentPath.value}/${fileName}`.replace(/\/+/g, '/');

  // Store the path to open after creation
  fileModals.value.pendingFileToOpen = filePath;

  send({
    type: 'files:create',
    path: filePath,
    isDirectory: false,
  });

  fileModals.value.createFile = false;
  fileModals.value.createFileName = '';
}

function confirmCreateFolder() {
  const folderName = fileModals.value.createFolderName.trim();
  if (!folderName) return;

  const folderPath = `${filesCurrentPath.value}/${folderName}`.replace(
    /\/+/g,
    '/',
  );
  send({
    type: 'files:create',
    path: folderPath,
    isDirectory: true,
  });

  fileModals.value.createFolder = false;
  fileModals.value.createFolderName = '';
}

function confirmRename() {
  const item = fileModals.value.rename;
  const newName = fileModals.value.renameNewName.trim();
  if (!item || !newName) return;

  const oldPath = item.path;
  const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
  const newPath = `${parentDir}/${newName}`.replace(/\/+/g, '/');

  send({
    type: 'files:rename',
    oldPath,
    newPath,
  });

  fileModals.value.rename = null;
  fileModals.value.renameNewName = '';
}

function confirmDelete() {
  const item = fileModals.value.delete;
  if (!item) return;

  send({
    type: 'files:delete',
    path: item.path,
  });

  fileModals.value.delete = null;
}

function confirmEditPath() {
  const newPath = fileModals.value.editPathValue.trim();
  if (!newPath) return;

  handleFilesNavigate(newPath);
  fileModals.value.editPath = false;
  fileModals.value.editPathValue = '';
}

// File message handlers
function handleFileMessage(msg) {
  switch (msg.type) {
    case 'files:browse:result':
      filesCurrentPath.value = msg.path;
      filesItems.value = msg.items;
      filesLoading.value = false;
      break;
    case 'files:browse:error':
      console.error('Browse error:', msg.error);
      filesLoading.value = false;
      break;
    case 'files:read:result':
      // Handle regular file editor
      if (openedFile.value && openedFile.value.path === msg.path) {
        openedFile.value = {
          path: msg.path,
          content: msg.content,
          loading: false,
        };
      }
      // Handle quick access file
      if (quickAccessFile.value && quickAccessFile.value.path === msg.path) {
        quickAccessFile.value = {
          path: msg.path,
          content: msg.content,
          loading: false,
        };
        // Clear quick access attempt flag on success
        if (memoAttempt === msg.path) {
          memoAttempt = null;
        }
      }
      break;
    case 'files:read:error':
      console.error('Read error:', msg.error);
      // If this was a quick access file that doesn't exist, create it
      if (memoAttempt && quickAccessFile.value?.path === memoAttempt) {
        const path = memoAttempt;
        memoAttempt = null; // Clear the attempt flag
        // Create the file with empty content
        send({
          type: 'files:write',
          path: path,
          content: '',
        });
        // Open the newly created file in quick access
        quickAccessFile.value = { path: path, content: '', loading: false };
      } else if (memoAttempt && openedFile.value?.path === memoAttempt) {
        // Legacy: handle old quick access logic for regular file editor
        const path = memoAttempt;
        memoAttempt = null;
        send({
          type: 'files:write',
          path: path,
          content: '',
        });
        openedFile.value = { path: path, content: '', loading: false };
      } else if (openedFile.value) {
        openedFile.value = null;
      }
      break;
    case 'files:write:result':
      // File saved successfully
      break;
    case 'files:write:error':
      console.error('Write error:', msg.error);
      break;
    case 'files:create:result':
      // If we have a pending file to open, open it now
      if (fileModals.value.pendingFileToOpen === msg.path) {
        openedFile.value = { path: msg.path, content: '', loading: true };
        send({ type: 'files:read', path: msg.path });
        fileModals.value.pendingFileToOpen = null;
      }
      break;
    case 'files:create:error':
      console.error('Create error:', msg.error);
      fileModals.value.pendingFileToOpen = null;
      break;
  }
}

// Register message handler (returns unsubscribe fn, auto-cleaned up on unmount by composable)
onMessage(handleFileMessage);

// Handle bookmark and watch responses from server
onMessage((msg) => {
  if (msg.type === 'terminal:bookmarks') {
    bookmarks.value = { global: msg.global ?? [], project: msg.project ?? [] };
  } else if (msg.type === 'terminal:watch:state') {
    const next = new Set(msg.active ?? []);
    // Clean up completed process entries for watches that are no longer active
    for (const id of watchEnabledIds.value) {
      if (!next.has(id)) {
        removeWatchProcess(id);
      }
    }
    watchEnabledIds.value = next;
  }
});

// Clear stale watch state when switching projects so the UI doesn't show
// watches from the previous project during the transition window
watch(
  () => projectSlug.value,
  (_newSlug, oldSlug) => {
    if (oldSlug !== undefined) {
      watchEnabledIds.value = new Set();
    }
  },
);

// Initialize files mode when switching to it OR when projectStatus becomes available
watch(currentMode, (mode) => {
  if (mode === 'files' && !filesCurrentPath.value && projectStatus.value.cwd) {
    // Start from project root
    handleFilesNavigate(projectStatus.value.cwd);
  }
});

// Initialize files mode when projectStatus updates
// This handles: initial load, session changes, and project changes
watch(
  projectStatus,
  (status) => {
    if (
      status.cwd &&
      currentMode.value === 'files' &&
      !filesCurrentPath.value
    ) {
      handleFilesNavigate(status.cwd);

      // Restore opened file from URL if specified
      const query = route.query;
      if (query.file) {
        nextTick(() => {
          openedFile.value = { path: query.file, content: '', loading: true };
          send({ type: 'files:read', path: query.file });
        });
      }
    }
  },
  { immediate: true, deep: true },
);

// Clear files state when session changes (files mode is per-session, not per-project like terminal)
watch(currentSession, () => {
  // Clear all files state immediately
  filesCurrentPath.value = '';
  filesItems.value = [];
  filesLoading.value = false;
  openedFile.value = null;
  filesFilter.value = '';

  // Close git diff modal on session change to avoid stale data
  showGitDiffModal.value = false;

  // Don't reinitialize here - the projectStatus.cwd watcher will handle it
  // once the new project status arrives from the server
});

// Update page title when session title or project changes
watch(
  [sessionTitle, projectStatus, messages],
  () => {
    // Get project name (last segment of path)
    const path = projectStatus.value.cwd;
    const projectName = path ? path.split('/').filter(Boolean).pop() : '';

    // Get session title or first prompt as fallback
    const title = sessionTitle.value;
    let sessionDisplay = title;

    // If no custom title, use first prompt (truncated)
    if (!sessionDisplay && messages.value.length > 0) {
      const firstUserMsg = messages.value.find(
        (m) => m.type === 'text' && m.role === 'user',
      );
      if (firstUserMsg?.text) {
        // Truncate first prompt to ~50 chars
        const text = firstUserMsg.text.trim();
        sessionDisplay =
          text.length > 50 ? `${text.substring(0, 50)}...` : text;
      }
    }

    // Format: project-name / session-title-or-prompt (no tofucode prefix to save space)
    if (projectName && sessionDisplay) {
      document.title = `${projectName} / ${sessionDisplay}`;
    } else if (projectName) {
      document.title = projectName;
    } else if (sessionDisplay) {
      document.title = `tofucode / ${sessionDisplay}`;
    } else {
      document.title = 'tofucode';
    }
  },
  { deep: true, immediate: true },
);

// URL state management - sync mode, terminal tab, and opened file to URL
// Flag to prevent watch loops when syncing from URL
let syncingFromUrl = false;

// Update URL when mode changes
watch(currentMode, (mode) => {
  if (syncingFromUrl) return;
  const query = { ...route.query };
  if (mode !== 'chat') {
    query.mode = mode;
  } else {
    delete query.mode;
  }
  // Clear file query when leaving files mode
  if (mode !== 'files') {
    delete query.file;
  }
  router.push({ query });
});

// Update URL when terminal sub-tab changes
watch(terminalSubTab, (tab) => {
  if (syncingFromUrl) return;
  if (currentMode.value === 'terminal') {
    const query = { ...route.query };
    if (tab !== 'history') {
      query.terminalTab = tab;
    } else {
      delete query.terminalTab;
    }
    router.push({ query });
  }
});

// Update URL when file is opened/closed in files mode
watch(openedFile, (file) => {
  if (syncingFromUrl) return;
  if (currentMode.value === 'files') {
    const query = { ...route.query };
    if (file?.path) {
      query.file = file.path;
    } else {
      delete query.file;
    }
    router.push({ query });
  }
});

// Sync state from URL (handles back/forward navigation)
watch(
  () => route.query,
  (query) => {
    syncingFromUrl = true;

    // Sync mode from URL
    if (query.mode === 'terminal') {
      currentMode.value = 'terminal';
    } else if (query.mode === 'files') {
      currentMode.value = 'files';
    } else {
      currentMode.value = 'chat';
    }

    // Sync terminal sub-tab from URL
    if (query.terminalTab === 'active') {
      terminalSubTab.value = 'active';
    } else if (query.terminalTab === 'bookmarks') {
      terminalSubTab.value = 'bookmarks';
    } else {
      terminalSubTab.value = 'history';
    }

    // Sync opened file from URL
    if (query.file && currentMode.value === 'files') {
      if (!openedFile.value || openedFile.value.path !== query.file) {
        openedFile.value = { path: query.file, content: '', loading: true };
        send({ type: 'files:read', path: query.file });
      }
    } else if (currentMode.value === 'files' && !query.file) {
      openedFile.value = null;
    }

    nextTick(() => {
      syncingFromUrl = false;
    });
  },
  { deep: true },
);
</script>

<template>
  <div class="chat-view">
    <AppHeader :show-hamburger="false">
      <template #content>
        <div class="header-breadcrumb">
          <!-- Folder name (last segment) - links to sessions -->
          <div v-if="projectStatus.cwd" class="breadcrumb-folder-group">
            <router-link
              :to="{ name: 'sessions', params: { project: projectSlug } }"
              class="breadcrumb-folder"
            >
              {{ projectStatus.cwd.split('/').pop() }}
            </router-link>
            <router-link
              :to="{ name: 'chat', params: { project: projectSlug, session: 'new' } }"
              class="breadcrumb-new-session-btn"
              title="New session"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </router-link>
          </div>
          <span class="breadcrumb-separator">/</span>
          <!-- Session title (editable) -->
          <div class="session-title-row">
            <form v-if="editingSessionTitle" class="title-edit-form" @submit.prevent="saveSessionTitle">
              <input
                ref="titleInputRef"
                type="text"
                v-model="editingTitleValue"
                class="title-input"
                placeholder="Session title..."
                @keydown.escape.prevent="cancelEditingSessionTitle"
                @blur="saveSessionTitle"
              />
            </form>
            <div v-else-if="!isNewSession" class="session-title-display" @click="startEditingSessionTitle">
              <span class="session-title">{{ sessionTitle || 'Untitled session' }}</span>
              <svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </div>
            <span v-else class="session-title new">New session</span>
          </div>
        </div>
      </template>
      <template #actions>
        <!-- Status moved to footer mode tabs -->
      </template>
    </AppHeader>

    <!-- Session active elsewhere warning -->
    <div v-if="sessionActiveElsewhere" class="session-warning">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>This session is open in another tab. Sending messages may cause conflicts.</span>
    </div>

    <!-- Chat Mode -->
    <ChatMessages
      v-if="currentMode === 'chat'"
      ref="chatMessagesRef"
      :messages="messages"
      :is-running="isRunning"
      :is-new-session="isNewSession"
      :context-ready="contextReady"
      :has-older-messages="hasOlderMessages"
      :summary-count="summaryCount"
      :loading-older-messages="loadingOlderMessages"
      :total-turns="totalTurns"
      :loaded-turns="loadedTurns"
      @load-full-history="loadFullHistory"
      @load-older-messages="loadOlderMessages"
      @answer-question="handleAnswerQuestion"
    />

    <!-- Terminal Mode -->
    <main v-else-if="currentMode === 'terminal'" class="terminal">
      <TerminalOutput
        ref="terminalOutputRef"
        :processes="terminalProcesses"
        :expanded-history="expandedHistory"
        :active-tab="terminalSubTab"
        :bookmarks="bookmarks"
        :watch-enabled-ids="watchEnabledIds"
        :project-slug="projectSlug"
        @kill="handleTerminalKill"
        @clear="handleTerminalClear"
        @toggle-expand="toggleHistoryExpand"
        @update:active-tab="terminalSubTab = $event"
        @replay="handleTerminalReplay"
        @add-bookmark="handleAddBookmark"
        @remove-bookmark="handleRemoveBookmark"
        @play-bookmark="handlePlayBookmark"
        @watch-update="handleWatchUpdate"
      />
    </main>

    <!-- Files Mode -->
    <main v-else-if="currentMode === 'files'" class="files-mode">
      <FileEditor
        v-if="openedFile"
        ref="fileEditorRef"
        :file-path="openedFile.path"
        :content="openedFile.content"
        :loading="openedFile.loading"
        :auto-save="autoSaveFilesEnabled"
        @save="handleFileSave"
        @close="handleFileClose"
      />
      <FileExplorer
        v-else
        :current-path="filesCurrentPath"
        :items="filteredFilesItems"
        :loading="filesLoading"
        @navigate="handleFilesNavigate"
        @select-file="handleFileSelect"
        @reference="handleReference"
        @rename="handleRename"
        @delete="handleDelete"
      />
    </main>

    <!-- File editor header (above footer, only when editing a file) -->
    <div v-if="currentMode === 'files' && openedFile" class="editor-header">
      <span class="editor-file-name">{{ openedFileName }}</span>
      <span v-if="fileEditorRef?.isDirty" class="editor-dirty-indicator" title="Unsaved changes">*</span>
      <div class="editor-header-spacer"></div>
      <span class="editor-stats">
        <span class="stat-item" :title="`File size: ${fileSize}`">{{ fileSize }}</span>
        <span class="stat-item" :title="`Total lines: ${totalLines}`">≡ {{ totalLines }}</span>
        <span class="stat-item" :title="`Total characters: ${totalChars}`">∑ {{ totalChars }}</span>
      </span>
      <button
        class="action-btn"
        :disabled="!fileEditorRef?.isDirty || fileEditorRef?.isSaving"
        title="Save (Cmd+S)"
        @click="fileEditorRef?.save()"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
      </button>
      <button
        class="action-btn"
        title="Close"
        @click="fileEditorRef?.close()"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <footer class="footer">
      <!-- Files explorer header (only in files mode) - moved above toolbar -->
      <div v-if="currentMode === 'files'" class="files-explorer-header">
        <div class="files-breadcrumb">
          <button
            class="breadcrumb-btn"
            @click="goUpDirectory"
            :disabled="!filesCurrentPath || filesCurrentPath === '/'"
            title="Go up"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <button
            class="breadcrumb-btn"
            @click="projectStatus.cwd && handleFilesNavigate(projectStatus.cwd)"
            :disabled="!projectStatus.cwd || filesCurrentPath === projectStatus.cwd"
            title="Go to project root"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </button>
          <!-- Path editing inline input -->
          <form v-if="fileModals.editPath" class="breadcrumb-edit-form" @submit.prevent="confirmEditPath">
            <input
              ref="pathEditInputRef"
              type="text"
              v-model="fileModals.editPathValue"
              class="breadcrumb-edit-input"
              placeholder="/path/to/folder"
              @keydown.escape.prevent="cancelEditPath"
              @blur="cancelEditPath"
            />
          </form>
          <!-- Path display with breadcrumbs -->
          <div v-else class="breadcrumb-scroll" @click="handleEditPath">
            <span class="breadcrumb-path">
              <template v-if="!filesCurrentPath || filesCurrentPath === '/'">/</template>
              <template v-else>
                <span
                  v-for="(crumb, index) in filesBreadcrumbs"
                  :key="index"
                  class="breadcrumb-item"
                >
                  <span class="breadcrumb-separator">/</span>
                  <button class="breadcrumb-link" @click.stop="handleFilesNavigate(crumb.path)">
                    {{ crumb.name }}
                  </button>
                </span>
              </template>
            </span>
          </div>
          <button v-if="!fileModals.editPath" class="breadcrumb-btn" @click="handleEditPath" title="Edit path">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <span
            class="toolbar-item branch"
            :class="[{ clickable: fileChangesText }, branchColorClass]"
            v-if="projectStatus.gitBranch"
            @click="openGitDiffModal"
            :title="`${projectStatus.gitBranch}${fileChangesText ? ' - Click to view changes' : ''}`"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="6" y1="3" x2="6" y2="15"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span class="branch-name">{{ projectStatus.gitBranch }}</span>
            <span class="git-changes" v-if="fileChangesText">{{ fileChangesText }}</span>
          </span>
          <span class="toolbar-item no-git" v-else-if="projectStatus.cwd">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            No git
          </span>
        </div>
        <div class="toolbar-right">
          <!-- Files mode tool icons -->
          <button
            v-if="filesMode"
            class="action-btn"
            :class="{ active: showDotfiles }"
            @click="showDotfiles = !showDotfiles"
            title="Show dotfiles"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="1"/>
            </svg>
          </button>
          <button
            v-if="filesMode"
            class="action-btn"
            @click="fileModals.createFile = true"
            title="New file"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </button>
          <button
            v-if="filesMode"
            class="action-btn"
            @click="fileModals.createFolder = true"
            title="New folder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
          </button>
          <button
            v-if="filesMode"
            class="action-btn md-btn"
            :class="{ active: mdMode }"
            @click="mdMode = !mdMode"
            title="Markdown mode - filter .md files only with auto-save"
          >
            MD
          </button>

          <!-- Terminal clear button (terminal mode, history tab only) — placed before subnav to avoid layout shift -->
          <button
            v-if="terminalMode && terminalSubTab === 'history'"
            class="action-btn clear-terminal-btn"
            @click="handleTerminalClear()"
            title="Clear completed processes"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Clear
          </button>

          <!-- Terminal subnav (terminal mode only) -->
          <div v-if="terminalMode" class="terminal-subnav">
            <button
              class="terminal-subnav-tab"
              :class="{ active: terminalSubTab === 'history' }"
              @click="terminalSubTab = 'history'"
              title="Command history"
            >
              <!-- Clock for History -->
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span class="subnav-label">History</span>
            </button>
            <button
              class="terminal-subnav-tab"
              :class="{ active: terminalSubTab === 'active' }"
              @click="terminalSubTab = 'active'"
              title="Active processes"
            >
              <!-- Lightning bolt for Active -->
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              <span class="subnav-label">Active</span>
              <span v-if="runningProcessCount > 0" class="subnav-badge">{{ runningProcessCount }}</span>
            </button>
            <button
              class="terminal-subnav-tab"
              :class="{ active: terminalSubTab === 'bookmarks' }"
              @click="terminalSubTab = 'bookmarks'"
              title="Bookmarks"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span class="subnav-label">Bookmarks</span>
            </button>
          </div>

          <!-- Model selector (chat mode only) -->
          <div v-if="!terminalMode && !filesMode" class="model-tabs">
            <button
              class="model-tab"
              :class="{ active: modelSelection === 'haiku' }"
              @click="modelSelection = 'haiku'"
              title="Haiku - Fast & lightweight"
            >
              H
            </button>
            <button
              class="model-tab"
              :class="{ active: modelSelection === 'sonnet' }"
              @click="modelSelection = 'sonnet'"
              title="Sonnet - Balanced (default)"
            >
              S
            </button>
            <button
              class="model-tab"
              :class="{ active: modelSelection === 'opus' }"
              @click="modelSelection = 'opus'"
              title="Opus - Most capable"
            >
              O
            </button>
          </div>
          <!-- Permission tabs (chat mode only) -->
          <div v-if="!terminalMode && !filesMode" class="permission-tabs">
            <button
              class="permission-tab"
              :class="{ active: permissionMode === 'default' }"
              @click="permissionMode = 'default'"
              title="Default - Ask for permissions"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </button>
            <button
              class="permission-tab plan"
              :class="{ active: permissionMode === 'plan' }"
              @click="permissionMode = 'plan'"
              title="Plan Mode - Read-only exploration"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </button>
            <button
              class="permission-tab bypass"
              :class="{ active: permissionMode === 'bypass' }"
              @click="permissionMode = 'bypass'"
              title="Bypass Permissions - Auto-approve safe operations"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
              </svg>
            </button>
            <button
              class="permission-tab skip"
              :class="{ active: permissionMode === 'skip' }"
              @click="permissionMode = 'skip'"
              title="Skip Permissions - No permission checks (dangerous)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </button>
            <!-- Memo file button (beside permission tabs) -->
            <button
              v-if="settingsContext?.enableMemo?.()"
              class="memo-btn"
              @click="openMemo"
              :title="`Memo: ${settingsContext?.quickAccessFile?.() || 'TODO.md'}`"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Chat input -->
      <form v-if="currentMode === 'chat'" class="input-form" :class="['permission-' + permissionMode, { 'reconnecting': !contextReady }]" @submit.prevent="handleSubmit" @click="focusChatInput">
        <span class="chat-prompt">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <div
          ref="editorEl"
          class="input tinyMDE"
          :style="{ maxHeight: textareaMaxHeight + 'px' }"
        ></div>
        <!-- Clear/Undo button (top-right) -->
        <button
          v-if="showUndoButton"
          type="button"
          class="clear-undo-btn undo"
          @click.stop="handleUndoClear"
          title="Undo clear"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
          </svg>
        </button>
        <button
          v-else-if="showClearButton"
          type="button"
          class="clear-undo-btn clear"
          @click.stop="handleClearInput"
          title="Clear input"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <!-- Reconnecting overlay -->
        <span v-if="!contextReady" class="reconnecting-indicator" title="Reconnecting to server...">
          <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          Reconnecting...
        </span>
        <button
          type="submit"
          class="send-btn"
          :disabled="!inputValue.trim() || isRunning || !contextReady"
          title="Send (Ctrl+Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 10 4 15 9 20"/>
            <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
          </svg>
        </button>
      </form>

      <!-- Terminal input -->
      <form v-else-if="currentMode === 'terminal'" class="terminal-form" @submit.prevent="handleTerminalSubmit">
        <div class="terminal-input-row">
          <span class="terminal-prompt">$</span>
          <textarea
            ref="terminalInputRef"
            v-model="terminalInput"
            class="terminal-input"
            placeholder="Enter command... (Enter to run, \ for multiline)"
            rows="1"
            @keydown="handleTerminalKeydown"
            @keydown.ctrl.enter.prevent="handleTerminalSubmit"
            @keydown.meta.enter.prevent="handleTerminalSubmit"
          ></textarea>
          <button type="submit" class="run-btn" :disabled="!terminalInput.trim()">
            Run
          </button>
        </div>
        <div class="terminal-cwd-row">
          <label for="terminal-cwd" class="cwd-label">cwd:</label>
          <input
            id="terminal-cwd"
            v-model="terminalCwd"
            type="text"
            class="cwd-input"
            :placeholder="projectStatus.cwd || '/path/to/directory'"
            @focus="handleCwdFocus"
          />
        </div>
      </form>

      <!-- Files filter input -->
      <div v-else-if="currentMode === 'files'" class="files-filter-form">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          v-model="filesFilter"
          type="text"
          class="files-filter-input"
          placeholder="Filter files... (supports fuzzy & glob: *.md)"
        />
        <button
          v-if="filesFilter"
          type="button"
          class="clear-btn"
          @click="filesFilter = ''"
          title="Clear filter"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Mode tabs at bottom: Chat | Terminal | Files -->
      <div class="mode-tabs">
        <!-- Hamburger button -->
        <button class="hamburger-btn" @click="sidebar.toggle" title="Toggle sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        <div class="mode-tabs-group">
          <button
            class="mode-tab"
            :class="{ active: currentMode === 'chat' }"
            @click="currentMode = 'chat'"
            title="Chat mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="mode-label">Chat</span>
          </button>
          <button
            class="mode-tab terminal-tab"
            :class="{ active: currentMode === 'terminal' }"
            @click="handleTerminalTabClick"
            title="Terminal mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <span class="mode-label">Terminal</span>
          </button>
          <button
            class="mode-tab"
            :class="{ active: currentMode === 'files' }"
            @click="currentMode = 'files'"
            title="Files mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            <span class="mode-label">Files</span>
          </button>
        </div>

        <!-- Recent sessions switcher -->
        <template v-if="displayedRecentSessions.length > 0">
          <div class="recent-sessions-group">
            <a
              v-for="session in displayedRecentSessions"
              :key="session.sessionId"
              :href="getSessionUrl(session)"
              class="recent-session-item"
              :title="getSessionDisplayTitle(session)"
            >
              <!-- Status indicator at start -->
              <span
                v-if="sessionStatuses.get(session.sessionId)"
                class="recent-session-status"
                :class="sessionStatuses.get(session.sessionId).status"
              >
                <!-- Running: spinner -->
                <svg
                  v-if="sessionStatuses.get(session.sessionId).status === 'running'"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  class="status-spinner"
                >
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                <!-- Completed: checkmark -->
                <svg
                  v-else-if="sessionStatuses.get(session.sessionId).status === 'completed'"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <!-- Error: X -->
                <svg
                  v-else-if="sessionStatuses.get(session.sessionId).status === 'error'"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </span>
              <span class="recent-session-text">{{ getSessionDisplayTitle(session) }}</span>
            </a>
          </div>
        </template>

        <!-- Task status indicator (flex right) -->
        <div class="task-status-indicator">
          <button
            v-if="isRunning"
            class="status-stop-btn"
            @click="cancelTask"
            title="Stop running task"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="6" width="12" height="12" rx="1"/>
            </svg>
          </button>
          <span
            v-else-if="taskStatus === 'completed'"
            class="status-completed"
            title="Completed"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          <span
            v-else-if="taskStatus === 'error'"
            class="status-error"
            title="Error"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </span>
        </div>
      </div>
    </footer>

    <!-- File operation modals -->
    <Teleport to="body">
      <!-- Create file modal -->
      <div v-if="fileModals.createFile" class="modal-overlay" @click="fileModals.createFile = false">
        <div class="modal" @click.stop>
          <h3>Create New File</h3>
          <form @submit.prevent="confirmCreateFile">
            <input
              ref="createFileInputRef"
              type="text"
              v-model="fileModals.createFileName"
              placeholder="filename.txt"
              class="modal-input"
              autofocus
            />
            <div class="modal-actions">
              <button type="button" @click="fileModals.createFile = false" class="modal-btn cancel">Cancel</button>
              <button type="submit" class="modal-btn confirm">Create</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Create folder modal -->
      <div v-if="fileModals.createFolder" class="modal-overlay" @click="fileModals.createFolder = false">
        <div class="modal" @click.stop>
          <h3>Create New Folder</h3>
          <form @submit.prevent="confirmCreateFolder">
            <input
              type="text"
              v-model="fileModals.createFolderName"
              placeholder="folder-name"
              class="modal-input"
              autofocus
            />
            <div class="modal-actions">
              <button type="button" @click="fileModals.createFolder = false" class="modal-btn cancel">Cancel</button>
              <button type="submit" class="modal-btn confirm">Create</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Rename modal -->
      <div v-if="fileModals.rename" class="modal-overlay" @click="fileModals.rename = null">
        <div class="modal" @click.stop>
          <h3>Rename</h3>
          <form @submit.prevent="confirmRename">
            <input
              type="text"
              v-model="fileModals.renameNewName"
              :placeholder="fileModals.rename?.name"
              class="modal-input"
              autofocus
            />
            <div class="modal-actions">
              <button type="button" @click="fileModals.rename = null" class="modal-btn cancel">Cancel</button>
              <button type="submit" class="modal-btn confirm">Rename</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Delete confirmation modal -->
      <div v-if="fileModals.delete" class="modal-overlay" @click="fileModals.delete = null">
        <div class="modal" @click.stop>
          <h3>Delete {{ fileModals.delete?.isDirectory ? 'Folder' : 'File' }}</h3>
          <p>Are you sure you want to delete <strong>{{ fileModals.delete?.name }}</strong>?</p>
          <p v-if="fileModals.delete?.isDirectory" class="warning">This will delete the folder and all its contents!</p>
          <div class="modal-actions">
            <button type="button" @click="fileModals.delete = null" class="modal-btn cancel">Cancel</button>
            <button type="button" @click="confirmDelete" class="modal-btn danger">Delete</button>
          </div>
        </div>
      </div>

    </Teleport>

    <!-- Git Diff Modal -->
    <GitDiffModal
      v-if="showGitDiffModal"
      :project-path="projectStatus.cwd"
      :send-and-wait="sendAndWait"
      @close="closeGitDiffModal"
    />

    <!-- AskUserQuestion Modal -->
    <AskUserQuestionModal
      :show="showQuestionModal"
      :questions="questionModalData?.questions || []"
      :tool-use-id="questionModalData?.toolUseId"
      @submit="handleQuestionSubmit"
      @close="closeQuestionModal"
    />

    <!-- Debug Popover -->
    <DebugPopover
      v-if="debugModeEnabled"
      :visible="!!hoveredElement"
      :position="popoverPosition"
      :data="popoverData"
    />

    <!-- Memo Modal/Sidebar -->
    <div v-if="memoOpen" class="memo-overlay">
      <div class="memo-container">
        <FileEditor
          v-if="quickAccessFile"
          :file-path="quickAccessFile.path"
          :content="quickAccessFile.content"
          :loading="quickAccessFile.loading"
          :auto-save="autoSaveFilesEnabled"
          @save="handleMemoSave"
        />
        <div class="memo-footer">
          <div class="memo-info">
            <span class="memo-filename">{{ quickAccessFileName }}</span>
            <span class="memo-stats">
              {{ quickAccessFileSize }} · {{ memoTotalLines }} lines · {{ memoTotalChars }} chars
            </span>
          </div>
          <button class="memo-close-btn" @click="closeMemo" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Import TinyMDE CSS */
@import 'tiny-markdown-editor/dist/tiny-mde.min.css';

/* TinyMDE dark theme overrides */
.TinyMDE {
  background-color: transparent;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  padding: 0;
}

/* Only constrain height in the chat input, not in file editor */
.tinyMDE .TinyMDE {
  max-height: 300px;
  overflow-y: auto;
}

.TinyMDE.TinyMDE_empty::before {
  color: var(--text-muted);
}

/* Code blocks */
.TMCode,
.TMFencedCodeBacktick,
.TMFencedCodeTilde,
.TMIndentedCode {
  background-color: var(--bg-tertiary);
  font-family: var(--font-mono);
}

.TMCodeFenceBacktickOpen,
.TMCodeFenceTildeOpen {
  border-bottom-color: var(--border-color);
  font-family: var(--font-mono);
}

.TMCodeFenceBacktickClose,
.TMCodeFenceTildeClose {
  border-top-color: var(--border-color);
  font-family: var(--font-mono);
}

.TMCode {
  border-color: var(--border-color);
}

/* Markdown syntax markers */
.TMMark {
  color: var(--text-muted);
}

.TMMark_TMH1,
.TMMark_TMH2,
.TMMark_TMOL,
.TMMark_TMUL {
  color: var(--warning-color);
}

/* Blockquotes */
.TMBlockquote {
  border-left-color: var(--border-color);
}

/* Links */
.TMLink {
  text-decoration-color: var(--accent-color);
}

.TMAutolink,
.TMLinkDestination {
  color: var(--accent-color);
}

.TMLinkLabel_Definition,
.TMLinkLabel_Valid {
  color: var(--success-color);
}

.TMLinkLabel_Invalid {
  color: var(--error-color);
}

/* Info string (language in code fence) */
.TMInfoString {
  color: var(--text-muted);
}

/* Horizontal rule */
.TMHR::before {
  border-bottom-color: var(--border-color);
}

/* HTML */
.TMHTML,
.TMHTMLBlock {
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
</style>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.messages-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.session-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(245, 158, 11, 0.15);
  border-bottom: 1px solid rgba(245, 158, 11, 0.3);
  color: var(--warning-color);
  font-size: 13px;
}

.session-warning svg {
  flex-shrink: 0;
}

.header-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.breadcrumb-folder-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.breadcrumb-folder {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s;
}

.breadcrumb-folder:hover {
  color: var(--text-primary);
}

.breadcrumb-new-session-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  text-decoration: none;
}

.breadcrumb-new-session-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.breadcrumb-separator {
  color: var(--text-muted);
  font-size: 14px;
}

.session-title-row {
  flex: 1;
  min-width: 0;
}

.session-title-display {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.session-title-display:hover {
  background: var(--bg-hover);
}

.session-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-title.new {
  color: var(--text-muted);
  font-style: italic;
}

.session-title-display .edit-icon {
  opacity: 0;
  color: var(--text-muted);
  transition: opacity 0.15s;
}

.session-title-display:hover .edit-icon {
  opacity: 1;
}

.title-edit-form {
  display: inline-block;
}

.title-input {
  padding: 2px 6px;
  font-size: 14px;
  font-weight: 500;
  background: var(--bg-primary);
  border: 1px solid var(--text-muted);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  min-width: 200px;
}

.title-input:focus {
  outline: none;
  border-color: var(--text-secondary);
}

.cancel-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-md);
  color: var(--error-color);
  transition: background 0.15s, border-color 0.15s;
}

.cancel-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.status-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 20px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  text-transform: capitalize;
}

.status-badge.running {
  background: rgba(245, 158, 11, 0.15);
  color: var(--warning-color);
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success-color);
}

.status-badge.error {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error-color);
}

.messages {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}

.jump-to-bottom {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  z-index: 10;
  box-shadow: var(--shadow-md);
  transition: background 0.15s, color 0.15s;
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.jump-to-bottom:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.messages-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 100%;
  overflow-x: hidden;
  padding-bottom: 16px;
}

.older-messages {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
  border-bottom: 1px dashed var(--border-color);
  margin-bottom: 8px;
}

.load-older-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  transition: background 0.15s, color 0.15s;
}

.load-older-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.summary-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-secondary);
  border-radius: 10px;
  color: var(--text-muted);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
}

.empty-hint {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.typing {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-lg);
  width: fit-content;
  margin: 16px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: typing 1.4s infinite ease-in-out;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* File editor header (between main content and footer) */
.editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-top: 1px solid var(--border-color);
}

.editor-file-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.editor-dirty-indicator {
  color: var(--warning-color);
  font-size: 14px;
  font-weight: bold;
  line-height: 1;
  flex-shrink: 0;
  margin-left: -4px;
}

.editor-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.editor-stats .stat-item {
  white-space: nowrap;
}

.editor-header-spacer {
  flex: 1;
  min-width: 0;
}

.editor-header .action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s, opacity 0.15s;
  flex-shrink: 0;
}

.editor-header .action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.editor-header .action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  margin-bottom: 8px;
  min-height: 28px; /* Consistent height when permission tabs hidden */
}


.toolbar-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar .action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.toolbar .action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toolbar .action-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.toolbar .action-btn svg {
  flex-shrink: 0;
}

.toolbar-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  min-width: 0; /* Allow shrinking */
}

.toolbar-item.branch {
  color: var(--text-secondary);
  max-width: 250px; /* Limit branch width to prevent pushing toolbar */
}

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.git-changes {
  flex-shrink: 0; /* Don't shrink the changes count */
  white-space: nowrap;
}

/* Branch color coding */
.toolbar-item.branch.branch-main {
  color: rgb(34, 197, 94); /* green-500 */
}

.toolbar-item.branch.branch-wip {
  color: rgb(249, 115, 22); /* orange-500 */
}

.toolbar-item.branch.branch-feature {
  color: rgb(234, 179, 8); /* yellow-500 */
}

.toolbar-item.branch.clickable {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.toolbar-item.branch.clickable:hover {
  background: var(--bg-hover);
}

.toolbar-item.branch .git-changes {
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--warning-color);
}

.toolbar-item.no-git {
  color: var(--text-muted);
  font-style: italic;
}

.toolbar-item.file-activity {
  gap: 6px;
  color: var(--text-secondary);
  max-width: 300px;
  animation: file-pulse 1.5s ease-in-out infinite;
}

.file-activity .file-tool {
  font-weight: 500;
}

.file-activity .file-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

@keyframes file-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

/* Model tabs */
.model-tabs {
  display: flex;
  gap: 2px;
  margin-right: 8px;
  flex-shrink: 0; /* Don't shrink */
}

.model-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
}

.model-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.model-tab.active {
  color: var(--accent-color);
  background: rgba(147, 51, 234, 0.15);
}

.permission-tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0; /* Don't shrink */
}

.permission-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
}

.permission-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.permission-tab.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

/* Plan mode - green */
.permission-tab.plan:hover {
  color: var(--success-color);
  background: rgba(34, 197, 94, 0.1);
}

.permission-tab.plan.active {
  color: var(--success-color);
  background: rgba(34, 197, 94, 0.15);
}

/* Bypass mode - yellow/warning */
.permission-tab.bypass:hover {
  color: var(--warning-color);
  background: rgba(245, 158, 11, 0.1);
}

.permission-tab.bypass.active {
  color: var(--warning-color);
  background: rgba(245, 158, 11, 0.15);
}

/* Skip mode - orange/danger */
.permission-tab.skip:hover {
  color: #f97316;
  background: rgba(249, 115, 22, 0.1);
}

.permission-tab.skip.active {
  color: #f97316;
  background: rgba(249, 115, 22, 0.15);
}

/* Mode tabs (Chat/Terminal toggle) */
.mode-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  width: 100%;
}

.hamburger-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.hamburger-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.memo-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.memo-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mode-tabs-group {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.mode-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
}

.mode-tab:hover {
  color: var(--text-secondary);
}

.mode-tab.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

/* Hide mode tab labels on mobile - show icons only */
@media (max-width: 639px) {
  .mode-label {
    display: none;
  }

  /* Reduce padding when showing icons only */
  .mode-tab {
    padding: 6px 10px;
  }
}

.mode-badge {
  font-size: 10px;
  padding: 1px 5px;
  background: var(--warning-color);
  color: var(--bg-primary);
  border-radius: 10px;
  font-weight: 600;
}

/* Terminal subnav (in toolbar-right, replaces inline subtabs) */
.terminal-subnav {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
}

.terminal-subnav-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.terminal-subnav-tab:hover {
  color: var(--text-secondary);
}

.terminal-subnav-tab.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.subnav-badge {
  font-size: 10px;
  padding: 1px 5px;
  background: var(--warning-color);
  color: var(--bg-primary);
  border-radius: 10px;
  font-weight: 600;
}

/* Mobile: hide subnav labels, show icons only */
@media (max-width: 639px) {
  .subnav-label {
    display: none;
  }
  .terminal-subnav-tab {
    padding: 4px 8px;
  }
}

/* Files explorer header (above toolbar) */
.files-explorer-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  background: var(--bg-primary);
}

.files-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.files-explorer-header .breadcrumb-scroll {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--text-muted) transparent;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.files-explorer-header .breadcrumb-scroll:hover {
  background: var(--bg-hover);
}

.breadcrumb-edit-form {
  flex: 1;
  min-width: 0;
}

.breadcrumb-edit-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 13px;
  font-family: var(--font-mono);
  background: var(--bg-primary);
  border: 1px solid var(--text-muted);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
}

.breadcrumb-edit-input:focus {
  border-color: var(--text-primary);
}

.files-explorer-header .breadcrumb-scroll::-webkit-scrollbar {
  height: 4px;
}

.files-explorer-header .breadcrumb-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.files-explorer-header .breadcrumb-scroll::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 2px;
}

.files-explorer-header .breadcrumb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.files-explorer-header .breadcrumb-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.files-explorer-header .breadcrumb-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.files-explorer-header .breadcrumb-path {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.files-explorer-header .breadcrumb-separator {
  color: var(--text-muted);
  margin: 0 4px;
}

.files-explorer-header .breadcrumb-link {
  color: var(--text-secondary);
  background: transparent;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.files-explorer-header .breadcrumb-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}


.files-explorer-header .action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.files-explorer-header .action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.files-explorer-header .action-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

/* Recent sessions switcher */
.recent-sessions-group {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.recent-session-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 150px;
  min-width: 0;
  flex-shrink: 1;
}

.recent-session-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.recent-session-status {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.recent-session-status.running {
  color: #3b82f6;
}

.recent-session-status.completed {
  color: var(--success-color);
}

.recent-session-status.error {
  color: var(--error-color);
}

.recent-session-status .status-spinner {
  animation: spin 1s linear infinite;
}

.recent-session-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.2);
}

.recent-session-item:active {
  transform: scale(0.98);
}

/* Mobile: Flex to fill space */
@media (max-width: 639px) {
  .recent-sessions-group {
    flex: 1;
    max-width: 100%;
    overflow: hidden;
  }

  .recent-session-item {
    flex: 1;
    min-width: 0;
    max-width: none;
  }
}

/* Task status indicator in mode tabs bar */
.task-status-indicator {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.status-stop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-sm);
  color: var(--error-color);
  transition: background 0.15s, border-color 0.15s;
}

.status-stop-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.status-completed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--success-color);
}

.status-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--error-color);
}

.input-form {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 32px 8px 8px;
  transition: border-color 0.15s, opacity 0.15s;
  cursor: text;
}

.input-form:focus-within {
  border-color: var(--text-muted);
}

/* Permission mode border colors */
.input-form.permission-plan {
  border-color: var(--success-color);
}

.input-form.permission-bypass {
  border-color: var(--warning-color);
}

.input-form.permission-skip {
  border-color: #f97316; /* orange */
}

.chat-prompt {
  color: var(--text-muted);
  display: flex;
  align-items: center;
  align-self: flex-start;
  padding-left: 4px;
  padding-top: 4px;
}

.input-form.permission-plan .chat-prompt {
  color: var(--success-color);
}

.input-form.permission-bypass .chat-prompt {
  color: var(--warning-color);
}

.input-form.permission-skip .chat-prompt {
  color: #f97316;
}

.input {
  flex: 1;
  min-height: 60px;
  line-height: 1.5;
  font-size: 13px;
  background: transparent;
  color: var(--text-primary);
  resize: none;
  overflow-y: auto;
}

/* TinyMDE editor styling */
.input.tinyMDE {
  outline: none;
  border: none;
  padding: 0;
}

.input.tinyMDE:empty::before {
  content: 'Send a message... (Ctrl+Enter to send)';
  color: var(--text-muted);
}

.input::placeholder {
  color: var(--text-muted);
}

.send-btn {
  position: absolute;
  bottom: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  transition: color 0.15s, background 0.15s;
}

.send-btn:disabled {
  opacity: 0.3;
}

.send-btn:not(:disabled):hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* Clear/Undo button (top-right of input) */
.clear-undo-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: var(--bg-primary);
  transition: all 0.15s;
  z-index: 10;
}

.clear-undo-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.clear-undo-btn.undo {
  color: var(--success-color);
}

.clear-undo-btn.undo:hover {
  color: var(--success-color);
  background: var(--bg-hover);
}

/* Reconnecting state */
.input-form.reconnecting {
  opacity: 0.7;
  pointer-events: none;
}

.input-form.reconnecting .input {
  pointer-events: none;
}

.reconnecting-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  background: var(--bg-primary);
  padding: 4px 10px;
  border-radius: 4px;
  z-index: 10;
}

.reconnecting-indicator .spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Terminal mode styles */
.terminal-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 6px 8px;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
}

.terminal-toggle:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.terminal-toggle.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.terminal-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  background: var(--warning-color);
  color: #000;
  border-radius: 10px;
}

.terminal {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.terminal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  font-family: var(--font-mono);
}

.terminal-form:focus-within {
  border-color: var(--text-muted);
}

.terminal-input-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.terminal-cwd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--border-color);
  margin: 0 -12px -10px -12px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
}

.cwd-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.cwd-input {
  flex: 1;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;
  padding: 2px 4px;
  min-width: 0;
}

.cwd-input::placeholder {
  color: var(--text-muted);
}

/* Files filter form */
.files-filter-form {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.files-filter-form:focus-within {
  border-color: var(--text-muted);
}

.files-filter-form .search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.files-filter-input {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
  color: var(--text-primary);
  border: none;
  outline: none;
  min-width: 0;
}

.files-filter-input::placeholder {
  color: var(--text-muted);
}

.files-filter-form .clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.files-filter-form .clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.terminal-prompt {
  color: var(--success-color);
  font-weight: 500;
  align-self: flex-start;
  padding-top: 2px;
}

.terminal-input {
  flex: 1;
  min-height: 60px;
  line-height: 1.5;
  font-family: var(--font-mono);
  font-size: 13px;
  background: transparent;
  color: var(--text-primary);
  resize: none;
  overflow-y: auto;
}

.terminal-input::placeholder {
  color: var(--text-muted);
}

.run-btn {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.run-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.run-btn:disabled {
  opacity: 0.4;
}

/* Files mode styles */
.files-mode {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.files-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.modal h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal p {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.modal p.warning {
  color: var(--error-color);
  font-weight: 500;
}

.modal-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  margin-bottom: 16px;
  outline: none;
  transition: border-color 0.15s;
}

.modal-input:focus {
  border-color: var(--accent-color);
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.modal-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.modal-btn.cancel {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.modal-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-btn.confirm {
  background: var(--text-primary);
  color: var(--bg-primary);
}

.modal-btn.confirm:hover {
  opacity: 0.9;
}

.modal-btn.danger {
  background: var(--error-color);
  color: #fff;
}

.modal-btn.danger:hover {
  opacity: 0.9;
}

/* Mobile styles - only icons, no text labels */
@media (max-width: 639px) {
  /* Toolbar - keep single line on mobile */
  .toolbar {
    gap: 8px;
  }

  .toolbar-left {
    flex: 1;
    min-width: 0;
  }

  .toolbar-right {
    flex-shrink: 0;
  }

  /* Mode tabs - keep single line on mobile */
  .mode-tabs {
    flex-wrap: nowrap;
    gap: 4px;
  }

  /* Branch - smaller max width on mobile */
  .toolbar-item.branch {
    max-width: 180px;
  }
}

/* Memo Modal/Sidebar */
.memo-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  align-items: stretch;
}

.memo-container {
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.memo-container :deep(.file-editor) {
  flex: 1;
  min-height: 0;
}

.memo-footer {
  border-top: 1px solid var(--border-color);
  padding: 12px 16px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--bg-secondary);
}

.memo-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  flex: 1;
  min-width: 0;
}

.memo-filename {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memo-stats {
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memo-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.memo-close-btn:hover {
  background: var(--bg-active);
  border-color: var(--border-hover);
}

.memo-close-btn svg {
  width: 16px;
  height: 16px;
}

/* Tablet and Desktop: Right sidebar (>600px) */
@media (min-width: 601px) {
  .memo-overlay {
    background: transparent;
    pointer-events: none;
  }

  .memo-container {
    width: 450px;
    box-shadow:
      -2px 0 8px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(255, 255, 255, 0.1),
      -4px 0 12px rgba(255, 255, 255, 0.05);
    pointer-events: auto;
  }
}
</style>
