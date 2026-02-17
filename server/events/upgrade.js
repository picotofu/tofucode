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
  const version = message.version || 'latest';

  console.log(`Upgrade request received (target version: ${version})`);

  // Check if auto-upgrade is supported
  if (!canAutoUpgrade()) {
    const installType = getInstallationType();
    const command = getUpgradeCommand(version);

    broadcast({
      type: 'upgrade_error',
      message: `Auto-upgrade not supported for ${installType} installation. Please run manually: ${command}`,
    });
    return;
  }

  // Broadcast upgrade started
  broadcast({
    type: 'upgrade_started',
    message: 'Downloading and installing update...',
  });

  try {
    // Step 1: Run npm install
    await installUpdate(version);

    // Broadcast install success
    broadcast({
      type: 'upgrade_installing',
      message: 'Update installed. Restarting server...',
    });

    // Wait for message to be sent
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Step 2: Restart with inverted spawn (from shared lib)
    await restartWithInvertedSpawn('upgrade', version);

    // Broadcast success before exiting
    broadcast({
      type: 'upgrade_success',
      message: 'Server upgraded successfully. Reconnecting...',
    });

    // Wait for message to be sent
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Exit old process - new process will take over
    console.log('Exiting old process, new process will take over...');
    process.exit(0);
  } catch (error) {
    console.error('Upgrade failed:', error);
    broadcast({
      type: 'upgrade_error',
      message: `Upgrade failed: ${error.message}`,
    });
  }
}

/**
 * Install npm update
 * @param {string} version - Version to install
 */
async function installUpdate(version = 'latest') {
  const command = getUpgradeCommand(version);

  console.log(`Installing update: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 120000, // 2 minute timeout
    });

    if (stdout) console.log('npm stdout:', stdout);
    if (stderr) console.error('npm stderr:', stderr);

    console.log('Update installed successfully');
  } catch (error) {
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
