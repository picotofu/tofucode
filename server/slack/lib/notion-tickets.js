/**
 * Slack Thread → Notion Ticket Mapping
 *
 * Persists a mapping of Slack thread timestamps to Notion page IDs so that
 * follow-up replies to a thread can update the existing ticket rather than
 * creating a duplicate.
 *
 * Storage: ~/.tofucode/notion-tickets.json
 * Format:  { "<channel>/<thread_ts>": { pageId, url, createdAt } }
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../lib/logger.js';

const STORE_PATH = join(homedir(), '.tofucode', 'notion-tickets.json');

/**
 * @typedef {Object} TicketEntry
 * @property {string} pageId - Notion page ID
 * @property {string} url - Notion page URL
 * @property {number} createdAt - Unix timestamp (ms) when the entry was stored
 */

/**
 * Load the full mapping store from disk.
 * @returns {Record<string, TicketEntry>}
 */
function loadStore() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    logger.warn(
      '[NotionTickets] Failed to parse notion-tickets.json, starting fresh',
    );
    return {};
  }
}

/**
 * Persist the mapping store to disk.
 * @param {Record<string, TicketEntry>} store
 */
function saveStore(store) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    logger.error(
      '[NotionTickets] Failed to save notion-tickets.json:',
      err.message,
    );
  }
}

/**
 * Build the composite key for a thread.
 * @param {string} channel
 * @param {string} threadTs
 * @returns {string}
 */
function makeKey(channel, threadTs) {
  return `${channel}/${threadTs}`;
}

/**
 * Store a ticket entry for a Slack thread.
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread parent timestamp
 * @param {string} pageId - Notion page ID
 * @param {string} url - Notion page URL
 */
export function storeTicket(channel, threadTs, pageId, url) {
  if (!channel || !threadTs || !pageId) {
    logger.warn(
      '[NotionTickets] storeTicket called with missing required params — skipping',
    );
    return;
  }
  const store = loadStore();
  store[makeKey(channel, threadTs)] = { pageId, url, createdAt: Date.now() };
  saveStore(store);
}

/**
 * Look up an existing ticket for a Slack thread.
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread parent timestamp
 * @returns {TicketEntry|null}
 */
export function findTicket(channel, threadTs) {
  if (!channel || !threadTs) return null;
  const store = loadStore();
  return store[makeKey(channel, threadTs)] ?? null;
}
