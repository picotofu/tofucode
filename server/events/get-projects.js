/**
 * Event: get_projects
 *
 * Returns list of projects from ~/.claude/projects/
 * Only includes projects that have at least one session.
 *
 * @event get_projects
 * @param {Object} message - Empty object {}
 * @returns {void} Sends: { type: 'projects_list', projects: Array }
 *
 * @example
 * // Request
 * { type: 'get_projects' }
 *
 * // Response
 * {
 *   type: 'projects_list',
 *   projects: [
 *     { slug: '-home-ts-projects-foo', name: 'foo', path: '/home/ts/projects/foo', sessionCount: 5, lastModified: '2024-...' }
 *   ]
 * }
 */

import { pathToSlug } from '../config.js';
import { getProjectsList } from '../lib/projects.js';
import { send } from '../lib/ws.js';
import { loadSlackConfigRaw } from '../slack/config.js';

export async function handler(ws, _message, _context) {
  const slackConfig = loadSlackConfigRaw();
  const slackSessionSlug =
    slackConfig.hideSlackSessions && slackConfig.sessionLogPath
      ? pathToSlug(slackConfig.sessionLogPath)
      : null;

  send(ws, {
    type: 'projects_list',
    projects: await getProjectsList(),
    slackSessionSlug,
  });
}
