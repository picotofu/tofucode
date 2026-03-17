/**
 * Shared Dispatch Logic
 *
 * Used by all event handlers (message, mention, dm) to dispatch
 * classified actions to the appropriate handlers.
 */

import { join } from 'node:path';
import { pathToSlug } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { resolveActiveProvider } from '../../lib/task-providers/index.js';
import { getSessionMapping } from '../config.js';
import { bold, link } from '../lib/formatter.js';
import { findTicket, storeTicket } from '../lib/notion-tickets.js';
import { startWorkSession } from '../lib/sessions.js';

/** Regex to extract GitHub PR URLs from session text output */
const PR_URL_REGEX = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/g;

/**
 * Dispatch a classified action
 * @param {Object} params
 * @param {import('../lib/classifier.js').Classification} params.classification
 * @param {Object} params.event - Slack event
 * @param {import('../lib/api.js').SlackAPI} params.slackApi
 * @param {Object} params.config - Full Slack bot config
 */
export async function dispatchAction({
  classification,
  event,
  channelConfig,
  slackApi,
  config,
}) {
  const { channel, ts, thread_ts: threadTs } = event;
  // DMs use channel ID as the session key (1 session per user/DM).
  // Threads use thread_ts as the anchor. Top-level channel messages fall back to ts.
  const isDm = channelConfig?.name === 'DM';
  // sessionKey: stable identifier for session reuse. DMs use channel ID (1 session per DM).
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
      const response = classification.response || 'Got it.';
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

    case 'work': {
      logger.log(
        `[Slack] [dispatch] work — project=${classification.workProject ?? 'unknown'} confidence=${classification.confidence ?? '?'}`,
      );
      await handleWorkAction({
        classification,
        channel,
        ts,
        sessionKey,
        replyTs,
        slackApi,
        event,
        config,
      });
      break;
    }

    default:
      logger.warn(`[Slack] Unknown action: ${classification.action}`);
  }
}

/**
 * Resolve a project slug from a folder name and the configured root path.
 * Falls back to null if resolution fails.
 * @param {string} [folderName] - Folder name returned by classifier (workProject)
 * @param {string} [rootPath] - config.projectRootPath
 * @returns {string|null}
 */
function resolveProjectSlug(folderName, rootPath) {
  if (!folderName || !rootPath) return null;
  try {
    const fullPath = join(rootPath, folderName);
    return pathToSlug(fullPath);
  } catch {
    return null;
  }
}

/**
 * Extract GitHub PR URLs from session text output.
 * @param {string} [output]
 * @returns {string[]}
 */
function extractPrUrls(output) {
  if (!output) return [];
  return [...new Set(output.match(PR_URL_REGEX) ?? [])];
}

/**
 * Handle ticket creation action.
 * Fetches the Slack thread permalink, includes it in the ticket body,
 * and stores the returned page ID for future thread reply → ticket updates.
 */
async function handleTicketAction({
  classification,
  channel,
  ts,
  sessionKey,
  replyTs,
  slackApi,
}) {
  const title = classification.ticketTitle || 'Untitled ticket';

  // Fetch Slack thread permalink to include in ticket body
  const permalink = await slackApi.getPermalink(channel, ts);

  // Build ticket body: classifier body + Slack thread link
  const classifierBody =
    classification.ticketBody || classification.response || '';
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

        const urlText = result.url
          ? `\n${link(result.url, 'View in Notion')}`
          : '';
        const ticketReply = classification.response
          ? `${classification.response}${urlText}`
          : `:ticket: Ticket created: ${bold(title)}${urlText}`;
        await slackApi.postThreadReply(channel, replyTs, ticketReply);
        return;
      }

      logger.warn('[Slack] Task provider ticket failed:', result.reason);
    } catch (err) {
      logger.error('[Slack] Task provider ticket error:', err.message);
    }
  }

  // Fallback: post ticket details as text
  const fallbackReply = classification.response || `:ticket: ${bold(title)}`;
  const fallbackParts = [fallbackReply];
  if (!active) {
    fallbackParts.push(
      '_No task provider configured — ticket logged here for reference._',
    );
  }

  try {
    await slackApi.postThreadReply(channel, replyTs, fallbackParts.join('\n'));
  } catch (err) {
    logger.error('[Slack] Failed to post ticket fallback:', err.message);
  }
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
  if (!updateText) return;

  const active = resolveActiveProvider();
  if (!active) return;

  try {
    const result = await active.provider.updateTicket({
      pageId: existing.pageId,
      appendText: `Thread update:\n\n${updateText}`,
    });

    if (result.success) {
      const urlText = existing.url
        ? `: ${link(existing.url, 'View in Notion')}`
        : '';
      await slackApi.postThreadReply(
        channel,
        replyTs,
        `:memo: Ticket updated${urlText}`,
      );
    } else {
      logger.warn('[Slack] Ticket update failed:', result.reason);
    }
  } catch (err) {
    logger.error('[Slack] Ticket update error:', err.message);
  }
}

/**
 * Handle work trigger action.
 *
 * Confidence gate: if classifier is not confident (low confidence or no project
 * identified), fall back to creating a ticket with findings instead of starting
 * a work session.
 *
 * When confident:
 *   1. Create ticket (if provider available) and set it to In Progress
 *   2. Post status in thread
 *   3. Run work session
 *   4. Post completion summary
 *   5. If session output contains a PR URL, append it to the ticket
 */
async function handleWorkAction({
  classification,
  channel,
  ts,
  sessionKey,
  replyTs,
  slackApi,
  event,
  config,
}) {
  // ── Confidence gate ──────────────────────────────────────────────────────
  const isLowConfidence =
    classification.confidence === 'low' || !classification.workProject;

  if (isLowConfidence) {
    logger.info(
      `[Slack] Work action low confidence — falling back to ticket. project=${classification.workProject} confidence=${classification.confidence}`,
    );

    // Build body inline (avoids double getPermalink call)
    const title =
      classification.ticketTitle ||
      classification.workPrompt?.substring(0, 80) ||
      'Work request (needs clarification)';
    const permalink = await slackApi.getPermalink(channel, ts);
    const reasoning = classification.reasoning
      ? `Reasoning: ${classification.reasoning}`
      : '';
    const slackSection = permalink ? `Slack thread: ${permalink}` : '';
    const body = [
      'Work requested but could not determine the target project with confidence.',
      reasoning,
      slackSection,
    ]
      .filter(Boolean)
      .join('\n\n');

    // Create ticket directly (body already contains permalink — skip inner getPermalink)
    const active = resolveActiveProvider();
    if (active) {
      try {
        const result = await active.provider.createTicket({
          title,
          body,
          databaseUrl: active.config.ticketDatabaseUrl,
          fieldMappings: active.config.fieldMappings || [],
        });
        if (result.success && result.pageId) {
          storeTicket(channel, sessionKey, result.pageId, result.url ?? '');
        }
      } catch (err) {
        logger.warn(
          '[Slack] Low-confidence ticket creation failed:',
          err.message,
        );
      }
    }

    await slackApi.postThreadReply(
      channel,
      replyTs,
      `:thinking_face: Not sure which project to work in. Created a ticket for tracking — please clarify and I'll start the work session.`,
    );
    return;
  }

  // ── Resolve project slug ─────────────────────────────────────────────────
  const projectSlug = resolveProjectSlug(
    classification.workProject,
    config.projectRootPath,
  );

  if (!projectSlug) {
    await slackApi.postThreadReply(
      channel,
      replyTs,
      ':warning: Cannot start work session — no project root configured or project could not be identified.',
    );
    return;
  }

  // ── Check for existing session (thread session reuse) ────────────────────
  const existingSession = getSessionMapping(sessionKey);
  const existingSessionId = existingSession?.sessionId ?? null;
  const isResume = Boolean(existingSessionId);

  logger.log(
    `[Slack] [dispatch] session lookup: key=${sessionKey} → ${isResume ? `resume sessionId=${existingSessionId}` : 'new session'}`,
  );

  // ── Create ticket and set In Progress (new sessions only) ────────────────
  let ticketPageId = null;
  let ticketUrl = null;

  const active = resolveActiveProvider();
  if (active && !isResume) {
    const title =
      classification.ticketTitle ||
      classification.workPrompt?.substring(0, 80) ||
      'Work session';
    const permalink = await slackApi.getPermalink(channel, ts);
    const classifierBody =
      classification.ticketBody || classification.workPrompt || '';
    const slackSection = permalink ? `Slack thread: ${permalink}` : '';
    const body = [classifierBody, slackSection].filter(Boolean).join('\n\n');

    try {
      const ticketResult = await active.provider.createTicket({
        title,
        body,
        databaseUrl: active.config.ticketDatabaseUrl,
        fieldMappings: active.config.fieldMappings || [],
      });

      if (ticketResult.success && ticketResult.pageId) {
        ticketPageId = ticketResult.pageId;
        ticketUrl = ticketResult.url ?? null;

        // Store mapping and set ticket to In Progress
        storeTicket(channel, sessionKey, ticketPageId, ticketUrl ?? '');

        // Find the status field from field mappings (look for 'status' type)
        const statusMapping = (active.config.fieldMappings ?? []).find(
          (m) => m.type === 'status',
        );
        if (statusMapping) {
          const statusProperties = active.provider.buildStatusProperty(
            statusMapping.field,
            'In Progress',
          );
          await active.provider
            .updateTicket({
              pageId: ticketPageId,
              properties: statusProperties,
            })
            .catch((err) => {
              logger.warn(
                '[Slack] Could not set ticket to In Progress:',
                err.message,
              );
            });
        }
      }
    } catch (err) {
      logger.warn('[Slack] Work ticket creation failed:', err.message);
    }
  }

  // ── React and post status ─────────────────────────────────────────────────
  try {
    await slackApi.addReaction(channel, event.ts, 'robot_face');
  } catch {
    // Ignore reaction errors (already reacted, etc.)
  }

  const workPrompt = classification.workPrompt || classification.response || '';
  const ticketNotice = ticketUrl ? ` ${link(ticketUrl, 'Ticket')}` : '';
  const workStatusDefault = isResume
    ? ':arrows_counterclockwise: On it — continuing from where we left off.'
    : `:construction: On it.${ticketNotice}`;
  const statusMessage = classification.response
    ? `${classification.response}${!isResume && ticketNotice ? `\n${ticketNotice}` : ''}`
    : workStatusDefault;
  try {
    await slackApi.postThreadReply(channel, replyTs, statusMessage);
  } catch (err) {
    logger.error('[Slack] Failed to post work status:', err.message);
  }

  // ── Run work session ─────────────────────────────────────────────────────
  try {
    const result = await startWorkSession({
      projectSlug,
      prompt: workPrompt,
      threadTs: sessionKey,
      channelId: channel,
      userId: event.user,
      existingSessionId,
    });

    const durationStr = result.duration
      ? ` (${(result.duration / 1000).toFixed(1)}s)`
      : '';
    const costStr = result.cost ? ` — $${result.cost.toFixed(4)}` : '';

    if (result.success) {
      await slackApi.postThreadReply(
        channel,
        replyTs,
        `:white_check_mark: Work session completed${durationStr}${costStr}`,
      );
    } else {
      await slackApi.postThreadReply(
        channel,
        replyTs,
        `:warning: Work session ended: ${result.error || 'unknown error'}`,
      );
    }

    // ── PR link → ticket update ───────────────────────────────────────────
    if (ticketPageId && active) {
      const prUrls = extractPrUrls(result.output);
      if (prUrls.length > 0) {
        const prText = `PR created:\n\n${prUrls.join('\n')}`;
        await active.provider
          .updateTicket({
            pageId: ticketPageId,
            appendText: prText,
          })
          .catch((err) => {
            logger.warn(
              '[Slack] Could not append PR link to ticket:',
              err.message,
            );
          });
      }
    }
  } catch (err) {
    logger.error('[Slack] Work session error:', err);
    try {
      await slackApi.postThreadReply(
        channel,
        replyTs,
        `:x: Work session failed: ${err.message}`,
      );
    } catch {
      // Give up on posting
    }
  }
}
