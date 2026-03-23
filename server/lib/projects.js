/**
 * Project utilities - list projects from ~/.claude/projects/
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { config, getProjectDisplayName, slugToPath } from '../config.js';

/**
 * Get list of available projects from ~/.claude/projects/
 * Scans for actual .jsonl session files to catch projects with empty/missing sessions-index.json
 * @returns {Promise<Array<{slug: string, name: string, path: string, sessionCount: number, lastModified: string|null}>>}
 */
export async function getProjectsList() {
  try {
    if (!existsSync(config.projectsDir)) {
      return [];
    }

    const entries = await readdir(config.projectsDir, { withFileTypes: true });
    const projects = [];

    // Process all project directories in parallel
    const projectPromises = entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
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
            const data = JSON.parse(await readFile(indexPath, 'utf-8'));
            if (data.entries?.length > 0) {
              sessionCount = data.entries.length;
              // Track indexed sessions
              for (const entry of data.entries) {
                sessionIds.add(entry.sessionId);
              }

              // Use JSONL file mtime for accurate timestamps
              // (sessions-index.json's modified field is stale)
              const statPromises = data.entries.map(async (entry) => {
                const jsonlPath = join(sessionsDir, `${entry.sessionId}.jsonl`);
                try {
                  const stats = await stat(jsonlPath);
                  return stats.mtime;
                } catch {
                  return null;
                }
              });

              const mtimes = (await Promise.all(statPromises)).filter(Boolean);
              const latestMtime =
                mtimes.length > 0
                  ? mtimes.reduce((a, b) => (a > b ? a : b))
                  : null;

              lastModified = latestMtime
                ? latestMtime.toISOString()
                : data.entries[0].modified;
            }
          } catch {
            // Malformed sessions-index.json, fall through to scan
          }
        }

        // If no sessions found in index, scan directory for .jsonl files
        // This catches projects with empty/missing index but actual session files
        if (sessionCount === 0 && existsSync(sessionsDir)) {
          try {
            const files = await readdir(sessionsDir);
            const jsonlFiles = files.filter(
              (file) => file.endsWith('.jsonl') && !file.startsWith('agent-'),
            );

            const statPromises = jsonlFiles.map(async (file) => {
              const sessionId = file.replace('.jsonl', '');
              // Validate UUID format to avoid counting non-session files
              if (
                /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
                  sessionId,
                )
              ) {
                if (!sessionIds.has(sessionId)) {
                  try {
                    const stats = await stat(join(sessionsDir, file));
                    return { sessionId, mtime: stats.mtime };
                  } catch {
                    return { sessionId, mtime: null };
                  }
                }
              }
              return null;
            });

            const results = (await Promise.all(statPromises)).filter(Boolean);
            sessionCount += results.length;
            for (const r of results) {
              sessionIds.add(r.sessionId);
            }

            const mtimes = results.map((r) => r.mtime).filter(Boolean);
            if (mtimes.length > 0) {
              const latestMtime = mtimes.reduce((a, b) => (a > b ? a : b));
              lastModified = latestMtime.toISOString();
            }
          } catch {
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
              return null;
            }
          }

          return {
            slug,
            name: displayName,
            path: projectPath,
            sessionCount,
            lastModified,
          };
        }

        return null;
      });

    const results = await Promise.all(projectPromises);
    projects.push(...results.filter(Boolean));

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
