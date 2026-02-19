/**
 * Discord Sync Utilities
 *
 * Reusable functions for syncing sessions to Discord threads.
 * Used by:
 * - /resume command (Phase 1 - manual sync)
 * - Event bus adapters (Phase 2 - automatic sync)
 */

import { logger } from '../../lib/logger.js';
import { loadSessionHistory } from '../../lib/sessions.js';
import { registerSession } from '../lib/sessions.js';
import { chunkMessage } from './formatter.js';

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

  // Use code-block-aware chunking from formatter
  const chunks = chunkMessage(content);

  // Send first chunk, return that message
  const firstMessage = await thread.send(chunks[0]);

  // Send remaining chunks
  for (let i = 1; i < chunks.length; i++) {
    await thread.send(chunks[i]);
  }

  return firstMessage;
}

/**
 * Format the last N turns of a session as Discord messages.
 * Since bots can't impersonate users, user messages are prefixed with 👤.
 *
 * A "turn" = one user message + the assistant response to it.
 *
 * @param {string} projectSlug
 * @param {string} sessionId
 * @param {number} [turns=3] - Number of turns to load
 * @returns {Promise<string[]>} Array of Discord-ready message strings (chunked)
 */
export async function formatLastTurnsForDiscord(
  projectSlug,
  sessionId,
  turns = 3,
) {
  const { messages } = await loadSessionHistory(projectSlug, sessionId, {
    turnLimit: turns,
  });

  if (!messages || messages.length === 0) {
    return [];
  }

  const parts = [];

  for (const msg of messages) {
    switch (msg.type) {
      case 'user':
        // Bot can't impersonate - prefix clearly
        if (msg.content?.trim()) {
          parts.push(
            `> 👤 **User**\n> ${msg.content.trim().replace(/\n/g, '\n> ')}`,
          );
        }
        break;

      case 'text':
        // Assistant text response
        if (msg.content?.trim()) {
          parts.push(`🤖 ${msg.content.trim()}`);
        }
        break;

      case 'tool_use': {
        // Compact inline format — formatToolUse was removed, inline it here
        const hint =
          msg.input?.command ||
          msg.input?.file_path ||
          msg.input?.pattern ||
          '';
        const short = hint.length > 60 ? `${hint.substring(0, 57)}…` : hint;
        parts.push(`> ⚙️ ${msg.tool}${short ? ` — ${short}` : ''}`);
        break;
      }

      case 'tool_result':
        // Only show errors
        if (msg.isError && msg.content) {
          parts.push(`> ❌ Tool error: ${msg.content.substring(0, 200)}`);
        }
        break;

      case 'summary':
        // Session summary from Claude's context management
        parts.push(`> 📝 _Context summary (${turns} turns ago)_`);
        break;

      default:
        // Skip system messages, progress updates, etc.
        break;
    }
  }

  if (parts.length === 0) {
    return [];
  }

  // Join all parts and chunk for Discord's 2000 char limit
  const combined = parts.join('\n\n');
  return chunkMessage(combined);
}

/**
 * Send the last N turns of session history to a Discord thread.
 * Called after thread creation in /resume.
 *
 * @param {Object} thread - Discord thread object
 * @param {string} projectSlug
 * @param {string} sessionId
 * @param {number} [turns=3]
 */
export async function sendSessionHistoryToThread(
  thread,
  projectSlug,
  sessionId,
  turns = 3,
) {
  const chunks = await formatLastTurnsForDiscord(projectSlug, sessionId, turns);

  if (chunks.length === 0) {
    return;
  }

  for (const chunk of chunks) {
    if (chunk?.trim()) {
      await thread.send(chunk);
    }
  }
}

/**
 * Check if a session already has a live Discord thread.
 *
 * Verifies the thread still exists in Discord (not just in local storage),
 * so that deleted threads don't block re-creation.
 *
 * @param {string} sessionId - Session ID to check
 * @param {Object} guild - Discord guild object (to verify thread exists)
 * @returns {Promise<string|null>} Thread ID if exists and live, null otherwise
 */
export async function findThreadForSession(sessionId, guild) {
  // Load all session mappings and search for matching sessionId
  const { loadSessionMappings, removeSessionMapping } = await import(
    '../config.js'
  );
  const mappings = loadSessionMappings();

  for (const [threadId, mapping] of Object.entries(mappings)) {
    if (mapping.sessionId !== sessionId) continue;

    // Verify thread still exists in Discord
    if (guild) {
      try {
        await guild.channels.fetch(threadId);
        // Thread exists - return it
        return threadId;
      } catch {
        // Thread was deleted - clean up stale mapping and continue searching
        logger.log(
          `[Discord] Removing stale thread mapping ${threadId} (thread deleted)`,
        );
        removeSessionMapping(threadId);
        continue;
      }
    }

    // No guild provided - trust local storage (fallback)
    return threadId;
  }

  return null;
}
