/**
 * Event: get_sessions
 *
 * Returns sessions list for the currently selected project.
 * Requires a project to be selected first via select_project.
 *
 * @event get_sessions
 * @param {Object} message - Empty object {}
 * @returns {void} Sends: { type: 'sessions_list', sessions }
 *
 * @example
 * // Request
 * { type: 'get_sessions' }
 *
 * // Response
 * {
 *   type: 'sessions_list',
 *   sessions: [
 *     { sessionId: 'abc123', firstPrompt: 'Help me...', messageCount: 10, created: '...', modified: '...' }
 *   ]
 * }
 */

import { getSessionsList } from '../lib/sessions.js';
import { send } from '../lib/ws.js';

export function handler(ws, _message, context) {
  if (!context.currentProjectPath) {
    send(ws, { type: 'error', message: 'No project selected' });
    return;
  }

  // getSessionsList now includes title (customTitle from sessions-index.json)
  const sessions = getSessionsList(context.currentProjectPath);

  send(ws, {
    type: 'sessions_list',
    sessions,
  });
}
