/**
 * Installation Detection & Upgrade Command Generation
 *
 * Detects how cc-web is installed and determines if auto-upgrade is supported.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

/**
 * Detect how cc-web is installed
 * @returns {'global'|'local'|'npx'|'docker'|'source'|'unknown'}
 */
export function getInstallationType() {
  // Docker: Check for /.dockerenv
  if (existsSync('/.dockerenv')) {
    return 'docker';
  }

  // Source: Check if we're running from a git repo
  if (existsSync(join(rootDir, '.git'))) {
    return 'source';
  }

  // npx: Check if running from npx cache
  // npx installs to ~/.npm/_npx/... or similar
  if (
    process.argv[1]?.includes('/_npx/') ||
    process.argv[1]?.includes('\\_npx\\')
  ) {
    return 'npx';
  }

  // Global vs Local: Check if node_modules exists in parent dirs
  const hasLocalNodeModules = existsSync(
    join(process.cwd(), 'node_modules', 'cc-web'),
  );

  if (hasLocalNodeModules) {
    return 'local';
  }

  // Check if installed in global node_modules
  // Global install: process.argv[1] typically in /usr/local/lib/node_modules or similar
  if (
    process.argv[1]?.includes('/node_modules/cc-web') ||
    process.argv[1]?.includes('\\node_modules\\cc-web')
  ) {
    return 'global';
  }

  return 'unknown';
}

/**
 * Check if auto-upgrade is supported for current installation type
 * @returns {boolean}
 */
export function canAutoUpgrade() {
  const type = getInstallationType();

  // Only npm global and local installs support auto-upgrade
  return type === 'global' || type === 'local';
}

/**
 * Get the appropriate upgrade command for current installation
 * @param {string} version - Version to upgrade to (e.g., "1.1.0" or "latest")
 * @returns {string}
 */
export function getUpgradeCommand(version = 'latest') {
  const type = getInstallationType();

  switch (type) {
    case 'global':
      return `npm install -g cc-web@${version}`;

    case 'local':
      return `npm install cc-web@${version}`;

    case 'npx':
      return 'npx clear-npx-cache && npx cc-web@latest';

    case 'docker':
      return 'docker pull ghcr.io/yourusername/cc-web:latest && docker restart <container>';

    case 'source':
      return 'git pull && npm install && npm run build';

    default:
      return 'npm install -g cc-web@latest';
  }
}

/**
 * Get user-friendly installation type name
 * @returns {string}
 */
export function getInstallationTypeName() {
  const type = getInstallationType();

  const names = {
    global: 'npm (global)',
    local: 'npm (local)',
    npx: 'npx',
    docker: 'Docker',
    source: 'Source',
    unknown: 'Unknown',
  };

  return names[type] || 'Unknown';
}
