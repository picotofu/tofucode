/**
 * Event: get_task_statuses
 *
 * Returns the current status of all active/recent tasks.
 * Used on initial page load to restore task status indicators in the sidebar.
 *
 * @event get_task_statuses
 * @param {Object} message - Empty object {}
 * @returns {void} Sends: { type: 'task_statuses', statuses: Array }
 *
 * @example
 * // Request
 * { type: 'get_task_statuses' }
 *
 * // Response
 * {
 *   type: 'task_statuses',
 *   statuses: [
 *     { sessionId: 'abc-123', status: 'running', timestamp: 1234567890 },
 *     { sessionId: 'def-456', status: 'completed', timestamp: 1234567891 }
 *   ]
 * }
 */

import { tasks } from '../lib/tasks.js';
import { getTerminalCounts } from '../lib/terminalUtils.js';
import { send } from '../lib/ws.js';

export function handler(ws, _message, _context) {
  const statuses = [];

  // Iterate through all tasks and collect their statuses
  for (const [sessionId, task] of tasks) {
    // Only include tasks that have a meaningful status
    if (
      task.status === 'running' ||
      task.status === 'completed' ||
      task.status === 'error'
    ) {
      statuses.push({
        sessionId,
        status: task.status,
        timestamp: task.startTime || Date.now(),
      });
    }
  }

  // Get terminal process counts per project
  const terminalCounts = getTerminalCounts();

  send(ws, {
    type: 'task_statuses',
    statuses,
    terminalCounts,
  });
}
