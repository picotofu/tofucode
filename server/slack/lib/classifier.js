/**
 * Slack Message Classifier
 *
 * Uses Claude (direct Anthropic SDK, NOT agent SDK) to classify incoming
 * Slack messages into actionable categories:
 *   - ignore    → message doesn't need a response
 *   - acknowledge → simple acknowledgement (got it, looking into it)
 *   - answer    → can be answered with available context
 *   - ticket    → needs tracking, create a Notion ticket
 *   - work      → requires code changes or investigation, start tofucode session
 *
 * Two-pass model strategy:
 *   1. Haiku  — always runs first (fast, cheap)
 *   2. Sonnet — escalated when Haiku signals low confidence, or when the
 *               action requires deeper reasoning (answer needing context
 *               gathering, work with uncertain project mapping, etc.)
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config, pathToSlug } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { setTitle } from '../../lib/session-titles.js';
import { loadNotionConfig } from '../../lib/task-providers/notion-config.js';
import { formatThreadContext } from './formatter.js';

/**
 * List available project directories under a root path
 * @param {string} rootPath
 * @returns {string[]} Array of project folder names
 */
function listProjects(rootPath) {
  if (!rootPath || !existsSync(rootPath)) return [];
  try {
    return readdirSync(rootPath).filter((name) => {
      if (name.startsWith('.')) return false;
      try {
        return statSync(join(rootPath, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Build the system prompt for classification
 * @param {Object} slackConfig - Slack bot config
 * @returns {string}
 */
function buildSystemPrompt(slackConfig) {
  const { identity, classifier = {}, projectRootPath } = slackConfig;

  // Enumerate available projects
  const projects = listProjects(projectRootPath);
  const projectsSection =
    projects.length > 0
      ? `\n\nAvailable projects (under ${projectRootPath}):\n${projects.map((p) => `- ${p}`).join('\n')}\nWhen returning "workProject", use the exact folder name from this list that best matches the work described.`
      : '';

  // Notion field mappings section — sourced from Notion config (independent of Slack config)
  const notionConfig = loadNotionConfig();
  const mappings = notionConfig.fieldMappings || [];
  const mappingsSection =
    mappings.length > 0
      ? `\n\nNotion field mappings for ticket creation:\n${mappings.map((m) => `- "${m.field}": ${m.purpose}`).join('\n')}`
      : '';

  // Allow full system prompt override — append dynamic sections
  if (classifier.systemPrompt) {
    return `${classifier.systemPrompt}${projectsSection}${mappingsSection}

You will analyze each Slack message and classify it into an action. Respond ONLY with a valid JSON object (no markdown code fences, no extra text).

Actions:
- "ignore" — Message doesn't need a response from you (ambient chatter, someone else's conversation, FYI messages, etc.)
- "acknowledge" — Simple acknowledgement needed (e.g., "Got it", "On it", "Thanks, noted")
- "answer" — You can answer the question or provide useful information
- "ticket" — The message describes work/feature/bug that should be tracked as a ticket
- "work" — The message explicitly asks you to implement, fix, or investigate something in code

Response JSON schema:
{
  "action": "ignore" | "acknowledge" | "answer" | "ticket" | "work",
  "confidence": "high" | "low",
  "needsContext": true | false,
  "response": "Your reply in Slack mrkdwn — required for all actions except ignore. Natural, varied tone — never robotic or templated.",
  "ticketTitle": "Short title for Notion ticket (only for ticket)",
  "ticketBody": "Detailed description for Notion ticket (only for ticket) — do NOT include a Slack thread link, it is appended automatically",
  "workProject": "Exact project folder name from the available projects list (only for work)",
  "workPrompt": "Detailed instructions for the work session (only for work)",
  "reasoning": "1-line reasoning for your classification"
}

Set confidence to "low" if you are unsure about the action, the project to work on, or the scope of the request.
Set needsContext to true if answering well would require looking up additional information (e.g. checking code, querying a database, reading docs).`;
  }

  const name = identity.name || 'the user';
  const role = identity.role || 'engineer';
  const tone = identity.tone || 'concise, professional';

  return `You are ${name}, a ${role}. You are responding to Slack messages on your own behalf.

Your communication style: ${tone}${projectsSection}${mappingsSection}

You will analyze each Slack message and classify it into an action. Respond ONLY with a valid JSON object (no markdown code fences, no extra text).

Actions:
- "ignore" — Message doesn't need a response from you (ambient chatter, someone else's conversation, FYI messages, etc.)
- "acknowledge" — Simple acknowledgement needed (e.g., "Got it", "On it", "Thanks, noted")
- "answer" — You can answer the question or provide useful information
- "ticket" — The message describes work/feature/bug that should be tracked as a ticket
- "work" — The message explicitly asks you to implement, fix, or investigate something in code

Classification guidelines:
- Default to "ignore" for messages that don't involve you or need your input
- Use "acknowledge" for messages directed at you that just need a brief response
- Use "answer" only when you have the knowledge to give a substantive reply
- Use "ticket" when someone reports a bug, requests a feature, or describes work that needs tracking
- Use "work" only when explicitly asked to do technical work (code, deploy, investigate a bug, etc.)
- When in doubt between "ignore" and "acknowledge", prefer "ignore"

Response guidelines:
- "response" is required for all actions except "ignore"
- Write as yourself — natural, human, in your own voice. Never sound like a bot or assistant.
- Vary your phrasing — avoid repeating the same openers or patterns across messages
- Keep it brief and direct — no filler words, no over-explanation
- For "ticket": confirm you've logged it, brief summary of what you understood, natural sign-off
- For "work": confirm you're on it, what you're about to do — no need to repeat the full brief

Response JSON schema:
{
  "action": "ignore" | "acknowledge" | "answer" | "ticket" | "work",
  "confidence": "high" | "low",
  "needsContext": true | false,
  "response": "Your reply in Slack mrkdwn — required for all actions except ignore",
  "ticketTitle": "Short title for Notion ticket (only for ticket)",
  "ticketBody": "Detailed description for Notion ticket (only for ticket) — do NOT include a Slack thread link, it is appended automatically",
  "workProject": "Exact project folder name from the available projects list (only for work)",
  "workPrompt": "Detailed instructions for the work session (only for work)",
  "reasoning": "1-line reasoning for your classification"
}

Set confidence to "low" if you are unsure about the action, the project to work on, or the scope of the request.
Set needsContext to true if answering well would require looking up additional information (e.g. checking code, querying a database, reading docs).`;
}

/**
 * Build the user prompt with message context
 * @param {Object} params
 * @param {Object} params.message - Slack event message
 * @param {Array} [params.threadHistory] - Thread messages for context
 * @param {Object} [params.channelInfo] - Channel metadata
 * @param {string} [params.senderName] - Display name of sender
 * @returns {string}
 */
function buildUserPrompt({ message, threadHistory, channelInfo, senderName }) {
  const parts = [];

  // Context: Channel
  if (channelInfo) {
    const channelName = channelInfo.name || channelInfo.id;
    parts.push(`[Channel: #${channelName}]`);
  }

  // Context: Thread history
  if (threadHistory?.length > 1) {
    parts.push(
      `[Thread history]\n${formatThreadContext(threadHistory.slice(0, -1))}`,
    );
  }

  // The actual message
  const sender = senderName || message.user || 'someone';
  parts.push(`[New message from ${sender}]\n${message.text || '(empty)'}`);

  return parts.join('\n\n');
}

/**
 * @typedef {Object} Classification
 * @property {'ignore'|'acknowledge'|'answer'|'ticket'|'work'} action
 * @property {'high'|'low'} [confidence] - Classifier confidence in the action
 * @property {boolean} [needsContext] - Whether deeper context lookup is needed
 * @property {string} [response] - Draft response (for acknowledge/answer)
 * @property {string} [ticketTitle] - Notion ticket title (for ticket)
 * @property {string} [ticketBody] - Notion ticket body (for ticket)
 * @property {string} [workProject] - Project slug (for work)
 * @property {string} [workPrompt] - Work session prompt (for work)
 * @property {string} [reasoning] - Classification reasoning
 */

/**
 * Determine whether a classification result should be escalated to Sonnet.
 * @param {Classification} result
 * @returns {boolean}
 */
function shouldEscalateToSonnet(result) {
  // Always escalate low confidence (treat missing confidence as low to be safe)
  const confidence = result.confidence ?? 'low';
  if (confidence === 'low') return true;
  // Escalate answers that need context gathering
  if (result.action === 'answer' && result.needsContext) return true;
  // Escalate work actions that need context (uncertain project mapping, etc.)
  if (result.action === 'work' && result.needsContext) return true;
  return false;
}

/**
 * Run a single classification pass against a model.
 * Uses the agent SDK query() (handles OAuth auth automatically).
 * No tools. If sessionLogPath is set, persists session JSONL to that path
 * (readable in tofucode web UI). Otherwise runs ephemeral with no disk writes.
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string|null} sessionLogPath
 * @returns {Promise<{ classification: Classification, sessionId: string|null }>}
 */
async function runClassification(
  model,
  systemPrompt,
  userPrompt,
  sessionLogPath,
) {
  const modelSlug = config.models[model] ?? model;

  const stream = query({
    prompt: userPrompt,
    options: {
      model: modelSlug,
      allowedTools: [],
      permissionMode: 'default',
      systemPrompt,
      persistSession: !!sessionLogPath,
      ...(sessionLogPath ? { cwd: sessionLogPath } : {}),
    },
  });

  let text = '';
  let sessionId = null;
  for await (const message of stream) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id ?? null;
    }
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if ('text' in block) text += block.text;
      }
    }
  }

  return { classification: parseClassification(text), sessionId };
}

/**
 * Build a human-readable session title from classification context.
 * Format: [#channel] action: message snippet
 * @param {Classification} classification
 * @param {Object} [channelInfo]
 * @param {string} messageText
 * @returns {string}
 */
function buildSessionTitle(classification, channelInfo, messageText) {
  const channel = channelInfo?.name
    ? `#${channelInfo.name}`
    : channelInfo?.id
      ? `#${channelInfo.id}`
      : '#slack';
  const snippet = (messageText || '').substring(0, 60).trim();
  const ellipsis = messageText?.length > 60 ? '…' : '';
  return `[${channel}] ${classification.action}: ${snippet}${ellipsis}`;
}

/**
 * Assign a session title to a persisted classifier session.
 * @param {string} sessionId
 * @param {string} sessionLogPath
 * @param {string} title
 */
function assignSessionTitle(sessionId, sessionLogPath, title) {
  if (!sessionId || !sessionLogPath) return;
  try {
    const slug = pathToSlug(sessionLogPath);
    setTitle(slug, sessionId, title);
    logger.log(
      `[Slack Classifier] Session title set: "${title}" (${sessionId})`,
    );
  } catch (err) {
    logger.warn('[Slack Classifier] Could not set session title:', err.message);
  }
}

/**
 * Classify a Slack message.
 * Uses Haiku first; escalates to Sonnet if confidence is low or context is needed.
 * @param {Object} params
 * @param {Object} params.message - Slack event message
 * @param {Array} [params.threadHistory] - Thread messages
 * @param {Object} [params.channelInfo] - Channel metadata
 * @param {string} [params.senderName] - Sender display name
 * @param {Object} params.config - Slack bot config
 * @returns {Promise<Classification>}
 */
export async function classifyMessage({
  message,
  threadHistory,
  channelInfo,
  senderName,
  config: slackConfig,
}) {
  const sessionLogPath = slackConfig.sessionLogPath || null;
  const systemPrompt = buildSystemPrompt(slackConfig);
  const userPrompt = buildUserPrompt({
    message,
    threadHistory,
    channelInfo,
    senderName,
  });

  try {
    // Pass 1: Haiku (fast, cheap)
    const { classification: initial, sessionId: haikusSessionId } =
      await runClassification(
        'haiku',
        systemPrompt,
        userPrompt,
        sessionLogPath,
      );

    // Pass 2: Sonnet (escalate if needed)
    if (shouldEscalateToSonnet(initial)) {
      logger.info(
        `[Slack Classifier] Escalating to Sonnet — action=${initial.action} confidence=${initial.confidence} needsContext=${initial.needsContext}`,
      );
      try {
        const { classification: escalated, sessionId: sonnetSessionId } =
          await runClassification(
            'sonnet',
            systemPrompt,
            userPrompt,
            sessionLogPath,
          );
        const title = buildSessionTitle(
          escalated,
          channelInfo,
          message.text || '',
        );
        assignSessionTitle(sonnetSessionId, sessionLogPath, title);
        // Also title the Haiku session so both are identifiable in the UI
        assignSessionTitle(
          haikusSessionId,
          sessionLogPath,
          `${title} [haiku→sonnet]`,
        );
        return escalated;
      } catch (err) {
        logger.warn(
          '[Slack Classifier] Sonnet escalation failed, using Haiku result:',
          err.message,
        );
        const title = buildSessionTitle(
          initial,
          channelInfo,
          message.text || '',
        );
        assignSessionTitle(haikusSessionId, sessionLogPath, title);
        return initial;
      }
    }

    const title = buildSessionTitle(initial, channelInfo, message.text || '');
    assignSessionTitle(haikusSessionId, sessionLogPath, title);
    return initial;
  } catch (err) {
    logger.error('[Slack Classifier] Error:', err.message);
    return {
      action: 'ignore',
      reasoning: `Classification error: ${err.message}`,
    };
  }
}

/**
 * Parse classifier JSON response
 * @param {string} text - Raw response text
 * @returns {Classification}
 */
function parseClassification(text) {
  try {
    // Extract JSON: find first '{' and attempt to parse from there.
    // Using substring from first '{' handles code fences and preamble text
    // without a greedy regex that can grab unintended trailing content.
    const start = text.indexOf('{');
    if (start === -1) {
      logger.warn('[Slack Classifier] No JSON found in response:', text);
      return { action: 'ignore', reasoning: 'Failed to parse classification' };
    }

    // Find matching closing brace to handle trailing text after the JSON object
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      logger.warn(
        '[Slack Classifier] Could not find closing brace in response:',
        text.substring(0, 200),
      );
      return { action: 'ignore', reasoning: 'Failed to parse classification' };
    }

    const parsed = JSON.parse(text.substring(start, end + 1));

    // Validate action
    const validActions = ['ignore', 'acknowledge', 'answer', 'ticket', 'work'];
    if (!validActions.includes(parsed.action)) {
      logger.warn(
        `[Slack Classifier] Invalid action "${parsed.action}", defaulting to ignore`,
      );
      return {
        action: 'ignore',
        reasoning: `Invalid action: ${parsed.action}`,
      };
    }

    return parsed;
  } catch (err) {
    logger.warn('[Slack Classifier] JSON parse error:', err.message, text);
    return { action: 'ignore', reasoning: 'JSON parse error' };
  }
}
