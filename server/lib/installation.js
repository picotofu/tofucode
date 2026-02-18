/**
 * Installation Detection & Upgrade Command Generation
 *
 * Detects how tofucode is installed and determines if auto-upgrade is supported.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

/**
 * Detect how tofucode is installed
 * @returns {'global'|'local'|'npx'|'docker'|'source'|'unknown'}
 */
export function getInstallationType() {
  console.log('[INSTALL-DETECT] === Detecting installation type ===');
  console.log(`[INSTALL-DETECT] rootDir: ${rootDir}`);
  console.log(`[INSTALL-DETECT] process.cwd(): ${process.cwd()}`);
  console.log(`[INSTALL-DETECT] process.argv[1]: ${process.argv[1]}`);

  // Docker: Check for /.dockerenv
  const isDocker = existsSync('/.dockerenv');
  console.log(
    `[INSTALL-DETECT] Docker check (/.dockerenv exists): ${isDocker}`,
  );
  if (isDocker) {
    console.log('[INSTALL-DETECT] Result: docker');
    return 'docker';
  }

  // Source: Check if we're running from a git repo
  const gitPath = join(rootDir, '.git');
  const isSource = existsSync(gitPath);
  console.log(`[INSTALL-DETECT] Source check (${gitPath} exists): ${isSource}`);
  if (isSource) {
    console.log('[INSTALL-DETECT] Result: source');
    return 'source';
  }

  // npx: Check if running from npx cache
  // npx installs to ~/.npm/_npx/... or similar
  const isNpx =
    process.argv[1]?.includes('/_npx/') ||
    process.argv[1]?.includes('\\_npx\\');
  console.log(`[INSTALL-DETECT] npx check (argv[1] contains _npx): ${isNpx}`);
  if (isNpx) {
    console.log('[INSTALL-DETECT] Result: npx');
    return 'npx';
  }

  // Global vs Local: Check if node_modules exists in parent dirs
  const localModulesPath = join(process.cwd(), 'node_modules', 'tofucode');
  const hasLocalNodeModules = existsSync(localModulesPath);
  console.log(
    `[INSTALL-DETECT] Local check (${localModulesPath} exists): ${hasLocalNodeModules}`,
  );

  if (hasLocalNodeModules) {
    console.log('[INSTALL-DETECT] Result: local');
    return 'local';
  }

  // Check if installed in global node_modules
  // Global install: process.argv[1] typically in /usr/local/lib/node_modules or similar
  const isGlobal =
    process.argv[1]?.includes('/node_modules/tofucode') ||
    process.argv[1]?.includes('\\node_modules\\tofucode');
  console.log(
    `[INSTALL-DETECT] Global check (argv[1] contains node_modules/tofucode): ${isGlobal}`,
  );

  if (isGlobal) {
    console.log('[INSTALL-DETECT] Result: global');
    return 'global';
  }

  console.log('[INSTALL-DETECT] Result: unknown');
  return 'unknown';
}

/**
 * SECURITY: Validate version string to prevent command injection.
 * Only allows 'latest' or semver format (e.g. "1.2.3").
 * @param {string} version
 * @returns {boolean}
 */
export function isValidVersion(version) {
  if (typeof version !== 'string') return false;
  return /^(latest|\d+\.\d+\.\d+)$/.test(version);
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
      return `npm install -g tofucode@${version}`;

    case 'local':
      return `npm install tofucode@${version}`;

    case 'npx':
      return 'npx clear-npx-cache && npx tofucode@latest';

    case 'docker':
      return 'docker pull ghcr.io/yourusername/tofucode:latest && docker restart <container>';

    case 'source':
      return 'git pull && npm install && npm run build';

    default:
      return 'npm install -g tofucode@latest';
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
