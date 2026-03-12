/**
 * Slack Bot Client Lifecycle
 *
 * Initializes Socket Mode client, registers event handlers, and manages startup/shutdown.
 * Called from server/index.js when Slack config is enabled.
 *
 * Uses @slack/socket-mode for real-time event listening.
 * Uses direct Slack API (fetch) for posting messages — NOT Slack MCP.
 */

import { SocketModeClient } from '@slack/socket-mode';
import { logger } from '../lib/logger.js';
import { broadcast } from '../lib/ws.js';
import { loadSlackConfig, saveSlackConfig } from './config.js';
import { handleDM } from './events/dm.js';
import { handleMention } from './events/mention.js';
import { handleMessage } from './events/message.js';
import { createSlackAPI } from './lib/api.js';

let socketClient = null;
let slackApi = null;
let slackConfig = null;

/** @type {boolean} */
let botConnected = false;

/**
 * Update bot connection status and broadcast to all WS clients.
 * @param {boolean} connected
 */
function setBotConnected(connected) {
  botConnected = connected;
  broadcast({ type: 'slack:status', connected });
}

/**
 * Get current Slack bot socket connection status.
 * @returns {boolean}
 */
export function getSlackBotConnected() {
  return botConnected;
}

/**
 * Start the Slack bot.
 * Called from server/index.js during server startup.
 *
 * @returns {Promise<SocketModeClient|null>} The Socket Mode client or null on error/skip
 */
export async function startSlackBot() {
  slackConfig = loadSlackConfig();

  if (!slackConfig.enabled) {
    logger.debug('[Slack] Bot disabled in config, skipping startup');
    return null;
  }

  if (!slackConfig.appToken) {
    logger.warn(
      '[Slack] No App Token (xapp-) configured — Socket Mode requires an App-Level Token',
    );
    return null;
  }

  if (!slackConfig.botToken) {
    logger.warn(
      '[Slack] No Bot Token (xoxp-) configured — cannot post messages',
    );
    return null;
  }

  // Create Slack API client for posting messages
  slackApi = createSlackAPI(slackConfig.botToken);

  // Resolve and cache self user ID (for self-reply prevention)
  if (!slackConfig.selfUserId) {
    try {
      const authResult = await slackApi.authTest();
      slackConfig.selfUserId = authResult.user_id;
      saveSlackConfig(slackConfig);
      logger.log(
        `[Slack] Authenticated as ${authResult.user} (${authResult.user_id})`,
      );
    } catch (err) {
      logger.error('[Slack] Failed to authenticate:', err.message);
      return null;
    }
  }

  // Create Socket Mode client
  socketClient = new SocketModeClient({
    appToken: slackConfig.appToken,
    logLevel: 'error', // Suppress noisy Socket Mode logs
  });

  // Deduplication set for Socket Mode reconnection edge cases
  const recentEventIds = new Set();
  const MAX_RECENT_EVENTS = 500;

  /**
   * Check and track event for deduplication
   * @param {string} eventId
   * @returns {boolean} true if duplicate
   */
  function isDuplicate(eventId) {
    if (!eventId) return false;
    if (recentEventIds.has(eventId)) return true;
    recentEventIds.add(eventId);
    if (recentEventIds.size > MAX_RECENT_EVENTS) {
      // Clear oldest half
      const entries = [...recentEventIds];
      for (let i = 0; i < MAX_RECENT_EVENTS / 2; i++) {
        recentEventIds.delete(entries[i]);
      }
    }
    return false;
  }

  // Log all raw socket lifecycle events for debugging
  socketClient.on('connecting', () =>
    logger.log('[Slack] Socket: connecting...'),
  );
  socketClient.on('connected', () => logger.log('[Slack] Socket: connected'));
  socketClient.on('ready', () => logger.log('[Slack] Socket: ready'));
  socketClient.on('disconnecting', () =>
    logger.log('[Slack] Socket: disconnecting'),
  );
  socketClient.on('reconnecting', () =>
    logger.log('[Slack] Socket: reconnecting'),
  );
  socketClient.on('unable_to_socket_mode_start', (err) =>
    logger.error('[Slack] Socket: unable to start', err?.message),
  );
  // Register event listeners
  // Note: @slack/socket-mode v2 re-emits events_api payloads directly as their event type
  // (e.g. 'message', 'app_mention') rather than under a single 'events_api' listener

  const handleEvent = async ({ event, body, ack, retry_num }) => {
    // Always acknowledge immediately (Socket Mode requires ack within 3s)
    await ack();

    const eventType = event?.type;
    const channelType = event?.channel_type;
    const channel = event?.channel;

    // Only log events from watched channels (or DMs)
    const isWatched =
      channelType === 'im' ||
      slackConfig.watchedChannels.some((c) => c.id === channel);

    if (isWatched && !retry_num) {
      const channelLabel =
        channelType === 'im'
          ? 'DM'
          : (slackConfig.watchedChannels.find((c) => c.id === channel)?.name ??
            channel);
      const isMention = (event?.text || '').includes(
        `<@${slackConfig.selfUserId}>`,
      );
      const mentionTag = isMention ? ' [@mentioned]' : '';
      const isSelf = event?.user === slackConfig.selfUserId;
      const selfTag = isSelf ? ' [self]' : '';
      logger.log(
        `[Slack] #${channelLabel} | user=${event?.user}${selfTag}${mentionTag} | "${(event?.text || '').substring(0, 100)}"`,
      );
    }

    // Skip retries (already processed)
    if (retry_num) return;

    // Deduplication
    const eventId = body?.event_id || event?.client_msg_id;
    if (isDuplicate(eventId)) return;

    try {
      if (eventType === 'app_mention') {
        await handleMention({ event, slackApi, config: slackConfig });
      } else if (eventType === 'message') {
        // Skip message subtypes that aren't actual new messages
        if (event.subtype && event.subtype !== 'thread_broadcast') return;

        if (channelType === 'im') {
          await handleDM({ event, slackApi, config: slackConfig });
        } else {
          await handleMessage({ event, slackApi, config: slackConfig });
        }
      }
    } catch (err) {
      logger.error(`[Slack] Error handling ${eventType} event:`, err);
    }
  };

  socketClient.on('message', handleEvent);
  socketClient.on('app_mention', handleEvent);

  // Error handling
  socketClient.on('error', (err) => {
    logger.error('[Slack] Socket Mode error:', err.message);
    setBotConnected(false);
  });

  // Track disconnect (Socket Mode emits 'disconnecting' / 'disconnected')
  socketClient.on('disconnecting', () => {
    setBotConnected(false);
  });

  try {
    await socketClient.start();
    setBotConnected(true);
    logger.log(
      `[Slack] Socket Mode connected — watching ${slackConfig.watchedChannels.length} channel(s)`,
    );
    logger.log(
      `[Slack] Watched channels: ${JSON.stringify(slackConfig.watchedChannels.map((c) => ({ id: c.id, name: c.name, mode: c.respondMode })))}`,
    );
    return socketClient;
  } catch (err) {
    logger.error('[Slack] Failed to start Socket Mode:', err.message);
    setBotConnected(false);
    socketClient = null;
    return null;
  }
}

/**
 * Gracefully stop the Slack bot.
 * Called during server shutdown.
 */
export async function stopSlackBot() {
  if (socketClient) {
    logger.log('[Slack] Stopping bot...');
    await socketClient.disconnect();
    socketClient = null;
    slackApi = null;
    slackConfig = null;
    setBotConnected(false);
  }
}

/**
 * Restart the Slack bot (stop + start).
 * Called when config is updated via Settings UI.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function restartSlackBot() {
  try {
    await stopSlackBot();
    const client = await startSlackBot();
    return { success: !!client };
  } catch (err) {
    logger.error('[Slack] Restart error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get the Slack API client (for external use)
 * @returns {import('./lib/api.js').SlackAPI|null}
 */
export function getSlackAPI() {
  return slackApi;
}

/**
 * Get the current Slack config (for external use)
 * @returns {Object|null}
 */
export function getSlackConfig() {
  return slackConfig;
}
