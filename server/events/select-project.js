/**
 * Event: select_project
 *
 * Selects a project and returns its sessions list.
 * Sets the current project context for subsequent operations.
 *
 * @event select_project
 * @param {Object} message - { path: string } - Project slug
 * @returns {void} Sends: { type: 'project_selected', path, project, sessions }
 *
 * @example
 * // Request
 * { type: 'select_project', path: '-home-ts-projects-foo' }
 *
 * // Response
 * {
 *   type: 'project_selected',
 *   path: '-home-ts-projects-foo',
 *   project: { slug, name, path, sessionCount, lastModified },
 *   sessions: [...]
 * }
 */

import path from 'node:path';
import { config, getProjectDisplayName, slugToPath } from '../config.js';
import { getProjectsList } from '../lib/projects.js';
import { getAllTitles } from '../lib/session-titles.js';
import { getSessionsList } from '../lib/sessions.js';
import { send, unwatchSession } from '../lib/ws.js';

export async function handler(ws, message, context) {
  const projectSlug = message.path;

  if (!projectSlug || typeof projectSlug !== 'string') {
    send(ws, { type: 'error', message: 'Project path is required' });
    return;
  }

  // SECURITY: Validate that the project path is within root (if --root is set)
  if (config.rootPath) {
    const projectPath = slugToPath(projectSlug);
    const resolvedProject = path.resolve(projectPath);
    const resolvedRoot = path.resolve(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedProject);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      send(ws, {
        type: 'error',
        message: `Access denied: project outside root (${config.rootPath})`,
      });
      return;
    }
  }

  // Unwatch previous session if any (before resetting context)
  if (context.currentSessionId) {
    unwatchSession(context.currentSessionId, ws);
  }

  context.currentProjectPath = projectSlug;
  context.currentSessionId = null;

  // Find project info or create basic info from slug
  const projectInfo = getProjectsList().find((p) => p.slug === projectSlug) || {
    slug: projectSlug,
    name: getProjectDisplayName(projectSlug),
    path: slugToPath(projectSlug),
  };

  // Get sessions and enrich with custom titles
  const sessions = await getSessionsList(projectSlug);
  const titles = getAllTitles(projectSlug);
  const enrichedSessions = sessions.map((session) => ({
    ...session,
    title: titles[session.sessionId] || null,
  }));

  send(ws, {
    type: 'project_selected',
    path: projectSlug,
    project: projectInfo,
    sessions: enrichedSessions,
  });
}
