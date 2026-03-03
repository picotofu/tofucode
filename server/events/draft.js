/**
 * Events: draft:set, draft:get
 *
 * Server-side draft persistence for multi-device sync.
 * Drafts are stored per-session in ~/.claude/projects/{slug}/.drafts.json
 *
 * @event draft:set
 * @param {Object} message - { sessionId: string, draft: string }
 * @returns {void} Sends: draft:ack
 *
 * @event draft:get
 * @param {Object} message - { sessionId: string }
 * @returns {void} Sends: draft:value
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSessionsDir } from '../config.js';
import { isValidSessionId } from '../lib/sessions.js';
import { send } from '../lib/ws.js';

const DRAFTS_FILE = '.drafts.json';
const MAX_DRAFT_LENGTH = 100_000; // 100KB safety cap

async function loadDrafts(projectPath) {
  const filePath = path.join(projectPath, DRAFTS_FILE);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveDrafts(projectPath, drafts) {
  const filePath = path.join(projectPath, DRAFTS_FILE);
  await writeFile(filePath, JSON.stringify(drafts, null, 2), 'utf8');
}

export async function setHandler(ws, message, context) {
  const { sessionId, draft } = message;

  if (!sessionId || typeof sessionId !== 'string') {
    send(ws, {
      type: 'draft:ack',
      success: false,
      error: 'Session ID is required',
    });
    return;
  }

  if (!isValidSessionId(sessionId)) {
    send(ws, {
      type: 'draft:ack',
      success: false,
      error: 'Invalid sessionId format',
    });
    return;
  }

  if (!context.currentProjectPath) {
    send(ws, {
      type: 'draft:ack',
      success: false,
      error: 'No project selected',
    });
    return;
  }

  if (typeof draft !== 'string' || draft.length > MAX_DRAFT_LENGTH) {
    send(ws, { type: 'draft:ack', success: false, error: 'Invalid draft' });
    return;
  }

  try {
    const projectPath = getSessionsDir(context.currentProjectPath);
    const drafts = await loadDrafts(projectPath);

    if (draft === '') {
      delete drafts[sessionId];
    } else {
      drafts[sessionId] = { draft, updatedAt: Date.now() };
    }

    await saveDrafts(projectPath, drafts);
    send(ws, { type: 'draft:ack', success: true, sessionId });
  } catch (err) {
    send(ws, { type: 'draft:ack', success: false, error: err.message });
  }
}

export async function getHandler(ws, message, context) {
  const { sessionId } = message;

  if (!sessionId || typeof sessionId !== 'string') {
    send(ws, { type: 'draft:value', sessionId, draft: null });
    return;
  }

  if (!isValidSessionId(sessionId)) {
    send(ws, { type: 'draft:value', sessionId, draft: null });
    return;
  }

  if (!context.currentProjectPath) {
    send(ws, { type: 'draft:value', sessionId, draft: null });
    return;
  }

  try {
    const projectPath = getSessionsDir(context.currentProjectPath);
    const drafts = await loadDrafts(projectPath);
    const entry = drafts[sessionId];
    send(ws, {
      type: 'draft:value',
      sessionId,
      draft: entry?.draft ?? null,
      updatedAt: entry?.updatedAt ?? null,
    });
  } catch {
    send(ws, { type: 'draft:value', sessionId, draft: null });
  }
}
