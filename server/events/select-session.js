/**
 * Event: select_session
 *
 * Selects a session and loads its history from JSONL.
 * Returns session info, task status, and message history.
 *
 * @event select_session
 * @param {Object} message - { sessionId: string }
 * @returns {void} Sends: session_selected, task_status, session_history
 *
 * @example
 * // Request
 * { type: 'select_session', sessionId: 'abc123-def456' }
 *
 * // Response (multiple messages)
 * { type: 'session_selected', sessionId: 'abc123-def456', projectPath: '-home-...' }
 * { type: 'task_status', taskId: null, status: 'idle', resultsCount: 15 }
 * { type: 'session_history', messages: [...] }
 */

import { isValidSessionId, loadSessionHistory } from '../lib/sessions.js';
import { clearCompletedTask, getOrCreateTask } from '../lib/tasks.js';
import {
  broadcast,
  getSessionWatcherCount,
  send,
  unwatchSession,
  watchSession,
} from '../lib/ws.js';

export async function handler(ws, message, context) {
  const sessionId = message.sessionId;

  if (!sessionId || typeof sessionId !== 'string') {
    send(ws, { type: 'error', message: 'Session ID is required' });
    return;
  }

  // SECURITY: Validate sessionId format to prevent path traversal
  if (!isValidSessionId(sessionId)) {
    send(ws, { type: 'error', message: 'Invalid sessionId format' });
    return;
  }

  // Check if session is already active in another tab
  const otherWatchers = getSessionWatcherCount(sessionId, ws);
  const isActiveElsewhere = otherWatchers > 0;

  // Unwatch previous session, watch new one
  if (context.currentSessionId && context.currentSessionId !== sessionId) {
    unwatchSession(context.currentSessionId, ws);
  }
  context.currentSessionId = sessionId;
  watchSession(sessionId, ws);

  const task = sessionId ? getOrCreateTask(sessionId) : null;

  // Detect stale-running tasks: status is 'running' but the stream/abortController
  // is gone (server restarted, stream crashed, or loop already exited without cleanup).
  // Also detect tasks that have been running for more than 30 minutes (hard timeout).
  // Reset to 'idle' so the client doesn't get stuck on an in-progress indicator.
  const STALE_TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  if (task && task.status === 'running') {
    const noController = !task.abortController;
    const timedOut =
      task.startTime && Date.now() - task.startTime > STALE_TASK_TIMEOUT_MS;
    if (noController || timedOut) {
      console.warn(
        `[select-session] Resetting stale-running task for session ${sessionId}` +
          ` (noController=${noController}, timedOut=${timedOut})`,
      );
      task.status = 'idle';
      task.stream = null;
    }
  }

  // Always load history from JSONL for accurate state
  // (in-memory task.results may be incomplete or stale)
  // Support turn-based pagination
  let history = [];
  let hasOlderMessages = false;
  let summaryCount = 0;
  let totalEntries = 0;
  let totalTurns = 0;
  let loadedTurns = 0;
  let effectiveOffset = 0;
  const offset = message.offset || 0; // Offset in terms of entries

  if (context.currentProjectPath && sessionId) {
    try {
      const fullHistory = message.fullHistory || false;
      const loadLastTurn = message.loadLastTurn !== false; // Default to true for initial load
      const result = await loadSessionHistory(
        context.currentProjectPath,
        sessionId,
        { fullHistory, offset, loadLastTurn },
      );
      history = result.messages;
      hasOlderMessages = result.hasOlderMessages;
      summaryCount = result.summaryCount;
      totalEntries = result.totalEntries;
      totalTurns = result.totalTurns || 0;
      loadedTurns = result.loadedTurns || 0;
      effectiveOffset = result.effectiveOffset || 0;
    } catch (err) {
      console.error('Failed to load session history:', err);
      send(ws, {
        type: 'error',
        sessionId,
        message: `Failed to load session history: ${err.message}`,
      });
      return;
    }
  } else if (sessionId) {
    // DEBUG: Project not selected yet when trying to load session
    console.warn(
      `[select-session] Project not selected yet for session ${sessionId}. ` +
        `currentProjectPath: ${context.currentProjectPath || 'undefined'}`,
    );
  }

  send(ws, {
    type: 'session_selected',
    sessionId: sessionId,
    projectPath: context.currentProjectPath,
    isActiveElsewhere,
  });

  send(ws, {
    type: 'task_status',
    sessionId: sessionId,
    taskId: task?.id || null,
    status: task?.status || 'idle',
    resultsCount: history.length,
  });

  send(ws, {
    type: 'session_history',
    sessionId: sessionId,
    messages: history,
    hasOlderMessages,
    summaryCount,
    totalEntries,
    totalTurns,
    loadedTurns,
    offset: effectiveOffset,
  });

  // Clear completed/error task from memory when user opens the session
  // This prevents memory buildup - no need to keep the task after user has seen it
  clearCompletedTask(sessionId);

  // Broadcast to all clients to clear sidebar indicator for this session
  broadcast({
    type: 'session_opened',
    sessionId: sessionId,
  });
}
