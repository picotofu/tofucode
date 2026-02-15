/**
 * Event: delete_session
 *
 * Deletes a session JSONL file and removes it from the sessions index.
 *
 * @event delete_session
 * @param {Object} message - { sessionId: string }
 * @returns {void} Sends: { type: 'session_deleted', sessionId } or { type: 'error', message }
 *
 * @example
 * // Request
 * { type: 'delete_session', sessionId: 'abc123' }
 *
 * // Response on success
 * { type: 'session_deleted', sessionId: 'abc123' }
 *
 * // Response on error
 * { type: 'error', message: 'Session not found' }
 */

import {
  existsSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getSessionsDir } from '../config.js';
import { deleteTitle } from '../lib/session-titles.js';
import { isValidSessionId } from '../lib/sessions.js';
import { broadcast, send } from '../lib/ws.js';

export function handler(ws, message, context) {
  if (!context.currentProjectPath) {
    send(ws, { type: 'error', message: 'No project selected' });
    return;
  }

  const { sessionId } = message;
  if (!sessionId) {
    send(ws, { type: 'error', message: 'sessionId is required' });
    return;
  }

  // SECURITY: Validate sessionId format to prevent path traversal
  if (!isValidSessionId(sessionId)) {
    send(ws, { type: 'error', message: 'Invalid sessionId format' });
    return;
  }

  const sessionsDir = getSessionsDir(context.currentProjectPath);
  const jsonlPath = join(sessionsDir, `${sessionId}.jsonl`);
  const sessionDir = join(sessionsDir, sessionId); // Subdirectory for session data
  const indexPath = join(sessionsDir, 'sessions-index.json');

  // Check if session file exists
  if (!existsSync(jsonlPath)) {
    send(ws, { type: 'error', message: 'Session not found' });
    return;
  }

  try {
    // Delete the JSONL file
    unlinkSync(jsonlPath);

    // Delete session subdirectory if it exists (contains subagents, tool-results, etc.)
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }

    // Update sessions-index.json
    if (existsSync(indexPath)) {
      const indexData = JSON.parse(readFileSync(indexPath, 'utf-8'));
      indexData.entries = (indexData.entries || []).filter(
        (entry) => entry.sessionId !== sessionId,
      );
      writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    }

    // Delete session title if exists
    deleteTitle(context.currentProjectPath, sessionId);

    // Broadcast to all clients so UI updates everywhere
    broadcast({
      type: 'session_deleted',
      sessionId,
    });
  } catch (err) {
    console.error('Failed to delete session:', err.message);
    send(ws, { type: 'error', message: 'Failed to delete session' });
  }
}
