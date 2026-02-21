# Feature: MCP (Model Context Protocol) Support

## Status: ✅ Complete (Phase 1 + Phase 2)

---

## Requirements

- **Phase 1**: Auto-detect and apply MCP server configs from Claude CLI config files so Claude can use MCP tools in sessions
- **Phase 2**: Web UI to view, add, edit, and remove MCP server configs without touching config files manually

## Context

- MCP (Model Context Protocol) is a standard for connecting AI assistants to external tools and data sources
- Claude Code CLI already supports MCP; the Claude Agent SDK accepts `mcpServers` in query options
- Two server types:
  - **HTTP / SSE** — hosted remotely, config is URL + optional auth headers / OAuth
  - **Stdio** — local subprocess (e.g. `npx @playwright/mcp@latest`), transport is stdin/stdout
- Three config scopes (merged with precedence: user < project < local):
  - **User** — `~/.claude.json` root-level `mcpServers`
  - **Project** — `~/.claude.json` under `projects[projectPath].mcpServers`
  - **Local** — `.mcp.json` in project root (gitignored)
- OAuth tokens live in `~/.claude/.credentials.json` — never sent to frontend
- tofucode runs both on VMs (browser = remote UI) and locally — MCP always runs server-side

## Scope

### Phase 1 — Auto-detect from CLI Config ✅
- Read and merge MCP config from all three scopes
- Inject OAuth tokens automatically from `~/.claude/.credentials.json`
- Pass merged server config to Claude Agent SDK `mcpServers` option per session
- Custom frontend tool display for known MCP servers (dbhub, notion, playwright)

### Phase 2 — UI Management ✅
| MCP Type | UI Capability |
|----------|--------------|
| **HTTP / SSE** | Full CRUD — add, edit, remove, test connection |
| **Stdio** | Config CRUD — command, args, env vars (no install management) |
| **OAuth** | Read-only display — expiry badge, CLI reconfigure hint |
| **Installation** | Out of scope — user manages their own binaries |

- Default new servers to **local scope** (`.mcp.json`) — most surgical, doesn't affect other projects
- Scope is **fixed** on edit — can't migrate a server between scopes
- OAuth tokens never exposed to frontend; only expiry metadata shown

## Plan

### Phase 1

**Backend (`server/lib/mcp.js`)**:
- `loadMcpServers(projectPath)` — reads and merges all three scopes
- `getMcpServerInfo()` — returns safe metadata for UI display (no tokens)
- Auto-injects OAuth Bearer token from `~/.claude/.credentials.json` with 5-minute expiry buffer

**Frontend (`src/utils/mcp-tools/`)**:
- Modular registry: `index.js`, `dbhub.js`, `notion.js`, `playwright.js`
- Custom icons and display formatting per known server

**Integration (`server/events/prompt.js`)**:
```javascript
const mcpServers = loadMcpServers(projectPath);
if (Object.keys(mcpServers).length > 0) queryOptions.mcpServers = mcpServers;
```

### Phase 2

**UI Entry Point**: Plug icon (🔌) in Sidebar footer → opens `McpModal` (dedicated 620px modal, not a SettingsModal tab, not a new route)

**WebSocket Events**:
```
mcp:list    →  mcp:servers      # All servers across scopes with metadata
mcp:add     →  mcp:added        # Add server; returns updated list
mcp:update  →  mcp:updated      # Update config; returns updated list
mcp:remove  →  mcp:removed      # Remove from correct scope; returns updated list
mcp:test    →  mcp:test_result  # MCP initialize handshake (POST); 2xx = success
```

**New Backend Files**:
- `server/lib/mcp-config.js` — read/write/validate config; `validateProjectPath()` (statSync guard against slugToPath fallback); shell injection check on command AND args; `listServersDetailed()` with Authorization header redaction; `testHttpConnection()` sends full MCP initialize handshake
- `server/events/mcp.js` — 5 WebSocket handlers; `testHandler` echoes `serverName` + `_formLevel` for UI routing

**New Frontend Components**:
- `McpModal.vue` — list ↔ form navigation; mutation error banner (6s auto-clear); 8s auto-clear for test results; saving state wired to form
- `McpServerList.vue` — servers grouped by scope; inline test result strip per server
- `McpServerItem.vue` — type badge (HTTP/SSE/stdio), scope badge, OAuth lock + expiry badge, override indicator
- `McpServerForm.vue` — HTTP/SSE and stdio variants; scope locked (greyed out) in edit mode; saving spinner on submit; meaningful header validation

**Modified Files**:
- `src/components/Sidebar.vue` — plug icon added to footer
- `src/App.vue` — McpModal wired; mutation success/error forwarded to modal ref
- `server/events/index.js` — mcp:* handlers registered

## Summary

Both phases are fully implemented and deployed.

**Phase 1** enables MCP tool use in all Claude sessions automatically — servers are loaded from CLI config on every query, OAuth tokens injected transparently.

**Phase 2** adds a first-class management UI: users can view all configured MCP servers across scopes, add/edit/remove HTTP/SSE and stdio servers, test HTTP connections with accurate status feedback, and see OAuth server expiry at a glance — all without touching config files directly.

Key implementation decisions:
- MCP test uses a real MCP initialize handshake (POST), not a plain GET — required by all compliant MCP servers
- Test result shows HTTP status text (e.g. "401 Unauthorized") instead of generic "unreachable"
- Shell injection validated on both command and args for stdio servers
- `slugToPath()` fallback guarded by `statSync` before any file write
- `_formLevel` flag round-tripped through WebSocket to distinguish form vs list test results
