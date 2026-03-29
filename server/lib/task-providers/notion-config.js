/**
 * Notion Configuration
 *
 * Manages Notion integration settings.
 * Config file: ~/.tofucode/notion-config.json
 *
 * Schema:
 *   { enabled, token, ticketDatabaseUrl, userEmail, fieldMappings: [{ field, type, purpose }] }
 *
 * TODO (adapter): When adding support for additional task management providers
 * (e.g. Jira, Linear), this file should evolve into a generic active-provider
 * config — e.g. ~/.tofucode/tasks-config.json with a top-level `provider` field.
 * Each provider would then have its own config block keyed by provider name.
 * The TaskProvider registry in index.js is already structured for this.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger.js';

const TOFUCODE_DIR = join(homedir(), '.tofucode');
const CONFIG_FILE = join(TOFUCODE_DIR, 'notion-config.json');

/** @type {Object} */
const DEFAULT_CONFIG = {
  enabled: false,
  token: '', // Notion Integration Token (secret_xxx)
  ticketDatabaseUrl: '',
  userEmail: '', // Workspace email to identify self for filtering
  fieldMappings: [], // [{ field: string, type: string, purpose: string }]
};

/**
 * Ensure ~/.tofucode directory exists
 */
function ensureDir() {
  if (!existsSync(TOFUCODE_DIR)) {
    mkdirSync(TOFUCODE_DIR, { recursive: true });
  }
}

/**
 * Load Notion configuration from disk (raw — no token resolution)
 * @returns {Object}
 */
export function loadNotionConfigRaw() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const loaded = JSON.parse(data);
      return {
        ...DEFAULT_CONFIG,
        ...loaded,
        fieldMappings: loaded.fieldMappings ?? DEFAULT_CONFIG.fieldMappings,
      };
    }
  } catch (error) {
    logger.error('[Notion Config] Error loading config:', error.message);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Load Notion configuration with env var fallback for token
 * @returns {Object}
 */
export function loadNotionConfig() {
  const raw = loadNotionConfigRaw();
  // Allow env var overrides
  if (!raw.token && process.env.NOTION_TOKEN) {
    raw.token = process.env.NOTION_TOKEN;
  }
  if (!raw.userEmail && process.env.NOTION_USER_EMAIL) {
    raw.userEmail = process.env.NOTION_USER_EMAIL;
  }
  return raw;
}

/**
 * Save Notion configuration to disk
 * @param {Object} config
 */
export function saveNotionConfig(config) {
  ensureDir();
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    logger.error('[Notion Config] Error saving config:', error.message);
  }
}

/**
 * Mask a token for display (show last 4 chars)
 * @param {string} token
 * @returns {string}
 */
function maskToken(token) {
  if (!token || token.length < 8) return '';
  return `${'*'.repeat(token.length - 4)}${token.slice(-4)}`;
}

/**
 * Get masked config (safe for frontend)
 * @returns {Object}
 */
export function getMaskedNotionConfig() {
  const config = loadNotionConfig();
  return {
    ...config,
    token: maskToken(config.token),
  };
}
