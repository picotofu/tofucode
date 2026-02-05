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

let globalWs = null;
let globalReconnectTimeout = null;

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

function handleGlobalMessage(msg) {
  switch (msg.type) {
    case 'connected':
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
        } else if (msg.status === 'completed') {
          newStatuses.set(msg.sessionId, {
            status: 'completed',
            timestamp: Date.now(),
          });
        } else if (msg.status === 'error') {
          newStatuses.set(msg.sessionId, {
            status: 'error',
            timestamp: Date.now(),
          });
        } else if (msg.status === 'idle' || msg.status === 'cancelled') {
          // Clear status for idle/cancelled
          newStatuses.delete(msg.sessionId);
        }
        sessionStatuses.value = newStatuses;
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
}

function sendGlobal(message) {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify(message));
  }
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

function getRecentSessions() {
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

    // Connection
    connect: connectGlobal,
    disconnect: disconnectGlobal,

    // Actions
    getProjects,
    selectProject: selectProjectGlobal,
    getSessions,
    getRecentSessions,
    browseFolder,
    setSessionTitle,
    deleteSession: deleteSessionGlobal,

    // Direct send
    send: sendGlobal,
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
  const projectStatus = ref({
    cwd: null,
    gitBranch: null,
    gitChanges: null,
  });

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
        break;

      case 'session_selected':
        // Only update if this matches our expected session (prevents race condition)
        // currentSession is already set by selectSession() before the request
        if (msg.sessionId === currentSession.value) {
          sessionActiveElsewhere.value = msg.isActiveElsewhere || false;
          // Don't clear messages here - selectSession() already did it
          // Clearing again creates a race window for cross-session messages
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
        if (!msg.sessionId || msg.sessionId === currentSession.value) {
          messages.value = msg.messages;
          hasOlderMessages.value = msg.hasOlderMessages || false;
          summaryCount.value = msg.summaryCount || 0;
        } else {
          console.warn(
            `[useChatWebSocket] Ignoring session_history for different session. History sessionId: ${msg.sessionId}, Current sessionId: ${currentSession.value}`,
          );
        }
        break;

      case 'task_status':
        // Only update task status if it's for the current session
        if (!msg.sessionId || msg.sessionId === currentSession.value) {
          taskStatus.value = msg.status;
        }
        // Refresh global sessions list when task completes to update timestamps
        if (msg.status === 'completed' || msg.status === 'error') {
          getRecentSessions();
        }
        break;

      case 'session_info':
        currentSession.value = msg.sessionId;
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
        if (msg.sessionId && msg.sessionId === currentSession.value) {
          messages.value = [...messages.value, msg];
        } else if (!msg.sessionId) {
          // Legacy messages without sessionId (shouldn't happen with new code)
          console.warn(
            '[useChatWebSocket] Message without sessionId:',
            msg.type,
          );
          messages.value = [...messages.value, msg];
        } else if (msg.sessionId !== currentSession.value) {
          // Log cross-session messages to help debug the issue
          console.warn(
            `[useChatWebSocket] Received message for different session. Message sessionId: ${msg.sessionId}, Current sessionId: ${currentSession.value}, Message type: ${msg.type}`,
          );
        }
        break;

      // Terminal events
      case 'terminal:processes':
        terminalProcesses.value = msg.processes;
        break;

      case 'terminal:started':
        terminalProcesses.value = [...terminalProcesses.value, msg.process];
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
        break;
      }

      case 'terminal:cleared':
        // List will be sent separately
        break;

      case 'terminal:error':
        console.error('Terminal error:', msg.error);
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

  function newSession(options = {}) {
    // Clear currentSession to prevent messages from other sessions
    // The server will send back session_info with the new sessionId
    currentSession.value = null;
    messages.value = [];
    send({ type: 'new_session', ...options });
  }

  function sendPrompt(prompt, options = {}) {
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
  }

  function listProcesses() {
    send({ type: 'terminal:list' });
  }

  function clearTerminal(processId) {
    send({ type: 'terminal:clear', processId });
  }

  // Auto-cleanup on unmount
  onUnmounted(() => {
    disconnect();
  });

  return {
    // State (readonly)
    connected: readonly(connected),
    connectionState: readonly(connectionState),
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

    // Connection
    connect,
    disconnect,

    // Actions
    selectProject,
    getProjectStatus,
    selectSession,
    loadFullHistory,
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

    // Direct send
    send,
  };
}
