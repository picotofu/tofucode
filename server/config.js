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

// Convert slug back to path (best effort - check if path exists)
export function slugToPath(slug) {
  // Slug format: -home-ts-projects-claude-web
  // Challenge: folder names can contain hyphens (e.g., "anime-service")
  // Strategy: recursively try matching consecutive parts joined by hyphens

  const normalized = slug.replace(/^-/, ''); // Remove leading dash
  const parts = normalized.split('-');

  function findPath(currentPath, startIdx) {
    if (startIdx >= parts.length) {
      return existsSync(currentPath) ? currentPath : null;
    }

    // Try matching 1, 2, 3... consecutive parts as a single folder name
    for (let endIdx = startIdx; endIdx < parts.length; endIdx++) {
      const folderName = parts.slice(startIdx, endIdx + 1).join('-');
      const testPath = `${currentPath}/${folderName}`;

      if (existsSync(testPath)) {
        const result = findPath(testPath, endIdx + 1);
        if (result) return result;
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
