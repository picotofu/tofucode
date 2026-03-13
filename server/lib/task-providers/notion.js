/**
 * Notion Task Provider
 *
 * Raw fetch()-based Notion REST API client + TaskProvider adapter.
 * No npm dependencies — uses the built-in fetch() API.
 *
 * Notion API docs: https://developers.notion.com/reference
 */

import { logger } from '../logger.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Max chars per Notion rich_text block
const RICH_TEXT_CHUNK_SIZE = 2000;

// Notion property types that are auto-managed (skip in field analysis)
const AUTO_MANAGED_TYPES = new Set([
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'formula',
  'rollup',
  'unique_id',
]);

// ─── NotionAPI class ────────────────────────────────────────────────────────

class NotionAPIError extends Error {
  /**
   * @param {string} path - API path that failed
   * @param {number} status - HTTP status
   * @param {string} code - Notion error code
   * @param {string} message - Notion error message
   */
  constructor(path, status, code, message) {
    super(`Notion API error [${status}] ${path}: ${code} — ${message}`);
    this.name = 'NotionAPIError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

class NotionAPI {
  /**
   * @param {string} token - Notion Integration Token (secret_xxx)
   */
  constructor(token) {
    this.token = token;
  }

  /**
   * Make a Notion API call
   * @param {'GET'|'POST'|'PATCH'} method
   * @param {string} path - API path (e.g. '/databases/abc123')
   * @param {Object} [body] - Request body for POST/PATCH
   * @returns {Promise<Object>}
   */
  async call(method, path, body) {
    const url = `${NOTION_API_BASE}${path}`;
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const data = await response.json();

    if (!response.ok) {
      throw new NotionAPIError(
        path,
        response.status,
        data.code ?? 'unknown',
        data.message ?? 'Unknown error',
      );
    }

    return data;
  }

  /**
   * Test authentication — GET /v1/users/me
   * @returns {Promise<Object>} User object
   */
  async getMe() {
    return this.call('GET', '/users/me');
  }

  /**
   * Get a database schema — GET /v1/databases/{id}
   * @param {string} id - Database ID (32 hex chars)
   * @returns {Promise<Object>}
   */
  async getDatabase(id) {
    return this.call('GET', `/databases/${id}`);
  }

  /**
   * Create a page in a database — POST /v1/pages
   * @param {string} dbId - Database ID
   * @param {Object} properties - Notion property values
   * @param {Array} [children] - Page content blocks
   * @returns {Promise<Object>}
   */
  async createPage(dbId, properties, children = []) {
    return this.call('POST', '/pages', {
      parent: { database_id: dbId },
      properties,
      children,
    });
  }

  /**
   * Update page properties — PATCH /v1/pages/{id}
   * @param {string} pageId - Page ID
   * @param {Object} properties - Notion property values to update
   * @returns {Promise<Object>}
   */
  async updatePage(pageId, properties) {
    return this.call('PATCH', `/pages/${pageId}`, { properties });
  }

  /**
   * Append block children to a page — PATCH /v1/blocks/{id}/children
   * @param {string} pageId - Page ID (also a block)
   * @param {Array} children - Block children to append
   * @returns {Promise<Object>}
   */
  async appendBlockChildren(pageId, children) {
    return this.call('PATCH', `/blocks/${pageId}/children`, { children });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a Notion database ID from a URL.
 * Notion DB IDs are 32 hex chars, optionally hyphenated (UUID format).
 * @param {string} url
 * @returns {string|null}
 */
export function extractDatabaseId(url) {
  if (!url) return null;

  try {
    // Handle both URL formats:
    //   https://www.notion.so/workspace/Title-<32hex>
    //   https://www.notion.so/<32hex>?v=...
    const u = new URL(url);
    const pathname = u.pathname;

    // Remove hyphens and look for 32-char hex sequence
    const segments = pathname.split('/').filter(Boolean);

    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      // Strip hyphens, check for 32 hex chars
      const clean = segment.replace(/-/g, '');
      if (/^[0-9a-f]{32}$/i.test(clean)) {
        return clean;
      }
      // Sometimes the last segment is "Title-<32hex>"
      const match = segment.match(/([0-9a-f]{32})$/i);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Not a valid URL, try raw string
    const match = url.replace(/-/g, '').match(/([0-9a-f]{32})/i);
    if (match) return match[1];
  }

  return null;
}

/**
 * Map Notion database schema properties to FieldDefinition array.
 * Skips auto-managed types.
 * @param {Object} properties - Notion database properties object
 * @returns {import('./types.js').FieldDefinition[]}
 */
function analyseProperties(properties) {
  const fields = [];

  for (const [name, prop] of Object.entries(properties)) {
    const type = prop.type;

    if (AUTO_MANAGED_TYPES.has(type)) continue;

    let purpose = '';

    switch (type) {
      case 'title':
        purpose = 'Required. The main title of the ticket.';
        break;
      case 'rich_text':
        purpose = 'Text description or notes for the ticket.';
        break;
      case 'select': {
        const options = prop.select?.options?.map((o) => o.name) ?? [];
        purpose =
          options.length > 0
            ? `Pick one of: ${options.join(', ')}.`
            : 'Select a value.';
        break;
      }
      case 'status': {
        const statuses = prop.status?.options?.map((o) => o.name) ?? [];
        purpose =
          statuses.length > 0
            ? `Set initial status — pick one of: ${statuses.join(', ')}.`
            : 'Set the status.';
        break;
      }
      case 'multi_select': {
        const tags = prop.multi_select?.options?.map((o) => o.name) ?? [];
        purpose =
          tags.length > 0
            ? `Select one or more tags from: ${tags.join(', ')}.`
            : 'Select applicable tags.';
        break;
      }
      case 'checkbox':
        purpose = 'Set to true or false.';
        break;
      case 'number':
        purpose = 'Numeric value (e.g. priority score, story points).';
        break;
      case 'date':
        purpose = 'Date value in ISO 8601 format (YYYY-MM-DD).';
        break;
      case 'url':
        purpose = 'URL link relevant to the ticket.';
        break;
      case 'email':
        purpose = 'Email address.';
        break;
      case 'phone_number':
        purpose = 'Phone number.';
        break;
      case 'people':
        purpose = 'Assign people to this ticket.';
        break;
      case 'relation':
        purpose = 'Link to related page(s) in another database.';
        break;
      default:
        purpose = `Fill in the ${type} value.`;
    }

    fields.push({ field: name, type, purpose });
  }

  return fields;
}

/**
 * Build Notion property values from title and database schema.
 * Sets the title field only — body goes into page content children.
 * @param {string} title
 * @param {Object} schema - Raw Notion database properties schema
 * @returns {Object} Notion property values object
 */
function buildProperties(title, schema) {
  const properties = {};

  // Find the title property (type === 'title') from schema
  const titleKey = Object.keys(schema).find((k) => schema[k].type === 'title');
  if (titleKey) {
    properties[titleKey] = {
      title: [{ type: 'text', text: { content: title.substring(0, 2000) } }],
    };
  } else {
    logger.warn(
      '[Notion] Database schema has no title field — page will be created without a title',
    );
  }

  return properties;
}

/**
 * Split a long string into Notion rich_text content chunks (≤2000 chars each).
 * Plain text only — use buildRichText for strings that may contain URLs.
 * @param {string} text
 * @returns {Array} Array of rich_text objects
 */
function chunkRichText(text) {
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push({
      type: 'text',
      text: { content: text.substring(offset, offset + RICH_TEXT_CHUNK_SIZE) },
    });
    offset += RICH_TEXT_CHUNK_SIZE;
  }
  return chunks;
}

/**
 * Build rich_text array from a string, turning any URLs into clickable links.
 * Splits the text into interleaved plain and URL segments.
 * @param {string} text
 * @returns {Array} Array of rich_text objects
 */
function buildRichText(text) {
  const URL_REGEX = /https?:\/\/[^\s]+/g;
  const result = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    // Plain text before the URL
    if (match.index > lastIndex) {
      result.push(...chunkRichText(text.substring(lastIndex, match.index)));
    }
    // URL as a clickable link
    const url = match[0];
    result.push({
      type: 'text',
      text: { content: url, link: { url } },
    });
    lastIndex = match.index + url.length;
  }

  // Remaining plain text after last URL
  if (lastIndex < text.length) {
    result.push(...chunkRichText(text.substring(lastIndex)));
  }

  return result.length > 0 ? result : chunkRichText(text);
}

/**
 * Build page content children from body text.
 * Splits into paragraph blocks to respect 2000-char limit.
 * @param {string} body
 * @returns {Array} Notion block children
 */
function buildBodyChildren(body) {
  if (!body) return [];

  const children = [];
  // Split on double newlines to create separate paragraphs
  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());

  for (const paragraph of paragraphs) {
    // Build rich text with URL linking support
    const richText = buildRichText(paragraph);

    // Each chunk gets its own paragraph block (Notion limit: 100 rich_text per block)
    const BLOCK_CHUNK_SIZE = 100;
    for (let i = 0; i < richText.length; i += BLOCK_CHUNK_SIZE) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: richText.slice(i, i + BLOCK_CHUNK_SIZE),
        },
      });
    }
  }

  return children;
}

// ─── Provider factory ────────────────────────────────────────────────────────

/**
 * Create a Notion task provider instance.
 * @param {string} token - Notion Integration Token (secret_xxx)
 * @returns {import('./types.js').TaskProvider}
 */
export function createNotionProvider(token) {
  const api = new NotionAPI(token);

  return {
    name: 'notion',

    /**
     * Test the Notion API connection
     * @returns {Promise<import('./types.js').ConnectionTestResult>}
     */
    async testConnection() {
      try {
        const me = await api.getMe();
        const name = me.name || me.id || 'Unknown';
        return { success: true, message: `Connected as ${name}` };
      } catch (err) {
        logger.error('[Notion] testConnection error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Analyse a Notion database schema
     * @param {string} databaseUrl
     * @returns {Promise<import('./types.js').AnalyseResult>}
     */
    async analyseDatabase(databaseUrl) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) {
        return {
          success: false,
          error: 'Could not extract database ID from URL.',
        };
      }

      try {
        const db = await api.getDatabase(dbId);
        const fields = analyseProperties(db.properties || {});
        return { success: true, fields };
      } catch (err) {
        logger.error('[Notion] analyseDatabase error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Create a ticket in a Notion database
     * @param {import('./types.js').CreateTicketParams} params
     * @returns {Promise<import('./types.js').TicketResult>}
     */
    async createTicket({
      title,
      body,
      databaseUrl,
      fieldMappings: _fieldMappings,
    }) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) {
        return {
          success: false,
          reason: 'Could not extract database ID from URL.',
        };
      }

      try {
        // Fetch schema to find title field
        const db = await api.getDatabase(dbId);
        const schema = db.properties || {};

        const properties = buildProperties(title, schema);
        const children = buildBodyChildren(body);

        const page = await api.createPage(dbId, properties, children);
        const url =
          page.url || `https://notion.so/${page.id?.replace(/-/g, '')}`;

        return { success: true, url, pageId: page.id };
      } catch (err) {
        logger.error('[Notion] createTicket error:', err.message);
        return { success: false, reason: err.message };
      }
    },

    /**
     * Append an update to an existing ticket page
     * @param {import('./types.js').UpdateTicketParams} params
     * @returns {Promise<import('./types.js').TicketResult>}
     */
    async updateTicket({ pageId, appendText, properties }) {
      try {
        if (properties && Object.keys(properties).length > 0) {
          await api.updatePage(pageId, properties);
        }

        if (appendText) {
          const children = buildBodyChildren(appendText);
          if (children.length > 0) {
            await api.appendBlockChildren(pageId, children);
          }
        }

        return { success: true };
      } catch (err) {
        logger.error('[Notion] updateTicket error:', err.message);
        return { success: false, reason: err.message };
      }
    },

    /**
     * Build Notion status property value for a given status name.
     * Used to set In Progress / Done etc. on a ticket.
     * @param {string} statusFieldName - Field name in the database
     * @param {string} statusValue - Status option name (e.g. "In Progress")
     * @returns {Object} Notion property value object
     */
    buildStatusProperty(statusFieldName, statusValue) {
      return {
        [statusFieldName]: { status: { name: statusValue } },
      };
    },
  };
}
