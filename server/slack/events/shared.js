/**
 * Shared Dispatch Logic
 *
 * Used by all event handlers (message, mention, dm) to dispatch
 * classified actions to the appropriate handlers.
 */

import { logger } from '../../lib/logger.js';
import { resolveActiveProvider } from '../../lib/task-providers/index.js';
import { bold, link } from '../lib/formatter.js';
import { findTicket, storeTicket } from '../lib/notion-tickets.js';

/**
 * Dispatch a classified action
 * @param {Object} params
 * @param {import('../lib/classifier.js').Classification} params.classification
 * @param {Object} params.event - Slack event
 * @param {import('../lib/api.js').SlackAPI} params.slackApi
 */
export async function dispatchAction({
  classification,
  event,
  channelConfig,
  slackApi,
}) {
  const { channel, ts, thread_ts: threadTs } = event;
  const isDm = channelConfig?.name === 'DM';
  // sessionKey: stable identifier for ticket dedup. DMs use channel ID; threads use thread_ts or ts.
  const sessionKey = isDm ? channel : threadTs || ts;
  // replyTs: valid Slack message timestamp for threading replies. Always a real ts.
  const replyTs = threadTs || ts;

  logger.log(
    `[Slack] [dispatch] action=${classification.action} sessionKey=${sessionKey} replyTs=${replyTs} isDm=${isDm}`,
  );

  switch (classification.action) {
    case 'ignore':
      // Silent — do nothing
      break;

    case 'acknowledge':
    case 'answer': {
      const response = classification.response || 'noted';
      logger.log(
        `[Slack] [dispatch] posting ${classification.action}: "${response.substring(0, 80)}"`,
      );
      try {
        await slackApi.postThreadReply(channel, replyTs, response);
      } catch (err) {
        logger.error(
          `[Slack] Failed to post ${classification.action} reply:`,
          err.message,
        );
      }
      break;
    }

    case 'ticket': {
      // Check if this thread already has a ticket — update instead of create
      const existing = findTicket(channel, sessionKey);
      logger.log(
        `[Slack] [dispatch] ticket — existing=${existing ? existing.pageId : 'none'}`,
      );
      if (existing) {
        await handleTicketUpdate({
          classification,
          channel,
          replyTs,
          existing,
          slackApi,
        });
      } else {
        await handleTicketAction({
          classification,
          channel,
          ts,
          sessionKey,
          replyTs,
          slackApi,
        });
      }
      break;
    }

    default:
      logger.warn(`[Slack] Unknown action: ${classification.action}`);
  }
}

/**
 * Handle ticket creation action.
 * Title is always prefixed with [BOT]. Fetches the Slack thread permalink
 * and includes it in the ticket body. Stores the page ID for future updates.
 */
async function handleTicketAction({
  classification,
  channel,
  ts,
  sessionKey,
  replyTs,
  slackApi,
}) {
  const rawTitle = classification.ticketTitle || 'Untitled';
  const title = `[BOT] ${rawTitle}`;

  // Fetch Slack thread permalink to include in ticket body
  const permalink = await slackApi.getPermalink(channel, ts);

  // Build ticket body: classifier body + Slack thread link
  const classifierBody = classification.ticketBody || '';
  const slackSection = permalink ? `Slack thread: ${permalink}` : '';
  const body = [classifierBody, slackSection].filter(Boolean).join('\n\n');

  // Try active task provider (Notion, etc.)
  const active = resolveActiveProvider();
  if (active) {
    try {
      const result = await active.provider.createTicket({
        title,
        body,
        databaseUrl: active.config.ticketDatabaseUrl,
        fieldMappings: active.config.fieldMappings || [],
      });

      if (result.success) {
        // Store thread → ticket mapping for future reply updates
        if (result.pageId) {
          storeTicket(channel, sessionKey, result.pageId, result.url ?? '');
        }

        const ticketRef = result.url ? link(result.url, title) : bold(title);
        await slackApi.postThreadReply(
          channel,
          replyTs,
          `got it, created ${ticketRef}, will get back`,
        );
        return;
      }

      logger.warn('[Slack] Task provider ticket failed:', result.reason);
    } catch (err) {
      logger.error('[Slack] Task provider ticket error:', err.message);
    }
  }

  // Fallback: no provider or provider error
  await slackApi
    .postThreadReply(
      channel,
      replyTs,
      `got it, logged ${bold(title)}, will get back`,
    )
    .catch((err) => {
      logger.error('[Slack] Failed to post ticket fallback:', err.message);
    });
}

/**
 * Handle a follow-up reply to a thread that already has a ticket.
 * Appends the new message summary to the existing Notion ticket.
 */
async function handleTicketUpdate({
  classification,
  channel,
  replyTs,
  existing,
  slackApi,
}) {
  const updateText = classification.ticketBody || classification.response || '';
  const active = resolveActiveProvider();
  if (!active) return;

  // If no update text, still acknowledge the follow-up in Slack
  if (!updateText) {
    const urlText = existing.url ? ` ${link(existing.url, 'ticket')}` : '';
    await slackApi
      .postThreadReply(channel, replyTs, `noted, on the${urlText || ' ticket'}`)
      .catch((err) =>
        logger.error('[Slack] Failed to post ticket ack:', err.message),
      );
    return;
  }

  try {
    const result = await active.provider.updateTicket({
      pageId: existing.pageId,
      appendText: `Thread update:\n\n${updateText}`,
    });

    if (result.success) {
      const urlText = existing.url ? ` ${link(existing.url, 'ticket')}` : '';
      await slackApi.postThreadReply(
        channel,
        replyTs,
        `noted, updated the${urlText || ' ticket'}`,
      );
    } else {
      logger.warn('[Slack] Ticket update failed:', result.reason);
    }
  } catch (err) {
    logger.error('[Slack] Ticket update error:', err.message);
  }
}
