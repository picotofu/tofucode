import { computed, onUnmounted, readonly, ref } from 'vue';

// ============================================
// GLOBAL STATE (shared across all components)
// Used for: project list, session list, folder browser
// ============================================

const globalConnected = ref(false);
const globalConnectionState = ref('disconnected'); // 'connected' | 'connecting' | 'disconnected'
const projects = ref([]);
const sessions = ref([]);
const recentSessions = ref([]);
const folderContents = ref([]);
const currentFolder = ref(null);
// Track task status per session for sidebar indicators
// Map of sessionId -> { status: 'running' | 'completed' | 'error', timestamp }
const sessionStatuses = ref(new Map());
// Track terminal process counts per project
// Map of projectSlug -> count
const terminalCounts = ref(new Map());

// Version info
const currentVersion = ref(null);
const updateAvailable = ref(null); // { currentVersion, latestVersion, updateUrl }

// Root path restriction (if --root is set on server)
const rootPath = ref(null);
// Home path — topmost browsable directory (rootPath if set, otherwise server home)
const homePath = ref(null);
// True once the first recent_sessions response is received
const sessionsReady = ref(false);

// Tasks panel state
const tasks = ref([]);
const tasksNextCursor = ref(null);
const tasksReady = ref(false);
const tasksError = ref(null);
const taskDetail = ref(null);
const taskDetailLoading = ref(false);
const taskSaveStatus = ref(null); // 'saving' | 'saved' | 'error' | null
const taskStatusOptions = ref([]); // available status names from DB schema
const taskAssignees = ref([]); // workspace users [{id, name, email}]
const taskSelfId = ref(null); // Notion user ID of the token owner
const taskComments = ref([]);
const taskCommentsLoading = ref(false);
const lastCreatedPageId = ref(null);

// Board view state
const boardTasks = ref([]);
const boardTasksReady = ref(false);
const boardTasksError = ref(null);
const boardStatusField = ref(null); // status field name for drag-drop updates
const boardStatusFieldType = ref(null); // 'status' | 'select'
const boardColumnOrder = ref([]); // custom column order from notion config
const boardFilterBySelf = ref(true); // filter board to only show self-assigned tasks (default on)

// LocalStorage key for persistent filter state
const TASKS_FILTER_KEY = 'tofucode:tasks-filter';

function loadTasksFilter() {
  try {
    const stored = localStorage.getItem(TASKS_FILTER_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        filterByAssignee: parsed.filterByAssignee ?? '__self__',
        filterByStatus: parsed.filterByStatus ?? '',
        titleSearch: '',
      };
    }
  } catch {
    // ignore parse errors
  }
  return { filterByAssignee: '__self__', filterByStatus: '', titleSearch: '' };
}

const tasksFilter = ref(loadTasksFilter());
let tasksAppending = false; // module-level flag for pagination append vs replace

// Clone dialog state (global so sidebar + homepage can both trigger it)
const showCloneDialog = ref(false);
const cloneInitialDir = ref(null);

function openCloneDialog(initialDir = null) {
  cloneInitialDir.value = initialDir;
  showCloneDialog.value = true;
  // Ensure currentFolder is populated (resolves to $HOME on server) so the
  // modal can default the destination field even when opened from non-home pages
  if (!currentFolder.value) {
    sendGlobal({ type: 'browse_folder', path: null });
  }
}

function closeCloneDialog() {
  showCloneDialog.value = false;
  cloneInitialDir.value = null;
}

let globalWs = null;
let globalReconnectTimeout = null;

// Global message listeners for components
const globalMessageListeners = [];

// Callbacks to run when connection is established
let onConnectCallbacks = [];

function connectGlobal(onConnect) {
  // Register callback if provided
  if (onConnect) {
    onConnectCallbacks.push(onConnect);
  }

  // If already connected, run callback immediately
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    if (onConnect) onConnect();
    return;
  }

  // If already connecting, just wait for callback
  if (globalWs && globalWs.readyState === WebSocket.CONNECTING) {
    return;
  }

  // Clear any pending reconnect
  if (globalReconnectTimeout) {
    clearTimeout(globalReconnectTimeout);
    globalReconnectTimeout = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  globalConnectionState.value = 'connecting';
  globalWs = new WebSocket(wsUrl);

  globalWs.onopen = () => {
    globalConnected.value = true;
    globalConnectionState.value = 'connected';
    // Request current task statuses to restore sidebar indicators after page refresh
    sendGlobal({ type: 'get_task_statuses' });
    // Run all pending callbacks
    const callbacks = onConnectCallbacks;
    onConnectCallbacks = [];
    for (const cb of callbacks) {
      cb();
    }
  };

  globalWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleGlobalMessage(msg);
  };

  globalWs.onclose = () => {
    globalConnected.value = false;
    globalConnectionState.value = 'disconnected';
    globalWs = null;
    globalReconnectTimeout = setTimeout(connectGlobal, 3000);
  };

  globalWs.onerror = () => {
    globalConnected.value = false;
    globalConnectionState.value = 'disconnected';
  };
}

// Add a global message listener
function addGlobalMessageListener(callback) {
  globalMessageListeners.push(callback);
  // Return unsubscribe function
  return () => {
    const index = globalMessageListeners.indexOf(callback);
    if (index > -1) {
      globalMessageListeners.splice(index, 1);
    }
  };
}

function handleGlobalMessage(msg) {
  switch (msg.type) {
    case 'connected':
      if (msg.version) {
        currentVersion.value = msg.version;
      }
      if (msg.rootPath) {
        rootPath.value = msg.rootPath;
      }
      if (msg.homePath) {
        homePath.value = msg.homePath;
      }
      break;

    case 'update_available':
      // Check if already dismissed for this version
      if (msg.latestVersion) {
        const dismissedKey = `dismissed-update:${msg.latestVersion}`;
        if (localStorage.getItem(dismissedKey) !== 'true') {
          updateAvailable.value = {
            currentVersion: msg.currentVersion,
            latestVersion: msg.latestVersion,
            updateUrl: msg.updateUrl,
          };
        }
      }
      break;

    case 'upgrade_started':
    case 'upgrade_installing':
    case 'restart_started':
      // These are informational - Sidebar handles the UI state
      console.log(msg.type, msg.message);
      break;

    case 'upgrade_success':
      // Clear update badge on successful upgrade
      updateAvailable.value = null;
      console.log(msg.type, msg.message);
      break;

    case 'upgrade_error':
    case 'restart_error':
      // Show error in console (Sidebar handles UI)
      console.error(msg.type, msg.message);
      break;

    case 'projects_list':
      projects.value = msg.projects;
      break;

    case 'project_selected':
      sessions.value = msg.sessions;
      break;

    case 'sessions_list':
      sessions.value = msg.sessions;
      break;

    case 'recent_sessions':
      recentSessions.value = msg.sessions;
      sessionsReady.value = true;
      break;

    case 'folder_contents':
      folderContents.value = msg.contents;
      currentFolder.value = msg.path;
      break;

    case 'session_title_updated':
      // Update title in sessions list
      if (msg.success) {
        sessions.value = sessions.value.map((s) =>
          s.sessionId === msg.sessionId ? { ...s, title: msg.title } : s,
        );
        recentSessions.value = recentSessions.value.map((s) =>
          s.sessionId === msg.sessionId ? { ...s, title: msg.title } : s,
        );
      }
      break;

    case 'task_status':
      // Track session task status for sidebar indicators
      if (msg.sessionId) {
        const newStatuses = new Map(sessionStatuses.value);
        if (msg.status === 'running') {
          newStatuses.set(msg.sessionId, {
            status: 'running',
            timestamp: Date.now(),
          });
          // Refresh sessions to show running session in sidebar
          getRecentSessions();
        } else if (msg.status === 'completed') {
          newStatuses.set(msg.sessionId, {
            status: 'completed',
            timestamp: Date.now(),
          });
          // Refresh sessions to update timestamps
          getRecentSessions();
        } else if (msg.status === 'error') {
          newStatuses.set(msg.sessionId, {
            status: 'error',
            timestamp: Date.now(),
          });
          // Refresh sessions to update timestamps
          getRecentSessions();
        } else if (msg.status === 'idle' || msg.status === 'cancelled') {
          // Clear status for idle/cancelled
          newStatuses.delete(msg.sessionId);
        }
        sessionStatuses.value = newStatuses;
      }
      break;

    case 'task_statuses':
      // Restore task statuses on initial load (after page refresh)
      if (msg.statuses && Array.isArray(msg.statuses)) {
        const newStatuses = new Map();
        for (const status of msg.statuses) {
          if (status.sessionId) {
            newStatuses.set(status.sessionId, {
              status: status.status,
              timestamp: status.timestamp,
            });
          }
        }
        sessionStatuses.value = newStatuses;
      }
      // Restore terminal counts per project
      if (msg.terminalCounts && typeof msg.terminalCounts === 'object') {
        const newCounts = new Map();
        for (const [projectSlug, count] of Object.entries(msg.terminalCounts)) {
          newCounts.set(projectSlug, count);
        }
        terminalCounts.value = newCounts;
      }
      break;

    case 'terminal_counts':
      // Update terminal counts (broadcast from server when processes start/exit)
      if (msg.terminalCounts && typeof msg.terminalCounts === 'object') {
        const newCounts = new Map();
        for (const [projectSlug, count] of Object.entries(msg.terminalCounts)) {
          newCounts.set(projectSlug, count);
        }
        terminalCounts.value = newCounts;
      }
      break;

    case 'session_opened':
      // Clear status indicator when session is opened
      if (msg.sessionId) {
        const newStatuses = new Map(sessionStatuses.value);
        newStatuses.delete(msg.sessionId);
        sessionStatuses.value = newStatuses;
      }
      break;

    case 'session_deleted':
      // Remove session from lists
      if (msg.sessionId) {
        sessions.value = sessions.value.filter(
          (s) => s.sessionId !== msg.sessionId,
        );
        recentSessions.value = recentSessions.value.filter(
          (s) => s.sessionId !== msg.sessionId,
        );
        // Clear status indicator if exists
        const newStatuses = new Map(sessionStatuses.value);
        newStatuses.delete(msg.sessionId);
        sessionStatuses.value = newStatuses;
      }
      break;

    case 'files:create:result':
      // Auto-refresh folder browser after successful folder creation
      if (msg.isDirectory && currentFolder.value) {
        browseFolder(currentFolder.value);
      }
      break;

    case 'files:create:error':
      // Logged here; components listen via onMessage for user-facing feedback
      console.error('File creation error:', msg.error);
      break;

    case 'tasks:list_result':
      tasksReady.value = true;
      if (msg.success) {
        if (tasksAppending) {
          tasks.value = [...tasks.value, ...(msg.tickets || [])];
        } else {
          tasks.value = msg.tickets || [];
        }
        tasksNextCursor.value = msg.nextCursor || null;
        tasksError.value = null;
      } else {
        tasks.value = [];
        tasksNextCursor.value = null;
        tasksError.value = msg.error || 'Failed to load tasks';
      }
      tasksAppending = false;
      break;

    case 'tasks:fetch_result':
      taskDetailLoading.value = false;
      if (msg.success) {
        taskDetail.value = msg;
      } else {
        taskDetail.value = { error: msg.error || 'Failed to load task' };
      }
      break;

    case 'tasks:create_result':
      if (msg.success && msg.pageId) {
        lastCreatedPageId.value = msg.pageId;
      }
      break;

    case 'tasks:update_result':
      // Status update — no local state change needed; task detail re-fetch handles it
      break;

    case 'tasks:replace_result':
      taskSaveStatus.value = msg.success ? 'saved' : 'error';
      break;

    case 'tasks:status_options_result':
      if (msg.success) {
        taskStatusOptions.value = msg.options || [];
      }
      break;

    case 'tasks:assignees_result':
      if (msg.success) {
        taskAssignees.value = msg.users || [];
        taskSelfId.value = msg.selfId || null;
      }
      break;

    case 'tasks:comments_result':
      taskCommentsLoading.value = false;
      if (msg.success) {
        taskComments.value = msg.comments || [];
      }
      break;

    case 'tasks:add_comment_result':
      if (msg.success && msg.pageId) {
        getTaskComments(msg.pageId);
      }
      break;

    case 'tasks:board_list_result':
      boardTasksReady.value = true;
      if (msg.success) {
        boardTasks.value = msg.tickets || [];
        boardTasksError.value = null;
        if (msg.statusField) boardStatusField.value = msg.statusField;
        if (msg.statusFieldType)
          boardStatusFieldType.value = msg.statusFieldType;
      } else {
        boardTasks.value = [];
        boardTasksError.value = msg.error || 'Failed to load board tasks';
      }
      break;
  }
  // Call all registered message listeners
  for (const listener of globalMessageListeners) {
    listener(msg);
  }
}

function sendGlobal(message) {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify(message));
  }
}

/**
 * Send a message and wait for a specific response type
 * @param {object} message - Message to send
 * @param {string} responseType - Expected response message type
 * @param {number} timeout - Timeout in ms (default 30000)
 * @returns {Promise<object>} Response message
 */
function sendAndWait(message, responseType, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    let timeoutId;

    const messageHandler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === responseType) {
          clearTimeout(timeoutId);
          globalWs.removeEventListener('message', messageHandler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };

    timeoutId = setTimeout(() => {
      globalWs.removeEventListener('message', messageHandler);
      reject(new Error(`Timeout waiting for ${responseType}`));
    }, timeout);

    globalWs.addEventListener('message', messageHandler);
    globalWs.send(JSON.stringify(message));
  });
}

// Debounced getProjects to prevent duplicate calls from Sidebar + view components
let projectsDebounceTimer = null;
function getProjects() {
  if (projectsDebounceTimer) {
    clearTimeout(projectsDebounceTimer);
  }
  projectsDebounceTimer = setTimeout(() => {
    projectsDebounceTimer = null;
    sendGlobal({ type: 'get_projects' });
  }, 50);
}

function selectProjectGlobal(slug) {
  sendGlobal({ type: 'select_project', path: slug });
}

function getSessions() {
  sendGlobal({ type: 'get_sessions' });
}

// Debounced getRecentSessions to prevent multiple rapid calls
let recentSessionsDebounceTimer = null;
function getRecentSessions() {
  // Clear any pending request
  if (recentSessionsDebounceTimer) {
    clearTimeout(recentSessionsDebounceTimer);
  }
  // Debounce by 150ms - fast enough to feel responsive, slow enough to batch
  recentSessionsDebounceTimer = setTimeout(() => {
    recentSessionsDebounceTimer = null;
    sendGlobal({ type: 'get_recent_sessions' });
  }, 150);
}

// Immediate version for explicit user actions (e.g., opening sidebar)
// Still debounced at 50ms to coalesce duplicate calls from Sidebar + view components
function getRecentSessionsImmediate() {
  if (recentSessionsDebounceTimer) {
    clearTimeout(recentSessionsDebounceTimer);
  }
  recentSessionsDebounceTimer = setTimeout(() => {
    recentSessionsDebounceTimer = null;
    sendGlobal({ type: 'get_recent_sessions' });
  }, 50);
}

// Higher-limit version for the command palette (needs full history for search)
function getRecentSessionsForPalette() {
  if (recentSessionsDebounceTimer) {
    clearTimeout(recentSessionsDebounceTimer);
    recentSessionsDebounceTimer = null;
  }
  sendGlobal({ type: 'get_recent_sessions', limit: 200 });
}

function browseFolder(path) {
  sendGlobal({ type: 'browse_folder', path });
}

function createFolder(folderPath) {
  sendGlobal({ type: 'files:create', path: folderPath, isDirectory: true });
}

function setSessionTitle(sessionId, title) {
  sendGlobal({ type: 'set_session_title', sessionId, title });
}

function deleteSessionGlobal(sessionId) {
  sendGlobal({ type: 'delete_session', sessionId });
}

function dismissUpdate(version) {
  localStorage.setItem(`dismissed-update:${version}`, 'true');
  updateAvailable.value = null;
}

// Tasks panel actions
function buildTasksListPayload(filter, extra = {}) {
  const payload = {
    type: 'tasks:list',
    filterByStatus: filter.filterByStatus || undefined,
    titleSearch: filter.titleSearch || undefined,
    ...extra,
  };
  if (filter.filterByAssignee === '__self__') {
    payload.filterBySelf = true;
  } else if (filter.filterByAssignee) {
    payload.filterByAssignee = filter.filterByAssignee;
    payload.filterBySelf = false;
  } else {
    payload.filterBySelf = false;
  }
  return payload;
}

function getTasks() {
  tasksAppending = false;
  tasksReady.value = false;
  tasksError.value = null;
  sendGlobal(buildTasksListPayload(tasksFilter.value));
}

function loadMoreTasks() {
  if (!tasksNextCursor.value) return;
  tasksAppending = true;
  sendGlobal(
    buildTasksListPayload(tasksFilter.value, { cursor: tasksNextCursor.value }),
  );
}

function setTasksFilter(partial) {
  tasksFilter.value = { ...tasksFilter.value, ...partial };
  // Persist assignee + status (never title search)
  try {
    localStorage.setItem(
      TASKS_FILTER_KEY,
      JSON.stringify({
        filterByAssignee: tasksFilter.value.filterByAssignee,
        filterByStatus: tasksFilter.value.filterByStatus,
      }),
    );
  } catch {
    // ignore storage errors
  }
  getTasks();
}

function fetchTaskDetail(pageId) {
  taskDetailLoading.value = true;
  taskDetail.value = null;
  sendGlobal({ type: 'tasks:fetch', pageId });
}

function clearTaskDetail() {
  taskDetail.value = null;
}

function createTask(title, assigneeId) {
  let resolvedAssigneeId = null;
  if (assigneeId === '__self__') {
    resolvedAssigneeId = taskSelfId.value ?? null;
  } else if (assigneeId) {
    resolvedAssigneeId = assigneeId;
  }
  sendGlobal({ type: 'tasks:create', title, assigneeId: resolvedAssigneeId });
}

function updateTaskStatus(pageId, status) {
  sendGlobal({ type: 'tasks:update', pageId, status });
}

function replaceTaskBody(pageId, body) {
  taskSaveStatus.value = 'saving';
  sendGlobal({ type: 'tasks:replace', pageId, body });
}

function getTaskStatusOptions() {
  sendGlobal({ type: 'tasks:get_status_options' });
}

function getTaskAssignees() {
  sendGlobal({ type: 'tasks:get_assignees' });
}

function getTaskComments(pageId) {
  taskCommentsLoading.value = true;
  sendGlobal({ type: 'tasks:get_comments', pageId });
}

function addTaskComment(pageId, content) {
  sendGlobal({ type: 'tasks:add_comment', pageId, content });
}

function updateTaskField(pageId, field, fieldType, value) {
  sendGlobal({ type: 'tasks:update', pageId, field, fieldType, value });
}

function getBoardTasks() {
  boardTasksReady.value = false;
  boardTasksError.value = null;
  sendGlobal({
    type: 'tasks:board_list',
    filterBySelf: boardFilterBySelf.value,
  });
}

function addTaskOption(pageId, field, fieldType, optionName, currentValues) {
  sendGlobal({
    type: 'tasks:add_option',
    pageId,
    field,
    fieldType,
    optionName,
    currentValues,
  });
}

function disconnectGlobal() {
  if (globalReconnectTimeout) {
    clearTimeout(globalReconnectTimeout);
    globalReconnectTimeout = null;
  }
  if (globalWs) {
    globalWs.close();
    globalWs = null;
  }
}

/**
 * Global WebSocket composable
 * Used by ProjectsView and SessionsView for shared data
 */
export function useWebSocket() {
  return {
    // State (readonly)
    connected: readonly(globalConnected),
    connectionState: readonly(globalConnectionState),
    projects: readonly(projects),
    sessions: readonly(sessions),
    recentSessions: readonly(recentSessions),
    sessionsReady: readonly(sessionsReady),
    folderContents: readonly(folderContents),
    currentFolder: readonly(currentFolder),
    sessionStatuses: readonly(sessionStatuses),
    terminalCounts: readonly(terminalCounts),
    currentVersion: readonly(currentVersion),
    updateAvailable: readonly(updateAvailable),
    rootPath: readonly(rootPath),
    homePath: readonly(homePath),

    // Tasks panel
    tasks: readonly(tasks),
    tasksNextCursor: readonly(tasksNextCursor),
    tasksReady: readonly(tasksReady),
    tasksError: readonly(tasksError),
    taskDetail: readonly(taskDetail),
    taskDetailLoading: readonly(taskDetailLoading),
    taskSaveStatus: readonly(taskSaveStatus),
    taskStatusOptions: readonly(taskStatusOptions),
    taskAssignees: readonly(taskAssignees),
    taskSelfId: readonly(taskSelfId),
    taskComments: readonly(taskComments),
    taskCommentsLoading: readonly(taskCommentsLoading),
    lastCreatedPageId: readonly(lastCreatedPageId),
    tasksFilter: readonly(tasksFilter),

    // Clone dialog
    showCloneDialog: readonly(showCloneDialog),
    cloneInitialDir: readonly(cloneInitialDir),
    openCloneDialog,
    closeCloneDialog,

    // Connection
    connect: connectGlobal,
    disconnect: disconnectGlobal,

    // Actions
    getProjects,
    selectProject: selectProjectGlobal,
    getSessions,
    getRecentSessions,
    getRecentSessionsImmediate,
    getRecentSessionsForPalette,
    browseFolder,
    createFolder,
    setSessionTitle,
    deleteSession: deleteSessionGlobal,
    dismissUpdate,

    // Tasks panel
    getTasks,
    loadMoreTasks,
    setTasksFilter,
    fetchTaskDetail,
    clearTaskDetail,
    createTask,
    updateTaskStatus,
    updateTaskField,
    replaceTaskBody,
    getTaskStatusOptions,
    getTaskAssignees,
    getTaskComments,
    addTaskComment,

    // Board view
    boardTasks: readonly(boardTasks),
    boardTasksReady: readonly(boardTasksReady),
    boardTasksError: readonly(boardTasksError),
    boardStatusField: readonly(boardStatusField),
    boardStatusFieldType: readonly(boardStatusFieldType),
    boardColumnOrder: readonly(boardColumnOrder),
    boardFilterBySelf,
    getBoardTasks,
    addTaskOption,

    // Direct send
    send: sendGlobal,
    sendAndWait,

    // Message listeners
    onMessage: addGlobalMessageListener,
  };
}

/**
 * Set the board column order from the Notion config (called by App.vue on notion:config).
 * Exported as a standalone function so App.vue can update shared state without an extra WS round-trip.
 * @param {string[]} order
 */
export function setBoardColumnOrder(order) {
  boardColumnOrder.value = Array.isArray(order) ? order : [];
}

// ============================================
// SCOPED STATE (per ChatView instance)
// Each chat tab gets its own WebSocket + state
// ============================================

/**
 * Create a scoped WebSocket connection for a chat session
 * Each call creates a new independent connection with its own state
 */
export function useChatWebSocket() {
  // Per-instance state
  const connected = ref(false);
  const connectionState = ref('disconnected'); // 'connected' | 'connecting' | 'disconnected'
  const messages = ref([]);
  const currentProject = ref(null);
  const currentSession = ref(null);
  const sessionTitle = ref(null);
  const taskStatus = ref('idle');
  const hasOlderMessages = ref(false);
  const summaryCount = ref(0);
  const sessionActiveElsewhere = ref(false); // True if session is open in another tab
  const totalEntries = ref(0); // Total entries in JSONL (for pagination)
  const messagesOffset = ref(0); // Current offset for pagination
  const loadingOlderMessages = ref(false); // Loading state for "Load older" button
  const totalTurns = ref(0); // Total turn count
  const loadedTurns = ref(0); // Currently loaded turn count
  const projectStatus = ref({
    cwd: null,
    gitBranch: null,
    gitChanges: null,
  });
  // Track if server-side context is ready (project selected and acknowledged)
  // This prevents sending prompts before server has our context after reconnect
  const contextReady = ref(false);

  // Message queue state — prompts queued while a task is running
  const queuedMessages = ref([]); // Array of { id, prompt, options, queuedAt }
  const queueSize = computed(() => queuedMessages.value.length);

  // Pending AskUserQuestion waiting for user response
  const pendingQuestion = ref(null); // { toolUseId, questions }

  // Terminal state
  const terminalProcesses = ref([]); // Array of process entries

  let ws = null;
  let reconnectTimeout = null;
  const messageHandlers = new Set();

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    connectionState.value = 'connecting';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connected.value = true;
      connectionState.value = 'connected';
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
      for (const handler of messageHandlers) {
        handler(msg);
      }
    };

    ws.onclose = () => {
      connected.value = false;
      connectionState.value = 'disconnected';
      // Server context is lost on disconnect - need to re-select project on reconnect
      contextReady.value = false;
      // Only reconnect if ws reference still exists (not explicitly disconnected)
      const shouldReconnect = ws !== null;
      ws = null;
      if (shouldReconnect) {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      connected.value = false;
      connectionState.value = 'disconnected';
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        break;

      case 'project_selected':
        currentProject.value = msg.project || { slug: msg.path };
        // Server has acknowledged our project selection
        // But don't set contextReady yet - wait for session selection too
        break;

      case 'session_selected':
        console.log(
          '[useChatWebSocket] Received session_selected:',
          `sessionId=${msg.sessionId}`,
          `currentSession=${currentSession.value}`,
          `hasHistory=${msg.hasHistory}`,
          `projectPath=${msg.projectPath}`,
        );
        // Handle new session flow first (both null)
        if (msg.sessionId === null && currentSession.value === null) {
          // Both null - new session flow - no history to wait for
          contextReady.value = true;
          console.log(
            '[useChatWebSocket] New session flow - contextReady set to true',
          );
        } else if (msg.sessionId === currentSession.value) {
          // Session match - update state
          sessionActiveElsewhere.value = msg.isActiveElsewhere || false;
          // Don't clear messages here - selectSession() already did it
          // Clearing again creates a race window for cross-session messages
          // For brand new sessions with no history, set contextReady immediately
          // For existing sessions, wait for session_history to load
          if (msg.hasHistory === false) {
            // Brand new session with no history - ready immediately
            contextReady.value = true;
            console.log(
              '[useChatWebSocket] No history - contextReady set to true',
            );
          } else {
            console.log('[useChatWebSocket] Waiting for session_history...');
          }
          // Otherwise, don't set contextReady yet - wait for session_history to load first
        } else {
          // Session mismatch - this shouldn't happen but log it
          console.warn(
            `[useChatWebSocket] session_selected mismatch. Expected: ${currentSession.value}, Got: ${msg.sessionId}`,
          );
          // Don't set contextReady to true - wait for correct session
        }
        // Note: Don't clear terminalProcesses here - it causes a race condition
        // because listProcesses() is called before selectSession(), so the processes
        // load first and then get cleared. Terminal processes are project-scoped
        // and will be refreshed by listProcesses() in ChatView.vue
        break;

      case 'session_active_elsewhere':
        sessionActiveElsewhere.value = msg.isActiveElsewhere;
        break;

      case 'session_history':
        // Only accept history if it matches current session (prevents race condition)
        console.log(
          '[useChatWebSocket] Received session_history:',
          `sessionId=${msg.sessionId}`,
          `currentSession=${currentSession.value}`,
          `messages=${msg.messages?.length || 0}`,
          `totalEntries=${msg.totalEntries}`,
        );
        if (!msg.sessionId || msg.sessionId === currentSession.value) {
          messages.value = msg.messages || [];
          hasOlderMessages.value = msg.hasOlderMessages || false;
          summaryCount.value = msg.summaryCount || 0;
          totalEntries.value = msg.totalEntries || 0;
          totalTurns.value = msg.totalTurns || 0;
          loadedTurns.value = msg.loadedTurns || 0;
          messagesOffset.value = msg.offset || 0;
          // History loaded - NOW context is fully ready
          // This ensures: history loads → then typing indicator (if running) → then UI is interactive
          contextReady.value = true;
          console.log('[useChatWebSocket] contextReady set to true');
        } else {
          console.warn(
            `[useChatWebSocket] Ignoring session_history for different session. History sessionId: ${msg.sessionId}, Current sessionId: ${currentSession.value}`,
          );
        }
        break;

      case 'older_messages':
        // Prepend older messages to the beginning of the array
        if (msg.sessionId === currentSession.value) {
          messages.value = [...msg.messages, ...messages.value];
          hasOlderMessages.value = msg.hasOlderMessages || false;
          totalTurns.value = msg.totalTurns || totalTurns.value;
          loadedTurns.value = (msg.loadedTurns || 0) + (loadedTurns.value || 0);
          messagesOffset.value = msg.offset || 0;
          loadingOlderMessages.value = false;
        }
        break;

      case 'task_status':
        // Only update task status if it's for the current session
        if (msg.sessionId === currentSession.value) {
          taskStatus.value = msg.status;
        }
        // Note: Session list refresh is handled by global WS handler (debounced)
        break;

      case 'session_info':
        currentSession.value = msg.sessionId;
        // New session is now created and ready for interaction
        contextReady.value = true;
        break;

      case 'project_status':
        projectStatus.value = {
          cwd: msg.cwd,
          gitBranch: msg.gitBranch,
          gitChanges: msg.gitChanges,
        };
        break;

      case 'session_title':
        sessionTitle.value = msg.title;
        break;

      case 'session_title_updated':
        if (msg.success) {
          sessionTitle.value = msg.title;
        }
        break;

      // Streaming messages - only append if belongs to current session
      case 'user':
      case 'text':
      case 'tool_use':
      case 'tool_result':
      case 'result':
      case 'error':
        // Filter out messages that don't belong to the current session
        // Accept messages in these cases:
        // 1. Message sessionId matches current session (normal case)
        // 2. Current session is null (new session being created) - accept any messages
        //    because server assigns ID before we receive session_info
        if (msg.sessionId && msg.sessionId === currentSession.value) {
          // Case 1: Normal - session IDs match
          messages.value.push(msg);
        } else if (!currentSession.value) {
          // Case 2: New session creation - currentSession is null
          // Accept messages from the new session being created
          // (server assigns ID before session_info arrives)
          messages.value.push(msg);
        } else {
          // Mismatch - different session's message
          console.warn(
            `[useChatWebSocket] Ignoring message for different session. Message sessionId: ${msg.sessionId}, Current sessionId: ${currentSession.value}, Message type: ${msg.type}`,
          );
        }
        break;

      // Terminal events
      case 'terminal:processes':
        terminalProcesses.value = msg.processes;
        // Terminal counts are now broadcast globally, no need to update here
        break;

      case 'terminal:started':
        terminalProcesses.value = [...terminalProcesses.value, msg.process];
        // Terminal counts are now broadcast globally, no need to update here
        break;

      case 'terminal:watch:tick':
        // A watch tick spawns a new process for the same bookmark each time.
        // Replace any existing watch process for this bookmark so the Active tab
        // always shows the latest run (not stale entries from previous ticks).
        if (msg.projectSlug === currentProject.value?.slug) {
          const bookmarkId = msg.process.watchBookmarkId;
          const without = terminalProcesses.value.filter(
            (p) => !(p.isWatch && p.watchBookmarkId === bookmarkId),
          );
          terminalProcesses.value = [...without, msg.process];
        }
        break;

      case 'terminal:processes:update':
        // Update an existing process in the list (e.g. watch tick exit status).
        // For watch processes: keep them after exit so the last output stays
        // visible between ticks. The next terminal:watch:tick will replace them.
        if (msg.projectSlug === currentProject.value?.slug) {
          terminalProcesses.value = terminalProcesses.value.map((p) =>
            p.id === msg.process.id ? { ...p, ...msg.process } : p,
          );
        }
        break;

      case 'terminal:output': {
        const proc = terminalProcesses.value.find(
          (p) => p.id === msg.processId,
        );
        if (proc) {
          proc.output = [
            ...proc.output,
            { stream: msg.stream, text: msg.data },
          ];
          // Trigger reactivity
          terminalProcesses.value = [...terminalProcesses.value];
        }
        break;
      }

      case 'terminal:exit': {
        const proc = terminalProcesses.value.find(
          (p) => p.id === msg.processId,
        );
        if (proc) {
          proc.status = msg.status;
          proc.exitCode = msg.code;
          proc.signal = msg.signal;
          proc.endedAt = Date.now();
          // Trigger reactivity
          terminalProcesses.value = [...terminalProcesses.value];
        }
        // Terminal counts are now broadcast globally, no need to update here
        break;
      }

      case 'terminal:cleared':
        // List will be sent separately
        break;

      case 'terminal:error':
        console.error('Terminal error:', msg.error);
        break;

      // AskUserQuestion events
      case 'ask_user_question':
        if (msg.sessionId === currentSession.value) {
          pendingQuestion.value = {
            toolUseId: msg.toolUseId,
            questions: msg.questions,
          };
        }
        break;

      case 'question_answered':
        if (msg.sessionId === currentSession.value) {
          pendingQuestion.value = null;
        }
        break;

      case 'question_timeout':
        if (msg.sessionId === currentSession.value) {
          pendingQuestion.value = null;
        }
        break;

      case 'queue_state':
      case 'queue_updated':
        // Only update queue if it's for the current session
        if (msg.sessionId === currentSession.value) {
          queuedMessages.value = msg.queue || [];
        }
        break;
    }
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      const socket = ws;
      ws = null; // Set to null before close to prevent reconnect in onclose
      socket.close();
    }
  }

  // Actions
  function selectProject(slug) {
    send({ type: 'select_project', path: slug });
  }

  function getProjectStatus() {
    send({ type: 'get_project_status' });
  }

  function selectSession(sessionId, options = {}) {
    // Set currentSession IMMEDIATELY to prevent race condition
    // where streaming messages from other sessions arrive before server responds
    currentSession.value = sessionId;
    messages.value = [];
    hasOlderMessages.value = false;
    summaryCount.value = 0;
    sessionTitle.value = null;
    taskStatus.value = 'idle'; // Reset task status when switching sessions
    queuedMessages.value = []; // Clear queue until server sends queue_state
    // Reset contextReady until server acknowledges session selection
    contextReady.value = false;
    send({ type: 'select_session', sessionId, ...options });
    // Also get the session title
    send({ type: 'get_session_title', sessionId });
  }

  function setSessionTitleChat(title) {
    if (currentSession.value) {
      send({
        type: 'set_session_title',
        sessionId: currentSession.value,
        title,
      });
    }
  }

  function getSessionTitle() {
    if (currentSession.value) {
      send({ type: 'get_session_title', sessionId: currentSession.value });
    }
  }

  function loadFullHistory() {
    if (currentSession.value) {
      messages.value = [];
      send({
        type: 'select_session',
        sessionId: currentSession.value,
        fullHistory: true,
      });
    }
  }

  function loadOlderMessages(turnLimit = 5) {
    if (currentSession.value && !loadingOlderMessages.value) {
      loadingOlderMessages.value = true;
      // Use current messagesOffset as starting point for loading older turns
      send({
        type: 'load_older_messages',
        sessionId: currentSession.value,
        offset: messagesOffset.value,
        turnLimit,
      });
    }
  }

  function newSession(options = {}) {
    // Clear currentSession to prevent messages from other sessions
    // The server will send back session_info with the new sessionId
    currentSession.value = null;
    messages.value = [];
    sessionTitle.value = null;
    hasOlderMessages.value = false;
    totalTurns.value = 0;
    loadedTurns.value = 0;
    messagesOffset.value = 0;
    summaryCount.value = 0;
    taskStatus.value = 'idle'; // Reset task status for new session
    queuedMessages.value = []; // New session has no queued messages
    // Reset contextReady until server acknowledges (sends session_selected)
    contextReady.value = false;
    send({ type: 'new_session', ...options });
  }

  function sendPrompt(prompt, options = {}) {
    // Warn if context is not ready (server may not have our project/session yet)
    if (!contextReady.value) {
      console.warn(
        '[useChatWebSocket] sendPrompt called but server context not ready. ' +
          'This can happen after reconnect - prompt may go to wrong session.',
      );
    }
    send({ type: 'prompt', prompt, ...options });
  }

  function cancelTask() {
    send({ type: 'cancel_task' });
  }

  function deleteQueuedMessage(messageId) {
    send({ type: 'queue:delete', messageId });
  }

  function clearQueuedMessages() {
    send({ type: 'queue:clear' });
  }

  function onMessage(handler) {
    messageHandlers.add(handler);
    return () => messageHandlers.delete(handler);
  }

  function clearMessages() {
    messages.value = [];
  }

  // Terminal actions
  function execCommand(command, cwd) {
    send({ type: 'terminal:exec', command, cwd });
  }

  function killProcess(processId, signal, skipRefresh = false) {
    send({ type: 'terminal:kill', processId, signal });
    // Refresh process list after a short delay to reflect the change.
    // Skip for watch processes — they manage state via terminal:watch:* events,
    // and the full-list replace from listProcesses() races with those broadcasts.
    if (!skipRefresh) {
      setTimeout(() => listProcesses(), 100);
    }
  }

  function listProcesses() {
    send({ type: 'terminal:list' });
  }

  function clearTerminal(processId) {
    send({ type: 'terminal:clear', processId });
  }

  // Remove all process entries for a stopped watch bookmark.
  // Called when a watch is stopped (Stop or Kill) so entries are cleaned up immediately.
  // Removes regardless of status — a killed running process won't emit exit events
  // because watchManager removes the listener before killing.
  function removeWatchProcess(bookmarkId) {
    terminalProcesses.value = terminalProcesses.value.filter(
      (p) => !(p.isWatch && p.watchBookmarkId === bookmarkId),
    );
  }

  function answerQuestion(toolUseId, answers) {
    send({ type: 'answer_question', toolUseId, answers });
    pendingQuestion.value = null;
  }

  function clearTaskStatus() {
    taskStatus.value = 'idle';
  }

  function sendAndWait(message, responseType, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${responseType}`));
      }, timeout);

      const handler = (msg) => {
        if (msg.type === responseType) {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        messageHandlers.delete(handler);
      };

      messageHandlers.add(handler);
      send(message);
    });
  }

  // Auto-cleanup on unmount
  onUnmounted(() => {
    disconnect();
  });

  return {
    // State (readonly)
    connected: readonly(connected),
    connectionState: readonly(connectionState),
    contextReady: readonly(contextReady),
    messages: readonly(messages),
    currentProject: readonly(currentProject),
    currentSession: readonly(currentSession),
    sessionTitle: readonly(sessionTitle),
    taskStatus: readonly(taskStatus),
    projectStatus: readonly(projectStatus),
    hasOlderMessages: readonly(hasOlderMessages),
    summaryCount: readonly(summaryCount),
    sessionActiveElsewhere: readonly(sessionActiveElsewhere),
    terminalProcesses: readonly(terminalProcesses),
    totalEntries: readonly(totalEntries),
    messagesOffset: readonly(messagesOffset),
    loadingOlderMessages: readonly(loadingOlderMessages),
    totalTurns: readonly(totalTurns),
    loadedTurns: readonly(loadedTurns),
    pendingQuestion: readonly(pendingQuestion),
    queuedMessages: readonly(queuedMessages),
    queueSize,

    // Connection
    connect,
    disconnect,

    // Actions
    selectProject,
    getProjectStatus,
    selectSession,
    loadFullHistory,
    loadOlderMessages,
    newSession,
    sendPrompt,
    cancelTask,
    onMessage,
    clearMessages,
    setSessionTitle: setSessionTitleChat,
    getSessionTitle,

    // Terminal actions
    execCommand,
    killProcess,
    listProcesses,
    clearTerminal,
    removeWatchProcess,

    // Task status
    clearTaskStatus,

    // Question answering
    answerQuestion,

    // Queue actions
    deleteQueuedMessage,
    clearQueuedMessages,

    // Direct send
    send,
    sendAndWait,
  };
}
