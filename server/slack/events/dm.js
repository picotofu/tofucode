/**
 * Slack DM Handler
 *
 * Handles direct messages to the user.
 * Only processes if config.respondDm is enabled.
 *
 * Thread anchoring: all replies for a given DM channel are threaded under
 * the first message ever received, so the entire conversation stays in one
 * Slack thread rather than spawning a new thread per message.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../lib/logger.js';
import { classifyMessage } from '../lib/classifier.js';
import { debounceMessage } from '../lib/debounce.js';
import { dispatchAction } from './shared.js';

/** Thread lock map — prevents concurrent processing of the same DM session */
const threadLocks = new Map();

// ── DM Thread Anchor Store ────────────────────────────────────────────────────
// Persists the first message ts per DM channel so all replies thread under it.

const DM_THREADS_PATH = join(homedir(), '.tofucode', 'slack-dm-threads.json');

/** @type {Record<string, string>} in-memory cache: { [channelId]: firstTs } */
let dmThreadCache = null;

function loadDmThreads() {
  if (dmThreadCache) return dmThreadCache;
  if (!existsSync(DM_THREADS_PATH)) {
    dmThreadCache = {};
    return dmThreadCache;
  }
  try {
    dmThreadCache = JSON.parse(readFileSync(DM_THREADS_PATH, 'utf-8'));
  } catch {
    dmThreadCache = {};
  }
  return dmThreadCache;
}

function saveDmThreads(store) {
  try {
    writeFileSync(DM_THREADS_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    logger.error('[Slack] Failed to save DM thread anchors:', err.message);
  }
}

/**
 * Get or register the thread anchor ts for a DM channel.
 * On first call for a channel, stores the given ts as the anchor.
 * Subsequent calls always return the original ts.
 * @param {string} channel
 * @param {string} ts - Current message ts (used as anchor if none exists)
 * @returns {string} The anchor ts to use for all replies in this DM channel
 */
function getDmThreadAnchor(channel, ts) {
  const store = loadDmThreads();
  if (!store[channel]) {
    store[channel] = ts;
    saveDmThreads(store);
    logger.log(
      `[Slack] [dm] Thread anchor registered: channel=${channel} ts=${ts}`,
    );
  }
  return store[channel];
}

/**
 * Process a (possibly debounce-combined) DM through triage and dispatch.
 * @param {Object} params
 * @param {Object} params.event - Slack DM event (text may be combined)
 * @param {import('../lib/api.js').SlackAPI} params.slackApi
 * @param {Object} params.config
 */
async function processDM({ event, slackApi, config }) {
  const { channel, ts } = event;
  const { text } = event;

  // Session lock — prevent concurrent processing of the same DM conversation.
  const lockKey = channel;
  if (threadLocks.has(lockKey)) {
    logger.log('[Slack] [triage] DM | skipped — session locked');
    return;
  }
  threadLocks.set(lockKey, true);

  // Resolve thread anchor — all replies go under the first-ever message in this DM.
  // This keeps the entire conversation in one Slack thread instead of spawning a new
  // thread per message.
  const threadAnchorTs = getDmThreadAnchor(channel, ts);

  try {
    logger.log(
      `[Slack] [triage] DM | accepted for triage | ts=${ts} anchor=${threadAnchorTs}`,
    );

    // Fetch sender info (uses cache)
    const senderName = await slackApi.getUserName(event.user);

    // Classify the DM — context is the debounce-accumulated message text only
    const classification = await classifyMessage({
      message: event,
      channelInfo: { id: channel, name: 'DM' },
      senderName,
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
      replyTs: threadAnchorTs,
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
  const { user, channel } = event;
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
  // DMs always use channel ID as lock key — aligns with processDM's session lock
  // and dispatchAction's sessionKey, both of which key on channel for DMs.
  debounceMessage({
    key: `${channel}:${channel}:${user}`,
    event,
    slackApi,
    config,
    handler: processDM,
  });
}
