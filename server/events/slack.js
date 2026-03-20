/**
 * Slack Bot WebSocket Event Handlers
 *
 * Handles Settings UI interactions for the Slack bot:
 *   - slack:get_config  → returns masked config
 *   - slack:save_config → saves config to disk
 *   - slack:test        → tests connection with current tokens
 *   - slack:restart     → restarts the Slack bot
 */

import { logger } from '../lib/logger.js';
import { send } from '../lib/ws.js';
import {
  getMaskedConfig,
  loadSlackConfig,
  loadSlackConfigRaw,
  saveSlackConfig,
  updateLastViewedAt,
} from '../slack/config.js';

/**
 * Send masked config to a client, always including lastViewedAt at the top level
 * so the sidebar unread badge stays in sync regardless of which handler triggered it.
 * @param {WebSocket} ws
 * @param {Object} [config] - Pre-loaded masked config (optional, loads fresh if not provided)
 */
function sendConfig(ws, config) {
  const cfg = config ?? getMaskedConfig();
  send(ws, {
    type: 'slack:config',
    config: cfg,
    lastViewedAt: cfg.lastViewedAt ?? null,
  });
}

/**
 * Get Slack config (tokens masked for display) + current bot socket status
 */
export async function handleGetConfig(ws) {
  try {
    const { getSlackBotConnected } = await import('../slack/bot.js');
    sendConfig(ws);
    send(ws, { type: 'slack:status', connected: getSlackBotConnected() });
  } catch (err) {
    logger.error('[Slack WS] Error getting config:', err);
    send(ws, { type: 'slack:config', config: null, error: err.message });
  }
}

/**
 * Save Slack config from Settings UI
 * Tokens are only updated if non-empty and not masked
 */
export async function handleSaveConfig(ws, message) {
  try {
    const incoming = message.config || {};
    // Use raw config (no token resolution) to avoid persisting env/MCP-resolved tokens
    const existing = loadSlackConfigRaw();

    // Merge — only overwrite tokens if the user provided actual new values (not masked)
    const updated = {
      ...existing,
      enabled: incoming.enabled ?? existing.enabled,
      projectRootPath: incoming.projectRootPath ?? existing.projectRootPath,
      sessionLogPath: incoming.sessionLogPath ?? existing.sessionLogPath,
      hideSlackSessions:
        incoming.hideSlackSessions ?? existing.hideSlackSessions,
      respondDm: incoming.respondDm ?? existing.respondDm,
      debounceMs: incoming.debounceMs ?? existing.debounceMs,
      watchedChannels: incoming.watchedChannels ?? existing.watchedChannels,
      identity: {
        ...existing.identity,
        ...(incoming.identity || {}),
      },
      classifier: {
        ...existing.classifier,
        ...(incoming.classifier || {}),
      },
    };

    // Only update tokens if they look like real tokens (not masked)
    if (incoming.botToken && !incoming.botToken.startsWith('*')) {
      updated.botToken = incoming.botToken;
    }
    if (incoming.appToken && !incoming.appToken.startsWith('*')) {
      updated.appToken = incoming.appToken;
    }

    saveSlackConfig(updated);
    send(ws, { type: 'slack:save_result', success: true });
    sendConfig(ws);
  } catch (err) {
    logger.error('[Slack WS] Error saving config:', err);
    send(ws, { type: 'slack:save_result', success: false, error: err.message });
  }
}

/**
 * Test Slack connection with current tokens
 */
export async function handleTestConnection(ws) {
  try {
    const config = loadSlackConfig();

    if (!config.botToken) {
      send(ws, {
        type: 'slack:test_result',
        success: false,
        error: 'No Bot Token configured',
      });
      return;
    }

    const { createSlackAPI } = await import('../slack/lib/api.js');
    const api = createSlackAPI(config.botToken);
    const result = await api.authTest();

    send(ws, {
      type: 'slack:test_result',
      success: true,
      user: result.user,
      userId: result.user_id,
      team: result.team,
    });
  } catch (err) {
    logger.error('[Slack WS] Test connection error:', err);
    send(ws, {
      type: 'slack:test_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * List all Slack channels (public + private) accessible with the current bot token
 */
export async function handleListChannels(ws) {
  try {
    const config = loadSlackConfig();

    if (!config.botToken) {
      send(ws, {
        type: 'slack:channels',
        channels: [],
        error: 'No Bot Token configured',
      });
      return;
    }

    const { createSlackAPI } = await import('../slack/lib/api.js');
    const api = createSlackAPI(config.botToken);
    const channels = await api.listChannels();
    send(ws, { type: 'slack:channels', channels });
  } catch (err) {
    logger.error('[Slack WS] Error listing channels:', err);
    send(ws, { type: 'slack:channels', channels: [], error: err.message });
  }
}

/**
 * Mark the Slack sessions tab as viewed — updates lastViewedAt to now and
 * responds with updated slack:config so all connected clients sync the timestamp
 */
export async function handleMarkViewed(ws) {
  try {
    updateLastViewedAt();
    sendConfig(ws);
  } catch (err) {
    logger.error('[Slack WS] Error marking viewed:', err);
  }
}

/**
 * Restart the Slack bot
 */
export async function handleRestart(ws) {
  try {
    const { restartSlackBot } = await import('../slack/bot.js');
    const result = await restartSlackBot();

    send(ws, {
      type: 'slack:restart_result',
      success: result.success,
      error: result.error,
    });
  } catch (err) {
    logger.error('[Slack WS] Restart error:', err);
    send(ws, {
      type: 'slack:restart_result',
      success: false,
      error: err.message,
    });
  }
}
