/**
 * Shared restart utility for server restarts and upgrades
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
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
  // Generate unique restart token
  const restartToken = randomBytes(16).toString('hex');

  // Spawn new server process (detached, will outlive this process)
  const newProc = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RESTART_TOKEN: restartToken,
      IS_RESTART: 'true',
    },
  });

  newProc.unref(); // Allow this process to exit independently

  logger.log(`New server process spawned (PID: ${newProc.pid}, reason: ${reason}${newVersion ? `, version: ${newVersion}` : ''})`);

  // Wait for new server to be ready (verify it started)
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Verify new process is still running
  try {
    // Send signal 0 to check if process exists (doesn't actually signal it)
    process.kill(newProc.pid, 0);
    logger.log(`Verified new server process is running (PID: ${newProc.pid})`);
  } catch (err) {
    throw new Error(`New server process failed to start (PID: ${newProc.pid})`);
  }

  return restartToken;
}
