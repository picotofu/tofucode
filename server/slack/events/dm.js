/**
 * Slack DM Handler
 *
 * Handles direct messages to the user.
 * Only processes if config.respondDm is enabled.
 */

import { logger } from '../../lib/logger.js';
import { classifyMessage } from '../lib/classifier.js';
import { debounceMessage } from '../lib/debounce.js';
import { dispatchAction } from './shared.js';

/** Thread lock map — prevents concurrent processing of the same DM session */
const threadLocks = new Map();

/**
 * Process a (possibly debounce-combined) DM through triage and dispatch.
 * @param {Object} params
 * @param {Object} params.event - Slack DM event (text may be combined)
 * @param {import('../lib/api.js').SlackAPI} params.slackApi
 * @param {Object} params.config
 */
async function processDM({ event, slackApi, config }) {
  const { channel, ts, thread_ts: threadTs } = event;
  const { text } = event;

  // Session lock — prevent concurrent processing of the same DM conversation.
  // Always use channel ID — aligns with dispatchAction's sessionKey for DMs,
  // which is always channel regardless of threadTs.
  const lockKey = channel;
  if (threadLocks.has(lockKey)) {
    logger.log('[Slack] [triage] DM | skipped — session locked');
    return;
  }
  threadLocks.set(lockKey, true);

  try {
    logger.log(`[Slack] [triage] DM | accepted for triage | ts=${ts}`);

    // Always fetch conversation context:
    // - Threaded replies: fetch all replies under the parent (includes parent as first message)
    // - Top-level DMs: fetch recent DM history for prior conversation context
    let threadHistory = null;
    try {
      if (threadTs) {
        const result = await slackApi.getThreadHistory(channel, threadTs, 30);
        threadHistory = result.messages;
      } else {
        const result = await slackApi.getChannelHistory(channel, 30);
        // Channel/DM history is newest-first — reverse for chronological order
        threadHistory = (result.messages || []).reverse();
      }
      logger.log(
        `[Slack] [triage] DM | context fetched: ${threadHistory?.length ?? 0} messages (${threadTs ? 'thread' : 'dm history'})`,
      );
    } catch (err) {
      logger.warn('[Slack] Failed to fetch DM context:', err.message);
    }

    // Fetch sender info (uses cache)
    const senderName = await slackApi.getUserName(event.user);

    // Classify the DM
    const classification = await classifyMessage({
      message: event,
      threadHistory,
      channelInfo: { id: channel, name: 'DM' },
      senderName,
      resolveName: (id) => slackApi.getUserName(id),
      config,
      slackApi,
      event,
    });

    logger.log(
      `[Slack] [triage] DM | ${senderName}: "${text.substring(0, 80)}" → action=${classification.action} confidence=${classification.confidence ?? '?'} | ${classification.reasoning || ''}`,
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

/**
 * Handle a DM event
 * @param {Object} params
 * @param {Object} params.event - Slack message event (channel_type: 'im')
 * @param {import('../lib/api.js').SlackAPI} params.slackApi - Slack API client
 * @param {Object} params.config - Slack bot config
 */
export async function handleDM({ event, slackApi, config }) {
  const { user, channel, thread_ts: threadTs } = event;
  let { text } = event;

  // Skip if DM responses are disabled
  if (!config.respondDm) return;

  // Self-message guard — skip unless it's a debug test message ("test <message>")
  if (user === config.selfUserId) {
    if (text?.toLowerCase().startsWith('test ')) {
      text = text.slice(5); // Strip "test " prefix and process as if sent by someone else
      event = { ...event, text };
      logger.log(
        `[Slack] [debug] Self test message detected — processing as: "${text.substring(0, 80)}"`,
      );
    } else {
      return;
    }
  }

  // Skip messages without text
  if (!text?.trim()) return;

  // Debounce — accumulate rapid successive messages before processing.
  // DMs use channel ID as the lock key (1 session per DM conversation).
  // User is included in the key for explicitness, though DMs are already 1-to-1.
  const lockKey = threadTs || channel;
  debounceMessage({
    key: `${channel}:${lockKey}:${user}`,
    event,
    slackApi,
    config,
    handler: processDM,
  });
}
