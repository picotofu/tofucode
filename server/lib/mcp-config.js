/**
 * MCP Config Manager
 *
 * Handles reading and writing MCP server configurations to:
 * - Local scope:   {projectPath}/.mcp.json
 * - Project scope: ~/.claude.json -> projects[projectPath].mcpServers
 * - User scope:    ~/.claude.json -> mcpServers
 *
 * OAuth credentials are never sent to the frontend — only expiry metadata.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

// Shell injection characters to block in stdio commands
const SHELL_INJECTION_RE = /[;&|`$\n><]/;

// Valid server name: alphanumeric, hyphens, underscores, max 64 chars
const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Valid scope values
const VALID_SCOPES = ['local', 'project', 'user'];

// ---------------------------------------------------------------------------
// Internal file helpers
// ---------------------------------------------------------------------------

/**
 * Verify a project path exists on disk and is a directory.
 * Guards against slugToPath returning a fabricated fallback path.
 * @param {string} projectPath
 * @returns {string|null} error message or null if valid
 */
function validateProjectPath(projectPath) {
  if (!projectPath) return 'No project path provided';
  try {
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      return `Project path does not exist: ${projectPath}`;
    }
  } catch {
    return `Cannot access project path: ${projectPath}`;
  }
  return null;
}

function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * @param {string} name
 * @returns {string|null} error message or null if valid
 */
export function validateServerName(name) {
  if (!name || typeof name !== 'string') return 'Name is required';
  if (!VALID_NAME_RE.test(name))
    return 'Name must be alphanumeric with hyphens/underscores only (max 64 chars)';
  return null;
}

/**
 * @param {string} scope
 * @returns {string|null}
 */
export function validateScope(scope) {
  if (!VALID_SCOPES.includes(scope))
    return `Scope must be one of: ${VALID_SCOPES.join(', ')}`;
  return null;
}

/**
 * @param {object} config
 * @returns {string|null}
 */
export function validateServerConfig(config) {
  if (!config || typeof config !== 'object') return 'Server config is required';

  const type = config.type ?? 'stdio';

  if (type === 'http' || type === 'sse') {
    if (!config.url) return 'URL is required for HTTP/SSE servers';
    try {
      const parsed = new URL(config.url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        return 'URL must use http or https protocol';
    } catch {
      return 'URL is not valid';
    }
    if (config.headers !== undefined) {
      if (typeof config.headers !== 'object' || Array.isArray(config.headers))
        return 'Headers must be an object';
      for (const [k, v] of Object.entries(config.headers)) {
        if (typeof k !== 'string' || typeof v !== 'string')
          return 'Header keys and values must be strings';
      }
    }
  } else if (type === 'stdio' || type === undefined) {
    if (!config.command) return 'Command is required for stdio servers';
    if (typeof config.command !== 'string') return 'Command must be a string';
    if (SHELL_INJECTION_RE.test(config.command))
      return 'Command contains invalid shell characters';
    if (config.args !== undefined) {
      if (!Array.isArray(config.args)) return 'Args must be an array';
      for (const arg of config.args) {
        if (typeof arg !== 'string') return 'Each arg must be a string';
        if (SHELL_INJECTION_RE.test(arg))
          return `Arg contains invalid shell characters: ${arg}`;
      }
    }
    if (config.env !== undefined) {
      if (typeof config.env !== 'object' || Array.isArray(config.env))
        return 'Env must be an object';
      for (const [k, v] of Object.entries(config.env)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
          return `Invalid env var name: ${k}`;
        if (typeof v !== 'string') return 'Env values must be strings';
      }
    }
  } else {
    return `Unknown server type: ${type}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Local scope: {projectPath}/.mcp.json
// ---------------------------------------------------------------------------

function readLocalConfig(projectPath) {
  const filePath = join(projectPath, '.mcp.json');
  const raw = readJsonFile(filePath);
  if (!raw) return {};
  // Support both { mcpServers: {...} } and flat { serverName: config }
  if (raw.mcpServers && typeof raw.mcpServers === 'object')
    return raw.mcpServers;
  const servers = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('_') && typeof value === 'object' && value !== null) {
      servers[key] = value;
    }
  }
  return servers;
}

function writeLocalConfig(projectPath, mcpServers) {
  const filePath = join(projectPath, '.mcp.json');
  // Read existing to preserve any _comment or other underscore-prefixed keys
  const existing = readJsonFile(filePath) ?? {};
  const preserved = {};
  for (const [k, v] of Object.entries(existing)) {
    if (k.startsWith('_')) preserved[k] = v;
  }
  writeJsonFile(filePath, { ...preserved, mcpServers });
}

// ---------------------------------------------------------------------------
// User / Project scope: ~/.claude.json
// ---------------------------------------------------------------------------

function readClaudeConfig() {
  return readJsonFile(CLAUDE_CONFIG_PATH) ?? {};
}

function writeClaudeConfig(data) {
  writeJsonFile(CLAUDE_CONFIG_PATH, data);
}

function readUserMcpServers() {
  const config = readClaudeConfig();
  return config.mcpServers ?? {};
}

function readProjectMcpServers(projectPath) {
  const config = readClaudeConfig();
  return config.projects?.[projectPath]?.mcpServers ?? {};
}

function writeUserMcpServers(mcpServers) {
  const config = readClaudeConfig();
  // Surgical merge — only replace mcpServers key
  writeClaudeConfig({ ...config, mcpServers });
}

function writeProjectMcpServers(projectPath, mcpServers) {
  const config = readClaudeConfig();
  const projects = { ...(config.projects ?? {}) };
  projects[projectPath] = { ...(projects[projectPath] ?? {}), mcpServers };
  writeClaudeConfig({ ...config, projects });
}

// ---------------------------------------------------------------------------
// OAuth helpers (read-only, never sent raw to frontend)
// ---------------------------------------------------------------------------

function readMcpCredentials() {
  const raw = readJsonFile(CREDENTIALS_PATH);
  if (!raw?.mcpOAuth) return {};
  const credentials = {};
  for (const [key, value] of Object.entries(raw.mcpOAuth)) {
    const serverName = key.split('|')[0];
    if (serverName) {
      credentials[serverName] = {
        expiresAt: value.expiresAt ?? null,
        hasToken: !!value.accessToken,
      };
    }
  }
  return credentials;
}

function getOAuthMeta(serverName, credentials) {
  const cred = credentials[serverName];
  if (!cred?.hasToken) return null;
  const expired = cred.expiresAt
    ? Date.now() > cred.expiresAt - 5 * 60 * 1000
    : false;
  return { expiresAt: cred.expiresAt, expired };
}

// ---------------------------------------------------------------------------
// Sanitize config before sending to frontend (strip auth headers)
// ---------------------------------------------------------------------------

function sanitizeConfig(config) {
  const out = { ...config };
  if (out.headers) {
    const sanitized = {};
    for (const [k, v] of Object.entries(out.headers)) {
      // Redact Authorization header value
      sanitized[k] = k.toLowerCase() === 'authorization' ? '***' : v;
    }
    out.headers = sanitized;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all MCP servers across all scopes with rich metadata.
 * OAuth tokens are never included — only expiry metadata.
 *
 * @param {string} projectPath
 * @returns {Array<object>}
 */
export function listServersDetailed(projectPath) {
  const userServers = readUserMcpServers();
  const projectServers = projectPath ? readProjectMcpServers(projectPath) : {};
  const localServers = projectPath ? readLocalConfig(projectPath) : {};
  const credentials = readMcpCredentials();

  const allNames = new Set([
    ...Object.keys(userServers),
    ...Object.keys(projectServers),
    ...Object.keys(localServers),
  ]);

  const result = [];

  for (const name of allNames) {
    const definedInScopes = [];
    if (userServers[name]) definedInScopes.push('user');
    if (projectServers[name]) definedInScopes.push('project');
    if (localServers[name]) definedInScopes.push('local');

    // Effective config: local > project > user
    const effectiveConfig =
      localServers[name] ?? projectServers[name] ?? userServers[name];
    const effectiveScope = localServers[name]
      ? 'local'
      : projectServers[name]
        ? 'project'
        : 'user';

    const oauthMeta = getOAuthMeta(name, credentials);
    const sanitized = sanitizeConfig(effectiveConfig);

    result.push({
      name,
      type: effectiveConfig.type ?? 'stdio',
      scope: effectiveScope,
      definedInScopes,
      // HTTP/SSE fields
      url: sanitized.url ?? null,
      headers: sanitized.headers ?? null,
      // Stdio fields
      command: sanitized.command ?? null,
      args: sanitized.args ?? null,
      env: sanitized.env ?? null,
      // OAuth metadata (no tokens)
      isOAuthManaged: oauthMeta !== null,
      oauthExpiresAt: oauthMeta?.expiresAt ?? null,
      oauthExpired: oauthMeta?.expired ?? false,
    });
  }

  return result;
}

/**
 * Add a new MCP server to the specified scope.
 *
 * @param {string} name
 * @param {object} config
 * @param {'local'|'project'|'user'} scope
 * @param {string} projectPath
 * @returns {{ success: boolean, error?: string }}
 */
export function addServer(name, config, scope, projectPath) {
  const nameErr = validateServerName(name);
  if (nameErr) return { success: false, error: nameErr };

  const scopeErr = validateScope(scope);
  if (scopeErr) return { success: false, error: scopeErr };

  const configErr = validateServerConfig(config);
  if (configErr) return { success: false, error: configErr };

  if (scope === 'local' || scope === 'project') {
    const pathErr = validateProjectPath(projectPath);
    if (pathErr) return { success: false, error: pathErr };
  }

  // Check for duplicate within the target scope
  const existing = getScopeServers(scope, projectPath);
  if (existing[name])
    return {
      success: false,
      error: `Server "${name}" already exists in ${scope} scope`,
    };

  const updated = { ...existing, [name]: config };
  writeScopeServers(scope, projectPath, updated);
  return { success: true };
}

/**
 * Update an existing MCP server config in the specified scope.
 *
 * @param {string} name
 * @param {object} config
 * @param {'local'|'project'|'user'} scope
 * @param {string} projectPath
 * @returns {{ success: boolean, error?: string }}
 */
export function updateServer(name, config, scope, projectPath) {
  const nameErr = validateServerName(name);
  if (nameErr) return { success: false, error: nameErr };

  const scopeErr = validateScope(scope);
  if (scopeErr) return { success: false, error: scopeErr };

  const configErr = validateServerConfig(config);
  if (configErr) return { success: false, error: configErr };

  if (scope === 'local' || scope === 'project') {
    const pathErr = validateProjectPath(projectPath);
    if (pathErr) return { success: false, error: pathErr };
  }

  const existing = getScopeServers(scope, projectPath);
  if (!existing[name])
    return {
      success: false,
      error: `Server "${name}" not found in ${scope} scope`,
    };

  const updated = { ...existing, [name]: config };
  writeScopeServers(scope, projectPath, updated);
  return { success: true };
}

/**
 * Remove an MCP server from the specified scope.
 *
 * @param {string} name
 * @param {'local'|'project'|'user'} scope
 * @param {string} projectPath
 * @returns {{ success: boolean, error?: string }}
 */
export function removeServer(name, scope, projectPath) {
  const nameErr = validateServerName(name);
  if (nameErr) return { success: false, error: nameErr };

  const scopeErr = validateScope(scope);
  if (scopeErr) return { success: false, error: scopeErr };

  if (scope === 'local' || scope === 'project') {
    const pathErr = validateProjectPath(projectPath);
    if (pathErr) return { success: false, error: pathErr };
  }

  const existing = getScopeServers(scope, projectPath);
  if (!existing[name])
    return {
      success: false,
      error: `Server "${name}" not found in ${scope} scope`,
    };

  const updated = { ...existing };
  delete updated[name];
  writeScopeServers(scope, projectPath, updated);
  return { success: true };
}

/**
 * Test connectivity for an HTTP/SSE server URL.
 *
 * @param {string} url
 * @param {Record<string,string>} [headers]
 * @returns {Promise<{ success: boolean, statusCode?: number, error?: string }>}
 */
export async function testHttpConnection(url, headers = {}) {
  const configErr = validateServerConfig({ type: 'http', url });
  if (configErr) return { success: false, error: configErr };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Use MCP initialize handshake so endpoints that only accept POST+SSE respond correctly
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'tofucode', version: '1.0' },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const statusCode = response.status;
    const statusText = response.statusText || '';
    // Only 2xx responses are considered reachable; anything else is flagged
    return {
      success: statusCode >= 200 && statusCode < 300,
      statusCode,
      statusText,
    };
  } catch (err) {
    if (err.name === 'AbortError')
      return { success: false, error: 'Connection timed out' };
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Internal scope helpers
// ---------------------------------------------------------------------------

function getScopeServers(scope, projectPath) {
  if (scope === 'local') return readLocalConfig(projectPath);
  if (scope === 'project') return readProjectMcpServers(projectPath);
  return readUserMcpServers();
}

function writeScopeServers(scope, projectPath, servers) {
  if (scope === 'local') return writeLocalConfig(projectPath, servers);
  if (scope === 'project') return writeProjectMcpServers(projectPath, servers);
  return writeUserMcpServers(servers);
}
