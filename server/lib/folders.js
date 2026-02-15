/**
 * Folder utilities - browse filesystem directories
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { config } from '../config.js';

/**
 * Browse folder contents
 * @param {string|null} folderPath - Path to browse, defaults to $HOME or root
 * @returns {{path: string, contents: Array<{name: string, path: string, isDirectory: boolean}>}}
 */
export function browseFolderContents(folderPath) {
  // If --root is set, default to root instead of home
  const defaultPath = config.rootPath || homedir();
  const targetPath = folderPath || defaultPath;

  // If --root is set, validate path is within root
  if (config.rootPath) {
    try {
      // SECURITY: Resolve symlinks to prevent escape via symlink
      const resolvedTarget = existsSync(targetPath)
        ? realpathSync(targetPath)
        : resolve(targetPath);
      const resolvedRoot = realpathSync(config.rootPath);
      const relativePath = relative(resolvedRoot, resolvedTarget);

      // If path is outside root, return root directory instead
      if (
        relativePath.startsWith('..') ||
        resolve(relativePath).startsWith('..')
      ) {
        return browseFolderContents(config.rootPath);
      }
    } catch (err) {
      // If realpath fails (broken symlink, no permissions), deny access
      console.error('Failed to resolve path:', err.message);
      return browseFolderContents(config.rootPath);
    }
  }

  try {
    if (!existsSync(targetPath)) {
      return { path: targetPath, contents: [] };
    }

    const entries = readdirSync(targetPath, { withFileTypes: true });
    let contents = entries
      .filter((entry) => !entry.name.startsWith('.')) // Hide hidden files
      .map((entry) => ({
        name: entry.name,
        path: join(targetPath, entry.name),
        isDirectory: entry.isDirectory(),
      }));

    // If --root is set, filter out paths that would go outside root
    if (config.rootPath) {
      try {
        const resolvedRoot = realpathSync(config.rootPath);
        contents = contents.filter((item) => {
          try {
            // SECURITY: Resolve symlinks to detect escape attempts
            const resolvedItem = existsSync(item.path)
              ? realpathSync(item.path)
              : resolve(item.path);
            const relativePath = relative(resolvedRoot, resolvedItem);
            return (
              !relativePath.startsWith('..') &&
              !resolve(relativePath).startsWith('..')
            );
          } catch {
            // If realpath fails, exclude the item
            return false;
          }
        });
      } catch (err) {
        console.error('Failed to resolve root path:', err.message);
        contents = [];
      }
    }

    contents.sort((a, b) => {
      // Directories first, then alphabetically
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return { path: targetPath, contents };
  } catch (err) {
    console.error('Failed to browse folder:', err.message);
    return { path: targetPath, contents: [] };
  }
}
