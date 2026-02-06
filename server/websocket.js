/**
 * WebSocket Connection Handler
 *
 * Routes incoming messages to appropriate event handlers.
 * Each connection maintains its own context (currentProjectPath, currentSessionId).
 */

import { handlers } from './events/index.js';
import { logger } from './lib/logger.js';
import {
  getCurrentVersion,
  getLatestVersion,
  isNewerVersion,
} from './lib/version-checker.js';
import { clients, send, unwatchAllSessions } from './lib/ws.js';

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
