/**
 * Slack Message Debouncer
 *
 * Groups rapid successive messages from the same user in the same thread
 * into a single combined message before classification. This prevents
 * multiple classifier calls when someone sends several messages in quick
 * succession (e.g. "fix this" + "in user-service" as separate sends).
 *
 * Key: `${channel}:${lockKey}:${user}` — scoped per thread per user.
 *   - Channels: lockKey = threadTs (thread reply) or ts (parent message)
 *   - DMs: lockKey = channel (all top-level DMs from same conversation group together)
 *
 * Window: configurable via config.debounceMs (default 10s), reset on each new message.
 * On flush: invokes the registered handler with a synthetic event whose
 *           text is all accumulated texts joined with "\n\n", and whose
 *           other fields (ts, thread_ts, user, channel) come from the
 *           first message received in the window.
 */

import { logger } from '../../lib/logger.js';

const DEFAULT_DEBOUNCE_MS = 10000;

/**
 * @typedef {Object} PendingBatch
 * @property {Object} firstEvent - First Slack event in this window (metadata anchor)
 * @property {string[]} texts - Accumulated message texts in order
 * @property {import('./api.js').SlackAPI} slackApi
 * @property {Object} config
 * @property {ReturnType<typeof setTimeout>} timer - Active debounce timer
 * @property {(params: { event: Object, slackApi: import('./api.js').SlackAPI, config: Object }) => Promise<void>} handler
 */

/** @type {Map<string, PendingBatch>} */
const pending = new Map();

/**
 * Debounce a Slack message event.
 *
 * Starts or extends a debounce window keyed by `key`. When the window
 * expires without further messages, flushes by calling `handler` with
 * a combined synthetic event.
 *
 * @param {Object} params
 * @param {string} params.key - Debounce key (`${channel}:${lockKey}:${user}`)
 * @param {Object} params.event - Incoming Slack event
 * @param {import('./api.js').SlackAPI} params.slackApi
 * @param {Object} params.config
 * @param {(params: { event: Object, slackApi: import('./api.js').SlackAPI, config: Object }) => Promise<void>} params.handler
 */
export function debounceMessage({ key, event, slackApi, config, handler }) {
  const text = event.text || '';
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  if (pending.has(key)) {
    const batch = pending.get(key);
    batch.texts.push(text);
    clearTimeout(batch.timer);
    logger.log(
      `[Slack] [debounce] key=${key} — appended (${batch.texts.length} total), window reset to ${debounceMs}ms`,
    );
    batch.timer = setTimeout(() => flush(key), debounceMs);
  } else {
    logger.log(
      `[Slack] [debounce] key=${key} — window started (${debounceMs}ms)`,
    );
    pending.set(key, {
      firstEvent: event,
      texts: [text],
      slackApi,
      config,
      handler,
      timer: setTimeout(() => flush(key), debounceMs),
    });
  }
}

/**
 * Flush a pending batch — combine all texts and invoke the handler.
 * @param {string} key
 */
async function flush(key) {
  const batch = pending.get(key);
  if (!batch) return;
  pending.delete(key);

  const { firstEvent, texts, slackApi, config, handler } = batch;
  const combinedText = texts.join('\n\n');

  if (texts.length > 1) {
    logger.log(
      `[Slack] [debounce] key=${key} — flushing ${texts.length} messages combined`,
    );
  } else {
    logger.log(`[Slack] [debounce] key=${key} — flushing single message`);
  }

  const syntheticEvent = { ...firstEvent, text: combinedText };

  try {
    await handler({ event: syntheticEvent, slackApi, config });
  } catch (err) {
    logger.error(`[Slack] [debounce] flush error key=${key}:`, err.message);
  }
}
