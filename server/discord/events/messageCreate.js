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
  chunkMessage,
  formatError,
  formatResult,
  formatToolResult,
  formatToolUse,
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
  const toolLines = [];
  let lastEditTime = 0;
  let newSessionId = null;

  try {
    // Send "thinking" indicator
    thinkingMsg = await message.reply('Thinking...').catch((err) => {
      logger.error('[Discord] Reply error:', err);
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
            // Register new session
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
            // Only update if session ID actually changed
            updateSessionId(threadId, newSessionId);
          }
          break;
        }

        case 'text': {
          fullText += event.content;
          // Rate-limited edit (max every 1.5 seconds to stay within Discord limits)
          const now = Date.now();
          if (now - lastEditTime > discordConfig.streamingEditInterval) {
            lastEditTime = now;
            await editThinkingMessage(thinkingMsg, fullText, toolLines);
          }
          break;
        }

        case 'tool_use': {
          const formatted = formatToolUse(event);
          if (formatted) {
            toolLines.push(formatted);
            // Update display with tool info
            const now = Date.now();
            if (now - lastEditTime > discordConfig.streamingEditInterval) {
              lastEditTime = now;
              await editThinkingMessage(thinkingMsg, fullText, toolLines);
            }
          }
          break;
        }

        case 'tool_result': {
          const formatted = formatToolResult(event);
          if (formatted) {
            toolLines.push(formatted);
          }
          break;
        }

        case 'ask_user_question': {
          // Display the questions in Discord (informational, not interactive)
          const questionLines = event.questions.map((q) => {
            const optionList = q.options
              ?.map((o) => `  - ${o.label}`)
              .join('\n');
            return `**${q.question}**\n${optionList || ''}`;
          });
          toolLines.push(
            `> :question: **Question asked:**\n${questionLines.join('\n')}`,
          );
          break;
        }

        case 'result': {
          const summary = formatResult(event);
          // Final update with complete text
          const display = buildDisplayMessage(fullText, toolLines, summary);
          const chunks = chunkMessage(display);

          // Edit first chunk into the thinking message
          if (thinkingMsg && chunks[0]) {
            await thinkingMsg.edit(chunks[0]).catch((err) => {
              logger.error('[Discord] Edit error:', err);
            });

            // Send remaining chunks as new messages with small delay
            for (let i = 1; i < chunks.length; i++) {
              await thread.send(chunks[i]).catch((err) => {
                logger.error('[Discord] Send error:', err);
              });
            }
          }

          // Set session title from thread name (if new session)
          if (newSessionId && sessionMapping === null) {
            setSessionTitle(projectSlug, newSessionId, thread.name);
          }
          break;
        }

        case 'error': {
          if (thinkingMsg) {
            await thinkingMsg.edit(formatError(event.message)).catch((err) => {
              logger.error('[Discord] Edit error:', err);
            });
          }
          break;
        }

        case 'task_status': {
          // Show typing indicator while running
          if (event.status === 'running') {
            // Discord typing indicator (lasts 10 seconds)
            thread.sendTyping().catch(() => {});
          }
          // Clean up task from memory when completed/errored
          if (
            event.status === 'completed' ||
            event.status === 'error' ||
            event.status === 'cancelled'
          ) {
            if (newSessionId) {
              // Give a short delay before cleanup so cancel.js can still read status
              setTimeout(() => {
                const task = tasks.get(newSessionId);
                if (
                  task &&
                  (task.status === 'completed' || task.status === 'error')
                ) {
                  tasks.delete(newSessionId);
                }
              }, 30000); // Clean up after 30 seconds
            }
          }
          break;
        }
      }
    }

    // If no result event was yielded (edge case), do final edit
    if (fullText && lastEditTime > 0 && thinkingMsg) {
      const display = buildDisplayMessage(fullText, toolLines);
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
    // Release lock
    threadLocks.delete(threadId);
  }
}

/**
 * Edit the thinking message with current content, handling empty content gracefully.
 * @param {Message|null} thinkingMsg
 * @param {string} fullText
 * @param {string[]} toolLines
 */
async function editThinkingMessage(thinkingMsg, fullText, toolLines) {
  if (!thinkingMsg) return;
  const display = buildDisplayMessage(fullText, toolLines);
  if (!display) return; // Don't edit with empty string
  const chunks = chunkMessage(display);
  if (chunks[0]) {
    await thinkingMsg.edit(chunks[0]).catch((err) => {
      logger.error('[Discord] Edit error:', err);
    });
  }
}

/**
 * Build the composite display message from text, tool lines, and optional summary.
 * Returns null if all parts are empty (prevents Discord API error on empty edit).
 *
 * @param {string} text - Full response text
 * @param {string[]} toolLines - Array of formatted tool lines
 * @param {string} [summary] - Optional result summary
 * @returns {string|null} Complete display message, or null if empty
 */
function buildDisplayMessage(text, toolLines, summary = null) {
  const parts = [];
  if (toolLines.length > 0) {
    parts.push(toolLines.join('\n'));
  }
  if (text) {
    parts.push(text);
  }
  if (summary) {
    parts.push(summary);
  }
  const result = parts.join('\n\n');
  return result.length > 0 ? result : null;
}
