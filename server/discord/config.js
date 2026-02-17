/**
 * Discord Bot Configuration
 *
 * Manages Discord-specific settings and persistence for channel/session mappings.
 * Isolated from web UI code - does not depend on ws.js or auth.js.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

// Discord configuration from environment variables
export const discordConfig = {
  enabled: process.env.DISCORD_ENABLED === 'true',
  token: process.env.DISCORD_BOT_TOKEN || null,
  guildId: process.env.DISCORD_GUILD_ID || null, // Optional: restrict to one server
  status: process.env.DISCORD_STATUS || 'Coding with Claude',
  maxMessageLength: Number.parseInt(
    process.env.DISCORD_MAX_MESSAGE_LENGTH || '1900',
    10,
  ),
  streamingEditInterval: 1500, // ms between message edits (rate-limit safe: ~3.3 edits per 5s)
};

// Storage paths
const DISCORD_DIR = join(homedir(), '.tofucode');
const CHANNELS_FILE = join(DISCORD_DIR, 'discord-channels.json');
const SESSIONS_FILE = join(DISCORD_DIR, 'discord-sessions.json');

/**
 * Ensure .tofucode directory exists
 */
function ensureDir() {
  if (!existsSync(DISCORD_DIR)) {
    mkdirSync(DISCORD_DIR, { recursive: true });
  }
}

/**
 * Load channel-to-project mappings from disk
 * Format: { "channelId": { projectPath, projectSlug, guildId, configuredBy, configuredAt } }
 * @returns {Object} Channel mappings
 */
export function loadChannelMappings() {
  try {
    if (existsSync(CHANNELS_FILE)) {
      const data = readFileSync(CHANNELS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('[Discord] Error loading channel mappings:', error.message);
  }
  return {};
}

/**
 * Save a channel-to-project mapping
 * @param {string} channelId - Discord channel ID
 * @param {Object} mapping - { projectPath, projectSlug, guildId, configuredBy, configuredAt }
 */
export function saveChannelMapping(channelId, mapping) {
  ensureDir();
  const mappings = loadChannelMappings();
  mappings[channelId] = mapping;
  writeFileSync(CHANNELS_FILE, JSON.stringify(mappings, null, 2));
}

/**
 * Get a channel's project mapping
 * @param {string} channelId - Discord channel ID
 * @returns {Object|null} Channel mapping or null
 */
export function getChannelMapping(channelId) {
  const mappings = loadChannelMappings();
  return mappings[channelId] || null;
}

/**
 * Remove a channel mapping
 * @param {string} channelId - Discord channel ID
 */
export function removeChannelMapping(channelId) {
  ensureDir();
  const mappings = loadChannelMappings();
  delete mappings[channelId];
  writeFileSync(CHANNELS_FILE, JSON.stringify(mappings, null, 2));
}

/**
 * Load thread-to-session mappings from disk
 * Format: { "threadId": { sessionId, channelId, projectSlug, userId, createdAt, threadName } }
 * @returns {Object} Session mappings
 */
export function loadSessionMappings() {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = readFileSync(SESSIONS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('[Discord] Error loading session mappings:', error.message);
  }
  return {};
}

/**
 * Save a thread-to-session mapping
 * @param {string} threadId - Discord thread ID
 * @param {Object} mapping - { sessionId, channelId, projectSlug, userId, createdAt, threadName }
 */
export function saveSessionMapping(threadId, mapping) {
  ensureDir();
  const mappings = loadSessionMappings();
  mappings[threadId] = mapping;
  writeFileSync(SESSIONS_FILE, JSON.stringify(mappings, null, 2));
}

/**
 * Get a thread's session mapping
 * @param {string} threadId - Discord thread ID
 * @returns {Object|null} Session mapping or null
 */
export function getSessionMapping(threadId) {
  const mappings = loadSessionMappings();
  return mappings[threadId] || null;
}

/**
 * Find all sessions for a specific channel
 * @param {string} channelId - Discord channel ID
 * @returns {Array} Array of session mappings
 */
export function findSessionsByChannel(channelId) {
  const mappings = loadSessionMappings();
  return Object.entries(mappings)
    .filter(([_threadId, mapping]) => mapping.channelId === channelId)
    .map(([threadId, mapping]) => ({ threadId, ...mapping }));
}
