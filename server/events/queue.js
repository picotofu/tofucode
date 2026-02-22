/**
 * Event handlers: queue:delete, queue:clear, queue:get
 *
 * queue:delete  { messageId }         → queue_updated (broadcast)
 * queue:clear   {}                    → queue_updated (broadcast)
 * queue:get     {}                    → queue_state   (send to requester only)
 */

import { clearQueue, deleteMessage, getQueue } from '../lib/message-queue.js';
import { broadcastToSession, send } from '../lib/ws.js';

function broadcastQueueUpdated(sessionId) {
  const queue = getQueue(sessionId);
  broadcastToSession(sessionId, {
    type: 'queue_updated',
    sessionId,
    queue,
    size: queue.length,
  });
}

export function deleteHandler(ws, message, context) {
  const sessionId = context.currentSessionId;
  if (!sessionId) {
    send(ws, { type: 'error', message: 'No session selected' });
    return;
  }

  const { messageId } = message;
  if (!messageId) {
    send(ws, { type: 'error', message: 'messageId is required' });
    return;
  }

  // If the message was already dequeued (race: it just started executing), this is
  // a silent no-op — only broadcast if something was actually removed.
  const removed = deleteMessage(sessionId, messageId);
  if (removed) {
    broadcastQueueUpdated(sessionId);
  }
}

export function clearHandler(ws, _message, context) {
  const sessionId = context.currentSessionId;
  if (!sessionId) {
    send(ws, { type: 'error', message: 'No session selected' });
    return;
  }

  clearQueue(sessionId);
  broadcastQueueUpdated(sessionId);
}

export function getHandler(ws, _message, context) {
  const sessionId = context.currentSessionId;
  const queue = sessionId ? getQueue(sessionId) : [];
  send(ws, {
    type: 'queue_state',
    sessionId,
    queue,
    size: queue.length,
  });
}
