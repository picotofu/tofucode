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

import { broadcast } from '../lib/ws.js';
import { restartWithInvertedSpawn } from '../lib/restart.js';

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
    await restartWithInvertedSpawn('restart');
    process.exit(0);
  } catch (error) {
    console.error('Restart failed:', error);
    broadcast({
      type: 'restart_error',
      message: `Restart failed: ${error.message}`,
    });
  }
}
