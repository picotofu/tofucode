/**
 * Discord Thread-to-Session Mapping
 *
 * Manages the bidirectional mapping between Discord threads and tofucode sessions.
 * Delegates to server/lib/session-titles.js for title persistence.
 */

import { setTitle } from '../../lib/session-titles.js';
import { getSessionMapping, saveSessionMapping } from '../config.js';

/**
 * Get the session mapping for a Discord thread.
 * Returns null if no mapping exists.
 *
 * @param {string} threadId - Discord thread ID
 * @returns {Object|null} { sessionId, channelId, projectSlug, userId, threadName, createdAt }
 */
export function getSession(threadId) {
  return getSessionMapping(threadId);
}

/**
 * Register a new session for a thread.
 * Called when SDK returns session_init with a new session ID.
 *
 * @param {string} threadId - Discord thread ID
 * @param {Object} data - { sessionId, channelId, projectSlug, userId, threadName }
 */
export function registerSession(threadId, data) {
  saveSessionMapping(threadId, {
    ...data,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Update session ID for a thread.
 * Called after first prompt when SDK assigns a session ID.
 *
 * @param {string} threadId - Discord thread ID
 * @param {string} sessionId - Session ID from SDK
 */
export function updateSessionId(threadId, sessionId) {
  const existing = getSessionMapping(threadId);
  if (existing) {
    saveSessionMapping(threadId, { ...existing, sessionId });
  }
}

/**
 * Set the session title (syncs with tofucode's session-titles.json).
 * This makes the Discord thread name appear as the session title in the web UI.
 *
 * @param {string} projectSlug - Project slug (e.g., -home-ts-projects-myapp)
 * @param {string} sessionId - Session ID (UUID from SDK)
 * @param {string} title - Session title (thread name)
 */
export function setSessionTitle(projectSlug, sessionId, title) {
  setTitle(projectSlug, sessionId, title);
}
