import { onUnmounted, readonly, ref } from 'vue';

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

// Global actions
function getProjects() {
  sendGlobal({ type: 'get_projects' });
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
function getRecentSessionsImmediate() {
  if (recentSessionsDebounceTimer) {
    clearTimeout(recentSessionsDebounceTimer);
    recentSessionsDebounceTimer = null;
  }
  sendGlobal({ type: 'get_recent_sessions' });
}

function browseFolder(path) {
  sendGlobal({ type: 'browse_folder', path });
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
    folderContents: readonly(folderContents),
    currentFolder: readonly(currentFolder),
    sessionStatuses: readonly(sessionStatuses),
    terminalCounts: readonly(terminalCounts),
    currentVersion: readonly(currentVersion),
    updateAvailable: readonly(updateAvailable),
    rootPath: readonly(rootPath),

    // Connection
    connect: connectGlobal,
    disconnect: disconnectGlobal,

    // Actions
    getProjects,
    selectProject: selectProjectGlobal,
    getSessions,
    getRecentSessions,
    getRecentSessionsImmediate,
    browseFolder,
    setSessionTitle,
    deleteSession: deleteSessionGlobal,
    dismissUpdate,

    // Direct send
    send: sendGlobal,
    sendAndWait,

    // Message listeners
    onMessage: addGlobalMessageListener,
  };
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
    taskStatus.value = 'idle'; // Reset task status for new session
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

  function killProcess(processId, signal) {
    send({ type: 'terminal:kill', processId, signal });
    // Refresh process list after a short delay to reflect the change
    setTimeout(() => listProcesses(), 100);
  }

  function listProcesses() {
    send({ type: 'terminal:list' });
  }

  function clearTerminal(processId) {
    send({ type: 'terminal:clear', processId });
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

    // Task status
    clearTaskStatus,

    // Question answering
    answerQuestion,

    // Direct send
    send,
    sendAndWait,
  };
}
