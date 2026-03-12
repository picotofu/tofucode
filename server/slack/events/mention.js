/**
 * Slack @Mention Handler
 *
 * Handles app_mention events — when someone @mentions the user.
 * Always processes regardless of channel respond mode.
 */

import { logger } from '../../lib/logger.js';
import { classifyMessage } from '../lib/classifier.js';
import { dispatchAction } from './shared.js';

/** Thread lock map */
const threadLocks = new Map();

/**
 * Handle an app_mention event
 * @param {Object} params
 * @param {Object} params.event - Slack app_mention event
 * @param {import('../lib/api.js').SlackAPI} params.slackApi - Slack API client
 * @param {Object} params.config - Slack bot config
 */
export async function handleMention({ event, slackApi, config }) {
  const { user, channel, ts, thread_ts: threadTs, text } = event;

  // Skip own messages
  if (user === config.selfUserId) return;

  // Skip messages without text
  if (!text?.trim()) return;

  // Thread lock
  const lockKey = threadTs || ts;
  if (threadLocks.has(lockKey)) return;
  threadLocks.set(lockKey, true);

  try {
    // Find channel config (may not be in watched list — mentions bypass filtering)
    const channelConfig = config.watchedChannels.find(
      (c) => c.id === channel,
    ) || { id: channel, name: channel, respondMode: 'auto' };

    // Fetch thread history if threaded
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

    // Classify — mentions are always processed, never ignored by channel filter
    const classification = await classifyMessage({
      message: event,
      threadHistory,
      channelInfo: { id: channel, name: channelConfig.name },
      senderName,
      config,
    });

    logger.debug(
      `[Slack] @mention in #${channelConfig.name} | ${senderName}: "${text.substring(0, 80)}" → ${classification.action}`,
    );

    // Force at least an acknowledge if classifier says ignore (mentions always deserve a response)
    const effectiveClassification =
      classification.action === 'ignore'
        ? {
            ...classification,
            action: 'acknowledge',
            response: 'Noted, thanks for the ping.',
          }
        : classification;

    await dispatchAction({
      classification: effectiveClassification,
      event,
      channelConfig,
      slackApi,
      config,
    });
  } catch (err) {
    logger.error('[Slack] Mention handler error:', err);
  } finally {
    threadLocks.delete(lockKey);
  }
}
