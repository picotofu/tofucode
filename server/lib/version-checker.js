/**
 * Version Checker
 *
 * Periodically checks npm registry for newer versions of cc-web
 * and broadcasts update notifications to all connected clients.
 */

import { broadcast } from './ws.js';

let currentVersion = null;
let latestVersion = null;
let _lastCheck = 0;
let checkInterval = null;

// Check every hour by default
const CHECK_INTERVAL =
  Number.parseInt(process.env.UPDATE_CHECK_INTERVAL, 10) || 3600000;
const DISABLE_CHECK = process.env.DISABLE_UPDATE_CHECK === 'true';
const PACKAGE_NAME = 'cc-web';

/**
 * Initialize version checker
 * @param {string} version - Current package version
 */
export function initVersionChecker(version) {
  currentVersion = version;

  if (DISABLE_CHECK) {
    console.log('Update checking disabled');
    return;
  }

  console.log(`Version checker initialized (current: v${version})`);

  // Check immediately on startup
  checkForUpdates();

  // Schedule periodic checks
  checkInterval = setInterval(checkForUpdates, CHECK_INTERVAL);
}

/**
 * Check npm registry for updates
 */
async function checkForUpdates() {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/-/package/${PACKAGE_NAME}/dist-tags`,
    );

    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status}`);
    }

    const data = await response.json();
    latestVersion = data.latest;

    if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
      console.log(`Update available: v${currentVersion} -> v${latestVersion}`);

      // Broadcast to all connected clients
      broadcast({
        type: 'update_available',
        currentVersion,
        latestVersion,
        updateUrl: `https://www.npmjs.com/package/${PACKAGE_NAME}`,
      });
    } else {
      console.log(
        `No update available (current: v${currentVersion}, latest: v${latestVersion || 'unknown'})`,
      );
    }

    _lastCheck = Date.now();
  } catch (error) {
    console.error('Version check failed:', error.message);
  }
}

/**
 * Compare semantic versions
 * @param {string} latest - Latest version (e.g., "1.1.0")
 * @param {string} current - Current version (e.g., "1.0.0")
 * @returns {boolean} True if latest is newer than current
 */
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;

  // Simple semver comparison (major.minor.patch)
  const [lMajor = 0, lMinor = 0, lPatch = 0] = latest.split('.').map(Number);
  const [cMajor = 0, cMinor = 0, cPatch = 0] = current.split('.').map(Number);

  if (lMajor > cMajor) return true;
  if (lMajor < cMajor) return false;
  if (lMinor > cMinor) return true;
  if (lMinor < cMinor) return false;
  if (lPatch > cPatch) return true;
  return false;
}

/**
 * Get current version
 * @returns {string|null}
 */
export function getCurrentVersion() {
  return currentVersion;
}

/**
 * Get latest version from npm
 * @returns {string|null}
 */
export function getLatestVersion() {
  return latestVersion;
}

/**
 * Stop version checker
 */
export function stopVersionChecker() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

/**
 * Force immediate version check (for testing)
 */
export function forceCheck() {
  return checkForUpdates();
}
