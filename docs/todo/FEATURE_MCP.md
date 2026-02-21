# Feature: MCP (Model Context Protocol) Support

## Overview

Enable MCP server integration in tofucode, allowing Claude to use external tools and services configured via MCP servers.

**Status:** ✅ **Phase 1 Complete** | 🚧 **Phase 2 In Progress**

---

## Background

MCP (Model Context Protocol) is a standard for connecting AI assistants to external tools and data sources. Claude Code CLI already supports MCP servers, and the Claude Agent SDK provides the `mcpServers` option to pass server configurations.

### MCP Server Types

**1. HTTP / SSE (Remote)**
- Hosted somewhere (third party or self-hosted)
- Config is just a URL + optional auth headers / OAuth
- Examples: `dbhub.io`, Notion MCP, hosted services
- Works identically whether tofucode runs on a VM or locally

**2. Stdio (Local process)**
- Runs as a subprocess spawned by Claude on the same machine as tofucode
- Transport is stdin/stdout between Claude and the MCP process
- Examples: `npx @playwright/mcp@latest`, `docker run ...`, `python my_mcp.py`
- "Local" means wherever tofucode's server runs — on VM or on user's machine

### tofucode Context

tofucode works in two modes:
- **VM/remote** — browser is just UI, MCP processes run on the server
- **Local** — tofucode and MCP both run on the user's own machine (no conflict)

In both cases, MCP config lives on the server side (`~/.claude.json`, `.mcp.json`) and is a server-side concern.

### Current User Configuration (Example)

| Server | Type | URL/Command |
|--------|------|-------------|
| notion | HTTP | `https://mcp.notion.com/mcp` |
| dbhub | HTTP | `http://0.0.0.0:9999/message` |
| playwright | stdio | `npx @playwright/mcp@latest` |

---

## SDK Support

The Claude Agent SDK supports MCP via the `mcpServers` option in query:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const result = query({
  prompt: 'Search my Notion for project docs',
  options: {
    mcpServers: {
      'notion': {
        type: 'http',
        url: 'https://mcp.notion.com/mcp',
        headers: { /* auth headers if needed */ }
      },
      'dbhub': {
        type: 'http',
        url: 'http://0.0.0.0:9999/message'
      },
      'playwright': {
        type: 'stdio',
        command: 'npx',
        args: ['@playwright/mcp@latest']
      }
    }
  }
});
```

### McpServerConfig Types

```typescript
// Stdio server (spawns a process)
type McpStdioServerConfig = {
  type?: 'stdio';  // default
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

// HTTP server
type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

// SSE server
type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};
```

---

## Scope Decisions

Agreed design decisions for Phase 2 UI management:

| MCP Type | UI Capability | Rationale |
|----------|--------------|-----------|
| **HTTP / SSE** | Full CRUD — add, edit, remove, view | Config is just URL + headers; safe and straightforward |
| **Stdio** | Config CRUD — add, edit, remove (command/args/env), view | User installs the binary themselves; tofucode only manages the config |
| **OAuth** | Out of scope — read-only display of what's configured | Too complex; redirect URIs, token storage, refresh logic — user manages via CLI |
| **Installation** | Out of scope entirely | Not tofucode's job; security risk on shared VM instances |

### Why no OAuth management

OAuth flows require browser redirect URIs + server-side token storage + refresh logic. This is a rabbit hole that doesn't belong in tofucode. The user already sets this up via `claude mcp add --oauth ...` before tofucode is involved. tofucode already reads and applies `~/.claude/.credentials.json` automatically (Phase 1).

### Why no stdio installation management

- Spawning arbitrary install commands from a web UI is a meaningful attack surface, especially on shared VM instances
- Whether it's `npx`, `uvx`, `docker`, or a compiled binary — the user manages their own toolchain
- The stdio config (command/args/env) is what tofucode manages; the binary existing is the user's responsibility

### Config scope — default to local

New servers added via UI should default to **local scope** (`.mcp.json` in project root):
- Most surgical — doesn't affect other projects
- User scope (`~/.claude.json`) is too broad to manage from a per-project UI

---

## Implementation

### Phase 1: Auto-detect from CLI Config ✅ **COMPLETE**

**Backend (`server/lib/mcp.js`):**

Config Sources (merged with precedence: user < project < local):
1. **User scope**: `~/.claude.json` → `mcpServers` (root level)
2. **Project scope**: `~/.claude.json` → `projects[projectPath].mcpServers`
3. **Local scope**: `.mcp.json` in project root (gitignored, personal overrides)

Features:
- Automatic OAuth token injection from `~/.claude/.credentials.json`
- Token expiry checking (5-minute buffer)
- Logging of loaded servers (without sensitive data)
- `getMcpServerInfo()` helper for UI display

Integration in `server/events/prompt.js`:
```javascript
const mcpServers = loadMcpServers(projectPath);
const queryOptions = {
  // ... existing options
  ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
};
```

**Frontend Tool Display (`src/utils/mcp-tools/`):**

Modular structure for MCP tool rendering:
```
src/utils/mcp-tools/
├── index.js          # Registry & getMcpToolDisplay()
├── dbhub.js          # Database tools
├── notion.js         # Notion workspace tools (15+ tools)
└── playwright.js     # Browser automation tools (20+ tools)
```

Each server has custom icons and display formatting for better UX.

**Testing:**
- ✅ HTTP servers (dbhub, notion) work with OAuth
- ✅ Tools available in web interface
- ✅ Concurrent session support
- ⏳ Stdio servers (playwright) need testing

---

### Phase 2: UI Management 🚧 **PLANNED**

#### Scope Summary

- View all configured MCP servers (all scopes, all types)
- HTTP/SSE: full CRUD
- Stdio: config CRUD (no install)
- OAuth: read-only, show expiry status
- Default new servers to local scope (`.mcp.json`)

#### 2.1 Backend API Endpoints

```
GET    /api/mcp/servers                  # List servers (merged, all scopes) with metadata
POST   /api/mcp/servers                  # Add server (writes to .mcp.json by default)
PUT    /api/mcp/servers/:name            # Update server config
DELETE /api/mcp/servers/:name            # Remove server (from specific scope file)
POST   /api/mcp/servers/:name/test       # Test HTTP/SSE connection (ping URL)
```

Scope targeting via query param or body field:
- `scope=local` → `.mcp.json` in project root (default)
- `scope=project` → `~/.claude.json` project entry
- `scope=user` → `~/.claude.json` root

#### 2.2 View MCP Servers

- Panel/page listing all configured servers across scopes
- Show per server: name, type, source scope, URL or command, OAuth expiry if applicable
- Read-only for OAuth-configured servers — show a note to manage via CLI

#### 2.3 Add / Edit Servers

**HTTP / SSE form fields:**
- Name (unique identifier)
- Type: `http` | `sse`
- URL
- Headers (key-value pairs, optional)
- Scope selector (local / project / user)
- Test connection button (pings the URL before save)

**Stdio form fields:**
- Name (unique identifier)
- Command (e.g. `npx`, `docker`, `python`)
- Args (space-separated or array input)
- Env vars (key-value pairs, optional)
- Scope selector (local / project / user)
- No test connection — not meaningful for stdio

#### 2.4 Remove Servers

- Delete from the scope it's defined in
- Warn if removing a server defined at a higher scope (user/project) — change is permanent
- Cannot delete servers configured with OAuth via UI — show CLI instruction

#### 2.5 Config File Operations

Backend reads and writes:
- `.mcp.json` — local scope per project
- `~/.claude.json` — user/project scopes (surgical merge, don't overwrite unrelated keys)

---

## File Structure (Phase 2)

```
server/
├── lib/
│   ├── mcp.js                        # Existing: load/merge MCP config (Phase 1)
│   └── mcp-config.js                 # New: read/write config file operations
└── events/
    └── mcp.js                        # New: WebSocket event handlers for MCP management

src/
├── components/
│   ├── McpServerList.vue             # Server list with status indicators
│   ├── McpServerForm.vue             # Add/edit form (HTTP/SSE and stdio variants)
│   └── McpServerItem.vue             # Single server row/card
└── views/
    └── McpView.vue                   # MCP management page (or settings panel)
```

---

## Security Considerations

1. **OAuth Tokens**: Never expose tokens to frontend; keep in backend only — already enforced in Phase 1
2. **Stdio commands**: Validate that command is not an arbitrary shell string; reject shell operators (`&&`, `|`, `;`, `$()`)
3. **HTTP URLs**: No domain whitelist (user's own config), but validate URL format
4. **Scope writes**: Only write to expected config file locations; never path-traverse
5. **Shared instances**: On VM deployments, all browser users share MCP config — document this clearly

---

## Success Criteria

### Phase 1 ✅ Complete
- [x] MCP servers load from CLI config files (user, project, local scopes)
- [x] OAuth credentials applied to HTTP servers automatically
- [x] Tools from MCP servers available in Claude responses
- [x] Server status visible in logs
- [x] Custom tool display for known MCP servers (dbhub, notion, playwright)
- [x] Modular frontend structure for adding new MCP servers
- [ ] Stdio servers spawn and communicate correctly (needs testing with playwright)

### Phase 2 🚧 Planned
- [ ] View all configured MCP servers from UI (all scopes, all types)
- [ ] Add HTTP/SSE servers from UI (with test connection)
- [ ] Edit HTTP/SSE server config from UI
- [ ] Add stdio servers from UI (config only, no install)
- [ ] Edit stdio server config from UI
- [ ] Delete servers from UI (from correct scope file)
- [ ] OAuth servers shown read-only with expiry status and CLI hint
- [ ] Default new servers to local scope

---

## Related Documentation

- [Claude Agent SDK MCP Types](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Model Context Protocol Spec](https://modelcontextprotocol.io/)
