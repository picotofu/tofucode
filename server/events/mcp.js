/**
 * MCP Server Management Event Handlers
 *
 * Handles WebSocket events for viewing and managing MCP server configurations.
 *
 * Events:
 *   mcp:list    -> mcp:servers       List all servers across all scopes
 *   mcp:add     -> mcp:added         Add a new server
 *   mcp:update  -> mcp:updated       Update an existing server config
 *   mcp:remove  -> mcp:removed       Remove a server from a scope
 *   mcp:test    -> mcp:test_result   Test HTTP/SSE connection
 */

import { slugToPath } from '../config.js';
import {
  addServer,
  listServersDetailed,
  removeServer,
  testHttpConnection,
  updateServer,
} from '../lib/mcp-config.js';
import { send } from '../lib/ws.js';

/**
 * Resolve the project path from WebSocket context.
 * Returns null if no project is selected.
 * @param {object} context
 * @returns {string|null}
 */
function resolveProjectPath(context) {
  if (!context.currentProjectPath) return null;
  return slugToPath(context.currentProjectPath);
}

/**
 * mcp:list — List all MCP servers across all scopes
 *
 * @event mcp:list
 * @returns mcp:servers { servers: Array }
 */
export async function listHandler(ws, _message, context) {
  const projectPath = resolveProjectPath(context);
  const servers = listServersDetailed(projectPath);
  send(ws, { type: 'mcp:servers', servers });
}

/**
 * mcp:add — Add a new MCP server
 *
 * @event mcp:add
 * @param {string} message.name        Server name
 * @param {object} message.config      Server config (type, url/command/args/env/headers)
 * @param {string} message.scope       'local' | 'project' | 'user' (default: 'local')
 * @returns mcp:added { success, error?, servers? }
 */
export async function addHandler(ws, message, context) {
  const projectPath = resolveProjectPath(context);
  const { name, config, scope = 'local' } = message;

  if ((scope === 'local' || scope === 'project') && !projectPath) {
    send(ws, {
      type: 'mcp:added',
      success: false,
      error: 'Select a project first',
    });
    return;
  }

  const result = addServer(name, config, scope, projectPath);

  if (result.success) {
    const servers = listServersDetailed(projectPath);
    send(ws, { type: 'mcp:added', success: true, servers });
  } else {
    send(ws, { type: 'mcp:added', success: false, error: result.error });
  }
}

/**
 * mcp:update — Update an existing MCP server config
 *
 * @event mcp:update
 * @param {string} message.name        Server name
 * @param {object} message.config      Updated server config
 * @param {string} message.scope       Scope where the server is defined
 * @returns mcp:updated { success, error?, servers? }
 */
export async function updateHandler(ws, message, context) {
  const projectPath = resolveProjectPath(context);
  const { name, config, scope } = message;

  if ((scope === 'local' || scope === 'project') && !projectPath) {
    send(ws, {
      type: 'mcp:updated',
      success: false,
      error: 'Select a project first',
    });
    return;
  }

  const result = updateServer(name, config, scope, projectPath);

  if (result.success) {
    const servers = listServersDetailed(projectPath);
    send(ws, { type: 'mcp:updated', success: true, servers });
  } else {
    send(ws, { type: 'mcp:updated', success: false, error: result.error });
  }
}

/**
 * mcp:remove — Remove an MCP server from a scope
 *
 * @event mcp:remove
 * @param {string} message.name        Server name
 * @param {string} message.scope       Scope to remove from
 * @returns mcp:removed { success, error?, servers? }
 */
export async function removeHandler(ws, message, context) {
  const projectPath = resolveProjectPath(context);
  const { name, scope } = message;

  if ((scope === 'local' || scope === 'project') && !projectPath) {
    send(ws, {
      type: 'mcp:removed',
      success: false,
      error: 'Select a project first',
    });
    return;
  }

  const result = removeServer(name, scope, projectPath);

  if (result.success) {
    const servers = listServersDetailed(projectPath);
    send(ws, { type: 'mcp:removed', success: true, servers });
  } else {
    send(ws, { type: 'mcp:removed', success: false, error: result.error });
  }
}

/**
 * mcp:test — Test connectivity for an HTTP/SSE server
 *
 * @event mcp:test
 * @param {string} message.url         URL to test
 * @param {object} [message.headers]   Optional request headers
 * @returns mcp:test_result { success, statusCode?, error? }
 */
export async function testHandler(ws, message) {
  const { url, headers = {}, serverName = null, _formLevel = false } = message;
  const result = await testHttpConnection(url, headers);
  send(ws, { type: 'mcp:test_result', ...result, serverName, _formLevel });
}
