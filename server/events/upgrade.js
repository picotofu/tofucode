/**
 * One-Click Upgrade Handler
 *
 * Handles automatic upgrade of tofucode package followed by server restart.
 *
 * Flow:
 * 1. Check installation type (global/local npm only)
 * 2. Run npm install -g tofucode@latest (or local variant)
 * 3. Spawn NEW process with UPGRADE_RETRY_BIND=true
 * 4. Old process exits, releasing the port
 * 5. New process's retry succeeds and takes over
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  canAutoUpgrade,
  getInstallationType,
  getUpgradeCommand,
  isValidVersion,
} from '../lib/installation.js';
import { restartWithInvertedSpawn } from '../lib/restart.js';
import { broadcast } from '../lib/ws.js';

const execAsync = promisify(exec);

/**
 * Handle upgrade request from frontend
 * @param {WebSocket} _ws - WebSocket connection (unused, we broadcast to all)
 * @param {Object} message - Message with optional version property
 * @param {Object} _context - Connection context (unused)
 */
export async function handleUpgrade(_ws, message, _context) {
  const rawVersion = message.version || 'latest';

  // SECURITY: Validate version string to prevent command injection
  if (!isValidVersion(rawVersion)) {
    broadcast({
      type: 'upgrade_error',
      message: `Invalid version format: "${rawVersion}". Must be "latest" or a semver string (e.g. "1.2.3").`,
    });
    return;
  }
  const version = rawVersion;

  console.log('=== UPGRADE DEBUG START ===');
  console.log(`[UPGRADE] Request received (target version: ${version})`);
  console.log(`[UPGRADE] process.argv[0]: ${process.argv[0]}`);
  console.log(`[UPGRADE] process.argv[1]: ${process.argv[1]}`);
  console.log(`[UPGRADE] process.cwd(): ${process.cwd()}`);
  console.log(`[UPGRADE] process.pid: ${process.pid}`);

  // Check if auto-upgrade is supported
  const installType = getInstallationType();
  console.log(`[UPGRADE] Detected installation type: ${installType}`);

  const canUpgrade = canAutoUpgrade();
  console.log(`[UPGRADE] Can auto-upgrade: ${canUpgrade}`);

  if (!canUpgrade) {
    const command = getUpgradeCommand(version);
    console.log('[UPGRADE] Auto-upgrade NOT supported - rejecting');

    broadcast({
      type: 'upgrade_error',
      message: `Auto-upgrade not supported for ${installType} installation. Please run manually: ${command}`,
    });
    return;
  }

  console.log('[UPGRADE] Auto-upgrade supported - proceeding');
  const upgradeCommand = getUpgradeCommand(version);
  console.log(`[UPGRADE] Will run command: ${upgradeCommand}`);

  // Broadcast upgrade started
  console.log(`[UPGRADE] Broadcasting 'upgrade_started' to all clients`);
  broadcast({
    type: 'upgrade_started',
    message: 'Downloading and installing update...',
  });

  try {
    // Step 1: Run npm install
    console.log('[UPGRADE] Step 1: Running npm install...');
    await installUpdate(version);
    console.log('[UPGRADE] Step 1 complete: npm install succeeded');

    // Broadcast install success
    console.log(`[UPGRADE] Broadcasting 'upgrade_installing' to all clients`);
    broadcast({
      type: 'upgrade_installing',
      message: 'Update installed. Restarting server...',
    });

    // Wait briefly for message to be sent
    console.log('[UPGRADE] Waiting 200ms for message to be sent...');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Step 2: Restart with inverted spawn (from shared lib)
    console.log(
      `[UPGRADE] Step 2: Calling restartWithInvertedSpawn('upgrade', '${version}')...`,
    );
    await restartWithInvertedSpawn('upgrade', version);
    console.log('[UPGRADE] Step 2 complete: restartWithInvertedSpawn returned');

    // Broadcast success before exiting
    console.log(`[UPGRADE] Broadcasting 'upgrade_success' to all clients`);
    broadcast({
      type: 'upgrade_success',
      message: 'Server upgraded successfully. Reconnecting...',
    });

    // Wait briefly for message to be sent, then exit quickly to free port
    console.log('[UPGRADE] Waiting 200ms for message to be sent...');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Exit old process immediately - new process is retrying and will take over
    console.log(
      `[UPGRADE] About to call process.exit(0) - PID ${process.pid} exiting now...`,
    );
    console.log('=== UPGRADE DEBUG END (old process exiting) ===');
    process.exit(0);
  } catch (error) {
    console.error('[UPGRADE] ERROR in upgrade flow:', error);
    console.error('[UPGRADE] Error stack:', error.stack);
    broadcast({
      type: 'upgrade_error',
      message: `Upgrade failed: ${error.message}`,
    });
    console.log('=== UPGRADE DEBUG END (error) ===');
  }
}

/**
 * Install npm update
 * @param {string} version - Version to install
 */
async function installUpdate(version = 'latest') {
  const command = getUpgradeCommand(version);

  console.log('[UPGRADE-INSTALL] Starting npm install...');
  console.log(`[UPGRADE-INSTALL] Command: ${command}`);
  console.log('[UPGRADE-INSTALL] Timeout: 120000ms (2 minutes)');

  try {
    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(command, {
      timeout: 120000, // 2 minute timeout
    });
    const duration = Date.now() - startTime;

    console.log(`[UPGRADE-INSTALL] Command completed in ${duration}ms`);

    if (stdout) {
      console.log('[UPGRADE-INSTALL] npm stdout:');
      console.log(stdout);
    }
    if (stderr) {
      console.log('[UPGRADE-INSTALL] npm stderr:');
      console.log(stderr);
    }

    console.log('[UPGRADE-INSTALL] Update installed successfully');
  } catch (error) {
    console.error('[UPGRADE-INSTALL] ERROR: Command failed');
    console.error(`[UPGRADE-INSTALL] Error code: ${error.code}`);
    console.error(`[UPGRADE-INSTALL] Error message: ${error.message}`);
    console.error(`[UPGRADE-INSTALL] Error stdout: ${error.stdout}`);
    console.error(`[UPGRADE-INSTALL] Error stderr: ${error.stderr}`);

    // Handle permission errors specifically
    if (
      error.message.includes('EACCES') ||
      error.message.includes('permission denied')
    ) {
      throw new Error(
        `Permission denied. Try running with sudo: sudo ${command}`,
      );
    }

    throw new Error(`npm install failed: ${error.message}`);
  }
}
