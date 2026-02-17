/**
 * Shared restart utility for server restarts and upgrades
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { logger } from './logger.js';

/**
 * Restart server with inverted spawn strategy
 * New process starts first, then old process exits
 *
 * @param {string} reason - Reason for restart (e.g., "upgrade", "restart")
 * @param {string} [newVersion] - New version being installed (for upgrades)
 * @returns {Promise<string>} Token for the new process
 */
export async function restartWithInvertedSpawn(reason, newVersion = null) {
  console.log('[RESTART] === Starting restart with inverted spawn ===');
  console.log(`[RESTART] Reason: ${reason}`);
  console.log(`[RESTART] New version: ${newVersion || 'N/A'}`);
  console.log(`[RESTART] Current PID: ${process.pid}`);
  console.log(`[RESTART] Current execPath: ${process.execPath}`);
  console.log(`[RESTART] Current argv: ${JSON.stringify(process.argv)}`);

  // Generate unique restart token
  const restartToken = randomBytes(16).toString('hex');
  console.log(`[RESTART] Generated restart token: ${restartToken}`);

  // For upgrades, spawn the 'tofucode' command to use newly installed version
  // For regular restarts, re-run the same script
  let spawnCmd, spawnArgs;
  if (reason === 'upgrade') {
    // Spawn 'tofucode' command (which now points to upgraded version)
    spawnCmd = 'tofucode';
    spawnArgs = process.argv.slice(2); // Skip node and script, keep CLI args
    console.log(
      `[RESTART] Upgrade: spawning tofucode command: ${spawnCmd} ${spawnArgs.join(' ')}`,
    );
    console.log(`[RESTART] Original argv: ${JSON.stringify(process.argv)}`);
    console.log(`[RESTART] Parsed args to pass: ${JSON.stringify(spawnArgs)}`);
  } else {
    // Regular restart: re-run same script
    spawnCmd = process.execPath;
    spawnArgs = process.argv.slice(1);
    console.log(
      `[RESTART] Regular restart: spawning: ${spawnCmd} ${spawnArgs.join(' ')}`,
    );
  }

  const spawnOptions = {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RESTART_TOKEN: restartToken,
      IS_RESTART: 'true',
      UPGRADE_RETRY_BIND: 'true',
      UPGRADE_MAX_RETRIES: process.env.UPGRADE_MAX_RETRIES || '20',
      UPGRADE_RETRY_INTERVAL: process.env.UPGRADE_RETRY_INTERVAL || '1000',
    },
  };

  // Log key env vars being passed
  console.log('[RESTART] Key env vars being passed:');
  console.log(`[RESTART]   PORT: ${spawnOptions.env.PORT}`);
  console.log(`[RESTART]   HOST: ${spawnOptions.env.HOST}`);
  console.log(`[RESTART]   DEBUG: ${spawnOptions.env.DEBUG}`);
  console.log(`[RESTART]   AUTH_DISABLED: ${spawnOptions.env.AUTH_DISABLED}`);
  console.log(`[RESTART]   PID_FILE: ${spawnOptions.env.PID_FILE}`);
  console.log(`[RESTART]   ALLOW_SOURCE_UPGRADE: ${spawnOptions.env.ALLOW_SOURCE_UPGRADE}`);

  // For upgrades, need shell to resolve 'tofucode' command in PATH
  if (reason === 'upgrade') {
    spawnOptions.shell = true;
  }

  const newProc = spawn(spawnCmd, spawnArgs, spawnOptions);

  newProc.unref(); // Allow this process to exit independently

  console.log(`[RESTART] New process spawned with PID: ${newProc.pid}`);
  logger.log(
    `New server process spawned (PID: ${newProc.pid}, reason: ${reason}${newVersion ? `, version: ${newVersion}` : ''})`,
  );

  // Update PID file if it exists (for daemon mode)
  const pidFile = getPidFile();
  console.log('[RESTART] Checking for PID file...');
  console.log(
    `[RESTART] PID file path: ${pidFile || 'null (not in daemon mode)'}`,
  );

  if (pidFile && existsSync(pidFile)) {
    console.log(
      `[RESTART] PID file exists, updating to new PID ${newProc.pid}`,
    );
    try {
      writeFileSync(pidFile, newProc.pid.toString(), 'utf8');
      console.log('[RESTART] PID file updated successfully');
      logger.log(`Updated PID file: ${pidFile} -> ${newProc.pid}`);
    } catch (err) {
      console.error('[RESTART] Failed to update PID file:', err);
      logger.log(`Warning: Failed to update PID file: ${err.message}`);
    }
  } else {
    console.log('[RESTART] No PID file to update (not in daemon mode)');
  }

  // Wait for new server to be ready (verify it started)
  console.log('[RESTART] Waiting 2 seconds for new process to start...');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Verify new process is still running
  console.log(
    `[RESTART] Verifying new process (PID ${newProc.pid}) is still running...`,
  );
  try {
    // Send signal 0 to check if process exists (doesn't actually signal it)
    process.kill(newProc.pid, 0);
    console.log(
      `[RESTART] ✅ New process verified running (PID: ${newProc.pid})`,
    );
    logger.log(`Verified new server process is running (PID: ${newProc.pid})`);
  } catch (_err) {
    console.error(`[RESTART] ❌ New process NOT running (PID: ${newProc.pid})`);
    throw new Error(`New server process failed to start (PID: ${newProc.pid})`);
  }

  console.log(`[RESTART] Restart token: ${restartToken}`);
  console.log('[RESTART] === restartWithInvertedSpawn() returning ===');
  return restartToken;
}

/**
 * Get PID file path (matches CLI logic)
 * @returns {string|null} PID file path or null if not in daemon mode
 */
function getPidFile() {
  console.log('[RESTART-PID] Checking for PID file...');
  console.log(
    `[RESTART-PID] PID_FILE env var: ${process.env.PID_FILE || 'not set'}`,
  );

  // Check environment variable (set by CLI)
  if (process.env.PID_FILE) {
    const resolved = resolve(process.env.PID_FILE);
    console.log(`[RESTART-PID] Using PID_FILE from env: ${resolved}`);
    return resolved;
  }

  // Check default location only if we think we're in daemon mode
  // (heuristic: if we were started with detached stdio, likely daemon)
  const defaultPidFile = join(homedir(), '.tofucode', 'tofucode.pid');
  console.log(`[RESTART-PID] Checking default location: ${defaultPidFile}`);
  console.log(
    `[RESTART-PID] Default PID file exists: ${existsSync(defaultPidFile)}`,
  );

  if (existsSync(defaultPidFile)) {
    console.log(`[RESTART-PID] Using default PID file: ${defaultPidFile}`);
    return defaultPidFile;
  }

  console.log('[RESTART-PID] No PID file found (not in daemon mode)');
  return null;
}
