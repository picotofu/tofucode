/**
 * Discord Prompt Executor
 *
 * Async generator that wraps the Claude Agent SDK query() call and yields
 * structured events for Discord consumption. This is the Discord equivalent
 * of server/events/prompt.js but without any WebSocket dependencies.
 *
 * Architecture: Discord -> executor.js -> SDK query() -> Claude API
 *                                |
 *                         Structured events
 *                                |
 *                         Discord formatter -> Discord API
 */

import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config, slugToPath } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { loadMcpServers } from '../../lib/mcp.js';
import { addTaskResult, getOrCreateTask, tasks } from '../../lib/tasks.js';

/**
 * Execute a prompt and yield structured events for Discord consumption.
 *
 * @param {Object} params
 * @param {string} params.projectSlug - Project slug from channel mapping
 * @param {string|null} params.sessionId - Existing session to resume, or null for new
 * @param {string} params.prompt - User's message text
 * @param {Object} [params.options] - { permissionMode, model }
 *
 * @yields {Object} events:
 *   { type: 'session_init', sessionId, isNew, projectPath }
 *   { type: 'text', content, model }
 *   { type: 'tool_use', tool, input, id, model }
 *   { type: 'tool_result', toolUseId, content, isError }
 *   { type: 'ask_user_question', toolUseId, questions }
 *   { type: 'result', subtype, result, cost, duration }
 *   { type: 'error', message }
 *   { type: 'task_status', status, taskId }
 */
export async function* executePrompt({
  projectSlug,
  sessionId,
  prompt,
  options = {},
}) {
  const projectPath = slugToPath(projectSlug);
  let taskSessionId = sessionId;

  // SECURITY: Validate that projectPath is within root (if --root is set)
  if (config.rootPath) {
    const resolvedProject = path.resolve(projectPath);
    const resolvedRoot = path.resolve(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedProject);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      yield {
        type: 'error',
        message: `Access denied: project outside root (${config.rootPath})`,
      };
      return;
    }
  }

  // Concurrent task guard: prevent double-prompting on the same session
  if (taskSessionId) {
    const existingTask = tasks.get(taskSessionId);
    if (existingTask?.status === 'running') {
      yield {
        type: 'error',
        message:
          'A task is already running on this session. Please wait for it to complete or cancel it first.',
      };
      return;
    }
  }

  // Determine permission mode (same logic as server/events/prompt.js)
  const permissionMode = options.permissionMode || config.permissionMode;
  const allowDangerouslySkipPermissions =
    permissionMode === 'bypassPermissions';

  // Load MCP servers
  const mcpServers = loadMcpServers(projectPath);

  const queryOptions = {
    allowedTools: config.allowedTools,
    permissionMode,
    cwd: projectPath,
    allowDangerouslySkipPermissions,
    settingSources: ['user', 'project', 'local'],
    ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
  };

  // Set model if specified — map shorthand names to full model strings via config
  if (options.model) {
    const modelKey = options.model; // e.g. 'opus', 'sonnet', 'haiku'
    queryOptions.model =
      config.models[modelKey] ??
      (options.model.startsWith('claude-') ? options.model : undefined);
  }

  // Resume session if sessionId provided
  if (taskSessionId) {
    queryOptions.resume = taskSessionId;
    logger.log(`[Discord] Resuming session: ${taskSessionId}`);
  }

  logger.log(
    `[Discord] Starting prompt in ${projectPath} with permissionMode: ${queryOptions.permissionMode}`,
  );

  // Initialize task tracking (reuses server/lib/tasks.js)
  const task = taskSessionId
    ? getOrCreateTask(taskSessionId)
    : {
        id: null,
        status: 'idle',
        results: [],
        error: null,
        startTime: null,
        abortController: null,
        stream: null,
      };

  const abortController = new AbortController();
  task.id = Date.now().toString();
  task.status = 'running';
  task.error = null;
  task.startTime = Date.now();
  task.abortController = abortController;
  queryOptions.abortController = abortController;

  // Add user message to task results (matches prompt.js behavior)
  const userMessage = {
    type: 'user',
    content: prompt,
    timestamp: new Date().toISOString(),
    sessionId: taskSessionId,
  };
  addTaskResult(task, userMessage);

  yield { type: 'task_status', status: 'running', taskId: task.id };

  let stream;
  try {
    stream = query({ prompt, options: queryOptions });
    task.stream = stream; // Store Query object for streamInput() access
  } catch (error) {
    task.status = 'error';
    task.error = error.message;
    logger.error('[Discord] Query creation error:', error);
    const errorResult = {
      type: 'error',
      message: mapApiError(error.message),
      timestamp: new Date().toISOString(),
    };
    addTaskResult(task, errorResult);
    yield errorResult;
    yield { type: 'task_status', status: 'error', taskId: task.id };
    return;
  }

  try {
    for await (const message of stream) {
      // Check if task was cancelled
      if (abortController.signal.aborted) {
        logger.log(`[Discord] Task ${task.id} was cancelled`);
        task.status = 'cancelled';
        yield { type: 'task_status', status: 'cancelled', taskId: task.id };
        return;
      }

      // Log SDK error messages
      if (message.type === 'error') {
        logger.error(
          '[Discord] SDK Error message:',
          JSON.stringify(message, null, 2),
        );
      }

      // Capture session ID from init message
      if (message.type === 'system' && message.subtype === 'init') {
        const newSessionId = message.session_id;
        if (newSessionId) {
          const isNew = !taskSessionId;
          if (isNew) {
            taskSessionId = newSessionId;
            tasks.set(taskSessionId, task);
          }
          yield {
            type: 'session_init',
            sessionId: newSessionId,
            isNew,
            projectPath,
          };
        }
      }

      // Process assistant messages
      if (message.type === 'assistant') {
        const content = message.message?.content || [];
        const modelName = extractModelName(message.message?.model);

        for (const block of content) {
          if ('text' in block) {
            const result = {
              type: 'text',
              content: block.text,
              model: modelName,
              timestamp: new Date().toISOString(),
            };
            addTaskResult(task, result);
            yield result;
          } else if ('name' in block) {
            const result = {
              type: 'tool_use',
              tool: block.name,
              input: block.input,
              id: block.id,
              model: modelName,
              timestamp: new Date().toISOString(),
            };
            addTaskResult(task, result);
            yield result;

            // Handle AskUserQuestion tool (matches prompt.js behavior)
            // Discord can't interactively answer, so we yield it for the handler
            // to display as an informational message
            if (
              block.name === 'AskUserQuestion' &&
              block.input?.questions?.length
            ) {
              yield {
                type: 'ask_user_question',
                toolUseId: block.id,
                questions: block.input.questions,
              };
            }
          } else {
            logger.log(
              '[Discord] Unhandled assistant content block:',
              JSON.stringify(block).substring(0, 200),
            );
          }
        }
      }

      // Process tool results
      if (message.type === 'user') {
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
              };
              addTaskResult(task, result);
              yield result;
            }
          }
        }
      }

      // Process result
      if (message.type === 'result') {
        const result = {
          type: 'result',
          subtype: message.subtype,
          result: message.result,
          cost: message.total_cost_usd,
          duration: message.duration_ms,
          timestamp: new Date().toISOString(),
        };
        addTaskResult(task, result);
        yield result;
      }
    }

    task.status = 'completed';
    task.stream = null; // Release stream reference to free memory
    yield { type: 'task_status', status: 'completed', taskId: task.id };
    logger.log(`[Discord] Task ${task.id} completed`);
  } catch (error) {
    task.status = 'error';
    task.error = error.message;
    task.stream = null; // Release stream reference on error too
    logger.error(`[Discord] Task ${task.id} error:`, error);
    const errorResult = {
      type: 'error',
      message: mapApiError(error.message),
      timestamp: new Date().toISOString(),
    };
    addTaskResult(task, errorResult);
    yield errorResult;
    yield { type: 'task_status', status: 'error', taskId: task.id };
  }
}

/**
 * Extract model name from full model string
 * @param {string} fullModel - e.g., "claude-sonnet-4-5-20250929"
 * @returns {string|null} - "opus" | "haiku" | "sonnet" | null
 */
function extractModelName(fullModel) {
  if (!fullModel) return null;
  if (fullModel.includes('opus')) return 'opus';
  if (fullModel.includes('haiku')) return 'haiku';
  if (fullModel.includes('sonnet')) return 'sonnet';
  return null;
}

/**
 * Map API error messages to user-friendly text
 * @param {string} message - Error message
 * @returns {string} User-friendly message
 */
function mapApiError(message) {
  if (
    message.includes('API Error: 500') ||
    message.includes('Internal server error')
  ) {
    return 'Claude API is temporarily unavailable (500 Internal Server Error). This is usually a temporary issue - please try again in a few moments.';
  }
  if (message.includes('API Error: 429') || message.includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment before trying again.';
  }
  if (
    message.includes('API Error: 401') ||
    message.includes('authentication')
  ) {
    return 'Authentication failed. Please check your ANTHROPIC_API_KEY environment variable.';
  }
  if (message.includes('API Error: 400')) {
    return `Invalid request: ${message}`;
  }
  if (message.includes('process exited with code')) {
    return 'Claude Code process crashed unexpectedly. Check server logs for details.';
  }
  return `Error: ${message}`;
}
