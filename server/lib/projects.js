/**
 * Project utilities - list projects from ~/.claude/projects/
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { config, getProjectDisplayName, slugToPath } from '../config.js';

/**
 * Get list of available projects from ~/.claude/projects/
 * Scans for actual .jsonl session files to catch projects with empty/missing sessions-index.json
 * @returns {Array<{slug: string, name: string, path: string, sessionCount: number, lastModified: string|null}>}
 */
export function getProjectsList() {
  try {
    if (!existsSync(config.projectsDir)) {
      return [];
    }

    const entries = readdirSync(config.projectsDir, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const slug = entry.name;
        const displayName = getProjectDisplayName(slug);
        const sessionsDir = join(config.projectsDir, slug);
        const indexPath = join(sessionsDir, 'sessions-index.json');

        let sessionCount = 0;
        let lastModified = null;
        const sessionIds = new Set();

        // First, try to use sessions-index.json (faster path)
        if (existsSync(indexPath)) {
          try {
            const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
            if (data.entries?.length > 0) {
              sessionCount = data.entries.length;
              // Track indexed sessions
              for (const entry of data.entries) {
                sessionIds.add(entry.sessionId);
              }

              // Use JSONL file mtime for accurate timestamps
              // (sessions-index.json's modified field is stale)
              let latestMtime = null;
              for (const entry of data.entries) {
                const jsonlPath = join(sessionsDir, `${entry.sessionId}.jsonl`);
                if (existsSync(jsonlPath)) {
                  try {
                    const stats = statSync(jsonlPath);
                    if (!latestMtime || stats.mtime > latestMtime) {
                      latestMtime = stats.mtime;
                    }
                  } catch (_err) {
                    // Ignore stat errors (file may have been deleted)
                  }
                }
              }
              lastModified = latestMtime
                ? latestMtime.toISOString()
                : data.entries[0].modified;
            }
          } catch (_err) {
            // Malformed sessions-index.json, fall through to scan
          }
        }

        // If no sessions found in index, scan directory for .jsonl files
        // This catches projects with empty/missing index but actual session files
        // Performance impact: ~0.3ms average for typical setup (negligible)
        if (sessionCount === 0 && existsSync(sessionsDir)) {
          try {
            const files = readdirSync(sessionsDir);
            let latestMtime = null;

            for (const file of files) {
              if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
                const sessionId = file.replace('.jsonl', '');
                // Validate UUID format to avoid counting non-session files
                if (
                  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
                    sessionId,
                  )
                ) {
                  if (!sessionIds.has(sessionId)) {
                    sessionCount++;
                    sessionIds.add(sessionId);

                    // Get mtime for sorting
                    try {
                      const stats = statSync(join(sessionsDir, file));
                      if (!latestMtime || stats.mtime > latestMtime) {
                        latestMtime = stats.mtime;
                      }
                    } catch (_err) {
                      // Ignore stat errors
                    }
                  }
                }
              }
            }

            if (latestMtime) {
              lastModified = latestMtime.toISOString();
            }
          } catch (_err) {
            // Directory read error, skip
          }
        }

        // Only include projects that have sessions
        if (sessionCount > 0) {
          const projectPath = slugToPath(slug);

          // If --root is set, filter projects outside root
          if (config.rootPath) {
            const resolvedProject = resolve(projectPath);
            const resolvedRoot = resolve(config.rootPath);
            const relativePath = relative(resolvedRoot, resolvedProject);

            // Skip projects outside root
            if (
              relativePath.startsWith('..') ||
              resolve(relativePath).startsWith('..')
            ) {
              continue;
            }
          }

          projects.push({
            slug,
            name: displayName,
            path: projectPath,
            sessionCount,
            lastModified,
          });
        }
      }
    }

    // Sort by last modified
    return projects.sort((a, b) => {
      if (!a.lastModified) return 1;
      if (!b.lastModified) return -1;
      return new Date(b.lastModified) - new Date(a.lastModified);
    });
  } catch (err) {
    console.error('Failed to load projects:', err.message);
    return [];
  }
}
