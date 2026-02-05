/**
 * Event: get_recent_sessions
 *
 * Returns recent sessions across all projects, sorted by modification date.
 * Used for the "Recent Sessions" tab on the landing page.
 *
 * @event get_recent_sessions
 * @param {Object} message - { limit?: number }
 * @returns {void} Sends: recent_sessions
 *
 * @example
 * // Request
 * { type: 'get_recent_sessions', limit: 50 }
 *
 * // Response
 * {
 *   type: 'recent_sessions',
 *   sessions: [
 *     {
 *       sessionId: 'abc-123',
 *       projectSlug: '-home-ts-projects-foo',
 *       projectName: 'foo',
 *       projectPath: '/home/ts/projects/foo',
 *       firstPrompt: 'Help me with...',
 *       messageCount: 10,
 *       created: '2024-01-01T00:00:00Z',
 *       modified: '2024-01-02T00:00:00Z'
 *     }
 *   ]
 * }
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config, getProjectDisplayName, slugToPath } from '../config.js';
import { getAllTitles } from '../lib/session-titles.js';
import { send } from '../lib/ws.js';

export function handler(ws, message) {
  const limit = message.limit || 50;

  try {
    if (!existsSync(config.projectsDir)) {
      send(ws, { type: 'recent_sessions', sessions: [] });
      return;
    }

    const entries = readdirSync(config.projectsDir, { withFileTypes: true });
    const allSessions = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectSlug = entry.name;
        const sessionsDir = join(config.projectsDir, projectSlug);
        const indexPath = join(sessionsDir, 'sessions-index.json');
        const projectName = getProjectDisplayName(projectSlug);
        const projectPath = slugToPath(projectSlug);
        const titles = getAllTitles(projectSlug);

        // Track sessions we've already added
        const sessionIds = new Set();

        // First, load from index if it exists
        if (existsSync(indexPath)) {
          try {
            const data = JSON.parse(readFileSync(indexPath, 'utf-8'));

            for (const session of data.entries || []) {
              sessionIds.add(session.sessionId);

              // Use JSONL file mtime for accurate modification time
              // (sessions-index.json's modified field is stale)
              const jsonlPath = join(sessionsDir, `${session.sessionId}.jsonl`);
              let modified = session.modified;
              if (existsSync(jsonlPath)) {
                try {
                  const stats = statSync(jsonlPath);
                  modified = stats.mtime.toISOString();
                } catch {
                  // Fall back to index modified if stat fails
                }
              }

              allSessions.push({
                sessionId: session.sessionId,
                projectSlug,
                projectName,
                projectPath,
                firstPrompt:
                  session.firstPrompt?.substring(0, 100) || 'No prompt',
                messageCount: session.messageCount || 0,
                created: session.created,
                modified,
                title: titles[session.sessionId] || null,
              });
            }
          } catch {
            // Skip projects with malformed index, but continue to scan directory
          }
        }

        // Second, scan directory for JSONL files not in the index
        // This catches newly created sessions before SDK updates the index
        try {
          const files = readdirSync(sessionsDir);
          for (const file of files) {
            if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
              const sessionId = file.replace('.jsonl', '');
              if (!sessionIds.has(sessionId)) {
                const jsonlPath = join(sessionsDir, file);
                try {
                  const stats = statSync(jsonlPath);
                  // Read first line to get the first prompt
                  let firstPrompt = 'New session';
                  try {
                    const content = readFileSync(jsonlPath, 'utf-8');
                    const firstLine = content.split('\n')[0];
                    if (firstLine) {
                      const jsonEntry = JSON.parse(firstLine);
                      if (jsonEntry.type === 'user' && jsonEntry.message?.content) {
                        const contentText =
                          typeof jsonEntry.message.content === 'string'
                            ? jsonEntry.message.content
                            : Array.isArray(jsonEntry.message.content)
                              ? jsonEntry.message.content
                                  .filter((b) => b.type === 'text')
                                  .map((b) => b.text)
                                  .join(' ')
                              : 'New session';
                        firstPrompt = contentText.substring(0, 100);
                      }
                    }
                  } catch {
                    // Couldn't read first prompt, use default
                  }

                  allSessions.push({
                    sessionId,
                    projectSlug,
                    projectName,
                    projectPath,
                    firstPrompt,
                    messageCount: 0,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    title: titles[sessionId] || null,
                  });
                } catch (err) {
                  console.error(`Failed to stat ${file}:`, err.message);
                }
              }
            }
          }
        } catch {
          // Failed to read directory, skip
        }
      }
    }

    // Sort by modification date (most recent first)
    allSessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    // Limit results
    const limitedSessions = allSessions.slice(0, limit);

    send(ws, {
      type: 'recent_sessions',
      sessions: limitedSessions,
    });
  } catch (err) {
    console.error('Failed to load recent sessions:', err.message);
    send(ws, { type: 'recent_sessions', sessions: [] });
  }
}
