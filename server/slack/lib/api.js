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
    /** @type {Map<string, string>} */
    this._userNameCache = new Map();
  }

  /**
   * Make a Slack Web API call via GET with query string params.
   * Some read-only endpoints (e.g. conversations.list) ignore certain params
   * when sent as POST JSON body — use this for those.
   * @param {string} method
   * @param {Object} params
   * @param {number} [_retryCount=0]
   * @returns {Promise<Object>}
   */
  async get(method, params = {}, _retryCount = 0) {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ),
    );
    const response = await fetch(`${SLACK_API_BASE}/${method}?${qs}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    });

    const data = await response.json();

    if (!data.ok) {
      if (data.error === 'ratelimited' && _retryCount < 2) {
        const retryAfter = Number.parseInt(
          response.headers.get('Retry-After') || '5',
          10,
        );
        logger.warn(
          `[Slack API] Rate limited on ${method}, retrying in ${retryAfter}s (attempt ${_retryCount + 1})`,
        );
        await sleep(retryAfter * 1000);
        return this.get(method, params, _retryCount + 1);
      }
      throw new SlackAPIError(method, data.error, data);
    }

    return data;
  }

  /**
   * Make a Slack Web API call via POST with JSON body.
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
    return this.get('conversations.replies', {
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
    return this.get('conversations.history', { channel, limit });
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
    return this.get('users.info', { user: userId });
  }

  /**
   * Resolve a Slack user ID to a display name.
   * Results are cached in-memory for the lifetime of the API instance.
   * Falls back to the raw user ID if resolution fails.
   * @param {string} userId - Slack user ID
   * @returns {Promise<string>} Display name or user ID as fallback
   */
  async getUserName(userId) {
    if (!userId) return 'unknown';
    if (this._userNameCache.has(userId)) return this._userNameCache.get(userId);
    try {
      const info = await this.getUserInfo(userId);
      // display_name can be an empty string — skip it if blank
      const name =
        info.user?.profile?.display_name?.trim() ||
        info.user?.real_name?.trim() ||
        info.user?.name?.trim() ||
        userId;
      this._userNameCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
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
      const data = await this.get('chat.getPermalink', {
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

  /**
   * Get the list of user IDs in a usergroup (subteam)
   * @param {string} usergroupId - Subteam ID (e.g. 'S0AAV3SB925')
   * @returns {Promise<string[]>} Array of user IDs, or empty array on failure
   */
  async getUsergroupMembers(usergroupId) {
    try {
      const data = await this.get('usergroups.users.list', {
        usergroup: usergroupId,
      });
      return data.users ?? [];
    } catch (err) {
      logger.warn(
        `[Slack API] getUsergroupMembers(${usergroupId}) failed:`,
        err.message,
      );
      return [];
    }
  }

  /**
   * List all channels the token has access to (public + private).
   *
   * Slack API quirk with xoxp- tokens:
   * - types=public_channel,private_channel only returns public channels
   * - types=private_channel correctly returns only private channels
   * So we fetch each type separately and merge by ID.
   * @returns {Promise<Array<{id: string, name: string, is_private: boolean, is_member: boolean}>>}
   */
  async listChannels() {
    const fetchType = async (types) => {
      const results = [];
      let cursor = '';
      do {
        const params = { types, exclude_archived: true, limit: 200 };
        if (cursor) params.cursor = cursor;
        const data = await this.get('conversations.list', params);
        for (const ch of data.channels || []) {
          results.push({
            id: ch.id,
            name: ch.name,
            is_private: ch.is_private ?? false,
            is_member: ch.is_member ?? false,
          });
        }
        cursor = data.response_metadata?.next_cursor || '';
      } while (cursor);
      return results;
    };

    const [publicChannels, privateChannels] = await Promise.all([
      fetchType('public_channel'),
      fetchType('private_channel'),
    ]);

    // Merge by ID — private fetch has correct is_private=true, public has is_private=false
    const map = new Map(publicChannels.map((ch) => [ch.id, ch]));
    for (const ch of privateChannels) {
      map.set(ch.id, ch);
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
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
