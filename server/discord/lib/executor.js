/**
 * Discord Prompt Executor
 *
 * Async generator that wraps the Claude Agent SDK query() call and yields
 * structured events for Discord consumption. This is the Discord equivalent
 * of server/events/prompt.js but without any WebSocket dependencies.
 *
 * Architecture: Discord → executor.js → SDK query() → Claude API
 *                                ↓
 *                         Structured events
 *                                ↓
 *                         Discord formatter → Discord API
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
 *   { type: 'session_init', sessionId, isNew }
 *   { type: 'text', content, model }
 *   { type: 'tool_use', tool, input, id, model }
 *   { type: 'tool_result', toolUseId, content, isError }
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
  // Same check as server/events/prompt.js lines 94-106
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

  // Determine permission mode (same logic as server/events/prompt.js lines 110-121)
  const permissionMode = options.permissionMode || config.permissionMode;
  const allowDangerouslySkipPermissions =
    permissionMode === 'bypassPermissions';

  // Load MCP servers (same as server/events/prompt.js lines 124-138)
  const mcpServers = loadMcpServers(projectPath);

  const queryOptions = {
    allowedTools: config.allowedTools,
    permissionMode,
    cwd: projectPath,
    allowDangerouslySkipPermissions,
    settingSources: ['user', 'project', 'local'],
    ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
  };

  // Set model if specified (opus defaults to 4.6, same as server/events/prompt.js lines 142-145)
  if (options.model) {
    queryOptions.model =
      options.model === 'opus' ? 'claude-opus-4-6' : options.model;
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
  // Same as server/events/prompt.js lines 159-182
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

  const abortController = new AbortController();
  task.id = Date.now().toString();
  task.status = 'running';
  task.error = null;
  task.startTime = Date.now();
  task.abortController = abortController;
  queryOptions.abortController = abortController;

  yield { type: 'task_status', status: 'running', taskId: task.id };

  let stream;
  try {
    stream = query({ prompt, options: queryOptions });
  } catch (error) {
    task.status = 'error';
    task.error = error.message;
    logger.error('[Discord] Query creation error:', error);
    yield { type: 'error', message: mapApiError(error.message) };
    yield { type: 'task_status', status: 'error' };
    return;
  }

  try {
    for await (const message of stream) {
      // Check if task was cancelled
      if (abortController.signal.aborted) {
        logger.log(`[Discord] Task ${task.id} was cancelled`);
        task.status = 'cancelled';
        yield { type: 'task_status', status: 'cancelled' };
        return;
      }

      // Capture session ID from init message (same as server/events/prompt.js lines 298-317)
      if (message.type === 'system' && message.subtype === 'init') {
        const newSessionId = message.session_id;
        if (newSessionId) {
          const isNew = !taskSessionId;
          if (isNew) {
            taskSessionId = newSessionId;
            tasks.set(taskSessionId, task);
          }
          yield { type: 'session_init', sessionId: newSessionId, isNew };
        }
      }

      // Process assistant messages (same as server/events/prompt.js lines 320-366)
      if (message.type === 'assistant') {
        const content = message.message?.content || [];
        const modelName = extractModelName(message.message?.model);

        for (const block of content) {
          if ('text' in block) {
            const result = {
              type: 'text',
              content: block.text,
              model: modelName,
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
            };
            addTaskResult(task, result);
            yield result;
          }
        }
      }

      // Process tool results (same as server/events/prompt.js lines 367-391)
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
              };
              addTaskResult(task, result);
              yield result;
            }
          }
        }
      }

      // Process result (same as server/events/prompt.js lines 394-406)
      if (message.type === 'result') {
        const result = {
          type: 'result',
          subtype: message.subtype,
          result: message.result,
          cost: message.total_cost_usd,
          duration: message.duration_ms,
        };
        addTaskResult(task, result);
        yield result;
      }
    }

    task.status = 'completed';
    yield { type: 'task_status', status: 'completed' };
    logger.log(`[Discord] Task ${task.id} completed`);
  } catch (error) {
    task.status = 'error';
    task.error = error.message;
    logger.error(`[Discord] Task ${task.id} error:`, error);
    yield { type: 'error', message: mapApiError(error.message) };
    yield { type: 'task_status', status: 'error' };
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
 * Same as server/events/prompt.js lines 229-252 and 439-462
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
  return `Error: ${message}`;
}
