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

import { isValidSessionId, loadSessionHistory } from '../lib/sessions.js';
import { send } from '../lib/ws.js';

export async function handler(ws, message, context) {
  const { sessionId, offset = 0, turnLimit = 5 } = message; // Default: load 5 turns

  if (!sessionId) {
    send(ws, { type: 'error', sessionId, message: 'Session ID is required' });
    return;
  }

  // SECURITY: Validate sessionId format to prevent path traversal
  if (!isValidSessionId(sessionId)) {
    send(ws, { type: 'error', sessionId, message: 'Invalid sessionId format' });
    return;
  }

  if (!context.currentProjectPath) {
    send(ws, { type: 'error', sessionId, message: 'No project selected' });
    return;
  }

  try {
    const result = await loadSessionHistory(
      context.currentProjectPath,
      sessionId,
      { offset, turnLimit, loadLastTurn: false },
    );

    send(ws, {
      type: 'older_messages',
      sessionId,
      messages: result.messages,
      hasOlderMessages: result.hasOlderMessages,
      totalTurns: result.totalTurns,
      loadedTurns: result.loadedTurns,
      offset,
    });
  } catch (err) {
    console.error('Failed to load older messages:', err);
    send(ws, {
      type: 'error',
      sessionId,
      message: `Failed to load older messages: ${err.message}`,
    });
  }
}
