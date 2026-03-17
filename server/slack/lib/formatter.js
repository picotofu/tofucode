/**
 * Slack mrkdwn Formatter
 *
 * Utilities for formatting text in Slack's mrkdwn syntax.
 * Slack uses its own markdown variant, not standard Markdown.
 *
 * Reference: https://api.slack.com/reference/surfaces/formatting
 */

/**
 * Format text as bold
 * @param {string} text
 * @returns {string}
 */
export function bold(text) {
  return `*${text}*`;
}

/**
 * Format text as italic
 * @param {string} text
 * @returns {string}
 */
export function italic(text) {
  return `_${text}_`;
}

/**
 * Format text as inline code
 * @param {string} text
 * @returns {string}
 */
export function code(text) {
  return `\`${text}\``;
}

/**
 * Format text as a code block
 * @param {string} text
 * @param {string} [lang] - Language hint (Slack ignores this, but included for clarity)
 * @returns {string}
 */
export function codeBlock(text, lang = '') {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

/**
 * Format text as a blockquote
 * @param {string} text
 * @returns {string}
 */
export function blockquote(text) {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Format a user mention
 * @param {string} userId - Slack user ID
 * @returns {string}
 */
export function mentionUser(userId) {
  return `<@${userId}>`;
}

/**
 * Format a channel mention
 * @param {string} channelId - Slack channel ID
 * @returns {string}
 */
export function mentionChannel(channelId) {
  return `<#${channelId}>`;
}

/**
 * Format a link
 * @param {string} url
 * @param {string} [text] - Display text
 * @returns {string}
 */
export function link(url, text) {
  if (text) return `<${url}|${text}>`;
  return `<${url}>`;
}

/**
 * Format a bullet list
 * @param {string[]} items
 * @returns {string}
 */
export function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * Build a thread context summary from message history
 * @param {Array} messages - Slack messages array
 * @param {number} [maxMessages=10] - Maximum messages to include
 * @param {((userId: string) => Promise<string>)|null} [resolveName=null] - Optional async resolver for user IDs to display names
 * @returns {Promise<string>} Formatted thread summary
 */
export async function formatThreadContext(
  messages,
  maxMessages = 10,
  resolveName = null,
) {
  if (!messages?.length) return '(no thread history)';

  const slice = messages.slice(-maxMessages);

  // Pre-resolve all unique user IDs in one pass
  if (resolveName) {
    const userIds = [...new Set(slice.map((m) => m.user).filter(Boolean))];
    const nameMap = Object.fromEntries(
      await Promise.all(userIds.map(async (id) => [id, await resolveName(id)])),
    );
    return slice
      .map((msg) => {
        const name = msg.user ? (nameMap[msg.user] ?? msg.user) : 'unknown';
        return `${name}: ${msg.text || '(empty)'}`;
      })
      .join('\n');
  }

  return slice
    .map((msg) => {
      const user = msg.user ? `<@${msg.user}>` : 'unknown';
      return `${user}: ${msg.text || '(empty)'}`;
    })
    .join('\n');
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(text, maxLen = 3000) {
  if (!text || text.length <= maxLen) return text;
  return `${text.substring(0, maxLen - 3)}...`;
}
