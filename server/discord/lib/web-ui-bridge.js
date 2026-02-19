/**
 * Web UI → Discord Bridge
 *
 * Subscribes to the internal event bus and mirrors Web UI sessions to Discord.
 * When the Web UI runs a prompt on a project that has a Discord channel mapped,
 * this bridge finds or creates a Discord thread and forwards events to it.
 *
 * Architecture:
 *   prompt.js (Web UI) → eventBus → web-ui-bridge.js → Discord API
 *
 * Isolation:
 *   - Web UI code never imports discord.js (uses event-bus.js only)
 *   - This file is the only bridge between the two transports
 *
 * Mapping logic:
 *   projectPath → channelId (via discord-channels.json)
 *   sessionId   → threadId  (via discord-sessions.json, created on first prompt)
 */

import { pathToSlug } from '../../config.js';
import { eventBus } from '../../lib/event-bus.js';
import { logger } from '../../lib/logger.js';
import {
  discordConfig,
  getChannelMappingByPath,
  getSessionMappingBySessionId,
  saveSessionMapping,
} from '../config.js';
import {
  accumulateToolUse,
  chunkMessage,
  formatFooter,
  formatToolStatus,
} from './formatter.js';

// Per-session Discord state: sessionId → { thread, toolState, fullText, lastEditTime, thinkingMsg }
const sessionState = new Map();

/**
 * Start the bridge — subscribe to event bus and forward to Discord.
 * Called once when the Discord bot is ready.
 *
 * @param {import('discord.js').Client} client - Discord.js client
 */
export function startWebUiBridge(client) {
  logger.log('[Discord] Web UI bridge started');

  eventBus.on(
    'session:start',
    async ({ projectPath, sessionId, isNew, prompt }) => {
      try {
        const channelMapping = getChannelMappingByPath(projectPath);
        if (!channelMapping) return; // Project not mapped to any Discord channel

        const slug = pathToSlug(projectPath);
        const { channelId } = channelMapping;

        // Find or create Discord thread for this session
        const thread = await resolveThread(
          client,
          channelId,
          sessionId,
          slug,
          prompt,
          isNew,
        );
        if (!thread) return;

        // Initialize (or re-use) per-session state
        if (!sessionState.has(sessionId)) {
          sessionState.set(sessionId, {
            thread,
            toolState: {
              counts: {},
              lastBash: null,
              lastTool: null,
              lastToolHint: null,
            },
            fullText: '',
            lastEditTime: 0,
            thinkingMsg: null,
          });
        }

        const state = sessionState.get(sessionId);
        // Always update thread ref in case it was re-created
        state.thread = thread;

        // Send user prompt flagged as Web UI input
        await thread.send(formatUserPrompt(prompt)).catch((err) => {
          logger.error('[Discord Bridge] Send error:', err);
        });

        // Reset turn state and send thinking indicator
        state.fullText = '';
        state.toolState = {
          counts: {},
          lastBash: null,
          lastTool: null,
          lastToolHint: null,
        };
        state.lastEditTime = 0;
        state.thinkingMsg = await thread.send('⏳ Working…').catch((err) => {
          logger.error('[Discord Bridge] Send error:', err);
          return null;
        });
      } catch (err) {
        logger.error('[Discord Bridge] session:start error:', err);
      }
    },
  );

  eventBus.on('session:text', async ({ sessionId, content }) => {
    const state = sessionState.get(sessionId);
    if (!state) return;

    state.fullText += content;

    const now = Date.now();
    if (now - state.lastEditTime > discordConfig.streamingEditInterval) {
      state.lastEditTime = now;
      await editMsg(state, state.fullText);
    }
  });

  eventBus.on('session:tool', async ({ sessionId, tool, input }) => {
    const state = sessionState.get(sessionId);
    if (!state) return;

    accumulateToolUse(state.toolState, { tool, input });

    const now = Date.now();
    if (now - state.lastEditTime > discordConfig.streamingEditInterval) {
      state.lastEditTime = now;
      // Only show status line if no text yet
      if (!state.fullText) {
        await editMsg(state, formatToolStatus(state.toolState));
      }
    }
  });

  eventBus.on(
    'session:result',
    async ({ sessionId, subtype, cost, duration }) => {
      const state = sessionState.get(sessionId);
      if (!state) return;

      const footer = formatFooter(state.toolState, { subtype, cost, duration });
      const display = [state.fullText, footer].filter(Boolean).join('\n\n');
      const chunks = chunkMessage(display);

      if (state.thinkingMsg && chunks[0]) {
        await state.thinkingMsg.edit(chunks[0]).catch(() => {});
        for (let i = 1; i < chunks.length; i++) {
          await state.thread.send(chunks[i]).catch(() => {});
        }
      }

      // Keep session state alive — user may send follow-up messages from Web UI.
      // Reset per-turn fields, keep thread reference.
      state.fullText = '';
      state.toolState = {
        counts: {},
        lastBash: null,
        lastTool: null,
        lastToolHint: null,
      };
      state.thinkingMsg = null;
      state.lastEditTime = 0;
    },
  );

  eventBus.on('session:error', async ({ sessionId, message }) => {
    const state = sessionState.get(sessionId);
    if (!state) return;

    if (state.thinkingMsg) {
      await state.thinkingMsg
        .edit(`⚠️ ${message}\n\n-# 💬 Reply to retry or rephrase`)
        .catch(() => {});
    }

    // Keep state alive for retry
    state.fullText = '';
    state.toolState = {
      counts: {},
      lastBash: null,
      lastTool: null,
      lastToolHint: null,
    };
    state.thinkingMsg = null;
    state.lastEditTime = 0;
  });
}

/**
 * Find an existing Discord thread for a session, or create a new one.
 *
 * @param {import('discord.js').Client} client
 * @param {string} channelId
 * @param {string} sessionId
 * @param {string} projectSlug
 * @param {string} prompt - First prompt (used as thread name)
 * @param {boolean} isNew - Whether this is a brand new session
 * @returns {Promise<import('discord.js').ThreadChannel|null>}
 */
async function resolveThread(
  client,
  channelId,
  sessionId,
  projectSlug,
  prompt,
  _isNew,
) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return null;

    // Check if a thread already exists for this session
    const existingMapping = getSessionMappingBySessionId(sessionId);
    if (existingMapping?.threadId) {
      try {
        const thread = await client.channels.fetch(existingMapping.threadId);
        if (thread) return thread;
      } catch {
        // Thread deleted — fall through to create a new one
      }
    }

    // Create a new thread
    const raw = prompt.trim().replace(/\s+/g, ' ');
    const threadName = raw.length > 50 ? `${raw.substring(0, 47)}…` : raw;

    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: 1440, // 24 hours
      reason: `Web UI session ${sessionId}`,
    });

    // Persist mapping
    saveSessionMapping(thread.id, {
      sessionId,
      channelId,
      projectSlug,
      userId: 'web-ui', // Not a Discord user
      threadName,
      createdAt: new Date().toISOString(),
      source: 'web-ui',
    });

    // Header message
    await thread.send(
      `🖥️ **Web UI session** — \`${sessionId.substring(0, 8)}…\`\n` +
        '-# Mirrored from Web UI · replies here continue the session',
    );

    return thread;
  } catch (err) {
    logger.error('[Discord Bridge] resolveThread error:', err);
    return null;
  }
}

/**
 * Edit the thinking message with new content.
 */
async function editMsg(state, content) {
  if (!state.thinkingMsg || !content) return;
  await state.thinkingMsg.edit(content).catch((err) => {
    logger.error('[Discord Bridge] Edit error:', err);
  });
}

/**
 * Format a user prompt as a bot message that's clearly flagged as Web UI input.
 * Truncates long prompts to keep Discord messages readable.
 *
 * @param {string} prompt
 * @returns {string}
 */
function formatUserPrompt(prompt) {
  const MAX = 1500;
  const text = prompt.trim();
  const truncated =
    text.length > MAX ? `${text.substring(0, MAX)}\n_…(truncated)_` : text;
  // Blockquote the content so it's visually distinct from bot responses
  const quoted = truncated
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `👤 **Web UI**\n${quoted}`;
}
