import { existsSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import {
  isAuthDisabled,
  parseSessionCookie,
  validateSession,
} from '../lib/auth.js';

/**
 * Validate that a destination path is within allowed directories.
 * Unlike WebSocket file handlers, the upload route has no server-side project context,
 * so we only allow paths under homedir() (or config.rootPath when set).
 * Symlinks are resolved in both modes for defense-in-depth.
 */
function validateUploadPath(requestedPath) {
  const resolved = path.resolve(requestedPath);

  if (config.rootPath) {
    try {
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

      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Access denied: path outside root');
      }

      return resolvedPath;
    } catch (err) {
      if (err.message.startsWith('Access denied')) throw err;
      throw new Error('Access denied: unable to resolve path');
    }
  }

  // SECURITY: Resolve symlinks to prevent escape via symlink
  const realResolved = existsSync(resolved)
    ? realpathSync(resolved)
    : (() => {
        const parent = path.dirname(resolved);
        const basename = path.basename(resolved);
        return existsSync(parent)
          ? path.join(realpathSync(parent), basename)
          : resolved;
      })();

  const home = homedir();
  const normalizedHome = path.resolve(home);
  const isAllowed =
    realResolved === normalizedHome ||
    realResolved.startsWith(normalizedHome + path.sep);

  if (!isAllowed) {
    throw new Error('Access denied: path outside allowed directories');
  }

  return realResolved;
}

/**
 * Auth middleware for the upload route.
 * Uses the same session cookie as the rest of the app.
 */
export function uploadAuthMiddleware(req, res, next) {
  if (isAuthDisabled()) return next();

  const token = parseSessionCookie(req.headers.cookie);
  if (!validateSession(token)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  next();
}

/**
 * Build a multer instance using the server's hard cap (MAX_FILE_SIZE_MB env).
 */
function buildUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
  });
}

/**
 * POST /api/upload
 *
 * multipart/form-data fields:
 *   file      — the file binary (required)
 *   destPath  — absolute destination directory path (required)
 */
export function uploadHandler(req, res) {
  const upload = buildUpload();

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File exceeds upload limit (${config.maxFileSizeMb} MB)`,
        });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { destPath } = req.body;
    if (!destPath) {
      return res.status(400).json({ error: 'destPath is required' });
    }

    try {
      const resolvedDir = validateUploadPath(destPath);

      // Ensure destination directory exists
      await fs.mkdir(resolvedDir, { recursive: true });

      // SECURITY: Sanitize filename — strip path separators and traversal sequences
      const sanitizedName = path.basename(req.file.originalname);
      if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const finalPath = path.join(resolvedDir, sanitizedName);

      // SECURITY: Re-validate that the final path is still within allowed directories
      validateUploadPath(finalPath);

      await fs.writeFile(finalPath, req.file.buffer);

      res.json({ success: true, path: finalPath, name: sanitizedName });
    } catch (writeErr) {
      const safeMessage = writeErr.message?.includes('Access denied')
        ? writeErr.message
        : 'Upload failed';
      res.status(400).json({ error: safeMessage });
    }
  });
}
