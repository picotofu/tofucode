import { getMcpToolDisplay } from './mcp-tools/index.js';

/**
 * Format a date string as a relative time (e.g., "5m ago", "2h ago")
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {string} Formatted relative time
 */
export function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

/**
 * Truncate a string to a maximum length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} len - Maximum length
 * @returns {string} Truncated string
 */
export function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return `${str.substring(0, len)}...`;
}

/**
 * Get a short version of a path (last 2-3 segments)
 * @param {string} path - Full path
 * @returns {string} Shortened path
 */
export function getShortPath(path) {
  if (!path) return '';
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

/**
 * Tool display configuration
 * Maps tool names to their display properties
 */
const TOOL_CONFIG = {
  // File operations
  Bash: {
    icon: '$',
    getDisplay: (input) => ({
      primary: input.command,
      secondary: input.description,
      type: 'command',
    }),
  },
  Read: {
    icon: '📄',
    getDisplay: (input) => ({
      primary: input.file_path,
      secondary: input.offset
        ? `Lines ${input.offset}-${input.offset + (input.limit || 2000)}`
        : null,
      type: 'path',
    }),
  },
  Write: {
    icon: '✏️',
    getDisplay: (input) => ({
      primary: input.file_path,
      secondary: `${input.content?.length || 0} characters`,
      type: 'path',
    }),
  },
  Edit: {
    icon: '📝',
    getDisplay: (input) => ({
      primary: input.file_path,
      secondary: input.old_string
        ? `"${truncate(input.old_string, 50)}" → "${truncate(input.new_string, 50)}"`
        : null,
      type: 'path',
    }),
  },

  // Search operations
  Glob: {
    icon: '🔍',
    getDisplay: (input) => ({
      primary: input.pattern,
      secondary: input.path || 'current directory',
      type: 'pattern',
    }),
  },
  Grep: {
    icon: '🔎',
    getDisplay: (input) => ({
      primary: input.pattern,
      secondary: input.path || 'current directory',
      type: 'pattern',
    }),
  },

  // Task management
  TodoWrite: {
    icon: '☑️',
    getDisplay: (input) => ({
      primary: 'Update todo list',
      secondary: `${input.todos?.length || 0} items`,
      type: 'text',
    }),
  },
  Task: {
    icon: '🤖',
    getDisplay: (input) => ({
      primary: input.description || 'Run agent task',
      secondary: input.prompt ? truncate(input.prompt, 100) : null,
      type: 'text',
    }),
  },

  // Web operations
  WebFetch: {
    icon: '🌐',
    getDisplay: (input) => ({
      primary: input.url,
      secondary: input.prompt ? truncate(input.prompt, 80) : null,
      type: 'url',
    }),
  },
  WebSearch: {
    icon: '🔍',
    getDisplay: (input) => ({
      primary: input.query,
      secondary: null,
      type: 'text',
    }),
  },

  // Notebook
  NotebookEdit: {
    icon: '📓',
    getDisplay: (input) => ({
      primary: input.notebook_path,
      secondary: input.edit_mode || 'replace',
      type: 'path',
    }),
  },

  // MCP tools (prefixed with mcp__)
  // These will be caught by the MCP handler below

  // User interaction
  AskUserQuestion: {
    icon: '❓',
    getDisplay: (input) => ({
      primary: input.questions?.[0]?.question || 'Ask user',
      secondary: `${input.questions?.length || 1} question(s)`,
      type: 'text',
    }),
  },

  // Plan mode
  EnterPlanMode: {
    icon: '📋',
    getDisplay: () => ({
      primary: 'Enter plan mode',
      secondary: null,
      type: 'text',
    }),
  },
  ExitPlanMode: {
    icon: '✅',
    getDisplay: () => ({
      primary: 'Exit plan mode',
      secondary: null,
      type: 'text',
    }),
  },
};

/**
 * Format tool display information
 * @param {string} tool - Tool name
 * @param {object} input - Tool input parameters
 * @returns {object} Display configuration { icon, primary, secondary, type }
 */
export function formatToolDisplay(tool, input = {}) {
  // Check for known tool
  const config = TOOL_CONFIG[tool];
  if (config) {
    return {
      icon: config.icon,
      ...config.getDisplay(input),
    };
  }

  // Handle MCP tools (mcp__server__tool format)
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__');
    const server = parts[1] || 'mcp';
    const toolName = parts[2] || tool;

    // Get MCP-specific display based on known tools
    const mcpDisplay = getMcpToolDisplay(server, toolName, input);

    return {
      icon: mcpDisplay.icon || '🔌',
      primary: mcpDisplay.primary || toolName,
      secondary: mcpDisplay.secondary || `MCP: ${server}`,
      type: mcpDisplay.type || 'mcp',
    };
  }

  // Generic fallback for unknown tools
  return {
    icon: '⚡',
    primary: tool,
    secondary:
      Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : null,
    type: 'json',
  };
}

/**
 * Format tool for compact display (ToolGroup summary)
 * @param {string} tool - Tool name
 * @param {object} input - Tool input parameters
 * @returns {object} Compact display { icon, primary, type }
 */
export function formatToolCompact(tool, input = {}) {
  const display = formatToolDisplay(tool, input);
  return {
    icon: display.icon,
    primary: display.primary,
    type: display.type,
  };
}
