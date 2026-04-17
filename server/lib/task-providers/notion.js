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
   * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
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
   * Update database properties — PATCH /v1/databases/{id}
   * Used to add new select/multi_select options to the schema (Notion merges, not replaces).
   * @param {string} id - Database ID
   * @param {Object} properties - Property updates to merge
   * @returns {Promise<Object>}
   */
  async updateDatabase(id, properties) {
    return this.call('PATCH', `/databases/${id}`, { properties });
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

  /**
   * Get a page by ID — GET /v1/pages/{id}
   * @param {string} pageId - Page ID
   * @returns {Promise<Object>}
   */
  async getPage(pageId) {
    return this.call('GET', `/pages/${pageId}`);
  }

  /**
   * List all workspace users — GET /v1/users
   * @returns {Promise<Object>}
   */
  async listUsers() {
    return this.call('GET', '/users');
  }

  /**
   * Get block children for a page — GET /v1/blocks/{id}/children
   * @param {string} pageId - Page ID (also a block)
   * @param {string} [cursor] - Pagination cursor
   * @returns {Promise<Object>}
   */
  async getBlockChildren(pageId, cursor) {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    return this.call('GET', `/blocks/${pageId}/children?${params}`);
  }

  /**
   * Query a database — POST /v1/databases/{id}/query
   * @param {string} dbId - Database ID
   * @param {Object} [body] - Query body (filter, sorts, page_size, start_cursor)
   * @returns {Promise<Object>}
   */
  async queryDatabase(dbId, body = {}) {
    return this.call('POST', `/databases/${dbId}/query`, body);
  }

  /**
   * Delete a block — DELETE /v1/blocks/{id}
   * @param {string} blockId - Block ID to delete
   * @returns {Promise<Object>}
   */
  async deleteBlock(blockId) {
    return this.call('DELETE', `/blocks/${blockId}`);
  }

  /**
   * Archive (soft-delete) a page — PATCH /v1/pages/{id}
   * Notion doesn't expose a hard-delete API; archiving is the equivalent.
   * @param {string} pageId - Page ID
   * @returns {Promise<Object>}
   */
  async archivePage(pageId) {
    return this.call('PATCH', `/pages/${pageId}`, { archived: true });
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

/**
 * Extract plain text from a Notion rich_text array.
 * @param {Array} richText
 * @returns {string}
 */
function extractPlainText(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text ?? t.text?.content ?? '').join('');
}

/**
 * Extract the unique_id string (e.g. "AOB-123") from a Notion page properties object.
 * @param {Object} properties
 * @returns {string|undefined}
 */
function extractPageUniqueId(properties) {
  for (const prop of Object.values(properties)) {
    if (prop.type === 'unique_id' && prop.unique_id?.number != null) {
      const { prefix, number } = prop.unique_id;
      return prefix ? `${prefix}-${number}` : String(number);
    }
  }
  return undefined;
}

/**
 * Extract the title string from a Notion page properties object.
 * Finds the first property with type === 'title'.
 * @param {Object} properties
 * @returns {string}
 */
function extractPageTitle(properties) {
  for (const prop of Object.values(properties)) {
    if (prop.type === 'title') {
      return extractPlainText(prop.title);
    }
  }
  return '';
}

/**
 * Extract the status string from a Notion page properties object.
 * When a statusField name is provided (from fieldMappings), uses it directly.
 * Otherwise falls back to scanning for the first non-null status/select property.
 * @param {Object} properties
 * @param {string|null} [statusField] - Known status field name from fieldMappings
 * @returns {string|undefined}
 */
function extractPageStatus(properties, statusField) {
  // Prefer direct lookup when field name is known
  if (statusField && properties[statusField]) {
    const prop = properties[statusField];
    if (prop.type === 'status') return prop.status?.name;
    if (prop.type === 'select') return prop.select?.name;
  }

  // Fallback: prefer 'status' type across all props before falling back to 'select'
  const propValues = Object.values(properties);
  for (const prop of propValues) {
    if (prop.type === 'status' && prop.status?.name) return prop.status.name;
  }
  for (const prop of propValues) {
    if (prop.type === 'select' && prop.select?.name) return prop.select.name;
  }
  return undefined;
}

/**
 * Extract labels from a Notion page properties object.
 * Returns an array of { name, color } objects for the known labelField.
 * @param {Object} properties
 * @param {string|null} [labelField] - Known multi_select field name from fieldMappings
 * @returns {Array<{name: string, color: string}>}
 */
function extractPageLabels(properties, labelField) {
  if (labelField && properties[labelField]) {
    const prop = properties[labelField];
    if (prop.type === 'multi_select' && Array.isArray(prop.multi_select)) {
      return prop.multi_select.map((o) => ({
        name: o.name,
        color: o.color ?? 'default',
      }));
    }
    if (prop.type === 'select' && prop.select?.name) {
      return [
        { name: prop.select.name, color: prop.select.color ?? 'default' },
      ];
    }
  }
  return [];
}

/**
 * Extract assignee names from a Notion page properties object.
 * Uses the known assigneeField name when provided, otherwise scans for the first people property.
 * @param {Object} properties
 * @param {string|null} [assigneeField] - Known assignee field name from fieldMappings
 * @returns {string[]} Array of assignee display names
 */
function extractPageAssignees(properties, assigneeField) {
  const pick = (prop) => {
    if (prop.type === 'people' && Array.isArray(prop.people)) {
      return prop.people.map((p) => p.name || p.id).filter(Boolean);
    }
    return null;
  };

  if (assigneeField && properties[assigneeField]) {
    const result = pick(properties[assigneeField]);
    if (result) return result;
  }

  for (const prop of Object.values(properties)) {
    const result = pick(prop);
    if (result?.length) return result;
  }
  return [];
}

/**
 * Fetch all block children for a page, following pagination.
 * Returns a flat array of all top-level block objects.
 * Capped at 10 pages (1000 blocks) to prevent runaway requests on very large pages.
 * @param {NotionAPI} api
 * @param {string} pageId
 * @returns {Promise<Array>}
 */
async function fetchAllBlocks(api, pageId) {
  const blocks = [];
  let cursor;
  let pages = 0;
  const MAX_PAGES = 10;

  do {
    const res = await api.getBlockChildren(pageId, cursor);
    blocks.push(...(res.results ?? []));
    cursor = res.next_cursor ?? undefined;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  return blocks;
}

/**
 * Convert a flat array of Notion blocks to a plain text string.
 * Handles paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item,
 * to_do, callout, quote, and code blocks.
 * @param {Array} blocks
 * @returns {string}
 */
function blocksToPlainText(blocks) {
  return blocks
    .map((block) => {
      const type = block.type;
      const content = block[type];
      if (!content) return '';

      switch (type) {
        case 'paragraph':
          return extractPlainText(content.rich_text);
        case 'heading_1':
          return `# ${extractPlainText(content.rich_text)}`;
        case 'heading_2':
          return `## ${extractPlainText(content.rich_text)}`;
        case 'heading_3':
          return `### ${extractPlainText(content.rich_text)}`;
        case 'bulleted_list_item':
          return `- ${extractPlainText(content.rich_text)}`;
        case 'numbered_list_item':
          return `1. ${extractPlainText(content.rich_text)}`;
        case 'to_do':
          return `[${content.checked ? 'x' : ' '}] ${extractPlainText(content.rich_text)}`;
        case 'callout':
        case 'quote':
        case 'code':
          return extractPlainText(content.rich_text);
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Find the Notion person user ID for a given email address.
 * Calls GET /v1/users and matches by person.email.
 * Returns null if not found or on error.
 * @param {NotionAPI} api
 * @param {string} email
 * @returns {Promise<string|null>}
 */
async function resolveUserIdByEmail(api, email) {
  if (!email) return null;
  try {
    const res = await api.listUsers();
    const users = res.results ?? [];
    const match = users.find(
      (u) => u.type === 'person' && u.person?.email === email,
    );
    return match?.id ?? null;
  } catch (err) {
    logger.warn('[Notion] resolveUserIdByEmail error:', err.message);
    return null;
  }
}

/**
 * Extract all configured field values from a page's properties.
 * Returns a map of fieldName → { type, value } for all field mappings.
 * @param {Object} properties - Raw Notion page properties
 * @param {Array<{field: string, type: string}>} fieldMappings
 * @returns {Object}
 */
function extractAllProperties(properties, fieldMappings) {
  const result = {};
  for (const mapping of fieldMappings) {
    const prop = properties[mapping.field];
    if (!prop) continue;
    const entry = { type: prop.type, value: null };
    switch (prop.type) {
      case 'title':
        entry.value = extractPlainText(prop.title);
        break;
      case 'rich_text':
        entry.value = extractPlainText(prop.rich_text);
        break;
      case 'select':
        entry.value = prop.select?.name ?? null;
        break;
      case 'status':
        entry.value = prop.status?.name ?? null;
        break;
      case 'multi_select':
        entry.value = (prop.multi_select ?? []).map((o) => ({
          name: o.name,
          color: o.color ?? 'default',
        }));
        break;
      case 'people':
        entry.value = (prop.people ?? []).map((p) => ({
          id: p.id,
          name: p.name || p.id,
        }));
        break;
      case 'checkbox':
        entry.value = prop.checkbox ?? false;
        break;
      case 'number':
        entry.value = prop.number ?? null;
        break;
      case 'date':
        entry.value = prop.date?.start ?? null;
        break;
      case 'url':
        entry.value = prop.url ?? null;
        break;
      case 'email':
        entry.value = prop.email ?? null;
        break;
      case 'phone_number':
        entry.value = prop.phone_number ?? null;
        break;
      default:
        entry.value = null;
    }
    result[mapping.field] = entry;
  }
  return result;
}

/**
 * Extract dropdown options for select/status/multi_select fields from a DB schema.
 * @param {Object} schema - Notion database properties schema
 * @param {Array<{field: string, type: string}>} fieldMappings
 * @returns {Object} Map of fieldName → Array<{name: string, color: string}>
 */
function extractFieldOptions(schema, fieldMappings) {
  const result = {};
  for (const mapping of fieldMappings) {
    const prop = schema[mapping.field];
    if (!prop) continue;
    if (prop.type === 'select') {
      result[mapping.field] = (prop.select?.options ?? []).map((o) => ({
        name: o.name,
        color: o.color ?? 'default',
      }));
    } else if (prop.type === 'status') {
      result[mapping.field] = (prop.status?.options ?? []).map((o) => ({
        name: o.name,
        color: o.color ?? 'default',
      }));
    } else if (prop.type === 'multi_select') {
      result[mapping.field] = (prop.multi_select?.options ?? []).map((o) => ({
        name: o.name,
        color: o.color ?? 'default',
      }));
    }
  }
  return result;
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
      assigneeId,
      assigneeField,
      labelValue,
      labelField,
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

        // Set assignee if provided and the field exists in the schema
        if (
          assigneeId &&
          assigneeField &&
          schema[assigneeField]?.type === 'people'
        ) {
          properties[assigneeField] = {
            people: [{ object: 'user', id: assigneeId }],
          };
        }

        // Set label if provided and field exists in schema
        if (labelValue && labelField && schema[labelField]) {
          const labelPropType = schema[labelField].type;
          if (labelPropType === 'select') {
            properties[labelField] = { select: { name: labelValue } };
          } else if (labelPropType === 'multi_select') {
            const names = Array.isArray(labelValue) ? labelValue : [labelValue];
            properties[labelField] = {
              multi_select: names.map((n) => ({ name: n })),
            };
          }
        }

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
        return { success: false, error: err.message };
      }
    },

    /**
     * Archive (soft-delete) a ticket page
     * @param {string} pageId
     * @returns {Promise<import('./types.js').TicketResult>}
     */
    async deleteTicket(pageId) {
      try {
        await api.archivePage(pageId);
        return { success: true };
      } catch (err) {
        logger.error('[Notion] deleteTicket error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Fetch a ticket's properties and page body content
     * @param {string} pageId
     * @param {string} [statusField] - Known status field name from fieldMappings
     * @param {string} [assigneeField] - Known assignee field name from fieldMappings
     * @param {Array} [fieldMappings] - Full field mappings for extracting all properties
     * @param {string} [databaseUrl] - Database URL for fetching field options
     * @returns {Promise<import('./types.js').FetchTicketResult>}
     */
    async fetchTicket(
      pageId,
      statusField,
      assigneeField,
      fieldMappings,
      databaseUrl,
    ) {
      try {
        const page = await api.getPage(pageId);
        const props = page.properties ?? {};
        const title = extractPageTitle(props);
        const status = extractPageStatus(props, statusField);
        const assignees = extractPageAssignees(props, assigneeField);
        const ticketId = extractPageUniqueId(props);
        const url = page.url || `https://notion.so/${pageId.replace(/-/g, '')}`;
        const lastEditedAt = page.last_edited_time;

        // Extract all configured field values
        const properties = fieldMappings?.length
          ? extractAllProperties(props, fieldMappings)
          : {};

        // Fetch field options (select/status/multi_select) from DB schema
        let fieldOptions = {};
        if (fieldMappings?.length && databaseUrl) {
          const dbId = extractDatabaseId(databaseUrl);
          if (dbId) {
            const db = await api.getDatabase(dbId);
            fieldOptions = extractFieldOptions(
              db.properties ?? {},
              fieldMappings,
            );
          }
        }

        const blocks = await fetchAllBlocks(api, pageId);
        const body = blocksToPlainText(blocks);

        return {
          success: true,
          pageId,
          ticketId,
          title,
          url,
          status,
          assignees,
          body,
          lastEditedAt,
          properties,
          fieldOptions,
          fieldMappings: fieldMappings ?? [],
        };
      } catch (err) {
        logger.error('[Notion] fetchTicket error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * List tickets from a Notion database
     * @param {import('./types.js').ListTicketsParams} params
     * @returns {Promise<import('./types.js').ListTicketsResult>}
     */
    async listTickets({
      databaseUrl,
      limit = 20,
      cursor,
      filterByUserId,
      assigneeField,
      statusField,
      labelField,
      archiveField,
      filterByStatus,
      titleSearch,
    }) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) {
        return {
          success: false,
          error: 'Could not extract database ID from URL.',
        };
      }

      try {
        const queryBody = { page_size: limit };
        if (cursor) queryBody.start_cursor = cursor;

        const conditions = [];

        // Assignee filter (self only)
        if (filterByUserId && assigneeField) {
          conditions.push({
            property: assigneeField,
            people: { contains: filterByUserId },
          });
        }

        // Status filter
        if (filterByStatus && statusField) {
          if (filterByStatus === '__none__') {
            // Filter to tickets with no status set
            conditions.push({
              property: statusField,
              status: { is_empty: true },
            });
          } else {
            conditions.push({
              property: statusField,
              status: { equals: filterByStatus },
            });
          }
        }

        // Exclude archived tickets (custom Archive formula field = "archive")
        if (archiveField) {
          conditions.push({
            property: archiveField,
            formula: { string: { does_not_equal: 'archive' } },
          });
        }

        // Title fuzzy search (Notion "contains" on title)
        if (titleSearch?.trim()) {
          conditions.push({
            property: 'title',
            title: { contains: titleSearch.trim() },
          });
        }

        if (conditions.length === 1) {
          queryBody.filter = conditions[0];
        } else if (conditions.length > 1) {
          queryBody.filter = { and: conditions };
        }

        // Sort: last_edited_time descending — most recently touched first
        queryBody.sorts = [
          { timestamp: 'last_edited_time', direction: 'descending' },
        ];

        const res = await api.queryDatabase(dbId, queryBody);

        const tickets = (res.results ?? []).map((page) => {
          const props = page.properties ?? {};
          const archiveStatus =
            archiveField && props[archiveField]?.type === 'formula'
              ? (props[archiveField].formula?.string ?? null)
              : null;
          return {
            pageId: page.id,
            ticketId: extractPageUniqueId(props),
            title: extractPageTitle(props),
            url: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
            status: extractPageStatus(props, statusField),
            assignees: extractPageAssignees(props, assigneeField),
            labels: extractPageLabels(props, labelField),
            lastEditedAt: page.last_edited_time,
            archived: page.archived ?? false,
            archiveStatus,
          };
        });

        return {
          success: true,
          tickets,
          nextCursor: res.next_cursor ?? undefined,
        };
      } catch (err) {
        logger.error('[Notion] listTickets error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Resolve a Notion person user ID from an email address.
     * @param {string} email
     * @returns {Promise<string|null>}
     */
    async resolveUserId(email) {
      return resolveUserIdByEmail(api, email);
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

    /**
     * Get available status options from the database schema.
     * Returns the named options plus a sentinel for no-status.
     * @param {string} databaseUrl
     * @param {string} statusField - Status field name from fieldMappings
     * @returns {Promise<{ success: boolean, options?: string[], error?: string }>}
     */
    async getStatusOptions(databaseUrl, statusField) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) {
        return {
          success: false,
          error: 'Could not extract database ID from URL.',
        };
      }
      try {
        const db = await api.getDatabase(dbId);
        const prop = db.properties?.[statusField];

        let options;
        if (prop?.type === 'status' && prop.status?.groups?.length) {
          // Status field: sort options by group order (To-do → In Progress → Done),
          // then by position within each group.
          const optionById = Object.fromEntries(
            (prop.status.options ?? []).map((o) => [o.id, o.name]),
          );
          options = prop.status.groups.flatMap((g) =>
            (g.option_ids ?? []).map((id) => optionById[id]).filter(Boolean),
          );
        } else {
          // Select / multi_select: preserve Notion's user-defined option order.
          options = (prop?.select?.options ?? []).map((o) => o.name);
        }

        return { success: true, options };
      } catch (err) {
        logger.error('[Notion] getStatusOptions error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Get options for any select/multi_select/status field from the database schema.
     * Returns [{name, color}] suitable for dropdown rendering.
     * @param {string} databaseUrl
     * @param {string} fieldName - Property name (e.g. "Label")
     * @returns {Promise<{ success: boolean, options?: Array<{name: string, color: string}>, error?: string }>}
     */
    async getFieldOptions(databaseUrl, fieldName) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) return { success: false, error: 'Invalid database URL.' };
      try {
        const db = await api.getDatabase(dbId);
        const prop = db.properties?.[fieldName];
        if (!prop) return { success: true, options: [] };
        let options = [];
        if (prop.type === 'select') {
          options = (prop.select?.options ?? []).map((o) => ({
            name: o.name,
            color: o.color ?? 'default',
          }));
        } else if (prop.type === 'multi_select') {
          options = (prop.multi_select?.options ?? []).map((o) => ({
            name: o.name,
            color: o.color ?? 'default',
          }));
        } else if (prop.type === 'status') {
          options = (prop.status?.options ?? []).map((o) => ({
            name: o.name,
            color: o.color ?? 'default',
          }));
        }
        return { success: true, options };
      } catch (err) {
        logger.error('[Notion] getFieldOptions error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * List unique assignees from actual tickets in the database.
     * Queries up to 100 pages without filters and collects unique people.
     * @param {string} databaseUrl
     * @param {string|null} assigneeField - Known assignee field name
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async listAssigneesFromDb(databaseUrl, assigneeField) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) return [];
      try {
        const res = await api.queryDatabase(dbId, {
          page_size: 100,
          sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        });

        const seen = new Map(); // id → name
        for (const page of res.results ?? []) {
          const props = page.properties ?? {};
          // Prefer known assignee field; fall back to scanning for people type
          const candidates = assigneeField
            ? [props[assigneeField]].filter(Boolean)
            : Object.values(props).filter((p) => p.type === 'people');
          for (const prop of candidates) {
            if (prop.type === 'people' && Array.isArray(prop.people)) {
              for (const person of prop.people) {
                if (person.id && !seen.has(person.id)) {
                  seen.set(person.id, person.name || person.id);
                }
              }
            }
          }
        }

        return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
      } catch (err) {
        logger.warn('[Notion] listAssigneesFromDb error:', err.message);
        return [];
      }
    },

    /**
     * List all workspace users (people type only).
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async listWorkspaceUsers() {
      try {
        const res = await api.listUsers();
        return (res.results ?? [])
          .filter((u) => u.type === 'person' && u.id)
          .map((u) => ({
            id: u.id,
            name: u.name || u.id,
            email: u.person?.email ?? null,
          }));
      } catch (err) {
        logger.warn('[Notion] listWorkspaceUsers error:', err.message);
        return [];
      }
    },

    /**
     * Get the Notion user ID of the token owner (integration user).
     * @returns {Promise<string|null>}
     */
    async getSelfId() {
      try {
        const me = await api.getMe();
        return me.id ?? null;
      } catch (err) {
        logger.warn('[Notion] getSelfId error:', err.message);
        return null;
      }
    },

    /**
     * Fetch comments on a Notion page.
     * @param {string} pageId
     * @returns {Promise<Array<{id, createdTime, createdBy, content}>>}
     */
    async getComments(pageId) {
      try {
        const res = await api.call('GET', `/comments?block_id=${pageId}`);
        return (res.results ?? []).map((c) => ({
          id: c.id,
          createdTime: c.created_time,
          createdBy: c.created_by?.id || 'Unknown',
          content: extractPlainText(c.rich_text ?? []),
        }));
      } catch (err) {
        logger.warn('[Notion] getComments error:', err.message);
        return [];
      }
    },

    /**
     * Add a comment to a Notion page.
     * @param {string} pageId
     * @param {string} content
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async addComment(pageId, content) {
      try {
        await api.call('POST', '/comments', {
          parent: { page_id: pageId },
          rich_text: [{ type: 'text', text: { content } }],
        });
        return { success: true };
      } catch (err) {
        logger.error('[Notion] addComment error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Build a Notion property value object from a field name, type, and value.
     * Used for arbitrary field updates from the frontend.
     * @param {string} fieldName
     * @param {string} fieldType - Notion property type
     * @param {*} value
     * @returns {Object|null}
     */
    buildPropertyValue(fieldName, fieldType, value) {
      switch (fieldType) {
        case 'title':
          return {
            [fieldName]: {
              title: [
                {
                  type: 'text',
                  text: { content: String(value ?? '').substring(0, 2000) },
                },
              ],
            },
          };
        case 'rich_text':
          return {
            [fieldName]: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: String(value ?? '').substring(0, 2000) },
                },
              ],
            },
          };
        case 'select':
          return { [fieldName]: { select: value ? { name: value } : null } };
        case 'status':
          return { [fieldName]: { status: value ? { name: value } : null } };
        case 'multi_select':
          return {
            [fieldName]: {
              multi_select: (value ?? []).map((name) => ({ name })),
            },
          };
        case 'checkbox':
          return { [fieldName]: { checkbox: !!value } };
        case 'number':
          return {
            [fieldName]: { number: value != null ? Number(value) : null },
          };
        case 'date':
          return { [fieldName]: { date: value ? { start: value } : null } };
        case 'people':
          // value: userId string | null
          return {
            [fieldName]: {
              people: value ? [{ object: 'user', id: value }] : [],
            },
          };
        case 'url':
          return { [fieldName]: { url: value || null } };
        case 'email':
          return { [fieldName]: { email: value || null } };
        case 'phone_number':
          return { [fieldName]: { phone_number: value || null } };
        default:
          return null;
      }
    },

    /**
     * Add a new option to a select or multi_select field on the database schema.
     * Notion's PATCH /databases/{id} merges options — existing ones are preserved.
     * Note: status fields cannot have options added via API (Notion restriction).
     * @param {string} databaseUrl
     * @param {string} fieldName - Property name (e.g. "Labels")
     * @param {'select'|'multi_select'} fieldType
     * @param {string} optionName - New option name to add
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async addSelectOption(databaseUrl, fieldName, fieldType, optionName) {
      const dbId = extractDatabaseId(databaseUrl);
      if (!dbId) return { success: false, error: 'Invalid database URL.' };
      if (fieldType !== 'select' && fieldType !== 'multi_select') {
        return {
          success: false,
          error: 'Can only add options to select/multi_select fields.',
        };
      }
      try {
        await api.updateDatabase(dbId, {
          [fieldName]: { [fieldType]: { options: [{ name: optionName }] } },
        });
        return { success: true };
      } catch (err) {
        logger.error('[Notion] addSelectOption error:', err.message);
        return { success: false, error: err.message };
      }
    },

    /**
     * Replace the full body content of a page.
     * Deletes all existing children blocks, then creates new ones from text.
     * @param {string} pageId
     * @param {string} text - New plain text body
     * @returns {Promise<import('./types.js').TicketResult>}
     */
    async replaceTicketBody(pageId, text) {
      try {
        // 1. Fetch all existing block IDs
        const existingBlockIds = [];
        let cursor;
        do {
          const res = await api.getBlockChildren(pageId, cursor);
          for (const block of res.results ?? []) {
            existingBlockIds.push(block.id);
          }
          cursor = res.has_more ? res.next_cursor : undefined;
        } while (cursor);

        // 2. Delete all existing blocks
        await Promise.all(existingBlockIds.map((id) => api.deleteBlock(id)));

        // 3. Create new blocks from text (may be empty)
        if (text?.trim()) {
          const children = buildBodyChildren(text);
          if (children.length > 0) {
            await api.appendBlockChildren(pageId, children);
          }
        }

        return { success: true };
      } catch (err) {
        logger.error('[Notion] replaceTicketBody error:', err.message);
        return { success: false, error: err.message };
      }
    },
  };
}
