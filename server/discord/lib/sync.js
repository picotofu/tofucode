/**
 * Discord Sync Utilities
 *
 * Reusable functions for syncing sessions to Discord threads.
 * Used by:
 * - /resume command (Phase 1 - manual sync)
 * - Event bus adapters (Phase 2 - automatic sync)
 */

import { logger } from '../../lib/logger.js';
import { registerSession } from '../lib/sessions.js';

/**
 * Create a Discord thread for a session.
 *
 * @param {Object} channel - Discord channel object
 * @param {string} sessionId - Session ID to map
 * @param {string} threadName - Thread name (max 100 chars)
 * @param {string} projectSlug - Project slug for mapping
 * @param {string} userId - Discord user ID who triggered this
 * @returns {Promise<Object>} Thread object
 */
export async function createThreadForSession(
  channel,
  sessionId,
  threadName,
  projectSlug,
  userId,
) {
  // Discord thread name limit is 100 chars
  const truncatedName =
    threadName.length > 100 ? `${threadName.substring(0, 97)}...` : threadName;

  // Create public thread
  const thread = await channel.threads.create({
    name: truncatedName,
    autoArchiveDuration: 1440, // 24 hours
    reason: `Resume session: ${sessionId}`,
  });

  // Register thread-session mapping
  registerSession(thread.id, {
    sessionId,
    channelId: channel.id,
    projectSlug,
    userId,
    threadName: truncatedName,
  });

  logger.log(
    `[Discord] Created thread ${thread.id} for session ${sessionId} (${truncatedName})`,
  );

  return thread;
}

/**
 * Send a message to a Discord thread.
 * Handles chunking if message exceeds Discord's 2000 char limit.
 *
 * @param {Object} thread - Discord thread object
 * @param {string} content - Message content
 * @returns {Promise<Object>} First message object
 */
export async function sendToThread(thread, content) {
  if (!content || content.length === 0) {
    throw new Error('Cannot send empty message to thread');
  }

  // If under 2000 chars, send directly
  if (content.length <= 2000) {
    return await thread.send(content);
  }

  // Otherwise, chunk (simple split for now - Phase 2 can use formatter.js chunking)
  const chunks = [];
  let remaining = content;
  while (remaining.length > 0) {
    chunks.push(remaining.substring(0, 1900));
    remaining = remaining.substring(1900);
  }

  // Send first chunk, return that message
  const firstMessage = await thread.send(chunks[0]);

  // Send remaining chunks
  for (let i = 1; i < chunks.length; i++) {
    await thread.send(chunks[i]);
  }

  return firstMessage;
}

/**
 * Check if a session already has a Discord thread.
 *
 * @param {string} sessionId - Session ID to check
 * @returns {Promise<string|null>} Thread ID if exists, null otherwise
 */
export async function findThreadForSession(sessionId) {
  // Load all session mappings and search for matching sessionId
  const { loadSessionMappings } = await import('../config.js');
  const mappings = loadSessionMappings();

  for (const [threadId, mapping] of Object.entries(mappings)) {
    if (mapping.sessionId === sessionId) {
      return threadId;
    }
  }

  return null;
}
