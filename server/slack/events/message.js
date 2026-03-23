/**
 * Slack Channel Message Handler
 *
 * Handles messages in watched channels. Applies respond mode filtering,
 * self-reply prevention, thread locking, and dispatches to classifier.
 */

import { logger } from '../../lib/logger.js';
import { classifyMessage } from '../lib/classifier.js';
import { debounceMessage } from '../lib/debounce.js';
import { isBotMentioned } from '../lib/mentions.js';
import { dispatchAction } from './shared.js';

/** Thread lock map — prevents concurrent processing of the same thread */
const threadLocks = new Map();

/**
 * Process a (possibly debounce-combined) channel message through triage and dispatch.
 * @param {Object} params
 * @param {Object} params.event - Slack message event (text may be combined)
 * @param {import('../lib/api.js').SlackAPI} params.slackApi
 * @param {Object} params.config
 * @param {Object} params.channelConfig
 */
async function processMessage({ event, slackApi, config, channelConfig }) {
  const { channel, ts, thread_ts: threadTs } = event;
  const { text } = event;

  // Thread lock — prevent concurrent processing of the same thread
  const lockKey = threadTs || ts;
  if (threadLocks.has(lockKey)) {
    logger.log(
      `[Slack] [triage] #${channelConfig.name} | skipped — thread locked`,
    );
    return;
  }
  threadLocks.set(lockKey, true);

  try {
    logger.log(
      `[Slack] [triage] #${channelConfig.name} | accepted for triage | thread=${threadTs || 'none'} ts=${ts}`,
    );

    // Fetch sender info (uses cache)
    const senderName = await slackApi.getUserName(event.user);

    // Classify the message — context is the debounce-accumulated message text only
    const classification = await classifyMessage({
      message: event,
      channelInfo: { id: channel, name: channelConfig.name },
      senderName,
      config,
      slackApi,
      event,
    });

    logger.log(
      `[Slack] [triage] #${channelConfig.name} | ${senderName}: "${text.substring(0, 80)}" → action=${classification.action} confidence=${classification.confidence ?? '?'} | ${classification.reasoning || ''}`,
    );

    // Dispatch the classified action
    await dispatchAction({
      classification,
      event,
      channelConfig,
      slackApi,
    });
  } catch (err) {
    logger.error('[Slack] Message handler error:', err);
  } finally {
    threadLocks.delete(lockKey);
  }
}

/**
 * Handle a channel message event
 * @param {Object} params
 * @param {Object} params.event - Slack message event
 * @param {import('../lib/api.js').SlackAPI} params.slackApi - Slack API client
 * @param {Object} params.config - Slack bot config
 */
export async function handleMessage({ event, slackApi, config }) {
  const { user, channel, ts, thread_ts: threadTs } = event;
  let { text } = event;

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

  // Check if channel is watched
  const channelConfig = config.watchedChannels.find((c) => c.id === channel);
  if (!channelConfig) return;

  // Apply respond mode
  if (channelConfig.respondMode === 'mention-only') {
    // Only respond if the bot is mentioned directly or via a group tag
    const mentioned = await isBotMentioned(text, config.selfUserId, slackApi);
    if (!mentioned) return;
  }

  // Debounce — accumulate rapid successive messages before processing.
  // Key includes user to prevent cross-user message merging in the same thread.
  const lockKey = threadTs || ts;
  debounceMessage({
    key: `${channel}:${lockKey}:${user}`,
    event,
    slackApi,
    config,
    handler: ({ event: e, slackApi: api, config: cfg }) =>
      processMessage({ event: e, slackApi: api, config: cfg, channelConfig }),
  });
}
