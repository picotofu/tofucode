/**
 * Event: set_session_title
 *
 * Set a custom title for a session.
 *
 * @event set_session_title
 * @param {Object} message - { sessionId: string, title: string }
 * @returns {void} Sends: session_title_updated
 */

import { setTitle } from '../lib/session-titles.js';
import { broadcast, send } from '../lib/ws.js';

export function handler(ws, message, context) {
  const { sessionId, title } = message;

  if (!context.currentProjectPath) {
    send(ws, { type: 'error', message: 'No project selected' });
    return;
  }

  if (!sessionId) {
    send(ws, { type: 'error', message: 'Session ID required' });
    return;
  }

  const success = setTitle(context.currentProjectPath, sessionId, title);

  // Broadcast to all clients so UI updates everywhere
  broadcast({
    type: 'session_title_updated',
    sessionId,
    title: title || null,
    success,
  });
}
