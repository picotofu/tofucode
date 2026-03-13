/**
 * Slack DM Handler
 *
 * Handles direct messages to the user.
 * Always processes — DMs are always relevant.
 */

import { logger } from '../../lib/logger.js';
import { classifyMessage } from '../lib/classifier.js';
import { dispatchAction } from './shared.js';

/** Thread lock map */
const threadLocks = new Map();

/**
 * Handle a DM event
 * @param {Object} params
 * @param {Object} params.event - Slack message event (channel_type: 'im')
 * @param {import('../lib/api.js').SlackAPI} params.slackApi - Slack API client
 * @param {Object} params.config - Slack bot config
 */
export async function handleDM({ event, slackApi, config }) {
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
    // Fetch thread history if threaded
    let threadHistory = null;
    if (threadTs) {
      try {
        const result = await slackApi.getThreadHistory(channel, threadTs, 15);
        threadHistory = result.messages;
      } catch (err) {
        logger.warn('[Slack] Failed to fetch DM thread history:', err.message);
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

    // Classify the DM
    const classification = await classifyMessage({
      message: event,
      threadHistory,
      channelInfo: { id: channel, name: 'DM' },
      senderName,
      config,
    });

    logger.debug(
      `[Slack] DM | ${senderName}: "${text.substring(0, 80)}" → ${classification.action}`,
    );

    await dispatchAction({
      classification,
      event,
      channelConfig: { id: channel, name: 'DM', respondMode: 'auto' },
      slackApi,
      config,
    });
  } catch (err) {
    logger.error('[Slack] DM handler error:', err);
  } finally {
    threadLocks.delete(lockKey);
  }
}
