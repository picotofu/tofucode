/**
 * Event: prompt
 *
 * Execute a prompt using Claude Agent SDK.
 * Streams results back to the client as they arrive.
 *
 * @event prompt
 * @param {Object} message - { prompt: string, dangerouslySkipPermissions?: boolean }
 * @returns {void} Sends: task_status, session_info, text, tool_use, result, error
 *
 * @example
 * // Request
 * { type: 'prompt', prompt: 'Help me write a function', dangerouslySkipPermissions: false }
 *
 * // Response (streamed)
 * { type: 'task_status', taskId: '123', status: 'running', resultsCount: 1 }
 * { type: 'session_info', sessionId: 'abc-123', projectPath: '/home/...', isNew: true }
 * { type: 'text', content: 'Here is...', timestamp: '...' }
 * { type: 'tool_use', tool: 'Read', input: {...}, timestamp: '...' }
 * { type: 'result', subtype: 'success', result: '...', cost: 0.01, duration: 5000 }
 * { type: 'task_status', taskId: '123', status: 'completed', resultsCount: 10 }
 */

import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config, slugToPath } from '../config.js';
import { eventBus } from '../lib/event-bus.js';
import { logger } from '../lib/logger.js';
import { loadMcpServers } from '../lib/mcp.js';
import { dequeue, enqueue, getQueue } from '../lib/message-queue.js';
import { loadSettings } from '../lib/settings.js';
import { addTaskResult, getOrCreateTask, tasks } from '../lib/tasks.js';
import {
  broadcast,
  broadcastToSession,
  send,
  watchSession,
} from '../lib/ws.js';

// Emit to the event bus only when Discord sync is enabled in user settings.
// Reads settings fresh each call so toggling the setting takes effect immediately.
function discordEmit(event, payload) {
  const settings = loadSettings();
  if (settings.discordSyncEnabled) {
    eventBus.emit(event, payload);
  }
}

// Helper to send to client and broadcast to other session watchers.
// ws may be null when processing a queued message after the originating tab closed —
// in that case we broadcast to session watchers only (no direct send).
function sendAndBroadcast(ws, sessionId, message) {
  if (ws) {
    send(ws, message);
  }
  if (sessionId) {
    broadcastToSession(sessionId, message, ws);
  }
}

// Helper to broadcast task status to all clients
// Single broadcast reaches everyone - no need for separate send/broadcastToSession
function broadcastTaskStatus(sessionId, statusMessage) {
  const messageWithSession = { ...statusMessage, sessionId };
  broadcast(messageWithSession);
}

export async function handler(ws, message, context) {
  if (!context.currentProjectPath) {
    send(ws, { type: 'error', message: 'No project selected' });
    return;
  }

  // Check if the CURRENT session already has a running task.
  // If so, enqueue the prompt instead of rejecting it — it will be auto-processed
  // once the current task finishes.
  if (context.currentSessionId) {
    const existingTask = getOrCreateTask(context.currentSessionId);
    if (existingTask.status === 'running') {
      const result = enqueue(context.currentSessionId, message.prompt, {
        model: message.model,
        permissionMode: message.permissionMode,
        dangerouslySkipPermissions: message.dangerouslySkipPermissions,
      });
      if (!result.ok) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      const queue = getQueue(context.currentSessionId);
      // Broadcast to all session watchers — no excludeWs so the sender is included too.
      broadcastToSession(context.currentSessionId, {
        type: 'queue_updated',
        sessionId: context.currentSessionId,
        queue,
        size: queue.length,
      });
      return;
    }
  }

  const newSessionId = await executePrompt(
    ws,
    context.currentProjectPath,
    context.currentSessionId,
    message.prompt,
    {
      dangerouslySkipPermissions: message.dangerouslySkipPermissions,
      permissionMode: message.permissionMode,
      model: message.model,
    },
  );

  context.currentSessionId = newSessionId;
}

async function executePrompt(ws, projectSlug, sessionId, prompt, options = {}) {
  let taskSessionId = sessionId;

  // Convert slug to actual path for cwd
  const projectPath = slugToPath(projectSlug);

  // SECURITY: Validate that projectPath is within root (if --root is set)
  if (config.rootPath) {
    const resolvedProject = path.resolve(projectPath);
    const resolvedRoot = path.resolve(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedProject);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      if (ws) {
        send(ws, {
          type: 'error',
          message: `Access denied: project outside root (${config.rootPath})`,
        });
      }
      return sessionId; // Return current session unchanged
    }
  }

  // Determine permission mode
  // Valid modes: 'default', 'acceptEdits', 'bypassPermissions', 'plan', 'delegate', 'dontAsk'
  let permissionMode = config.permissionMode;
  let allowDangerouslySkipPermissions = false;

  if (options.dangerouslySkipPermissions) {
    permissionMode = 'bypassPermissions';
    allowDangerouslySkipPermissions = true;
  } else if (options.permissionMode === 'bypassPermissions') {
    permissionMode = 'bypassPermissions';
    allowDangerouslySkipPermissions = true;
  } else if (options.permissionMode) {
    permissionMode = options.permissionMode;
  }

  // Load MCP servers from CLI config (merged from user, project, local scopes)
  const mcpServers = loadMcpServers(projectPath);

  const queryOptions = {
    allowedTools: config.allowedTools,
    permissionMode,
    cwd: projectPath,
    allowDangerouslySkipPermissions,
    // Load all settings sources to match native CLI behavior:
    // - 'user': Global settings (~/.claude/settings.json)
    // - 'project': Project settings (.claude/settings.json) and CLAUDE.md files
    // - 'local': Local settings (.claude/settings.local.json)
    settingSources: ['user', 'project', 'local'],
    // Pass MCP servers if any are configured
    ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
  };

  // Set model if specified (sonnet, opus, haiku)
  // Map friendly names to specific model versions from config
  // SECURITY: Validate model string to prevent arbitrary values being sent to SDK
  if (options.model) {
    if (options.model === 'opus') {
      queryOptions.model = config.models.opus;
    } else if (options.model === 'sonnet') {
      queryOptions.model = config.models.sonnet;
    } else if (options.model === 'haiku') {
      queryOptions.model = config.models.haiku;
    } else if (/^claude-[a-z0-9-]+$/.test(options.model)) {
      // Only allow well-formed claude model strings (e.g., "claude-sonnet-4-5-20250929")
      queryOptions.model = options.model;
    } else {
      // Reject unknown/invalid model strings
      if (ws) {
        send(ws, {
          type: 'error',
          message: `Invalid model: "${options.model}". Use "opus", "sonnet", "haiku", or a valid claude-* model string.`,
        });
      }
      return sessionId;
    }
  }

  if (taskSessionId) {
    queryOptions.resume = taskSessionId;
    console.log(`Resuming session: ${taskSessionId}`);
  }

  console.log(
    `Starting prompt in ${projectPath} with permissionMode: ${queryOptions.permissionMode}, model: ${queryOptions.model || 'default'}`,
  );
  console.log('Received model from client:', options.model);
  console.log('Query options:', JSON.stringify(queryOptions, null, 2));

  // Initialize task
  const task = taskSessionId
    ? getOrCreateTask(taskSessionId)
    : {
        id: null,
        status: 'idle',
        results: [],
        error: null,
        startTime: null,
        abortController: null,
      };

  // Create AbortController for this task
  const abortController = new AbortController();

  task.id = Date.now().toString();
  task.status = 'running';
  // DON'T clear results - we want to keep the conversation history in memory
  // task.results = []
  task.error = null;
  task.startTime = Date.now();
  task.abortController = abortController;

  // Pass abort controller to SDK so it can actually cancel the API request
  queryOptions.abortController = abortController;

  // Add user message and send to client immediately (and broadcast to other watchers)
  const userMessage = {
    type: 'user',
    content: prompt,
    timestamp: new Date().toISOString(),
    sessionId: taskSessionId,
    permissionMode: options.permissionMode || 'default',
    dangerouslySkipPermissions: options.dangerouslySkipPermissions || false,
    model: options.model || null, // Track which model was used for this message
  };
  addTaskResult(task, userMessage);
  sendAndBroadcast(ws, taskSessionId, userMessage);

  broadcastTaskStatus(taskSessionId, {
    type: 'task_status',
    taskId: task.id,
    status: 'running',
    resultsCount: 1,
  });

  // Flag set when the task completes (result received) inside the stream loop.
  // processNextInQueue is deferred to after the loop exits to avoid a double-fire
  // race where the next queued task sets task.status='running' before the
  // post-loop fallback checks it, causing both messages to execute simultaneously.
  let shouldProcessQueue = false;

  let stream;
  try {
    console.log(
      `Calling SDK query() with prompt: "${prompt.substring(0, 50)}..."`,
    );
    stream = query({ prompt, options: queryOptions });
    task.stream = stream; // Store Query object for streamInput() access
    console.log('Query returned:', typeof stream, stream ? 'truthy' : 'falsy');
  } catch (error) {
    // Handle stream creation errors
    task.status = 'error';
    task.error = error.message;

    // Log detailed error information for stream creation
    console.error('\n========== Stream Creation Error ==========');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error object:', JSON.stringify(error, null, 2));
    console.error('Session ID:', taskSessionId);
    console.error('Project path:', projectPath);
    console.error('Query options:', JSON.stringify(queryOptions, null, 2));
    console.error('===========================================\n');

    // Determine user-friendly error message
    let userMessage = error.message;

    // Check for API errors
    if (
      error.message.includes('API Error: 500') ||
      error.message.includes('Internal server error')
    ) {
      userMessage =
        'Claude API is temporarily unavailable (500 Internal Server Error). This is usually a temporary issue - please try again in a few moments.';
    } else if (
      error.message.includes('API Error: 429') ||
      error.message.includes('rate limit')
    ) {
      userMessage =
        'Rate limit exceeded. Please wait a moment before trying again.';
    } else if (
      error.message.includes('API Error: 401') ||
      error.message.includes('authentication')
    ) {
      userMessage =
        'Authentication failed. Please check your ANTHROPIC_API_KEY environment variable.';
    } else if (error.message.includes('API Error: 400')) {
      userMessage = `Invalid request: ${error.message}`;
    } else {
      userMessage = `Failed to start query: ${error.message}`;
    }

    const errorResult = {
      type: 'error',
      message: userMessage,
      originalError: error.message, // Keep original for debugging
      timestamp: new Date().toISOString(),
      sessionId: taskSessionId,
    };
    addTaskResult(task, errorResult);
    sendAndBroadcast(ws, taskSessionId, errorResult);
    discordEmit('session:error', {
      projectPath,
      sessionId: taskSessionId,
      message: userMessage,
    });
    broadcastTaskStatus(taskSessionId, {
      type: 'task_status',
      taskId: task.id,
      status: 'error',
      resultsCount: task.results.length,
    });
    processNextInQueue(taskSessionId, projectSlug);
    return taskSessionId;
  }

  try {
    for await (const message of stream) {
      // Check if task was cancelled
      if (abortController.signal.aborted) {
        console.log(`Task ${task.id} was cancelled`);
        task.status = 'cancelled';
        broadcastTaskStatus(taskSessionId, {
          type: 'task_status',
          taskId: task.id,
          status: 'cancelled',
          resultsCount: task.results.length,
        });
        return taskSessionId;
      }

      console.log(
        `Received message type: ${message.type}`,
        message.subtype || '',
      );

      // Log any error messages from SDK
      if (message.type === 'error') {
        console.error('SDK Error message:', JSON.stringify(message, null, 2));
      }

      // Capture session ID from init message
      if (message.type === 'system' && message.subtype === 'init') {
        const newSessionId = message.session_id;
        if (newSessionId) {
          const isNewSession = !taskSessionId;
          if (isNewSession) {
            taskSessionId = newSessionId;
            tasks.set(taskSessionId, task);
            // Register this client as watching the new session
            watchSession(taskSessionId, ws);
          }
          if (ws) {
            send(ws, {
              type: 'session_info',
              sessionId: newSessionId,
              projectPath,
              isNew: isNewSession,
            });
          }
          discordEmit('session:start', {
            projectPath,
            sessionId: newSessionId,
            isNew: isNewSession,
            prompt,
          });

          // Note: No need to broadcast sessions_list here - clients will
          // refresh via getRecentSessions() when task_status changes
        }
      }

      // Process messages
      if (message.type === 'assistant') {
        const content = message.message?.content || [];
        // Extract model name from full model string (e.g., "claude-sonnet-4-6" -> "sonnet")
        let modelName = null;
        if (message.message?.model) {
          const fullModel = message.message.model;
          console.log('API returned model:', fullModel);
          if (fullModel.includes('opus')) {
            modelName = 'opus';
          } else if (fullModel.includes('haiku')) {
            modelName = 'haiku';
          } else if (fullModel.includes('sonnet')) {
            modelName = 'sonnet';
          }
          console.log('Extracted model name:', modelName);
        }

        for (const block of content) {
          if ('text' in block) {
            const result = {
              type: 'text',
              content: block.text,
              timestamp: new Date().toISOString(),
              sessionId: taskSessionId,
              model: modelName,
            };
            addTaskResult(task, result);
            sendAndBroadcast(ws, taskSessionId, result);
            discordEmit('session:text', {
              projectPath,
              sessionId: taskSessionId,
              content: block.text,
              model: modelName,
            });
          } else if ('name' in block) {
            const result = {
              type: 'tool_use',
              tool: block.name,
              input: block.input,
              id: block.id, // Include block ID for debugging
              timestamp: new Date().toISOString(),
              sessionId: taskSessionId,
              model: modelName,
            };
            addTaskResult(task, result);
            sendAndBroadcast(ws, taskSessionId, result);
            discordEmit('session:tool', {
              projectPath,
              sessionId: taskSessionId,
              tool: block.name,
              input: block.input,
            });

            // Signal frontend for AskUserQuestion - let stream continue
            // The user will answer later, and we'll handle it as a follow-up prompt
            if (
              block.name === 'AskUserQuestion' &&
              block.input?.questions?.length
            ) {
              sendAndBroadcast(ws, taskSessionId, {
                type: 'ask_user_question',
                toolUseId: block.id,
                questions: block.input.questions,
                sessionId: taskSessionId,
              });

              // Store the pending question
              const { pendingQuestions } = await import('./answer-question.js');
              pendingQuestions.set(block.id, {
                sessionId: taskSessionId,
                toolUseId: block.id,
                createdAt: Date.now(),
              });
              logger.log(
                `[prompt] Stored pending question ${block.id} for later answer`,
              );
            }
          } else {
            console.log(
              'Unhandled assistant content block:',
              JSON.stringify(block).substring(0, 200),
            );
          }
        }
      } else if (message.type === 'user') {
        // User messages contain tool results
        const msgContent = message.message?.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'tool_result') {
              const content =
                typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content
                        .map((c) => (c.type === 'text' ? c.text : ''))
                        .join('')
                    : '';
              const result = {
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                content,
                isError: block.is_error || false,
                timestamp: new Date().toISOString(),
                sessionId: taskSessionId,
              };
              addTaskResult(task, result);
              sendAndBroadcast(ws, taskSessionId, result);
            }
          }
        }
      } else if (message.type === 'result') {
        const result = {
          type: 'result',
          subtype: message.subtype,
          result: message.result,
          cost: message.total_cost_usd,
          duration: message.duration_ms,
          timestamp: new Date().toISOString(),
          sessionId: taskSessionId,
        };
        addTaskResult(task, result);
        sendAndBroadcast(ws, taskSessionId, result);
        discordEmit('session:result', {
          projectPath,
          sessionId: taskSessionId,
          subtype: message.subtype,
          cost: message.total_cost_usd,
          duration: message.duration_ms,
        });

        // Mark completed immediately on result — don't wait for the for-await loop to exit.
        // The SDK may keep the stream open briefly after emitting result (e.g. cleanup),
        // which causes the session to appear stuck in "running" state.
        // Mark completed but defer processNextInQueue to after the loop exits.
        // The SDK may keep the stream open briefly after emitting result (cleanup),
        // so we can't call processNextInQueue here — the next task would set
        // task.status='running' while this loop is still iterating, causing the
        // post-loop fallback to fire processNextInQueue a second time and run
        // two queued messages simultaneously.
        task.status = 'completed';
        task.stream = null;
        shouldProcessQueue = true;
        broadcastTaskStatus(taskSessionId, {
          type: 'task_status',
          taskId: task.id,
          status: 'completed',
          resultsCount: task.results.length,
        });
        console.log(`Task ${task.id} completed (result received)`);
      }
    }

    // Loop exited naturally.
    // Case 1: result message was received inside the loop (shouldProcessQueue=true, status='completed')
    //   → process queue now that the loop has fully exited (safe: no more iterations possible)
    // Case 2: stream ended without a result message (status still 'running')
    //   → mark completed and process queue
    // Case 3: abort signal fired (status='cancelled' or aborted after loop drain)
    //   → queue pauses on cancel
    if (shouldProcessQueue) {
      // Result was received — loop is now fully done, safe to process next queue item
      processNextInQueue(taskSessionId, projectSlug);
    } else if (task.status === 'running') {
      if (abortController.signal.aborted) {
        task.status = 'cancelled';
        task.stream = null;
        broadcastTaskStatus(taskSessionId, {
          type: 'task_status',
          taskId: task.id,
          status: 'cancelled',
          resultsCount: task.results.length,
        });
        console.log(`Task ${task.id} cancelled (stream ended after abort)`);
        // Queue pauses on cancel — do NOT call processNextInQueue
      } else {
        task.status = 'completed';
        task.stream = null;
        broadcastTaskStatus(taskSessionId, {
          type: 'task_status',
          taskId: task.id,
          status: 'completed',
          resultsCount: task.results.length,
        });
        console.log(`Task ${task.id} completed (stream ended without result)`);
        processNextInQueue(taskSessionId, projectSlug);
      }
    }
  } catch (error) {
    task.status = 'error';
    task.error = error.message;
    task.stream = null; // Release stream reference on error too

    // Log detailed error information
    console.error(`\n========== Task ${task.id} Error ==========`);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error object:', JSON.stringify(error, null, 2));
    if (error.cause) {
      console.error('Error cause:', error.cause);
    }
    console.error('Session ID:', taskSessionId);
    console.error('Project path:', projectPath);
    console.error('Permission mode:', queryOptions.permissionMode);
    console.error('Model:', queryOptions.model || 'default');
    console.error('==========================================\n');

    // Determine user-friendly error message
    let userMessage = error.message;

    // Check for API errors (500s, rate limits, etc.)
    if (
      error.message.includes('API Error: 500') ||
      error.message.includes('Internal server error')
    ) {
      userMessage =
        'Claude API is temporarily unavailable (500 Internal Server Error). This is usually a temporary issue - please try again in a few moments.';
    } else if (
      error.message.includes('API Error: 429') ||
      error.message.includes('rate limit')
    ) {
      userMessage =
        'Rate limit exceeded. Please wait a moment before trying again.';
    } else if (
      error.message.includes('API Error: 401') ||
      error.message.includes('authentication')
    ) {
      userMessage =
        'Authentication failed. Please check your ANTHROPIC_API_KEY environment variable.';
    } else if (error.message.includes('API Error: 400')) {
      userMessage = `Invalid request: ${error.message}`;
    } else if (error.message.includes('process exited with code')) {
      userMessage =
        'Claude Code process crashed unexpectedly. Check server logs for details.';
    }

    const errorResult = {
      type: 'error',
      message: userMessage,
      originalError: error.message, // Keep original for debugging
      timestamp: new Date().toISOString(),
      sessionId: taskSessionId,
    };
    addTaskResult(task, errorResult);
    sendAndBroadcast(ws, taskSessionId, errorResult);
    discordEmit('session:error', {
      projectPath,
      sessionId: taskSessionId,
      message: userMessage,
    });
    broadcastTaskStatus(taskSessionId, {
      type: 'task_status',
      taskId: task.id,
      status: 'error',
      resultsCount: task.results.length,
    });
    processNextInQueue(taskSessionId, projectSlug);
  }

  return taskSessionId;
}

/**
 * Dequeue and execute the next queued prompt for a session (if any).
 * Called after each task completes or errors — NOT after cancel (queue pauses on cancel).
 * ws is null so messages broadcast to session watchers only.
 */
function processNextInQueue(sessionId, projectSlug) {
  if (!sessionId) return;
  const next = dequeue(sessionId);
  if (!next) return;

  // Broadcast updated queue state (item was dequeued)
  const queue = getQueue(sessionId);
  broadcastToSession(sessionId, {
    type: 'queue_updated',
    sessionId,
    queue,
    size: queue.length,
  });

  console.log(
    `[queue] Processing next queued message for session ${sessionId}: "${next.prompt.substring(0, 50)}..."`,
  );

  executePrompt(null, projectSlug, sessionId, next.prompt, next.options).catch(
    (err) => {
      console.error(
        `[queue] Error processing queued message for session ${sessionId}:`,
        err,
      );
    },
  );
}
