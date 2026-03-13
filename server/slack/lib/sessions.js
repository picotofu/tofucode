/**
 * Slack Session Management
 *
 * Manages work sessions triggered from Slack messages.
 * Thread → SDK session mapping, work session lifecycle.
 */

import { logger } from '../../lib/logger.js';
import { saveSessionMapping } from '../config.js';
import { executePrompt } from './executor.js';

/**
 * @typedef {Object} WorkResult
 * @property {boolean} success
 * @property {string} [sessionId] - SDK session ID
 * @property {number} [cost] - Total cost in USD
 * @property {number} [duration] - Duration in ms
 * @property {string} [error] - Error message on failure
 * @property {string} [output] - Concatenated assistant text output from the session
 */

/**
 * Start a work session from a Slack trigger
 * @param {Object} params
 * @param {string} params.projectSlug - Project slug to work in
 * @param {string} params.prompt - Work instructions
 * @param {string} params.threadTs - Slack thread timestamp (for mapping)
 * @param {string} params.channelId - Slack channel ID
 * @param {string} params.userId - Slack user who triggered the work
 * @param {string|null} [params.existingSessionId] - Resume an existing session if provided
 * @returns {Promise<WorkResult>}
 */
export async function startWorkSession({
  projectSlug,
  prompt,
  threadTs,
  channelId,
  userId,
  existingSessionId = null,
}) {
  let sessionId = existingSessionId;
  let cost = null;
  let duration = null;
  const textChunks = [];

  try {
    for await (const event of executePrompt({
      projectSlug,
      sessionId: existingSessionId,
      prompt,
    })) {
      // Capture session ID and save mapping (only on new sessions)
      if (event.type === 'session_init' && event.isNew) {
        sessionId = event.sessionId;
        saveSessionMapping(threadTs, {
          sessionId,
          channelId,
          projectSlug,
          userId,
          createdAt: new Date().toISOString(),
        });
        logger.log(
          `[Slack] Work session started: ${sessionId} for thread ${threadTs}`,
        );
      }

      // On resume, just log continuation (session_init with isNew=false)
      if (event.type === 'session_init' && !event.isNew) {
        logger.log(
          `[Slack] Work session resumed: ${event.sessionId} for thread ${threadTs}`,
        );
      }

      // Collect assistant text output (used for PR link detection etc.)
      if (event.type === 'text' && event.content) {
        textChunks.push(event.content);
      }

      // Capture final result
      if (event.type === 'result') {
        cost = event.cost;
        duration = event.duration;
      }

      // Handle errors mid-session
      if (event.type === 'error') {
        return {
          success: false,
          sessionId,
          error: event.message,
          cost,
          duration,
          output: textChunks.join(''),
        };
      }
    }

    return {
      success: true,
      sessionId,
      cost,
      duration,
      output: textChunks.join(''),
    };
  } catch (err) {
    logger.error('[Slack] Work session error:', err);
    return {
      success: false,
      sessionId,
      error: err.message,
      cost,
      duration,
      output: textChunks.join(''),
    };
  }
}
