/**
 * Event: load_older_messages
 *
 * Load older messages for pagination (incremental backward loading)
 *
 * @event load_older_messages
 * @param {Object} message - { sessionId, offset, limit }
 * @returns {void} Sends: { type: 'older_messages', messages, hasOlderMessages, offset, limit }
 *
 * @example
 * // Request (load 50 messages starting from offset 50)
 * { type: 'load_older_messages', sessionId: 'abc123', offset: 50, limit: 50 }
 *
 * // Response
 * {
 *   type: 'older_messages',
 *   sessionId: 'abc123',
 *   messages: [...],
 *   hasOlderMessages: true,
 *   offset: 50,
 *   limit: 50
 * }
 */

import { loadSessionHistory } from '../lib/sessions.js';
import { send } from '../lib/ws.js';

export async function handler(ws, message, context) {
  const { sessionId, offset = 0, limit = 50 } = message;

  if (!sessionId) {
    send(ws, { type: 'error', message: 'Session ID is required' });
    return;
  }

  if (!context.currentProjectPath) {
    send(ws, { type: 'error', message: 'No project selected' });
    return;
  }

  const result = await loadSessionHistory(
    context.currentProjectPath,
    sessionId,
    { limit, offset },
  );

  send(ws, {
    type: 'older_messages',
    sessionId,
    messages: result.messages,
    hasOlderMessages: result.hasOlderMessages,
    offset,
    limit,
  });
}
