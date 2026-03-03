import { existsSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { config, slugToPath } from '../config.js';
import { send } from '../lib/ws.js';

/**
 * Check if query is a glob pattern
 * @param {string} query - Search query
 * @returns {boolean}
 */
function isGlobPattern(query) {
  return query.includes('*') || query.includes('?');
}

/**
 * Convert glob pattern to regex
 * @param {string} pattern - Glob pattern (e.g., "*.md", "test*.js")
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  // Escape special regex characters except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Recursively search for files and folders in a directory
 * @param {string} dirPath - Directory to search
 * @param {string} query - Search query (case-insensitive or glob pattern)
 * @param {number} maxDepth - Maximum depth to recurse
 * @param {number} maxResults - Maximum results to return
 * @param {string} basePath - Base path for relative paths
 * @returns {Promise<Array>} Array of file/folder paths
 */
async function searchFiles(
  dirPath,
  query,
  maxDepth = 5,
  maxResults = 100,
  basePath = dirPath,
  showDotfiles = false,
) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  const isGlob = isGlobPattern(query);
  const globRegex = isGlob ? globToRegex(query) : null;

  // Normalize separators (space, underscore, hyphen, slash) → single space.
  // Applied to both the query tokens and the target strings so that
  // "feature mcp" matches "FEATURE_MCP.md", "docs api" matches "docs/api/file.md", etc.
  const normalize = (s) => s.replace(/[\s_\-/]+/g, ' ').trim();

  // Split query into tokens on whitespace. Multi-token queries require ALL tokens
  // to appear somewhere in the normalized target (AND semantics).
  const tokens = lowerQuery.trim().split(/\s+/).filter(Boolean);

  // Common directories to skip
  const skipDirs = new Set([
    'node_modules',
    '.git',
    '.next',
    '.nuxt',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.DS_Store',
    '__pycache__',
    '.pytest_cache',
    '.venv',
    'venv',
    '.env',
  ]);

  async function search(currentPath, depth) {
    if (depth > maxDepth || results.length >= maxResults) {
      return;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        // Skip hidden files/folders (unless showDotfiles) and common build directories
        // skipDirs only applies to directories — don't skip files named the same (e.g. .env file)
        if (
          (!showDotfiles && entry.name.startsWith('.')) ||
          (entry.isDirectory() && skipDirs.has(entry.name))
        ) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);
        const fileName = entry.name.toLowerCase();

        // Normalised forms used for separator-agnostic matching
        const normFileName = normalize(fileName);
        const normRelative = normalize(
          relativePath.split(path.sep).join('/').toLowerCase(),
        );

        // Returns true if every query token appears in the given normalised string
        const allTokensIn = (target) =>
          tokens.every((t) => target.includes(normalize(t)));

        // Check if filename matches search criteria
        let filenameMatches = false;

        if (isGlob) {
          filenameMatches = globRegex.test(entry.name);
        } else if (tokens.length > 1) {
          // Multi-token: all tokens must appear in the normalised filename
          filenameMatches = allTokensIn(normFileName);
        } else {
          // Single token: fuzzy char-order match against raw filename
          let queryIndex = 0;
          for (const char of fileName) {
            if (char === lowerQuery[queryIndex]) {
              queryIndex++;
              if (queryIndex === lowerQuery.length) break;
            }
          }
          filenameMatches = queryIndex === lowerQuery.length;
          // Also try normalised substring (e.g. "feat_mcp" → "feat mcp" in normFileName)
          if (!filenameMatches) {
            filenameMatches = normFileName.includes(normalize(lowerQuery));
          }
        }

        // Check if the full relative path matches.
        // Single-token: substring on raw path (preserves "docs/api" → "docs/api/file.md").
        // Multi-token: all tokens must appear in the normalised path.
        let fullPathMatches = false;
        if (!isGlob) {
          const rawRelative = relativePath
            .split(path.sep)
            .join('/')
            .toLowerCase();
          if (tokens.length > 1) {
            fullPathMatches = allTokensIn(normRelative);
          } else {
            fullPathMatches =
              rawRelative.includes(lowerQuery) ||
              normRelative.includes(normalize(lowerQuery));
          }
        }

        // Fallback: fuzzy match any single parent folder name (single-token only)
        let folderPathMatches = false;
        if (
          !isGlob &&
          !entry.isDirectory() &&
          !fullPathMatches &&
          tokens.length === 1
        ) {
          const pathParts = relativePath.split(path.sep);
          for (let i = 0; i < pathParts.length - 1; i++) {
            const folderName = pathParts[i].toLowerCase();
            let queryIndex = 0;
            for (const char of folderName) {
              if (char === lowerQuery[queryIndex]) {
                queryIndex++;
                if (queryIndex === lowerQuery.length) break;
              }
            }
            if (queryIndex === lowerQuery.length) {
              folderPathMatches = true;
              break;
            }
          }
        }

        const matches = filenameMatches || fullPathMatches || folderPathMatches;

        if (entry.isDirectory()) {
          // Add matching directories to results
          if (filenameMatches) {
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath,
              directory: path.dirname(relativePath),
              isDirectory: true,
              matchType: 'folder', // For sorting priority
            });
          }
          // Always recurse into directories
          await search(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Add matching files to results
          if (matches) {
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath,
              directory: path.dirname(relativePath),
              isDirectory: false,
              matchType: filenameMatches
                ? 'filename'
                : fullPathMatches
                  ? 'fullpath'
                  : 'folderpath',
            });
          }
        }
      }
    } catch (_err) {
      // Skip directories we can't read (permissions, etc.)
    }
  }

  await search(dirPath, 0);

  // Sort results: folders first, then files by filename match, then by folder path match
  results.sort((a, b) => {
    // Folders first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    // For files, prioritize: filename > fullpath > folderpath
    if (!a.isDirectory && !b.isDirectory) {
      const rank = { filename: 0, fullpath: 1, folderpath: 2 };
      const diff = (rank[a.matchType] ?? 2) - (rank[b.matchType] ?? 2);
      if (diff !== 0) return diff;
    }

    // Alphabetically by name
    return a.name.localeCompare(b.name);
  });

  return results;
}

/**
 * Validate that a search path is within allowed directories
 * @param {string} requestedPath - Path to validate
 * @param {object} context - WebSocket context with project info
 * @returns {string} Validated resolved path
 * @throws {Error} If path is outside allowed directories
 */
function validateSearchPath(requestedPath, context) {
  const resolved = path.resolve(requestedPath);

  // If --root is set, enforce strict root restriction
  if (config.rootPath) {
    const resolvedPath = existsSync(resolved)
      ? realpathSync(resolved)
      : resolved;
    const resolvedRoot = realpathSync(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(
        `Access denied: search path outside root (${config.rootPath})`,
      );
    }

    return resolvedPath;
  }

  // Default behavior (no --root set): Allow home directory and project
  const allowedRoots = [homedir()];

  if (context?.currentProjectPath) {
    const projectPath = context.currentProjectPath.startsWith('-')
      ? slugToPath(context.currentProjectPath)
      : context.currentProjectPath;
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
    throw new Error('Access denied: search path outside allowed directories');
  }

  return resolved;
}

/**
 * Handle files:search WebSocket event
 */
export async function handleFilesSearch(ws, payload, context) {
  const { query, projectPath, showDotfiles = false } = payload;

  try {
    // Get project slug from context or use provided path
    // context.currentProjectPath is actually a slug, not a path
    const projectSlugOrPath = projectPath || context?.currentProjectPath;

    if (!projectSlugOrPath) {
      throw new Error('No project path specified');
    }

    // Convert slug to path if it starts with dash (slug format)
    const actualPath = projectSlugOrPath.startsWith('-')
      ? slugToPath(projectSlugOrPath)
      : projectSlugOrPath;

    // SECURITY: Validate search path is within allowed directories
    const resolvedPath = validateSearchPath(actualPath, context);

    // Validate path exists and is a directory
    const stats = await fs.stat(resolvedPath);

    if (!stats.isDirectory()) {
      throw new Error('Search path must be a directory');
    }

    // Perform search
    const results = await searchFiles(
      resolvedPath,
      query,
      5,
      100,
      resolvedPath,
      showDotfiles,
    );

    send(ws, {
      type: 'files:search:result',
      query,
      projectPath: resolvedPath,
      results,
      count: results.length,
    });
  } catch (err) {
    send(ws, {
      type: 'files:search:error',
      query,
      error: err.message,
    });
  }
}
