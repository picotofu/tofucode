/**
 * Event: answer_question
 *
 * Receives user's answers to an AskUserQuestion prompt from the frontend.
 * Resolves the pending Promise in prompt.js so the SDK stream can continue.
 *
 * @event answer_question
 * @param {Object} message - { toolUseId: string, answers: Record<string, string|string[]> }
 */

import { logger } from '../lib/logger.js';
import { send } from '../lib/ws.js';

// Map of toolUseId -> { resolve, reject, sessionId }
export const pendingQuestions = new Map();

/**
 * Handle answer_question WebSocket event
 */
export async function handler(ws, message, context) {
  const { toolUseId, answers } = message;

  logger.log(
    `[answer_question] Received handler call: toolUseId=${toolUseId}, answers=${JSON.stringify(answers)}`,
  );
  logger.log(
    `[answer_question] Pending questions: ${Array.from(pendingQuestions.keys()).join(', ')}`,
  );

  if (!toolUseId || !answers) {
    logger.log(
      '[answer_question] Invalid payload - missing toolUseId or answers',
    );
    send(ws, {
      type: 'error',
      message: 'Invalid answer_question payload',
      sessionId: context.currentSessionId,
    });
    return;
  }

  const pending = pendingQuestions.get(toolUseId);
  if (!pending) {
    logger.log(
      `[answer_question] No pending question found for toolUseId: ${toolUseId}`,
    );
    send(ws, {
      type: 'error',
      message: 'No pending question found for this toolUseId',
      sessionId: context.currentSessionId,
    });
    return;
  }

  logger.log(
    '[answer_question] Appending tool_result to session JSONL and resuming',
  );

  // Write tool_result to session JSONL file
  const { slugToPath } = await import('../config.js');
  const { appendFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  const projectPath = slugToPath(context.currentProjectPath);
  const claudeDir = join(projectPath, '.claude');
  const jsonlPath = join(claudeDir, `${pending.sessionId}.jsonl`);

  // Append tool_result as a user message
  const toolResultEntry = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(answers),
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: pending.sessionId,
  };

  appendFileSync(jsonlPath, `${JSON.stringify(toolResultEntry)}\n`, 'utf8');
  logger.log(`[answer_question] Appended tool_result to ${jsonlPath}`);

  // Trigger prompt handler to resume the session
  // Send a minimal prompt to continue - SDK will pick up tool_result from session
  const { handler: promptHandler } = await import('./prompt.js');
  await promptHandler(
    ws,
    {
      type: 'prompt',
      prompt: 'continue', // Minimal prompt to resume (empty string causes API error with cache_control)
      sessionId: pending.sessionId,
      projectPath: context.currentProjectPath,
    },
    context,
  );

  pendingQuestions.delete(toolUseId);
  logger.log(
    `[answer_question] Question ${toolUseId} answered and session resumed`,
  );
}
