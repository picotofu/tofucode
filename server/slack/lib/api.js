/**
 * Slack Web API Wrapper
 *
 * Direct fetch()-based wrapper for Slack Web API.
 * Does NOT use Slack MCP — MCP is reserved for interactive session use only.
 * Posts as user identity via xoxp- token.
 */

import { logger } from '../../lib/logger.js';

const SLACK_API_BASE = 'https://slack.com/api';

class SlackAPIError extends Error {
  /**
   * @param {string} method - API method that failed
   * @param {string} errorCode - Slack error code
   * @param {Object} rawResponse - Full Slack response
   */
  constructor(method, errorCode, rawResponse) {
    super(`Slack API error: ${method} -> ${errorCode}`);
    this.name = 'SlackAPIError';
    this.code = errorCode;
    this.method = method;
    this.raw = rawResponse;
  }
}

/**
 * Sleep helper for rate limit backoff
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SlackAPI {
  /**
   * @param {string} token - Slack xoxp- user token
   */
  constructor(token) {
    this.token = token;
  }

  /**
   * Make a Slack Web API call
   * @param {string} method - API method name (e.g. 'chat.postMessage')
   * @param {Object} params - Request body parameters
   * @param {number} [_retryCount=0] - Internal retry counter
   * @returns {Promise<Object>} Slack API response
   */
  async call(method, params = {}, _retryCount = 0) {
    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!data.ok) {
      // Handle rate limiting with single retry
      if (data.error === 'ratelimited' && _retryCount < 2) {
        const retryAfter = Number.parseInt(
          response.headers.get('Retry-After') || '5',
          10,
        );
        logger.warn(
          `[Slack API] Rate limited on ${method}, retrying in ${retryAfter}s (attempt ${_retryCount + 1})`,
        );
        await sleep(retryAfter * 1000);
        return this.call(method, params, _retryCount + 1);
      }
      throw new SlackAPIError(method, data.error, data);
    }

    return data;
  }

  // --- Convenience Methods ---

  /**
   * Post a message to a channel
   * @param {string} channel - Channel ID
   * @param {string} text - Message text
   * @param {Object} [opts] - Additional options (blocks, unfurl_links, etc.)
   * @returns {Promise<Object>} Response with ts, channel, message
   */
  async postMessage(channel, text, opts = {}) {
    return this.call('chat.postMessage', { channel, text, ...opts });
  }

  /**
   * Reply in a thread
   * @param {string} channel - Channel ID
   * @param {string} threadTs - Parent message timestamp
   * @param {string} text - Reply text
   * @param {Object} [opts] - Additional options
   * @returns {Promise<Object>}
   */
  async postThreadReply(channel, threadTs, text, opts = {}) {
    return this.call('chat.postMessage', {
      channel,
      text,
      thread_ts: threadTs,
      ...opts,
    });
  }

  /**
   * Get message replies in a thread
   * @param {string} channel - Channel ID
   * @param {string} threadTs - Thread parent timestamp
   * @param {number} [limit=20] - Max messages to return
   * @returns {Promise<Object>} Response with messages array
   */
  async getThreadHistory(channel, threadTs, limit = 20) {
    return this.call('conversations.replies', {
      channel,
      ts: threadTs,
      limit,
    });
  }

  /**
   * Get recent messages from a channel
   * @param {string} channel - Channel ID
   * @param {number} [limit=10] - Max messages to return
   * @returns {Promise<Object>} Response with messages array
   */
  async getChannelHistory(channel, limit = 10) {
    return this.call('conversations.history', { channel, limit });
  }

  /**
   * Add an emoji reaction to a message
   * @param {string} channel - Channel ID
   * @param {string} timestamp - Message timestamp
   * @param {string} name - Emoji name (without colons)
   * @returns {Promise<Object>}
   */
  async addReaction(channel, timestamp, name) {
    return this.call('reactions.add', { channel, timestamp, name });
  }

  /**
   * Get user info by user ID
   * @param {string} userId - Slack user ID
   * @returns {Promise<Object>} Response with user object
   */
  async getUserInfo(userId) {
    return this.call('users.info', { user: userId });
  }

  /**
   * Get channel info
   * @param {string} channel - Channel ID
   * @returns {Promise<Object>} Response with channel object
   */
  async getChannelInfo(channel) {
    return this.call('conversations.info', { channel });
  }

  /**
   * Get a permanent link for a message
   * @param {string} channel - Channel ID
   * @param {string} messageTs - Message timestamp
   * @returns {Promise<string|null>} Permalink URL or null on failure
   */
  async getPermalink(channel, messageTs) {
    try {
      const data = await this.call('chat.getPermalink', {
        channel,
        message_ts: messageTs,
      });
      return data.permalink ?? null;
    } catch (err) {
      logger.warn('[Slack API] getPermalink failed:', err.message);
      return null;
    }
  }

  /**
   * Test authentication and get bot identity
   * @returns {Promise<Object>} Response with user_id, user, team, team_id
   */
  async authTest() {
    return this.call('auth.test');
  }
}

/**
 * Create a new Slack API client
 * @param {string} token - Slack xoxp- user token
 * @returns {SlackAPI}
 */
export function createSlackAPI(token) {
  return new SlackAPI(token);
}

export { SlackAPIError };
