/**
 * WebSocket Connection Handler
 *
 * Routes incoming messages to appropriate event handlers.
 * Each connection maintains its own context (currentProjectPath, currentSessionId).
 */

import { handlers } from './events/index.js';
import { logger } from './lib/logger.js';
import { getCurrentVersion, getLatestVersion } from './lib/version-checker.js';
import { clients, send, unwatchAllSessions } from './lib/ws.js';

/**
 * Check if there's a newer version available
 */
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
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
 * Handle new WebSocket connection
 * @param {WebSocket} ws
 */
export function handleWebSocket(ws) {
  clients.add(ws);
  logger.log(`Client connected (${clients.size})`);

  // Per-connection context
  const context = {
    currentProjectPath: null,
    currentSessionId: null,
  };

  // Send connection info with version
  send(ws, {
    type: 'connected',
    version: getCurrentVersion(),
  });

  // Send update notification if available
  const currentVersion = getCurrentVersion();
  const latestVersion = getLatestVersion();
  if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
    send(ws, {
      type: 'update_available',
      currentVersion,
      latestVersion,
      updateUrl: 'https://www.npmjs.com/package/cc-web',
    });
  }

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const handler = handlers[message.type];

      if (handler) {
        await handler(ws, message, context);
      } else {
        logger.log('Unknown message type:', message.type);
      }
    } catch (err) {
      logger.error('Message handling error:', err);
      send(ws, { type: 'error', message: err.message });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    logger.log(`Client disconnected (${clients.size})`);
    unwatchAllSessions(ws);
  });

  ws.on('error', (err) => {
    logger.error('WebSocket error:', err);
    clients.delete(ws);
    unwatchAllSessions(ws);
  });
}
