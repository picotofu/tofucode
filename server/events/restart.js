/**
 * POC: Server restart handler using inverted spawn strategy
 *
 * This is a PROOF OF CONCEPT for one-click upgrade functionality.
 * Currently only handles restart (no npm upgrade step).
 *
 * Flow:
 * 1. Spawn NEW process with UPGRADE_RETRY_BIND=true
 * 2. New process starts retry loop for port binding
 * 3. Old process exits, releasing the port
 * 4. New process's next retry succeeds
 *
 * Status: ✅ POC VALIDATED - Works perfectly for restart
 * Next: Expand to full upgrade by adding npm install step
 * See: docs/FEATURE_UPDATE_VERSION.md Section 8.3
 */

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { broadcast } from '../lib/ws.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Handle restart request from frontend (POC)
 *
 * POC Handler - This will become handleUpgrade() in full implementation
 * TODO: Add npm install step before calling restartWithInvertedSpawn()
 */
export async function handleRestart(_ws, _message, _context) {
  console.log('Restart request received');

  // Broadcast to all clients
  broadcast({
    type: 'restart_started',
    message: 'Server restarting... Please wait.',
  });

  try {
    // Wait for message to be sent
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Perform restart
    await restartWithInvertedSpawn();
  } catch (error) {
    console.error('Restart failed:', error);
    broadcast({
      type: 'restart_error',
      message: `Restart failed: ${error.message}`,
    });
  }
}

/**
 * Restart server using inverted spawn strategy
 *
 * Core logic validated in POC. This function will be reused for full upgrade.
 * When implementing upgrade, call this AFTER npm install completes.
 */
async function restartWithInvertedSpawn() {
  // Preserve original command arguments
  // process.argv = ['node', '-r', 'dotenv/config', 'server/index.js'] (npm start)
  // process.argv = ['node', 'server/index.js'] (direct)
  // process.argv = ['/path/to/node', '/path/to/claude-web'] (npx/global)

  const nodeExecutable = process.argv[0]; // 'node' or path to node
  const args = process.argv.slice(1); // All args after node executable

  console.log(`Current process: ${process.pid}`);
  console.log(`Spawning: ${nodeExecutable} ${args.join(' ')}`);
  console.log(
    `Current UPGRADE_RETRY_INTERVAL: ${process.env.UPGRADE_RETRY_INTERVAL || '(not set)'}`,
  );

  // 1. Spawn NEW process with same args + retry flag
  const child = spawn(nodeExecutable, args, {
    detached: true,
    stdio: 'ignore', // Don't inherit FDs (important: prevents port holding)
    env: {
      ...process.env,
      UPGRADE_RETRY_BIND: 'true',
      UPGRADE_MAX_RETRIES: process.env.UPGRADE_MAX_RETRIES || '20',
      UPGRADE_RETRY_INTERVAL: process.env.UPGRADE_RETRY_INTERVAL || '1000',
    },
  });

  console.log(
    `Spawned with UPGRADE_RETRY_INTERVAL: ${process.env.UPGRADE_RETRY_INTERVAL || '1000'}`,
  );

  child.unref();

  console.log(`Spawned new process: PID ${child.pid}`);

  // 2. Wait for child to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Verify child is running
  try {
    process.kill(child.pid, 0); // Signal 0 = check if process exists
    console.log(`✅ Child process ${child.pid} is running`);
  } catch (err) {
    throw new Error(`Child process failed to start: ${err.message}`);
  }

  // 4. Exit this process - child will retry and bind to port
  console.log('Exiting old process, new process will take over...');
  process.exit(0);
}
