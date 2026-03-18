/**
 * Slack Bot Configuration
 *
 * Manages Slack-specific settings and persistence for channel/session mappings.
 * Isolated from web UI code - does not depend on ws.js or auth.js.
 *
 * Config resolution for botToken:
 *   1. slack-config.json → botToken (primary, set via Settings UI)
 *   2. process.env.SLACK_BOT_TOKEN (env var fallback)
 *   3. ~/.claude.json → mcpServers.slack.env.SLACK_BOT_TOKEN (MCP fallback)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

// Storage paths
const TOFUCODE_DIR = join(homedir(), '.tofucode');
const CONFIG_FILE = join(TOFUCODE_DIR, 'slack-config.json');
const SESSIONS_FILE = join(TOFUCODE_DIR, 'slack-sessions.json');

const DEFAULT_CONFIG = {
  enabled: false,
  botToken: '',
  appToken: '',
  selfUserId: '', // Cached from auth.test — for self-reply prevention
  projectRootPath: '', // Root path for project discovery (e.g. /home/user/projects)
  sessionLogPath: '', // Optional: folder path to persist session logs (e.g. /home/user/slack-sessions)
  respondDm: true, // Whether to respond to direct messages
  debounceMs: 10000, // Debounce window in ms — groups rapid successive messages before processing
  watchedChannels: [],
  identity: {
    name: '',
    role: '',
    tone: 'concise, professional',
  },
  classifier: {
    systemPrompt: '',
    maxTriageTurns: 5, // Max tool-use turns for Sonnet agentic triage pass
  },
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
 * Resolve the bot token from multiple sources
 * @param {Object} config - Loaded config object
 * @returns {string} Resolved token or empty string
 */
function resolveBotToken(config) {
  // 1. Direct config
  if (config.botToken) return config.botToken;

  // 2. Env var
  if (process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;

  // 3. Claude MCP config fallback
  try {
    const claudeConfigPath = join(homedir(), '.claude.json');
    if (existsSync(claudeConfigPath)) {
      const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
      const slackMcp = claudeConfig.mcpServers?.slack;
      if (slackMcp?.env?.SLACK_BOT_TOKEN) {
        return slackMcp.env.SLACK_BOT_TOKEN;
      }
    }
  } catch (err) {
    logger.warn(
      '[Slack] Failed to parse ~/.claude.json for MCP token fallback:',
      err.message,
    );
  }

  return '';
}

/**
 * Resolve the app token from multiple sources
 * @param {Object} config - Loaded config object
 * @returns {string} Resolved token or empty string
 */
function resolveAppToken(config) {
  if (config.appToken) return config.appToken;
  if (process.env.SLACK_APP_TOKEN) return process.env.SLACK_APP_TOKEN;
  return '';
}

/**
 * Load Slack configuration from disk (raw, without token resolution).
 * Used for save operations to avoid persisting env/MCP-resolved tokens.
 * @returns {Object} Config with defaults applied but tokens as stored on disk
 */
export function loadSlackConfigRaw() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const loaded = JSON.parse(data);
      return {
        ...DEFAULT_CONFIG,
        ...loaded,
        identity: { ...DEFAULT_CONFIG.identity, ...loaded.identity },
        classifier: {
          ...DEFAULT_CONFIG.classifier,
          ...loaded.classifier,
        },
      };
    }
  } catch (error) {
    logger.error('[Slack] Error loading raw config:', error.message);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Load Slack configuration from disk
 * @returns {Object} Full config with defaults applied and tokens resolved
 */
export function loadSlackConfig() {
  const merged = loadSlackConfigRaw();
  // Resolve tokens from fallback sources
  merged.botToken = resolveBotToken(merged);
  merged.appToken = resolveAppToken(merged);
  return merged;
}

/**
 * Save Slack configuration to disk
 * @param {Object} config - Config object to save
 */
export function saveSlackConfig(config) {
  ensureDir();
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    logger.error('[Slack] Error saving config:', error.message);
  }
}

/**
 * Get a masked version of the config (safe for sending to frontend)
 * @returns {Object} Config with tokens masked
 */
export function getMaskedConfig() {
  const config = loadSlackConfig();
  return {
    ...config,
    botToken: maskToken(config.botToken),
    appToken: maskToken(config.appToken),
  };
}

/**
 * Mask a token for display (show last 4 chars)
 * @param {string} token
 * @returns {string} Masked token
 */
function maskToken(token) {
  if (!token || token.length < 8) return '';
  return `${'*'.repeat(token.length - 4)}${token.slice(-4)}`;
}

// --- Session Mappings ---

/**
 * Load thread-to-session mappings from disk
 * Format: { "threadTs": { sessionId, channelId, projectSlug, userId, createdAt } }
 * @returns {Object} Session mappings
 */
export function loadSessionMappings() {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = readFileSync(SESSIONS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('[Slack] Error loading session mappings:', error.message);
  }
  return {};
}

/**
 * Save a thread-to-session mapping
 * @param {string} threadTs - Slack thread timestamp
 * @param {Object} mapping - { sessionId, channelId, projectSlug, userId, createdAt }
 */
export function saveSessionMapping(threadTs, mapping) {
  ensureDir();
  try {
    const mappings = loadSessionMappings();
    mappings[threadTs] = mapping;
    writeFileSync(SESSIONS_FILE, JSON.stringify(mappings, null, 2));
  } catch (error) {
    logger.error('[Slack] Error saving session mapping:', error.message);
  }
}

/**
 * Get a thread's session mapping
 * @param {string} threadTs - Slack thread timestamp
 * @returns {Object|null} Session mapping or null
 */
export function getSessionMapping(threadTs) {
  const mappings = loadSessionMappings();
  return mappings[threadTs] || null;
}

/**
 * Find a session mapping by sessionId (reverse lookup)
 * @param {string} sessionId
 * @returns {{ threadTs: string } & Object | null}
 */
export function getSessionMappingBySessionId(sessionId) {
  const mappings = loadSessionMappings();
  for (const [threadTs, mapping] of Object.entries(mappings)) {
    if (mapping.sessionId === sessionId) {
      return { threadTs, ...mapping };
    }
  }
  return null;
}

/**
 * Remove a thread-to-session mapping
 * @param {string} threadTs - Slack thread timestamp
 */
export function removeSessionMapping(threadTs) {
  ensureDir();
  try {
    const mappings = loadSessionMappings();
    delete mappings[threadTs];
    writeFileSync(SESSIONS_FILE, JSON.stringify(mappings, null, 2));
  } catch (error) {
    logger.error('[Slack] Error removing session mapping:', error.message);
  }
}

/**
 * Find all sessions for a specific channel
 * @param {string} channelId - Slack channel ID
 * @returns {Array} Array of session mappings
 */
export function findSessionsByChannel(channelId) {
  const mappings = loadSessionMappings();
  return Object.entries(mappings)
    .filter(([, mapping]) => mapping.channelId === channelId)
    .map(([threadTs, mapping]) => ({ threadTs, ...mapping }));
}
