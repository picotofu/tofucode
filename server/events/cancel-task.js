/**
 * Event: cancel_task
 *
 * Cancel a running task for the current session.
 *
 * @event cancel_task
 * @param {Object} message - Empty object {}
 * @returns {void} Sends: task_cancelled or error
 */

import { cancelTask, getOrCreateTask } from '../lib/tasks.js';
import { send } from '../lib/ws.js';
import { pendingQuestions } from './answer-question.js';

export async function handler(ws, _message, context) {
  if (!context.currentSessionId) {
    send(ws, { type: 'error', message: 'No session selected' });
    return;
  }

  const task = getOrCreateTask(context.currentSessionId);

  if (task.status !== 'running') {
    send(ws, { type: 'error', message: 'No running task to cancel' });
    return;
  }

  // Reject any pending questions so the Promise doesn't leak
  for (const [toolUseId, pending] of pendingQuestions) {
    pending.reject(new Error('Task cancelled'));
    pendingQuestions.delete(toolUseId);
  }

  const success = cancelTask(context.currentSessionId);

  if (success) {
    send(ws, {
      type: 'task_cancelled',
      sessionId: context.currentSessionId,
    });
  } else {
    send(ws, { type: 'error', message: 'Failed to cancel task' });
  }
}
