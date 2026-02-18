import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const config = {
  port: Number.parseInt(process.env.PORT || '3001', 10),

  // Claude storage location
  claudeDir: join(homedir(), '.claude'),
  projectsDir: join(homedir(), '.claude', 'projects'),

  // Allowed tools for Claude
  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],

  // Permission mode: 'bypassPermissions' for full access
  permissionMode: 'bypassPermissions',

  // Root path restriction (if set, limits file/terminal access)
  rootPath: process.env.ROOT_PATH || null,

  // Model configuration (override default model versions)
  models: {
    haiku: process.env.MODEL_HAIKU_SLUG || 'claude-haiku-4-5',
    sonnet: process.env.MODEL_SONNET_SLUG || 'claude-sonnet-4-6',
    opus: process.env.MODEL_OPUS_SLUG || 'claude-opus-4-6',
  },
};

// Convert project path to slug (how Claude stores it)
export function pathToSlug(projectPath) {
  // Claude uses: leading dash + path with slashes replaced by dashes
  return `-${projectPath.replace(/\//g, '-').replace(/^-/, '')}`;
}

// Extract display name from slug (last segment, best effort)
export function getProjectDisplayName(slug) {
  // Slug format: -home-ts-projects-my-project
  // Try to find the actual path and get its basename
  const path = slugToPath(slug);
  if (path) {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || slug;
  }
  return slug;
}

// SECURITY: Limits for slugToPath to prevent exponential complexity DoS
const MAX_SLUG_PARTS = 30; // Reject slugs with too many dash-separated parts
const MAX_SPAN_SIZE = 8; // Max parts combined into a single folder name (2^8=256 combos max per span)

// Convert slug back to path (best effort - check if path exists)
export function slugToPath(slug) {
  // Slug format: -home-ts-projects-claude-web
  // Challenge: folder names can contain hyphens (e.g., "anime-service")
  // Strategy: recursively try matching consecutive parts joined by hyphens

  const normalized = slug.replace(/^-/, ''); // Remove leading dash
  const parts = normalized.split('-');

  // SECURITY: Reject excessively long slugs to prevent DoS via exponential recursion
  if (parts.length > MAX_SLUG_PARTS) {
    // Fallback to simple replacement for oversized slugs
    return `/${normalized.replace(/-/g, '/')}`;
  }

  function findPath(currentPath, startIdx) {
    if (startIdx >= parts.length) {
      return existsSync(currentPath) ? currentPath : null;
    }

    // Try matching 1, 2, 3... consecutive parts as a single folder name.
    // For each span, try joining with '-' first, then also try all combinations
    // where any separator between adjacent parts could be '.' (e.g. picotofu.dev).
    // Cap span size to MAX_SPAN_SIZE to bound combinations per level.
    const maxEnd = Math.min(parts.length - 1, startIdx + MAX_SPAN_SIZE - 1);
    for (let endIdx = startIdx; endIdx <= maxEnd; endIdx++) {
      const span = parts.slice(startIdx, endIdx + 1);

      // Generate all separator combinations (each gap is '-' or '.')
      const gapCount = span.length - 1;
      const combos = 2 ** gapCount; // 1 part = 1 combo, 2 parts = 2, etc.
      for (let mask = 0; mask < combos; mask++) {
        let folderName = span[0];
        for (let g = 0; g < gapCount; g++) {
          folderName += (mask >> g) & 1 ? '.' : '-';
          folderName += span[g + 1];
        }
        const testPath = `${currentPath}/${folderName}`;
        if (existsSync(testPath)) {
          const result = findPath(testPath, endIdx + 1);
          if (result) return result;
        }
      }
    }

    return null;
  }

  const result = findPath('', 0);
  if (result) return result;

  // Fallback: simple replacement (may not be accurate for non-existent paths)
  return `/${normalized.replace(/-/g, '/')}`;
}

// Get sessions directory for a project slug
export function getSessionsDir(slug) {
  return join(config.projectsDir, slug);
}
