/**
 * Discord Message Handler
 *
 * Routes messages based on whether they are in a thread or parent channel.
 * Thread messages -> execute prompt via SDK
 * Parent channel messages -> redirect to create thread
 */

import { logger } from '../../lib/logger.js';
import { tasks } from '../../lib/tasks.js';
import { discordConfig, getChannelMapping } from '../config.js';
import { executePrompt } from '../lib/executor.js';
import {
  accumulateToolUse,
  chunkMessage,
  formatError,
  formatFooter,
  formatToolResult,
  formatToolStatus,
} from '../lib/formatter.js';
import {
  getSession,
  registerSession,
  setSessionTitle,
  updateSessionId,
} from '../lib/sessions.js';

// Per-thread lock to prevent concurrent prompts in same thread
const threadLocks = new Map();

/**
 * Handle incoming Discord messages.
 *
 * Rules:
 * 1. Ignore bot messages
 * 2. If in a thread: execute prompt against mapped session
 * 3. If in parent channel: tell user to create a thread
 *
 * @param {Message} message - discord.js Message object
 */
export async function handleMessage(message) {
  // Ignore bots
  if (message.author.bot) return;

  // Guild restriction
  if (discordConfig.guildId && message.guild?.id !== discordConfig.guildId) {
    return;
  }

  // Guard against empty message content
  if (!message.content || message.content.trim().length === 0) {
    return;
  }

  const channel = message.channel;

  // Check if this is a thread
  if (channel.isThread()) {
    await handleThreadMessage(message);
  } else {
    // Parent channel message - check if channel is mapped
    const mapping = getChannelMapping(channel.id);
    if (mapping) {
      await message
        .reply(
          'Please create a thread to start a new session.\n\n' +
            '**How to create a thread:**\n' +
            '• Right-click this message -> "Create Thread"\n' +
            '• Or click the thread button below this message\n' +
            "• Or use Discord's thread creation UI\n\n" +
            'Each thread = one Claude Code session.',
        )
        .catch((err) => logger.error('[Discord] Reply error:', err));
    }
    // If channel is not mapped, ignore silently
  }
}

/**
 * Handle message in a thread (execute prompt)
 * @param {Message} message
 */
async function handleThreadMessage(message) {
  const thread = message.channel;
  const threadId = thread.id;
  const parentChannelId = thread.parentId;

  // Check for concurrent execution lock
  if (threadLocks.get(threadId)) {
    await message
      .reply(
        'A task is already running in this thread. Wait for it to finish or use `/cancel`.',
      )
      .catch((err) => logger.error('[Discord] Reply error:', err));
    return;
  }

  // Look up channel-project mapping
  const channelMapping = getChannelMapping(parentChannelId);
  if (!channelMapping) {
    await message
      .reply(
        'This channel is not configured. Use `/setup` in the parent channel first.',
      )
      .catch((err) => logger.error('[Discord] Reply error:', err));
    return;
  }

  const { projectSlug } = channelMapping;

  // Look up thread-session mapping
  const sessionMapping = getSession(threadId);
  const sessionId = sessionMapping?.sessionId ?? null;

  // Lock this thread
  threadLocks.set(threadId, true);

  let thinkingMsg = null;
  let fullText = '';
  const toolState = {
    counts: {},
    lastBash: null,
    lastTool: null,
    lastToolHint: null,
  };
  const errorLines = []; // tool errors shown inline in response
  let lastEditTime = 0;
  let newSessionId = null;
  const isFirstMessage = sessionId === null; // true when this opens a new session

  try {
    // Send "thinking" indicator — use thread.send instead of message.reply
    // to avoid Discord quoting the user's message above every bot response
    thinkingMsg = await thread.send('⏳ Thinking…').catch((err) => {
      logger.error('[Discord] Send error:', err);
      return null;
    });

    const events = executePrompt({
      projectSlug,
      sessionId,
      prompt: message.content,
    });

    for await (const event of events) {
      switch (event.type) {
        case 'session_init': {
          newSessionId = event.sessionId;
          if (event.isNew) {
            registerSession(threadId, {
              sessionId: newSessionId,
              channelId: parentChannelId,
              projectSlug,
              userId: message.author.id,
              threadName: thread.name,
            });
            logger.log(
              `[Discord] New session registered: ${newSessionId} for thread ${threadId}`,
            );
          } else if (
            newSessionId !== sessionId &&
            sessionMapping?.sessionId !== newSessionId
          ) {
            updateSessionId(threadId, newSessionId);
          }
          break;
        }

        case 'text': {
          fullText += event.content;
          // Rate-limited streaming edit
          const now = Date.now();
          if (now - lastEditTime > discordConfig.streamingEditInterval) {
            lastEditTime = now;
            await editThinkingMessage(
              thinkingMsg,
              fullText,
              toolState,
              errorLines,
            );
          }
          break;
        }

        case 'tool_use': {
          accumulateToolUse(toolState, event);
          // Update status line while no text yet, or rate-limited
          const now = Date.now();
          if (now - lastEditTime > discordConfig.streamingEditInterval) {
            lastEditTime = now;
            await editThinkingMessage(
              thinkingMsg,
              fullText,
              toolState,
              errorLines,
            );
          }
          break;
        }

        case 'tool_result': {
          // Only capture errors — surfaced inline above the AI response
          const formatted = formatToolResult(event);
          if (formatted) errorLines.push(formatted);
          break;
        }

        case 'ask_user_question': {
          // Informational only — Claude is asking itself / the user in web UI
          const questionLines = event.questions.map((q) => {
            const optionList = q.options?.map((o) => `· ${o.label}`).join('\n');
            return `**${q.question}**\n${optionList || ''}`;
          });
          errorLines.push(`> ❓ ${questionLines.join('\n')}`);
          break;
        }

        case 'result': {
          const isSuccess = event.subtype === 'success';
          const footer = formatFooter(toolState, event);

          // Build display — fall back to footer alone if no text (avoids stuck 'Thinking…')
          const display =
            buildDisplayMessage(fullText, errorLines, footer) || footer;
          const chunks = chunkMessage(display);

          if (thinkingMsg) {
            if (chunks[0]) {
              await thinkingMsg.edit(chunks[0]).catch((err) => {
                logger.error('[Discord] Edit error:', err);
              });
            }
            for (let i = 1; i < chunks.length; i++) {
              await thread.send(chunks[i]).catch((err) => {
                logger.error('[Discord] Send error:', err);
              });
            }
          }

          // Send a final message so Discord notifies the user even if they
          // closed the thread — edits to the thinking message don't trigger notifications
          const doneLabel = isSuccess ? '✅ Done' : '⚠️ Done with errors';
          await thread.send(doneLabel).catch((err) => {
            logger.error('[Discord] Send error:', err);
          });

          if (newSessionId && sessionMapping === null) {
            setSessionTitle(projectSlug, newSessionId, thread.name);
          }

          // Item 2: auto-rename thread from first message content
          if (isFirstMessage && newSessionId) {
            const raw = message.content.trim().replace(/\s+/g, ' ');
            const name = raw.length > 50 ? `${raw.substring(0, 47)}…` : raw;
            thread.setName(name).catch(() => {}); // best-effort
          }
          break;
        }

        case 'error': {
          if (thinkingMsg) {
            // Item 5: retry hint on error
            const errMsg = `${formatError(event.message)}\n\n-# 💬 Reply to retry or rephrase`;
            await thinkingMsg.edit(errMsg).catch((err) => {
              logger.error('[Discord] Edit error:', err);
            });
          }
          break;
        }

        case 'task_status': {
          if (event.status === 'running') {
            thread.sendTyping().catch(() => {});
          }
          if (
            event.status === 'completed' ||
            event.status === 'error' ||
            event.status === 'cancelled'
          ) {
            if (newSessionId) {
              setTimeout(() => {
                const task = tasks.get(newSessionId);
                if (
                  task &&
                  (task.status === 'completed' || task.status === 'error')
                ) {
                  tasks.delete(newSessionId);
                }
              }, 30000);
            }
          }
          break;
        }
      }
    }

    // Edge case: no result event yielded
    if (fullText && lastEditTime > 0 && thinkingMsg) {
      const display = buildDisplayMessage(fullText, errorLines);
      const chunks = chunkMessage(display);
      if (chunks[0]) {
        await thinkingMsg.edit(chunks[0]).catch((err) => {
          logger.error('[Discord] Edit error:', err);
        });
        for (let i = 1; i < chunks.length; i++) {
          await thread.send(chunks[i]).catch((err) => {
            logger.error('[Discord] Send error:', err);
          });
        }
      }
    }
  } catch (err) {
    logger.error('[Discord] Message handler error:', err);
    if (thinkingMsg) {
      await thinkingMsg
        .edit(formatError('An unexpected error occurred. Check server logs.'))
        .catch(() => {});
    }
  } finally {
    threadLocks.delete(threadId);
  }
}

/**
 * Edit the thinking message during streaming.
 *
 * While tools are running but no text yet: shows a dynamic tool status line.
 * Once text starts flowing: shows the text (tool noise disappears).
 *
 * @param {Message|null} thinkingMsg
 * @param {string} fullText
 * @param {Object} toolState - Accumulator from accumulateToolUse
 * @param {string[]} errorLines - Tool error lines to show above response
 */
async function editThinkingMessage(
  thinkingMsg,
  fullText,
  toolState,
  errorLines,
) {
  if (!thinkingMsg) return;

  let display;
  if (!fullText) {
    // No response text yet — show live tool status
    display = formatToolStatus(toolState);
  } else {
    // Text is flowing — show partial response (errors above, no footer yet)
    display = buildDisplayMessage(fullText, errorLines);
  }

  if (!display) return;
  const chunks = chunkMessage(display);
  if (chunks[0]) {
    await thinkingMsg.edit(chunks[0]).catch((err) => {
      logger.error('[Discord] Edit error:', err);
    });
  }
}

/**
 * Build the final display message.
 *
 * Layout:
 *   [error lines if any]
 *
 *   [AI response text]
 *
 *   [footer: tool summary + result status]
 *
 * @param {string} text - AI response text
 * @param {string[]} errorLines - Tool errors or questions (shown above response)
 * @param {string} [footer] - Footer line (tool summary + result)
 * @returns {string|null}
 */
function buildDisplayMessage(text, errorLines, footer = null) {
  const parts = [];
  if (errorLines.length > 0) parts.push(errorLines.join('\n'));
  if (text) parts.push(text);
  if (footer) parts.push(footer);
  const result = parts.join('\n\n');
  return result.length > 0 ? result : null;
}
