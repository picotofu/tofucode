/**
 * Event: get_git_diff
 *
 * Returns git diff for the current working directory.
 * Shows changes staged and unstaged, formatted as unified diff.
 *
 * @event get_git_diff
 * @returns {void} Sends: git_diff
 *
 * @example
 * // Request
 * { type: 'get_git_diff' }
 *
 * // Response
 * {
 *   type: 'git_diff',
 *   files: [
 *     { path: 'src/App.vue', status: 'M', additions: 5, deletions: 2 },
 *     { path: 'package.json', status: 'M', additions: 1, deletions: 0 }
 *   ],
 *   diffs: {
 *     'src/App.vue': '... unified diff content ...',
 *     'package.json': '... unified diff content ...'
 *   }
 * }
 */

import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { slugToPath } from '../config.js';
import { send } from '../lib/ws.js';

const execAsync = promisify(exec);

export async function handler(ws, _message, context) {
  // SECURITY: Derive project path from context, never accept from client
  const projectSlug = context.currentProjectPath;

  if (!projectSlug) {
    send(ws, {
      type: 'git_diff',
      files: [],
      diffs: {},
      error: 'No project selected',
    });
    return;
  }

  const projectPath = slugToPath(projectSlug);

  try {
    // Get list of changed files with status
    const { stdout: statusOutput } = await execAsync('git status --porcelain', {
      cwd: projectPath,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Parse changed files
    const files = [];
    for (const line of statusOutput.split('\n').filter(Boolean)) {
      // Format: XY file (or XY old -> new for renames)
      // X = index status, Y = working tree status
      const status = line.substring(0, 2).trim();
      let path = line.substring(3);

      let statusChar = 'M'; // Modified
      if (status.includes('A'))
        statusChar = 'A'; // Added
      else if (status.includes('D'))
        statusChar = 'D'; // Deleted
      else if (status.includes('R')) {
        statusChar = 'R'; // Renamed
        // Renamed files have format: "old-path -> new-path"
        // Extract just the new path for the diff
        const arrowIndex = path.indexOf(' -> ');
        if (arrowIndex !== -1) {
          path = path.substring(arrowIndex + 4);
        }
      } else if (status.includes('?')) statusChar = '?'; // Untracked

      files.push({ path, status: statusChar, additions: 0, deletions: 0 });
    }

    // Get diffs for each changed file
    const diffs = {};
    for (const file of files) {
      try {
        if (file.status === '?') {
          // Untracked file - show entire content as new
          try {
            const content = await readFile(
              join(projectPath, file.path),
              'utf-8',
            );
            const lines = content.split('\n');
            // Format as unified diff for untracked file
            const diffLines = [
              `diff --git a/${file.path} b/${file.path}`,
              'new file mode 100644',
              '--- /dev/null',
              `+++ b/${file.path}`,
              `@@ -0,0 +1,${lines.length} @@`,
              ...lines.map((line) => `+${line}`),
            ];
            diffs[file.path] = diffLines.join('\n');
            file.additions = lines.length;
            file.deletions = 0;
          } catch {
            // Binary or unreadable file
            diffs[file.path] = `Binary file or unable to read: ${file.path}`;
          }
        } else {
          // Use git diff HEAD to show all changes (staged + unstaged)
          const { stdout: diffOutput } = await execAsync(
            `git diff HEAD -- "${file.path}"`,
            {
              cwd: projectPath,
              maxBuffer: 10 * 1024 * 1024,
            },
          );

          if (diffOutput) {
            diffs[file.path] = diffOutput;

            // Count additions/deletions
            const lines = diffOutput.split('\n');
            let additions = 0;
            let deletions = 0;
            for (const line of lines) {
              if (line.startsWith('+') && !line.startsWith('+++')) additions++;
              if (line.startsWith('-') && !line.startsWith('---')) deletions++;
            }
            file.additions = additions;
            file.deletions = deletions;
          }
        }
      } catch (err) {
        // File might be deleted or inaccessible
        console.error(`Failed to get diff for ${file.path}:`, err.message);
      }
    }

    send(ws, {
      type: 'git_diff',
      files,
      diffs,
    });
  } catch (err) {
    console.error('Failed to get git diff:', err.message);
    send(ws, {
      type: 'git_diff',
      files: [],
      diffs: {},
      error: err.message,
    });
  }
}
