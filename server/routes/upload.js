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
import { loadSettings } from '../lib/settings.js';

/**
 * Validate that a destination path is within allowed directories.
 * Mirrors the logic in server/events/files.js.
 */
function validateUploadPath(requestedPath, projectPath) {
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
        throw new Error(
          `Access denied: path outside root (${config.rootPath})`,
        );
      }

      return resolvedPath;
    } catch (err) {
      throw new Error(`Access denied: unable to resolve path (${err.message})`);
    }
  }

  const allowedRoots = [homedir()];
  if (projectPath) {
    allowedRoots.push(path.resolve(projectPath));
  }

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
 * Build a multer instance with the current upload size limit.
 * Re-read settings each request so changes take effect without restart.
 */
function buildUpload() {
  const settings = loadSettings();
  const limitMb = Math.min(
    settings.uploadMaxFileSizeMb ?? 10,
    config.maxFileSizeMb,
  );

  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limitMb * 1024 * 1024 },
  });
}

/**
 * POST /api/upload
 *
 * multipart/form-data fields:
 *   file      — the file binary (required)
 *   destPath  — absolute destination directory path (required)
 *   projectPath — current project path for access validation (optional)
 */
export function uploadHandler(req, res) {
  const upload = buildUpload();

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const settings = loadSettings();
        const limitMb = Math.min(
          settings.uploadMaxFileSizeMb ?? 10,
          config.maxFileSizeMb,
        );
        return res
          .status(413)
          .json({ error: `File exceeds upload limit (${limitMb} MB)` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { destPath, projectPath } = req.body;
    if (!destPath) {
      return res.status(400).json({ error: 'destPath is required' });
    }

    try {
      const resolvedDir = validateUploadPath(destPath, projectPath || null);

      // Ensure destination directory exists
      await fs.mkdir(resolvedDir, { recursive: true });

      const finalPath = path.join(resolvedDir, req.file.originalname);
      await fs.writeFile(finalPath, req.file.buffer);

      res.json({ success: true, path: finalPath, name: req.file.originalname });
    } catch (writeErr) {
      res.status(400).json({ error: writeErr.message });
    }
  });
}
