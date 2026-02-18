/**
 * Session utilities - list sessions, load history from JSONL
 */

import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { getSessionsDir } from '../config.js';
import { loadTitles } from './session-titles.js';

/**
 * SECURITY: Validate sessionId format to prevent path traversal
 * Session IDs must be valid UUIDs (alphanumeric + hyphens only)
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isValidSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  // UUID format: 8-4-4-4-12 hexadecimal characters with hyphens
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    sessionId,
  );
}

/**
 * Get sessions list for a project
 * Merges sessions from sessions-index.json with JSONL files in the directory
 * to catch newly created sessions that haven't been indexed yet
 *
 * @param {string} projectSlug - Project slug (e.g., -home-ts-projects-foo)
 * @returns {Promise<Array<{sessionId: string, firstPrompt: string, messageCount: number, created: string, modified: string}>>}
 */
export async function getSessionsList(projectSlug) {
  try {
    const sessionsDir = getSessionsDir(projectSlug);
    const indexPath = join(sessionsDir, 'sessions-index.json');

    // Load custom titles from .session-titles.json (SDK-safe storage)
    const titles = loadTitles(projectSlug);

    // Start with indexed sessions
    const sessionsMap = new Map();
    if (existsSync(indexPath)) {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
      for (const entry of data.entries || []) {
        const jsonlPath = join(sessionsDir, `${entry.sessionId}.jsonl`);
        let modified = entry.modified;
        let messageCount = entry.messageCount || 0;

        if (existsSync(jsonlPath)) {
          try {
            const stats = statSync(jsonlPath);
            modified = stats.mtime.toISOString();

            // Recount displayable messages from JSONL (SDK includes system messages in index)
            messageCount = 0;
            await new Promise((resolve, reject) => {
              const rl = createInterface({
                input: createReadStream(jsonlPath),
                crlfDelay: Number.POSITIVE_INFINITY,
              });

              rl.on('line', (line) => {
                if (line.trim()) {
                  try {
                    const msgEntry = JSON.parse(line);
                    // Only count displayable message types
                    if (
                      msgEntry.type === 'user' ||
                      msgEntry.type === 'human' ||
                      msgEntry.type === 'assistant' ||
                      msgEntry.type === 'tool_result'
                    ) {
                      messageCount++;
                    }
                  } catch {
                    // Skip malformed lines
                  }
                }
              });

              rl.on('close', () => resolve());
              rl.on('error', reject);
            });
          } catch {
            // Fall back to index values if streaming fails
            messageCount = entry.messageCount || 0;
          }
        }

        sessionsMap.set(entry.sessionId, {
          sessionId: entry.sessionId,
          firstPrompt: entry.firstPrompt?.substring(0, 100) || 'No prompt',
          messageCount,
          created: entry.created,
          modified,
          // Use .session-titles.json (SDK overwrites sessions-index.json customTitle)
          title: titles[entry.sessionId] || null,
        });
      }
    }

    // Scan directory for JSONL files not in the index
    // This catches newly created sessions before SDK updates the index
    if (existsSync(sessionsDir)) {
      const files = readdirSync(sessionsDir);
      for (const file of files) {
        if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
          const sessionId = file.replace('.jsonl', '');
          if (!sessionsMap.has(sessionId)) {
            const jsonlPath = join(sessionsDir, file);
            try {
              const stats = statSync(jsonlPath);
              // Read first line via streaming (don't load entire file)
              let firstPrompt = 'New session';
              let messageCount = 0;

              try {
                // Use streaming to count displayable messages and get first user prompt
                await new Promise((resolve, reject) => {
                  const rl = createInterface({
                    input: createReadStream(jsonlPath),
                    crlfDelay: Number.POSITIVE_INFINITY,
                  });

                  let firstUserPromptFound = false;
                  rl.on('line', (line) => {
                    if (line.trim()) {
                      try {
                        const entry = JSON.parse(line);
                        // Only count displayable message types (exclude system, summary, etc.)
                        if (
                          entry.type === 'user' ||
                          entry.type === 'human' ||
                          entry.type === 'assistant' ||
                          entry.type === 'tool_result'
                        ) {
                          messageCount++;

                          // Get first user prompt for display
                          if (
                            !firstUserPromptFound &&
                            (entry.type === 'user' || entry.type === 'human') &&
                            entry.message?.content
                          ) {
                            const contentText =
                              typeof entry.message.content === 'string'
                                ? entry.message.content
                                : Array.isArray(entry.message.content)
                                  ? entry.message.content
                                      .filter((b) => b.type === 'text')
                                      .map((b) => b.text)
                                      .join(' ')
                                  : '';
                            if (contentText.trim()) {
                              firstPrompt = contentText.substring(0, 100);
                              firstUserPromptFound = true;
                            }
                          }
                        }
                      } catch {
                        // Skip malformed lines
                      }
                    }
                  });

                  rl.on('close', () => resolve());
                  rl.on('error', reject);
                });
              } catch {
                // Couldn't read first prompt, use default
              }

              sessionsMap.set(sessionId, {
                sessionId,
                firstPrompt,
                messageCount,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                // Unindexed sessions don't have customTitle
                title: null,
              });
            } catch (err) {
              console.error(`Failed to stat ${file}:`, err.message);
            }
          }
        }
      }
    }

    // Convert to array and sort by modification time
    return Array.from(sessionsMap.values()).sort(
      (a, b) => new Date(b.modified) - new Date(a.modified),
    );
  } catch (err) {
    console.error('Failed to load sessions:', err.message);
    return [];
  }
}

/**
 * Parse a single JSONL entry into message object(s)
 * @param {Object} entry - Parsed JSON entry
 * @returns {Array} Array of message objects (may be empty or multiple)
 */
function parseEntry(entry) {
  const messages = [];

  // User messages (type can be 'user' or 'human')
  if (entry.type === 'user' || entry.type === 'human') {
    const content = entry.message?.content;
    let textContent = '';

    // Handle both string and array content formats
    if (typeof content === 'string') {
      textContent = content;
    } else if (Array.isArray(content)) {
      // New format: array of content blocks
      // Extract text blocks
      const textBlocks = content.filter((block) => block.type === 'text');
      textContent = textBlocks.map((block) => block.text).join('\n');

      // Extract tool_result blocks
      const toolResults = content.filter(
        (block) => block.type === 'tool_result',
      );
      for (const result of toolResults) {
        messages.push({
          type: 'tool_result',
          toolUseId: result.tool_use_id,
          content: result.content,
          isError: result.is_error || false,
          timestamp: entry.timestamp,
        });
      }
    }

    if (textContent?.trim()) {
      messages.push({
        type: 'user',
        content: textContent,
        timestamp: entry.timestamp,
        permissionMode: entry.permissionMode || 'default',
        dangerouslySkipPermissions: entry.dangerouslySkipPermissions || false,
        model: entry.model || null, // Preserve model information
      });
    }
  }

  // Assistant messages
  if (entry.type === 'assistant') {
    const blocks = entry.message?.content || [];
    // Extract model name from full model string (e.g., "claude-sonnet-4-6" -> "sonnet")
    let modelName = null;
    if (entry.message?.model) {
      const fullModel = entry.message.model;
      if (fullModel.includes('opus')) {
        modelName = 'opus';
      } else if (fullModel.includes('haiku')) {
        modelName = 'haiku';
      } else if (fullModel.includes('sonnet')) {
        modelName = 'sonnet';
      }
    }

    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        messages.push({
          type: 'text',
          content: block.text,
          timestamp: entry.timestamp,
          model: modelName,
        });
      } else if (block.type === 'tool_use') {
        messages.push({
          type: 'tool_use',
          tool: block.name,
          input: block.input,
          id: block.id,
          timestamp: entry.timestamp,
          model: modelName,
        });
      }
    }
  }

  // Tool results
  if (entry.type === 'tool_result') {
    const content = entry.message?.content;
    if (content) {
      messages.push({
        type: 'tool_result',
        toolUseId: entry.message?.tool_use_id,
        content:
          typeof content === 'string' ? content : JSON.stringify(content),
        timestamp: entry.timestamp,
      });
    }
  }

  // Summary messages (from Claude's context management)
  if (entry.type === 'summary') {
    messages.push({
      type: 'summary',
      content: entry.summary || 'Session summarized',
      timestamp: entry.timestamp,
      leafUuid: entry.leafUuid,
    });
  }

  return messages;
}

/**
 * Parse JSONL file and extract messages for display
 * Uses circular buffer to limit memory usage for large sessions
 * Supports pagination via offset/limit parameters
 *
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @param {Object} options - Options
 * @param {boolean} options.fullHistory - If true, load all messages (ignores buffer limit)
 * @param {number} options.limit - Max messages to return (default: 50)
 * @param {number} options.offset - Start offset from end (0 = most recent, default: 0)
 * @param {number} options.maxBufferSize - Max entries to keep in memory (default: 500)
 * @returns {Promise<{messages: Array, hasOlderMessages: boolean, summaryCount: number, totalEntries: number}>}
 */
export async function loadSessionHistory(projectSlug, sessionId, options = {}) {
  // SECURITY: Validate sessionId to prevent path traversal
  if (!isValidSessionId(sessionId)) {
    return {
      messages: [],
      hasOlderMessages: false,
      summaryCount: 0,
      totalEntries: 0,
    };
  }

  const sessionsDir = getSessionsDir(projectSlug);
  const jsonlPath = join(sessionsDir, `${sessionId}.jsonl`);

  if (!existsSync(jsonlPath)) {
    return {
      messages: [],
      hasOlderMessages: false,
      summaryCount: 0,
      totalEntries: 0,
    };
  }

  const { fullHistory = false, loadLastTurn = false } = options;

  // SECURITY: Sanitize and clamp pagination parameters to prevent abuse
  const rawOffset = Number.isInteger(options.offset)
    ? options.offset
    : Number.parseInt(options.offset, 10) || 0;
  const rawLimit = Number.isInteger(options.limit)
    ? options.limit
    : Number.parseInt(options.limit, 10) || 100;
  const rawMaxBufferSize = Number.isInteger(options.maxBufferSize)
    ? options.maxBufferSize
    : Number.parseInt(options.maxBufferSize, 10) || 5000;
  const rawTurnLimit =
    options.turnLimit != null
      ? Number.isInteger(options.turnLimit)
        ? options.turnLimit
        : Number.parseInt(options.turnLimit, 10)
      : null;

  const limit = Math.max(1, Math.min(rawLimit, 500));
  const offset = Math.max(0, Math.min(rawOffset, 100000));
  const maxBufferSize = Math.max(100, Math.min(rawMaxBufferSize, 10000));
  const turnLimit =
    rawTurnLimit != null ? Math.max(1, Math.min(rawTurnLimit, 50)) : null;

  // Use circular buffer to limit memory usage
  const buffer = [];
  let summaryCount = 0;
  let _lastSummaryIndex = -1;
  let totalLineCount = 0;
  let totalSessionTurns = 0; // Count ALL turns in session (persists across summaries)

  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(jsonlPath),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    rl.on('line', (line) => {
      try {
        const entry = JSON.parse(line);

        // Count ALL turns in session (before buffer management)
        if (entry.type === 'user' || entry.type === 'human') {
          const content = entry.message?.content;
          let hasTextContent = false;

          if (typeof content === 'string' && content.trim()) {
            hasTextContent = true;
          } else if (Array.isArray(content)) {
            hasTextContent = content.some(
              (block) => block.type === 'text' && block.text?.trim(),
            );
          }

          if (hasTextContent) {
            totalSessionTurns++; // Never reset, counts full session history
          }
        }

        // Track summary positions
        if (entry.type === 'summary') {
          summaryCount++;
          _lastSummaryIndex = totalLineCount;
          // Clear buffer on summary if not loading full history
          if (!fullHistory) {
            buffer.length = 0;
          }
        }

        buffer.push(entry);

        // Maintain circular buffer if not loading full history
        if (!fullHistory && buffer.length > maxBufferSize) {
          buffer.shift();
        }

        totalLineCount++;
      } catch (_err) {
        // Skip malformed lines
        totalLineCount++;
      }
    });

    rl.on('close', () => {
      // Helper: Check if entry has text content
      const hasTextContent = (entry) => {
        const content = entry.message?.content;
        if (typeof content === 'string' && content.trim()) {
          return true;
        }
        if (Array.isArray(content)) {
          return content.some(
            (block) => block.type === 'text' && block.text?.trim(),
          );
        }
        return false;
      };

      // Count turns in the final buffer (not accumulated during streaming)
      // This gives us turns in the current window (after summaries/circular buffer)
      let _bufferTurnCount = 0;
      for (const entry of buffer) {
        if (
          (entry.type === 'user' || entry.type === 'human') &&
          hasTextContent(entry)
        ) {
          _bufferTurnCount++;
        }
      }

      let entriesToParse;
      let effectiveOffset = offset;
      let loadedTurnCount = 0;

      if (turnLimit !== null) {
        // TURN-BASED PAGINATION: Load N turns instead of N entries
        const userIndices = [];

        // Find user messages with text, starting from (buffer.length - offset) going backward
        const searchEnd = buffer.length - offset;
        for (let i = searchEnd - 1; i >= 0; i--) {
          if (
            (buffer[i].type === 'user' || buffer[i].type === 'human') &&
            hasTextContent(buffer[i])
          ) {
            userIndices.push(i);
            if (userIndices.length >= turnLimit) break;
          }
        }

        loadedTurnCount = userIndices.length;

        if (userIndices.length > 0) {
          // Load from earliest found user message to searchEnd
          const startIdx = userIndices[userIndices.length - 1];
          entriesToParse = buffer.slice(startIdx, searchEnd);
          // effectiveOffset = how many entries from end of buffer are NOT yet loaded
          // Next request should search up to startIdx, so offset = buffer.length - startIdx
          // If startIdx === 0, we've reached the beginning of the buffer - no more to load
          effectiveOffset = startIdx === 0 ? 0 : buffer.length - startIdx;
        } else {
          // No user turns found before searchEnd - load whatever remains (e.g. summary)
          // and signal no more older messages
          entriesToParse = buffer.slice(0, searchEnd);
          effectiveOffset = 0;
        }
      } else if (loadLastTurn && offset === 0) {
        // INITIAL LOAD: Load last N turns (specified by turnLimit in initial call)
        // This is kept for backward compatibility but we'll use turnLimit going forward
        const userIndices = [];
        for (let i = buffer.length - 1; i >= 0; i--) {
          if (
            (buffer[i].type === 'user' || buffer[i].type === 'human') &&
            hasTextContent(buffer[i])
          ) {
            userIndices.push(i);
            if (userIndices.length === 3) break; // Load last 3 turns
          }
        }

        loadedTurnCount = userIndices.length;

        if (userIndices.length === 3) {
          const startIdx = userIndices[2]; // Third-to-last user message
          entriesToParse = buffer.slice(startIdx);
          // effectiveOffset = entries from end to skip on next load = buffer.length - startIdx
          // (next searchEnd = buffer.length - effectiveOffset = startIdx, searching [0..startIdx))
          effectiveOffset = startIdx === 0 ? 0 : buffer.length - startIdx;
        } else if (userIndices.length > 0) {
          // Less than 3 turns total - loaded everything, no older messages
          const startIdx = userIndices[userIndices.length - 1];
          entriesToParse = buffer.slice(startIdx);
          effectiveOffset = 0; // Loaded all turns, nothing older
        } else {
          // No user message found, fall back to limit-based loading
          const startIdx = Math.max(0, buffer.length - limit);
          entriesToParse = buffer.slice(startIdx);
          effectiveOffset = startIdx === 0 ? 0 : buffer.length - startIdx;
        }
      } else {
        // ENTRY-BASED FALLBACK: Standard pagination by entry count
        const startIdx = Math.max(0, buffer.length - offset - limit);
        const endIdx = buffer.length - offset;
        entriesToParse = buffer.slice(startIdx, endIdx);
      }

      // Parse entries into messages
      const messages = [];
      for (const entry of entriesToParse) {
        const parsed = parseEntry(entry);
        messages.push(...parsed);
      }

      // hasOlderMessages: check if there are more entries before what we loaded,
      // within the buffer (which stops at summary boundary when fullHistory=false).
      // Using buffer.length instead of totalLineCount to correctly stop at summary.
      const hasOlderMessages = effectiveOffset > 0;

      resolve({
        messages,
        hasOlderMessages,
        summaryCount,
        totalEntries: totalLineCount,
        totalTurns: totalSessionTurns, // Total turns in full session history
        loadedTurns: loadedTurnCount,
        effectiveOffset, // The new offset for the next load request
      });
    });

    rl.on('error', reject);
  });
}
