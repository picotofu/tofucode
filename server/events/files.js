import { existsSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { send } from '../lib/ws.js';

/**
 * Validate that a path is within allowed directories
 * @param {string} requestedPath - Path to validate
 * @param {object} context - WebSocket context with project info
 * @returns {string} Validated resolved path
 * @throws {Error} If path is outside allowed directories
 */
function validatePath(requestedPath, context) {
  const resolved = path.resolve(requestedPath);

  // If --root is set, enforce strict root restriction
  if (config.rootPath) {
    try {
      // SECURITY: Resolve symlinks to prevent escape via symlink
      // For non-existent paths (create operations), resolve the parent
      const resolvedPath = existsSync(resolved)
        ? realpathSync(resolved)
        : (() => {
            const parent = path.dirname(resolved);
            const basename = path.basename(resolved);
            return existsSync(parent)
              ? path.join(realpathSync(parent), basename)
              : resolved;
          })();

      const resolvedRoot = realpathSync(config.rootPath);
      const relativePath = path.relative(resolvedRoot, resolvedPath);

      // Check if path is within root (relative path shouldn't start with ..)
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(
          `Access denied: path outside root (${config.rootPath})`,
        );
      }

      return resolvedPath;
    } catch (err) {
      // If realpath fails, deny access
      throw new Error(`Access denied: unable to resolve path (${err.message})`);
    }
  }

  // Default behavior (no --root set): Allow home directory and project
  const allowedRoots = [homedir()];

  // Add project path if available in context
  if (context?.currentProjectPath) {
    allowedRoots.push(path.resolve(context.currentProjectPath));
  }

  // Check if resolved path is within any allowed root
  const isAllowed = allowedRoots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return (
      resolved === normalizedRoot ||
      resolved.startsWith(normalizedRoot + path.sep)
    );
  });

  if (!isAllowed) {
    throw new Error('Access denied: path outside allowed directories');
  }

  return resolved;
}

/**
 * Check if a directory contains .md files (recursively)
 * @param {string} dirPath - Directory path to check
 * @param {number} maxDepth - Maximum recursion depth (default 3)
 * @returns {Promise<boolean>}
 */
async function containsMarkdownFiles(dirPath, maxDepth = 3) {
  if (maxDepth <= 0) return false;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip dotfiles
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        // Recursively check subdirectories
        const hasMarkdown = await containsMarkdownFiles(
          path.join(dirPath, entry.name),
          maxDepth - 1,
        );
        if (hasMarkdown) return true;
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        return true;
      }
    }
    return false;
  } catch (_err) {
    // If we can't read the directory, assume it doesn't contain markdown files
    return false;
  }
}

/**
 * Browse folder contents
 */
export async function handleFilesBrowse(ws, payload, context) {
  const { path: folderPath } = payload;

  try {
    // Validate path (prevent directory traversal and restrict to allowed dirs)
    const resolvedPath = validatePath(folderPath, context);

    // Read directory
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    // Build items with markdown metadata for directories
    const items = await Promise.all(
      entries.map(async (entry) => {
        const item = {
          name: entry.name,
          path: path.join(resolvedPath, entry.name),
          isDirectory: entry.isDirectory(),
        };

        // For directories, check if they contain markdown files
        if (item.isDirectory) {
          item.hasMarkdown = await containsMarkdownFiles(item.path);
        }

        return item;
      }),
    );

    send(ws, {
      type: 'files:browse:result',
      path: resolvedPath,
      items,
    });
  } catch (err) {
    send(ws, {
      type: 'files:browse:error',
      path: folderPath,
      error: err.message,
    });
  }
}

/**
 * Read file contents
 */
export async function handleFilesRead(ws, payload, context) {
  const { path: filePath } = payload;

  try {
    // Validate path
    const resolvedPath = validatePath(filePath, context);

    // Check file size (limit to 10MB)
    const stats = await fs.stat(resolvedPath);
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error('File too large (max 10MB)');
    }

    // Detect if file is an image based on extension
    const ext = path.extname(resolvedPath).toLowerCase();
    const imageExtensions = [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.svg',
      '.bmp',
      '.ico',
    ];
    const isImage = imageExtensions.includes(ext);

    if (isImage) {
      // For images, read as base64
      const buffer = await fs.readFile(resolvedPath);
      const base64 = buffer.toString('base64');

      // Detect MIME type
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      send(ws, {
        type: 'files:read:result',
        path: resolvedPath,
        content: `data:${mimeType};base64,${base64}`,
        size: stats.size,
        isImage: true,
      });
    } else {
      // Check if binary (skip for empty files)
      if (stats.size > 0) {
        const sampleSize = Math.min(8192, stats.size);
        const buffer = Buffer.alloc(sampleSize);
        const fd = await fs.open(resolvedPath, 'r');
        await fd.read(buffer, 0, sampleSize, 0);
        await fd.close();

        if (buffer.includes(0)) {
          throw new Error('Cannot edit binary file');
        }
      }

      // Read full content
      const content = await fs.readFile(resolvedPath, 'utf-8');

      send(ws, {
        type: 'files:read:result',
        path: resolvedPath,
        content,
        size: stats.size,
      });
    }
  } catch (err) {
    send(ws, {
      type: 'files:read:error',
      path: filePath,
      error: err.message,
    });
  }
}

/**
 * Write file contents
 */
export async function handleFilesWrite(ws, payload, context) {
  const { path: filePath, content } = payload;

  try {
    // Validate path
    const resolvedPath = validatePath(filePath, context);

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(resolvedPath, content, 'utf-8');

    send(ws, {
      type: 'files:write:result',
      path: resolvedPath,
      success: true,
    });
  } catch (err) {
    send(ws, {
      type: 'files:write:error',
      path: filePath,
      error: err.message,
    });
  }
}

/**
 * Create new file
 */
export async function handleFilesCreate(ws, payload, context) {
  const { path: filePath, isDirectory = false } = payload;

  try {
    const resolvedPath = validatePath(filePath, context);

    if (isDirectory) {
      await fs.mkdir(resolvedPath, { recursive: true });
    } else {
      // Ensure parent directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
      // Create empty file
      await fs.writeFile(resolvedPath, '', 'utf-8');
    }

    send(ws, {
      type: 'files:create:result',
      path: resolvedPath,
      isDirectory,
      success: true,
    });

    // Refresh parent directory
    const parentPath = path.dirname(resolvedPath);
    handleFilesBrowse(ws, { path: parentPath }, context);
  } catch (err) {
    send(ws, {
      type: 'files:create:error',
      path: filePath,
      error: err.message,
    });
  }
}

/**
 * Rename file or folder
 */
export async function handleFilesRename(ws, payload, context) {
  const { oldPath, newPath } = payload;

  try {
    const resolvedOldPath = validatePath(oldPath, context);
    const resolvedNewPath = validatePath(newPath, context);

    // Check if old path exists
    await fs.access(resolvedOldPath);

    // Rename
    await fs.rename(resolvedOldPath, resolvedNewPath);

    send(ws, {
      type: 'files:rename:result',
      oldPath: resolvedOldPath,
      newPath: resolvedNewPath,
      success: true,
    });

    // Refresh parent directory
    const parentPath = path.dirname(resolvedNewPath);
    handleFilesBrowse(ws, { path: parentPath }, context);
  } catch (err) {
    send(ws, {
      type: 'files:rename:error',
      oldPath,
      newPath,
      error: err.message,
    });
  }
}

/**
 * Delete file or folder
 */
export async function handleFilesDelete(ws, payload, context) {
  const { path: targetPath } = payload;

  try {
    const resolvedPath = validatePath(targetPath, context);

    // Check if exists
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      // Remove directory recursively
      await fs.rm(resolvedPath, { recursive: true, force: true });
    } else {
      // Remove file
      await fs.unlink(resolvedPath);
    }

    send(ws, {
      type: 'files:delete:result',
      path: resolvedPath,
      success: true,
    });

    // Refresh parent directory
    const parentPath = path.dirname(resolvedPath);
    handleFilesBrowse(ws, { path: parentPath }, context);
  } catch (err) {
    send(ws, {
      type: 'files:delete:error',
      path: targetPath,
      error: err.message,
    });
  }
}

/**
 * Move file or folder
 */
export async function handleFilesMove(ws, payload, context) {
  const { sourcePath, destPath } = payload;

  try {
    const resolvedSourcePath = validatePath(sourcePath, context);
    const resolvedDestPath = validatePath(destPath, context);

    // Check if source exists
    await fs.access(resolvedSourcePath);

    // Ensure destination parent exists
    const destDir = path.dirname(resolvedDestPath);
    await fs.mkdir(destDir, { recursive: true });

    // Move (rename)
    await fs.rename(resolvedSourcePath, resolvedDestPath);

    send(ws, {
      type: 'files:move:result',
      sourcePath: resolvedSourcePath,
      destPath: resolvedDestPath,
      success: true,
    });

    // Refresh both directories
    const sourceParent = path.dirname(resolvedSourcePath);
    const destParent = path.dirname(resolvedDestPath);
    handleFilesBrowse(ws, { path: sourceParent }, context);
    if (sourceParent !== destParent) {
      handleFilesBrowse(ws, { path: destParent }, context);
    }
  } catch (err) {
    send(ws, {
      type: 'files:move:error',
      sourcePath,
      destPath,
      error: err.message,
    });
  }
}
