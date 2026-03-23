/**
 * Slack Message Classifier
 *
 * Uses Claude (agent SDK) to classify incoming Slack messages into actionable
 * categories:
 *   - ignore      → message doesn't need a response
 *   - acknowledge → FYI directly to you, no action needed
 *   - answer      → question that needs investigation, then responds with the answer
 *   - ticket      → anything requiring action/tracking — creates a [BOT]-prefixed Notion ticket
 *
 * Two-tier model strategy:
 *   1. Haiku  — always runs first (fast, cheap, no tools): classifies the obvious majority
 *   2. Sonnet — escalated for: low confidence, answer+needsContext, and all tickets.
 *               Uses Grep/Glob/Read to investigate the codebase before classifying or answering.
 *               For tickets: always runs to produce a rich, actionable ticketBody.
 *               Max turns configurable via config.classifier.maxTriageTurns.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { config, pathToSlug } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { setTitle } from '../../lib/session-titles.js';
import { loadNotionConfig } from '../../lib/task-providers/notion-config.js';

/**
 * Build the system prompt for classification
 * @param {Object} slackConfig - Slack bot config
 * @returns {string}
 */
function buildSystemPrompt(slackConfig) {
  const { identity, classifier = {} } = slackConfig;

  // Notion field mappings section — sourced from Notion config (independent of Slack config)
  const notionConfig = loadNotionConfig();
  const mappings = notionConfig.fieldMappings || [];
  const mappingsSection =
    mappings.length > 0
      ? `\n\nNotion field mappings for ticket creation:\n${mappings.map((m) => `- "${m.field}": ${m.purpose}`).join('\n')}`
      : '';

  // Allow full system prompt override — append dynamic sections
  if (classifier.systemPrompt) {
    return `${classifier.systemPrompt}${mappingsSection}

You will analyze each Slack message and classify it into an action. Respond ONLY with a valid JSON object wrapped in a \`\`\`json code fence. No extra text outside the fence.

Actions:
- "ignore" — Message doesn't need a response from you (ambient chatter, someone else's conversation, FYI messages, etc.)
- "acknowledge" — FYI directly to you, no action needed — just a brief natural reply
- "answer" — A question or request that you can respond to with information or investigation
- "ticket" — Anything requiring tracking or action (bug, feature, work request, investigation, etc.)

Response JSON schema:
{
  "action": "ignore" | "acknowledge" | "answer" | "ticket",
  "confidence": "high" | "low",
  "needsContext": true | false,
  "response": "Your reply in Slack mrkdwn — required for acknowledge/answer/ticket. One short line for acknowledge. Lead with the answer for answer. For ticket, omit — reply is handled automatically.",
  "ticketTitle": "Short title for Notion ticket (only for ticket, without [BOT] prefix)",
  "ticketBody": "Self-contained brief for the ticket — what needs to be done, where in the codebase, suggested approach if clear. Do NOT include a Slack thread link, it is appended automatically.",
  "reasoning": "1-line reasoning for your classification"
}

Set confidence to "low" if you are unsure about the action or scope.
Set needsContext to true if answering well would require looking up additional information (e.g. checking code, querying a database, reading docs).`;
  }

  const name = identity.name || 'the user';
  const role = identity.role || 'engineer';
  const tone = identity.tone || 'concise, professional';

  return `You are ${name}, a ${role}. You are responding to Slack messages on your own behalf.

Your communication style: ${tone}${mappingsSection}

You will analyze each Slack message and classify it into an action. Respond ONLY with a valid JSON object wrapped in a \`\`\`json code fence. No extra text outside the fence.

Actions:
- "ignore" — Message doesn't need a response from you (ambient chatter, someone else's conversation, FYI messages not directed at you, etc.)
- "acknowledge" — FYI directly to you, no action needed — just a brief natural reply
- "answer" — A question or request that you can respond to with information (may need investigation first)
- "ticket" — Anything requiring tracking or action: bugs, feature requests, work requests, investigations, anything that needs to be logged and followed up

Classification guidelines:
- Default to "ignore" for messages that don't involve you or don't need your input
- Use "acknowledge" only for FYIs sent directly to you where no further action is needed
- Use "answer" when someone asks you a question you can actually answer (with or without looking things up)
- Use "ticket" for anything that requires action, tracking, or follow-up — including work requests, bugs, feature requests
- When in doubt between "ignore" and "acknowledge", prefer "ignore"
- When in doubt between "acknowledge" and "ticket", prefer "ticket"

Response guidelines:
- Write exactly as you would in a real Slack message — lowercase, casual, no punctuation if not needed
- Never sound like an assistant or a bot. No "Sure!", "Got it!", "Noted!", "Certainly" — ever.
- For "acknowledge": one short line only — vary it every time. e.g. "noted", "yep", "👍", "sounds good", "k", "sure", "ok", "will do" — match the tone of the message
- For "answer": answer directly, no preamble. Lead with the answer, not "Great question" or "Sure, here's..."
- For "ticket": omit "response" — the reply is handled automatically
- For "ignore": omit "response"

Response JSON schema:
{
  "action": "ignore" | "acknowledge" | "answer" | "ticket",
  "confidence": "high" | "low",
  "needsContext": true | false,
  "response": "Your reply — required for acknowledge/answer only",
  "ticketTitle": "Short title for Notion ticket (only for ticket, without [BOT] prefix)",
  "ticketBody": "Self-contained brief for the ticket — what needs to be done, where in the codebase, suggested approach if clear. Do NOT include a Slack thread link, it is appended automatically.",
  "reasoning": "1-line reasoning for your classification"
}

Set confidence to "low" if you are unsure about the action or scope.
Set needsContext to true if answering well would require looking up additional information (e.g. checking code, reading a config, querying a database).`;
}

/**
 * Build the user prompt with message context
 * @param {Object} params
 * @param {Object} params.message - Slack event (text may be debounce-combined)
 * @param {Object} [params.channelInfo] - Channel metadata
 * @param {string} [params.senderName] - Display name of sender
 * @returns {string}
 */
function buildUserPrompt({ message, channelInfo, senderName }) {
  const parts = [];

  // Context: Channel
  if (channelInfo) {
    const channelName = channelInfo.name || channelInfo.id;
    parts.push(`[Channel: #${channelName}]`);
  }

  // The message — may be debounce-combined text from multiple rapid sends
  const sender = senderName || message.user || 'someone';
  parts.push(`[Message from ${sender}]\n${message.text || '(empty)'}`);

  return parts.join('\n\n');
}

/**
 * @typedef {Object} Classification
 * @property {'ignore'|'acknowledge'|'answer'|'ticket'} action
 * @property {'high'|'low'} [confidence] - Classifier confidence in the action
 * @property {boolean} [needsContext] - Whether deeper context lookup is needed
 * @property {string} [response] - Draft response (for acknowledge/answer)
 * @property {string} [ticketTitle] - Notion ticket title, without [BOT] prefix (for ticket)
 * @property {string} [ticketBody] - Notion ticket body (for ticket)
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
  // Always escalate tickets — Sonnet investigates the codebase to produce a rich,
  // actionable ticketBody with files, routes, scope, and suggested approach.
  if (result.action === 'ticket') return true;
  return false;
}

/**
 * Run a single blind classification pass against a model (no tools).
 * Used for the Haiku first pass.
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string|null} sessionLogPath
 * @param {string|null} [resumeSessionId] - Resume an existing session
 * @returns {Promise<{ classification: Classification, sessionId: string|null }>}
 */
async function runClassification(
  model,
  systemPrompt,
  userPrompt,
  sessionLogPath,
  resumeSessionId = null,
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
      // Load project CLAUDE.md if session log path is configured — user can place
      // a CLAUDE.md (and a .claude/ folder) in their session log directory to
      // provide classifier-relevant context (service descriptions, conventions, etc.)
      ...(sessionLogPath ? { settingSources: ['project'] } : {}),
      // Only resume if session is persisted — resume requires an existing JSONL on disk
      ...(resumeSessionId && sessionLogPath ? { resume: resumeSessionId } : {}),
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
 * Build the escalation prompt for the agentic Sonnet pass.
 * Written in first-person as TS — matches the persona tone in the system prompt.
 * @param {Classification} initial - Haiku's initial (low-confidence) result
 * @param {string|null} projectRootPath - Root path of the codebase (from slackConfig)
 * @param {string|null} sessionLogPath - Session log path (cwd when resuming a session)
 * @returns {string}
 */
function buildAgenticEscalationPrompt(
  initial,
  projectRootPath,
  sessionLogPath,
) {
  const isTicket = initial.action === 'ticket';
  const reason =
    initial.confidence === 'low'
      ? `wasn't sure how to classify this (initial guess: ${initial.action})`
      : isTicket
        ? 'this is a ticket — need to investigate before writing the body'
        : `needs more context to respond well (action=${initial.action})`;

  // Tell the model exactly which base path to use for tool calls.
  // cwd may be sessionLogPath (when resuming) — not the codebase — so absolute paths are required.
  const pathNote = projectRootPath
    ? `my projects are at ${projectRootPath} — always use that as the absolute base for tool calls${sessionLogPath ? `, even though cwd is currently ${sessionLogPath}` : ''}`
    : 'use absolute paths when calling tools';

  const ticketInstructions = isTicket
    ? `
since this is a ticket, investigate thoroughly so the body has everything needed to act on it:
- identify the exact service/project (grep for the route, function name, or domain term under ${projectRootPath ?? 'the projects folder'})
- find the relevant files — controller, service layer, model, migration, config — whatever applies
- understand the current behaviour vs what's being asked
- note any related code that would need to change (e.g. if a field is added, what reads/writes it)
- if it's a bug: identify where the fault likely is
- if it's a feature/change: sketch the approach — what needs to be added/modified and where

the ticketBody should be a self-contained brief that a dev can pick up without needing to ask follow-up questions. include:
- what: 1-2 lines on what needs to be done
- where: exact file paths and function/route names found during investigation
- how (if clear): suggested approach or any constraints to be aware of
- context: anything else relevant (related tickets, edge cases, dependencies)

keep it tight — no fluff, no repetition of the slack message. use plain text, not markdown headers.`
    : `
when digging in:
- if there's a route or endpoint mentioned: grep for it under ${projectRootPath ?? 'the projects folder'} to find which service owns it. my services follow /api/{context}/v1/{route} where context = repo prefix (user-service → user, anime-service → anime, etc.)
- if the project or scope is unclear: grep for the most specific term — a function name, field name, or table name
- if it's a question i should answer: read the actual code or config so i'm not guessing`;

  return `ok so my initial read ${reason}. let me check before responding.

${pathNote}.
${ticketInstructions}

2-3 targeted lookups is usually enough. don't spiral.

once i have enough to be confident, respond with ONLY the \`\`\`json code fence — same schema as before. don't output JSON mid-investigation, only in the final message.`;
}

/**
 * Run an agentic classification pass (Sonnet + Grep/Glob/Read tools).
 * Used for Tier 2 escalation — investigates the codebase before classifying.
 * @param {string} systemPrompt
 * @param {Classification} initial - Haiku's initial result (for escalation prompt context)
 * @param {string|null} sessionLogPath
 * @param {string|null} resumeSessionId - Haiku session to resume
 * @param {string|null} projectRootPath - Codebase root (cwd for tools)
 * @param {number} maxTurns
 * @returns {Promise<{ classification: Classification, sessionId: string|null }>}
 */
async function runAgenticClassification(
  systemPrompt,
  initial,
  sessionLogPath,
  resumeSessionId,
  projectRootPath,
  maxTurns,
) {
  const modelSlug = config.models.sonnet;
  const escalationPrompt = buildAgenticEscalationPrompt(
    initial,
    projectRootPath,
    sessionLogPath,
  );

  // cwd resolution:
  // - When resuming a persisted session, use sessionLogPath so the SDK locates
  //   the existing JSONL (session slug is derived from cwd at creation time).
  //   The escalation prompt tells Sonnet the projectRootPath explicitly so it
  //   can use absolute paths with tools regardless of cwd.
  // - When not resuming (ephemeral), use projectRootPath so tools default to
  //   the codebase root. Fall back to undefined (SDK default) if neither is set.
  const cwd =
    resumeSessionId && sessionLogPath
      ? sessionLogPath
      : projectRootPath || undefined;

  const stream = query({
    prompt: escalationPrompt,
    options: {
      model: modelSlug,
      allowedTools: ['Grep', 'Glob', 'Read'],
      permissionMode: 'default',
      systemPrompt,
      maxTurns,
      persistSession: !!sessionLogPath,
      ...(cwd ? { cwd } : {}),
      // Load project CLAUDE.md from session log path if available (same guard as haiku pass)
      ...(sessionLogPath ? { settingSources: ['project'] } : {}),
      // Only resume if session is persisted — resume requires an existing JSONL on disk
      ...(resumeSessionId && sessionLogPath ? { resume: resumeSessionId } : {}),
    },
  });

  let text = '';
  let sessionId = null;
  let toolUseCount = 0;

  for await (const message of stream) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id ?? null;
    }
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if ('text' in block) {
          text += block.text;
        } else if ('name' in block) {
          toolUseCount++;
          logger.log(
            `[Slack Classifier] [agentic] tool_use #${toolUseCount}: ${block.name}(${JSON.stringify(block.input).substring(0, 120)})`,
          );
        }
      }
    }
  }

  logger.log(
    `[Slack Classifier] [agentic] completed — ${toolUseCount} tool calls`,
  );

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
 *
 * Tier 1 — Haiku (no tools, 1 turn): classifies the obvious majority cheaply.
 * Tier 2 — Sonnet (Grep/Glob/Read, up to maxTriageTurns): escalated when Haiku
 *           is uncertain. Actively investigates the codebase before classifying.
 *
 * @param {Object} params
 * @param {Object} params.message - Slack event (text may be debounce-combined)
 * @param {Object} [params.channelInfo] - Channel metadata
 * @param {string} [params.senderName] - Sender display name
 * @param {Object} params.config - Slack bot config
 * @param {import('./api.js').SlackAPI|null} [params.slackApi] - For posting reactions on escalation
 * @param {Object|null} [params.event] - Original Slack event (for reaction target)
 * @returns {Promise<Classification>}
 */
export async function classifyMessage({
  message,
  channelInfo,
  senderName,
  config: slackConfig,
  slackApi = null,
  event = null,
}) {
  const sessionLogPath = slackConfig.sessionLogPath || null;
  const projectRootPath = slackConfig.projectRootPath || null;
  const maxTriageTurns = slackConfig.classifier?.maxTriageTurns ?? 5;
  const systemPrompt = buildSystemPrompt(slackConfig);
  const userPrompt = buildUserPrompt({
    message,
    channelInfo,
    senderName,
  });

  try {
    // Tier 1: Haiku — fast, cheap, no tools
    const { classification: initial, sessionId: haikuSessionId } =
      await runClassification(
        'haiku',
        systemPrompt,
        userPrompt,
        sessionLogPath,
      );

    logger.log(
      `[Slack Classifier] haiku → action=${initial.action} confidence=${initial.confidence ?? '?'} needsContext=${initial.needsContext ?? false}`,
    );

    // Tier 2: Sonnet + tools — escalate when haiku is uncertain.
    // Resumes the same session so haiku's turn is visible in context.
    // Posts :mag: reaction immediately so the user sees investigation is underway.
    if (shouldEscalateToSonnet(initial)) {
      logger.log(
        `[Slack Classifier] escalating to Sonnet (agentic) — action=${initial.action} confidence=${initial.confidence} needsContext=${initial.needsContext}`,
      );

      // Post :mag: reaction as immediate visual feedback
      if (slackApi && event) {
        try {
          await slackApi.addReaction(event.channel, event.ts, 'mag');
        } catch {
          // Ignore — already reacted, or missing permission
        }
      }

      try {
        const { classification: escalated, sessionId: sonnetSessionId } =
          await runAgenticClassification(
            systemPrompt,
            initial,
            sessionLogPath,
            haikuSessionId,
            projectRootPath,
            maxTriageTurns,
          );
        logger.log(
          `[Slack Classifier] sonnet → action=${escalated.action} confidence=${escalated.confidence ?? '?'} needsContext=${escalated.needsContext ?? false}`,
        );
        // Single session — title using the final escalated result
        const title = buildSessionTitle(
          escalated,
          channelInfo,
          message.text || '',
        );
        assignSessionTitle(sonnetSessionId, sessionLogPath, title);
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
        assignSessionTitle(haikuSessionId, sessionLogPath, title);
        return initial;
      }
    }

    const title = buildSessionTitle(initial, channelInfo, message.text || '');
    assignSessionTitle(haikuSessionId, sessionLogPath, title);
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
    // Primary: extract from ```json code fence — the model is instructed to use this.
    // This is robust against intermediate reasoning text that may contain stray braces
    // (e.g. code samples echoed during agentic tool investigation turns).
    const fenceMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (fenceMatch) {
      const parsed = JSON.parse(fenceMatch[1].trim());
      const validActions = ['ignore', 'acknowledge', 'answer', 'ticket'];
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
    }

    // Fallback: brace-matching extraction for responses without a code fence.
    // Finds the first '{' and its matching '}' by depth counting.
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
    const validActions = ['ignore', 'acknowledge', 'answer', 'ticket'];
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
