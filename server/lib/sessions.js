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

/**
 * Get sessions list for a project
 * Merges sessions from sessions-index.json with JSONL files in the directory
 * to catch newly created sessions that haven't been indexed yet
 *
 * @param {string} projectSlug - Project slug (e.g., -home-ts-projects-foo)
 * @returns {Array<{sessionId: string, firstPrompt: string, messageCount: number, created: string, modified: string}>}
 */
export function getSessionsList(projectSlug) {
  try {
    const sessionsDir = getSessionsDir(projectSlug);
    const indexPath = join(sessionsDir, 'sessions-index.json');

    // Start with indexed sessions
    const sessionsMap = new Map();
    if (existsSync(indexPath)) {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
      for (const entry of data.entries || []) {
        const jsonlPath = join(sessionsDir, `${entry.sessionId}.jsonl`);
        let modified = entry.modified;
        if (existsSync(jsonlPath)) {
          try {
            const stats = statSync(jsonlPath);
            modified = stats.mtime.toISOString();
          } catch {
            // Fall back to index modified if stat fails
          }
        }
        sessionsMap.set(entry.sessionId, {
          sessionId: entry.sessionId,
          firstPrompt: entry.firstPrompt?.substring(0, 100) || 'No prompt',
          messageCount: entry.messageCount || 0,
          created: entry.created,
          modified,
          // Include native customTitle from sessions-index.json
          title: entry.customTitle || null,
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
              // Read first line to get the first prompt and count messages
              let firstPrompt = 'New session';
              let messageCount = 0;
              try {
                const content = readFileSync(jsonlPath, 'utf-8');
                const lines = content.split('\n').filter((line) => line.trim());
                messageCount = lines.length;

                const firstLine = lines[0];
                if (firstLine) {
                  const entry = JSON.parse(firstLine);
                  if (entry.type === 'user' && entry.message?.content) {
                    const contentText =
                      typeof entry.message.content === 'string'
                        ? entry.message.content
                        : Array.isArray(entry.message.content)
                          ? entry.message.content
                              .filter((b) => b.type === 'text')
                              .map((b) => b.text)
                              .join(' ')
                          : 'New session';
                    firstPrompt = contentText.substring(0, 100);
                  }
                }
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
    // Extract model name from full model string (e.g., "claude-sonnet-4-5-20250929" -> "sonnet")
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
 * By default, only loads messages after the last summary for faster loading
 *
 * @param {string} projectSlug - Project slug
 * @param {string} sessionId - Session ID
 * @param {Object} options - Options
 * @param {boolean} options.fullHistory - If true, load all messages (slower)
 * @returns {Promise<{messages: Array, hasOlderMessages: boolean, summaryCount: number}>}
 */
export async function loadSessionHistory(projectSlug, sessionId, options = {}) {
  const sessionsDir = getSessionsDir(projectSlug);
  const jsonlPath = join(sessionsDir, `${sessionId}.jsonl`);

  if (!existsSync(jsonlPath)) {
    return { messages: [], hasOlderMessages: false, summaryCount: 0 };
  }

  const { fullHistory = false } = options;

  // First pass: find all summary positions if not loading full history
  const allEntries = [];
  let summaryCount = 0;
  let lastSummaryIndex = -1;

  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(jsonlPath),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    let lineIndex = 0;

    rl.on('line', (line) => {
      try {
        const entry = JSON.parse(line);
        allEntries.push(entry);

        if (entry.type === 'summary') {
          summaryCount++;
          lastSummaryIndex = lineIndex;
        }

        lineIndex++;
      } catch (_err) {
        // Skip malformed lines
        lineIndex++;
      }
    });

    rl.on('close', () => {
      const messages = [];
      const hasOlderMessages = lastSummaryIndex > 0;

      // Determine starting index
      const startIndex = fullHistory
        ? 0
        : lastSummaryIndex >= 0
          ? lastSummaryIndex
          : 0;

      // Parse entries from starting point
      for (let i = startIndex; i < allEntries.length; i++) {
        const parsed = parseEntry(allEntries[i]);
        messages.push(...parsed);
      }

      resolve({ messages, hasOlderMessages, summaryCount });
    });

    rl.on('error', reject);
  });
}
