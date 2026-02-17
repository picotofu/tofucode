/**
 * Discord Message Formatter
 *
 * Transforms Claude responses into Discord-safe messages.
 * Handles 2000-char limit, code-block awareness, and tool output formatting.
 */

/**
 * Chunk text into Discord-safe messages (max 2000 chars).
 * Preserves code blocks - never splits inside a fenced code block.
 *
 * @param {string} text - Full text to chunk
 * @param {number} maxLen - Max chars per chunk (default 1900, leave room for overhead)
 * @returns {string[]} Array of message chunks
 */
export function chunkMessage(text, maxLen = 1900) {
  if (!text) return [''];
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let currentChunk = '';
  let inCodeBlock = false;
  let codeBlockLang = '';

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWithNewline = i < lines.length - 1 ? `${line}\n` : line;

    // Check if this line starts/ends a code block
    // Match: optional whitespace + ``` + optional language + optional whitespace
    const codeBlockMatch = line.match(/^\s*```(\w*)\s*$/);
    if (codeBlockMatch) {
      if (!inCodeBlock) {
        // Starting code block
        inCodeBlock = true;
        codeBlockLang = codeBlockMatch[1] || '';
      } else {
        // Ending code block
        inCodeBlock = false;
        codeBlockLang = '';
      }
    }

    // Check if adding this line would exceed limit
    if (currentChunk.length + lineWithNewline.length > maxLen) {
      // Need to split here
      if (currentChunk.length === 0) {
        // Single line is too long - force split mid-line
        let remaining = lineWithNewline;
        while (remaining.length > 0) {
          const splitLen = inCodeBlock ? maxLen - 10 : maxLen; // Leave room for code fence close/open
          const piece = remaining.substring(0, splitLen);
          if (inCodeBlock) {
            chunks.push(`${piece}\n\`\`\``);
          } else {
            chunks.push(piece);
          }
          remaining = remaining.substring(splitLen);
          // If there's remaining text and we're in a code block, reopen it
          if (remaining.length > 0 && inCodeBlock) {
            remaining = `\`\`\`${codeBlockLang}\n${remaining}`;
          }
        }
        continue;
      }

      // Close code block if we're in one
      if (inCodeBlock) {
        currentChunk += '```\n';
      }

      // Push chunk (don't trim - preserve intentional whitespace)
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      // Start new chunk, reopen code block if needed
      currentChunk = inCodeBlock ? `\`\`\`${codeBlockLang}\n` : '';
      currentChunk += lineWithNewline;
    } else {
      currentChunk += lineWithNewline;
    }
  }

  // Add remaining chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [''];
}

/**
 * Escape backticks in text to prevent breaking inline code formatting.
 * @param {string} text
 * @returns {string}
 */
function escapeBackticks(text) {
  if (!text) return '';
  return text.replace(/`/g, '\\`');
}

/**
 * Format a tool_use event for Discord.
 * Returns a compact representation: tool name + truncated input.
 *
 * @param {Object} event - { tool, input }
 * @returns {string} Formatted string
 */
export function formatToolUse(event) {
  const toolName = event.tool;
  const input = event.input || {};

  // Tool-specific compact formats
  if (toolName === 'Read' && input.file_path) {
    return `> :mag: **Read** \`${escapeBackticks(input.file_path)}\``;
  }
  if (toolName === 'Write' && input.file_path) {
    return `> :pencil2: **Write** \`${escapeBackticks(input.file_path)}\``;
  }
  if (toolName === 'Edit' && input.file_path) {
    return `> :pencil2: **Edit** \`${escapeBackticks(input.file_path)}\``;
  }
  if (toolName === 'Bash' && input.command) {
    const cmd =
      input.command.length > 100
        ? `${input.command.substring(0, 100)}...`
        : input.command;
    return `> :computer: **Bash** \`${escapeBackticks(cmd)}\``;
  }
  if (toolName === 'Glob' && input.pattern) {
    return `> :mag_right: **Glob** \`${escapeBackticks(input.pattern)}\``;
  }
  if (toolName === 'Grep' && input.pattern) {
    return `> :mag_right: **Grep** \`${escapeBackticks(input.pattern)}\``;
  }

  return `> :wrench: **${toolName}**`;
}

/**
 * Format tool_result for Discord.
 * Only shows errors (non-error results are too verbose for Discord).
 *
 * @param {Object} event - { content, isError }
 * @returns {string|null} Formatted string, or null if content should be skipped
 */
export function formatToolResult(event) {
  // Most tool results are verbose - only show errors
  if (event.isError) {
    const content = event.content || 'Unknown error';
    // Escape backticks in error content to prevent breaking code blocks
    const truncated = escapeBackticks(content.substring(0, 500));
    return `> :x: Error:\n\`\`\`\n${truncated}\n\`\`\``;
  }
  // Skip non-error tool results in Discord (too verbose)
  return null;
}

/**
 * Format the final result summary.
 *
 * @param {Object} event - { subtype, cost, duration }
 * @returns {string}
 */
export function formatResult(event) {
  const status = event.subtype === 'success' ? ':white_check_mark:' : ':x:';
  const duration =
    event.duration != null ? `${(event.duration / 1000).toFixed(1)}s` : '';
  const cost = event.cost ? `$${event.cost.toFixed(4)}` : '';
  const parts = [status, 'Completed'];
  if (duration) parts.push(`in ${duration}`);
  if (cost) parts.push(`| ${cost}`);
  return parts.join(' ');
}

/**
 * Format an error for Discord.
 * Escapes backticks to prevent formatting issues.
 *
 * @param {string} message
 * @returns {string}
 */
export function formatError(message) {
  return `:warning: **Error**: ${escapeBackticks(message)}`;
}
