/**
 * Slack Channel Message Handler
 *
 * Handles messages in watched channels. Applies respond mode filtering,
 * self-reply prevention, thread locking, and dispatches to classifier.
 */

import { logger } from '../../lib/logger.js';
import { classifyMessage } from '../lib/classifier.js';
import { isBotMentioned } from '../lib/mentions.js';
import { dispatchAction } from './shared.js';

/** Thread lock map — prevents concurrent processing of the same thread */
const threadLocks = new Map();

/**
 * Handle a channel message event
 * @param {Object} params
 * @param {Object} params.event - Slack message event
 * @param {import('../lib/api.js').SlackAPI} params.slackApi - Slack API client
 * @param {Object} params.config - Slack bot config
 */
export async function handleMessage({ event, slackApi, config }) {
  const { user, channel, ts, thread_ts: threadTs, text } = event;

  // Skip own messages (self-reply prevention)
  if (user === config.selfUserId) return;

  // Skip messages without text
  if (!text?.trim()) return;

  // Check if channel is watched
  const channelConfig = config.watchedChannels.find((c) => c.id === channel);
  if (!channelConfig) return;

  // Apply respond mode
  if (channelConfig.respondMode === 'muted') return;
  if (channelConfig.respondMode === 'mention-only') {
    // Only respond if the bot is mentioned directly or via a group tag
    const mentioned = await isBotMentioned(text, config.selfUserId, slackApi);
    if (!mentioned) return;
  }

  // Thread lock — prevent concurrent processing
  const lockKey = threadTs || ts;
  if (threadLocks.has(lockKey)) return;
  threadLocks.set(lockKey, true);

  try {
    // Fetch thread history if this is a threaded message
    let threadHistory = null;
    if (threadTs) {
      try {
        const result = await slackApi.getThreadHistory(channel, threadTs, 15);
        threadHistory = result.messages;
      } catch (err) {
        logger.warn('[Slack] Failed to fetch thread history:', err.message);
      }
    }

    // Fetch sender info
    let senderName = user;
    try {
      const userInfo = await slackApi.getUserInfo(user);
      senderName = userInfo.user?.real_name || userInfo.user?.name || user;
    } catch {
      // Use user ID as fallback
    }

    // Classify the message
    const classification = await classifyMessage({
      message: event,
      threadHistory,
      channelInfo: { id: channel, name: channelConfig.name },
      senderName,
      config,
    });

    logger.debug(
      `[Slack] #${channelConfig.name} | ${senderName}: "${text.substring(0, 80)}" → ${classification.action} (${classification.reasoning || ''})`,
    );

    // Dispatch the classified action
    await dispatchAction({
      classification,
      event,
      channelConfig,
      slackApi,
      config,
    });
  } catch (err) {
    logger.error('[Slack] Message handler error:', err);
  } finally {
    threadLocks.delete(lockKey);
  }
}
