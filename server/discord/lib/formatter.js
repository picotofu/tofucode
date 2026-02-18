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
 * Accumulate tool_use events into a running tally.
 * Returns updated state — call this for each tool_use event.
 *
 * State shape:
 * {
 *   counts: { Read: 2, Edit: 1, ... },  // call counts per tool
 *   lastBash: 'npm run check',           // last bash command (for hint)
 *   lastTool: 'Bash',                    // most recent tool name (for status line)
 *   lastToolHint: 'npm run check',       // most recent tool detail (for status line)
 * }
 *
 * @param {Object} state - Current accumulator state (mutated in place)
 * @param {Object} event - { tool, input }
 * @returns {Object} Same state object (for convenience)
 */
export function accumulateToolUse(state, event) {
  const toolName = event.tool;
  const input = event.input || {};

  // Increment count
  state.counts[toolName] = (state.counts[toolName] || 0) + 1;
  state.lastTool = toolName;

  // Capture a short hint for the status line
  if (toolName === 'Bash' && input.command) {
    const cmd =
      input.command.length > 60
        ? `${input.command.substring(0, 60)}…`
        : input.command;
    state.lastBash = cmd;
    state.lastToolHint = cmd;
  } else if (
    (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') &&
    input.file_path
  ) {
    // Show just the filename, not full path
    const filename = input.file_path.split('/').pop();
    state.lastToolHint = filename;
  } else if ((toolName === 'Glob' || toolName === 'Grep') && input.pattern) {
    state.lastToolHint = input.pattern;
  } else {
    state.lastToolHint = null;
  }

  return state;
}

/**
 * Build a compact one-line tool status for the streaming "thinking" message.
 * Shows what Claude is currently doing.
 *
 * @param {Object} state - Accumulator state from accumulateToolUse
 * @returns {string} e.g. "⚙️ Reading `config.js`..." or "⚙️ Running tools..."
 */
export function formatToolStatus(state) {
  if (!state.lastTool) return '⚙️ Working…';

  const toolLabels = {
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Editing',
    Bash: 'Running',
    Glob: 'Searching',
    Grep: 'Searching',
    Task: 'Delegating',
  };

  const label = toolLabels[state.lastTool] || state.lastTool;
  const hint = state.lastToolHint ? ` ${state.lastToolHint}` : '';
  return `⚙️ ${label}${hint}…`;
}

/**
 * Build the compact tool summary footer line.
 * Groups tools by name with counts, appends last bash command as context.
 *
 * @param {Object} state - Accumulator state from accumulateToolUse
 * @returns {string|null} e.g. "🔧 Read ×4 · Edit ×2 · Bash `npm run check`" or null if no tools
 */
export function formatToolSummary(state) {
  const { counts, lastBash } = state;
  if (Object.keys(counts).length === 0) return null;

  // Tool display order (most common first)
  const ORDER = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'Task'];
  const sorted = [
    ...ORDER.filter((t) => counts[t]),
    ...Object.keys(counts).filter((t) => !ORDER.includes(t)),
  ];

  const parts = sorted.map((tool) => {
    const count = counts[tool];
    const suffix = count > 1 ? ` ×${count}` : '';
    // For Bash, append last command as plain text hint (no backticks — avoids rendering issues)
    if (tool === 'Bash' && lastBash) {
      return `Bash (${lastBash})${count > 1 ? ` ×${count}` : ''}`;
    }
    return `${tool}${suffix}`;
  });

  return `🔧 ${parts.join(' · ')}`;
}

/**
 * Format tool_result errors only — shown inline in the response.
 * Non-error results are suppressed (too verbose for Discord).
 *
 * @param {Object} event - { content, isError }
 * @returns {string|null}
 */
export function formatToolResult(event) {
  if (event.isError) {
    const content = event.content || 'Unknown error';
    // Truncate and strip backticks to avoid breaking Discord formatting
    const truncated = content.substring(0, 300).replace(/`/g, "'");
    return `> ❌ ${truncated}`;
  }
  return null;
}

/**
 * Build the final footer line combining tool summary + result status.
 *
 * @param {Object} toolState - Accumulator state from accumulateToolUse
 * @param {Object} resultEvent - { subtype, cost, duration }
 * @returns {string}
 */
export function formatFooter(toolState, resultEvent) {
  const status = resultEvent.subtype === 'success' ? '✅' : '❌';
  const duration =
    resultEvent.duration != null
      ? `${(resultEvent.duration / 1000).toFixed(1)}s`
      : '';
  const cost = resultEvent.cost ? `$${resultEvent.cost.toFixed(4)}` : '';

  const meta = [status, duration, cost ? `· ${cost}` : '']
    .filter(Boolean)
    .join(' ');

  const toolSummary = formatToolSummary(toolState);

  if (toolSummary) {
    return `-# ${toolSummary}   ${meta}`;
  }
  return `-# ${meta}`;
}

/**
 * Format an error for Discord.
 *
 * @param {string} message
 * @returns {string}
 */
export function formatError(message) {
  return `:warning: **Error**: ${escapeBackticks(message)}`;
}

// Keep formatResult exported for any callers that still use it directly
export function formatResult(event) {
  const status = event.subtype === 'success' ? '✅' : '❌';
  const duration =
    event.duration != null ? `${(event.duration / 1000).toFixed(1)}s` : '';
  const cost = event.cost ? `$${event.cost.toFixed(4)}` : '';
  const parts = [status, 'Completed'];
  if (duration) parts.push(`in ${duration}`);
  if (cost) parts.push(`· ${cost}`);
  return parts.join(' ');
}
