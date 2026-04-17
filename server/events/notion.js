/**
 * Notion WebSocket Event Handlers
 *
 * Handles Settings UI interactions for the Notion integration:
 *   - notion:get_config  → returns masked config
 *   - notion:save_config → saves config to disk
 *   - notion:test        → tests connection with current token
 *   - notion:analyse     → analyses database schema
 *
 * Uses raw Notion REST API — no MCP, no executor session required.
 */

import { logger } from '../lib/logger.js';
import {
  createNotionProvider,
  extractDatabaseId,
} from '../lib/task-providers/notion.js';
import {
  getMaskedNotionConfig,
  loadNotionConfig,
  loadNotionConfigRaw,
  saveNotionConfig,
} from '../lib/task-providers/notion-config.js';
import { send } from '../lib/ws.js';

/**
 * Get Notion config (token masked for display)
 * @param {import('ws').WebSocket} ws
 */
export async function handleGetConfig(ws) {
  try {
    const config = getMaskedNotionConfig();
    send(ws, { type: 'notion:config', config });
  } catch (err) {
    logger.error('[Notion WS] Error getting config:', err);
    send(ws, { type: 'notion:config', config: null, error: err.message });
  }
}

/**
 * Save Notion config from Settings UI
 * Token is only updated if non-empty and not masked
 * @param {import('ws').WebSocket} ws
 * @param {Object} message
 */
export async function handleSaveConfig(ws, message) {
  try {
    const incoming = message.config || {};
    const existing = loadNotionConfigRaw();

    const updated = {
      ...existing,
      enabled: incoming.enabled ?? existing.enabled,
      ticketDatabaseUrl:
        incoming.ticketDatabaseUrl ?? existing.ticketDatabaseUrl,
      userEmail: incoming.userEmail ?? existing.userEmail ?? '',
      fieldMappings: incoming.fieldMappings ?? existing.fieldMappings ?? [],
      boardColumnOrder:
        incoming.boardColumnOrder ?? existing.boardColumnOrder ?? [],
    };

    // Only update token if it looks like a real token (not masked)
    if (incoming.token && !incoming.token.startsWith('*')) {
      updated.token = incoming.token;
    }

    saveNotionConfig(updated);
    send(ws, { type: 'notion:save_result', success: true });

    // Return updated masked config
    const masked = getMaskedNotionConfig();
    send(ws, { type: 'notion:config', config: masked });
  } catch (err) {
    logger.error('[Notion WS] Error saving config:', err);
    send(ws, {
      type: 'notion:save_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Test Notion API connection with current token
 * @param {import('ws').WebSocket} ws
 */
export async function handleTestConnection(ws) {
  try {
    const config = loadNotionConfig();

    if (!config.token) {
      send(ws, {
        type: 'notion:test_result',
        success: false,
        error: 'No Notion token configured.',
      });
      return;
    }

    const provider = createNotionProvider(config.token);
    const result = await provider.testConnection();

    send(ws, {
      type: 'notion:test_result',
      success: result.success,
      message: result.message,
      error: result.error,
    });
  } catch (err) {
    logger.error('[Notion WS] Test connection error:', err);
    send(ws, {
      type: 'notion:test_result',
      success: false,
      error: err.message,
    });
  }
}

/**
 * Analyse a Notion database schema and return field definitions
 * @param {import('ws').WebSocket} ws
 * @param {Object} message - { ticketDatabaseUrl: string }
 */
export async function handleAnalyseDatabase(ws, message) {
  try {
    const config = loadNotionConfig();

    if (!config.token) {
      send(ws, {
        type: 'notion:analyse_result',
        success: false,
        error: 'No Notion token configured.',
      });
      return;
    }

    const { ticketDatabaseUrl } = message;
    if (!ticketDatabaseUrl) {
      send(ws, {
        type: 'notion:analyse_result',
        success: false,
        error: 'No database URL provided.',
      });
      return;
    }

    const dbId = extractDatabaseId(ticketDatabaseUrl);
    if (!dbId) {
      send(ws, {
        type: 'notion:analyse_result',
        success: false,
        error: 'Could not extract database ID from the provided URL.',
      });
      return;
    }

    const provider = createNotionProvider(config.token);
    const result = await provider.analyseDatabase(ticketDatabaseUrl);

    send(ws, {
      type: 'notion:analyse_result',
      success: result.success,
      fields: result.fields,
      error: result.error,
    });
  } catch (err) {
    logger.error('[Notion WS] Analyse database error:', err);
    send(ws, {
      type: 'notion:analyse_result',
      success: false,
      error: err.message,
    });
  }
}
