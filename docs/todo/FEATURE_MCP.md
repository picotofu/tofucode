# Feature: MCP (Model Context Protocol) Support

## Overview

Enable MCP server integration in claude-web, allowing Claude to use external tools and services configured via MCP servers.

**Status:** ✅ **Phase 1 Complete** | 📋 **Phase 2 Planned**

---

## Background

MCP (Model Context Protocol) is a standard for connecting AI assistants to external tools and data sources. Claude Code CLI already supports MCP servers, and the Claude Agent SDK provides the `mcpServers` option to pass server configurations.

### Current User Configuration

The user has the following MCP servers configured in Claude CLI:

| Server | Type | URL/Command |
|--------|------|-------------|
| notion | HTTP | `https://mcp.notion.com/mcp` |
| dbhub | HTTP | `http://0.0.0.0:9999/message` |
| playwright | stdio | `npx @playwright/mcp@latest` |

These servers provide tools like:
- `mcp__notion__notion-search`, `mcp__notion__notion-fetch`, `mcp__notion__notion-update-page`
- `mcp__dbhub__execute_sql`
- `mcp__playwright__*` (browser automation)

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

## Implementation Options

### Option A: Auto-detect from Claude CLI Config

Read MCP server configurations from existing Claude CLI config files.

**Pros:**
- Zero configuration for users who already have MCP set up
- Stays in sync with CLI settings

**Cons:**
- Need to parse multiple config file formats
- OAuth tokens stored in `.credentials.json` need careful handling
- Config locations may vary

**Config Locations:**
- `~/.claude/settings.json` - allowedCommands with MCP tools
- `~/.claude/.credentials.json` - OAuth tokens for MCP servers
- `~/.claude/plugins/*/.mcp.json` - Plugin MCP configs

### Option B: Dedicated Config File

Create a `mcp-servers.json` config file for claude-web.

**Pros:**
- Clear separation from CLI config
- Full control over format
- No parsing complexity

**Cons:**
- Duplicate configuration
- Manual sync required

**Example:**
```json
{
  "servers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    },
    "dbhub": {
      "type": "http",
      "url": "http://0.0.0.0:9999/message"
    },
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### Option C: UI Configuration

Add MCP server management in the web UI.

**Pros:**
- User-friendly
- No file editing required
- Can validate connections

**Cons:**
- More complex implementation
- Need to store config somewhere (localStorage, backend file)
- OAuth flow handling is complex

---

## Recommended Approach

**Phase 1: Auto-detect from CLI Config (Option A)** ✅ IMPLEMENTED
- Reads MCP servers from `~/.claude.json` (user and project scopes)
- Reads local overrides from `.mcp.json` in project root
- Merges with precedence: user < project < local
- Applies OAuth credentials from `~/.claude/.credentials.json`

**Phase 2: UI Status Display**
- Display connected MCP servers in sidebar
- Show connection status (connected/error)

**Phase 3: UI Configuration (Option C)**
- Optional enhancement
- Add/remove servers from UI
- Test connection functionality

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
- Token expiry checking (5 minute buffer)
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

### Phase 2: UI Management 📋 **PLANNED**

**Scope:** Full MCP server management from the web interface

#### 2.1 View MCP Servers
- New page/section to view configured MCP servers
- Display per-project and global servers
- Show server type, status, and available tools
- Filter/search through servers

#### 2.2 Add/Edit Servers
- Forms to add new MCP servers (HTTP, SSE, stdio)
- Edit existing server configurations
- Validation for server URLs and commands
- Test connection before saving

#### 2.3 Server Status & Health
- Real-time connection status indicators
- Error messages for failed servers
- Tool availability list per server
- OAuth authentication flow for HTTP servers

#### 2.4 Scope Management
- Toggle servers per project vs global
- Override global servers at project level
- Manage `.mcp.json` files from UI

#### 2.5 Backend APIs
New API endpoints needed:
```
GET  /api/mcp/servers          # List all servers (user + project + local)
POST /api/mcp/servers          # Add new server
PUT  /api/mcp/servers/:name    # Update server config
DELETE /api/mcp/servers/:name  # Remove server
GET  /api/mcp/servers/:name/status  # Connection status
POST /api/mcp/servers/:name/test    # Test connection
```

#### Implementation Complexity: **HIGH**
- Multiple forms for different server types
- File system operations for config management
- OAuth flow handling for HTTP servers
- Real-time status monitoring
- Scope-aware CRUD operations

**Estimated Effort:** 2-3 days of focused development

---

### Phase 3: Advanced Features (Future)

- **Tool Permissions**: Granular control over which MCP tools are allowed
- **Usage Analytics**: Track which MCP tools are used most
- **Server Marketplace**: Discover and install popular MCP servers
- **Custom Tool Wrappers**: Create aliases or shortcuts for complex tool chains

### Phase 3: UI Enhancement

#### 3.1 MCP Status in Sidebar

- Show connected MCP servers
- Connection status indicator (connected/error)
- Tool count per server

#### 3.2 MCP Management Page

- List all configured servers
- Add new servers (stdio/http/sse)
- Test connection
- View available tools

---

## File Structure

```
server/
├── lib/
│   └── mcp.js                    # MCP config loading
└── events/
    └── mcp.js                    # MCP status WebSocket events (optional)

src/
├── components/
│   └── McpStatus.vue             # MCP status indicator (Phase 3)
└── views/
    └── McpSettingsView.vue       # MCP management UI (Phase 3)

# Config file (user creates)
mcp-servers.json                  # Project-level MCP config
~/.tofucode/mcp-servers.json    # Global MCP config
```

---

## Security Considerations

1. **OAuth Tokens**: Never expose tokens to frontend; keep in backend only
2. **Stdio Servers**: Validate commands to prevent arbitrary code execution
3. **HTTP Servers**: Consider allowing only localhost or whitelisted domains
4. **Permissions**: MCP tools should respect existing permission modes

---

## Testing Plan

1. **Stdio Server**: Test with playwright MCP
   - Verify process spawning
   - Test tool invocation
   - Clean process termination

2. **HTTP Server**: Test with local dbhub
   - Verify HTTP requests
   - Test authentication headers
   - Handle connection errors

3. **OAuth Server**: Test with Notion
   - Token refresh flow
   - Permission scopes
   - Error handling

---

## Related Documentation

- [Claude Agent SDK MCP Types](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Model Context Protocol Spec](https://modelcontextprotocol.io/)
- [FEATURE_CLAUDE_INTERACTIVE.md](./FEATURE_CLAUDE_INTERACTIVE.md) - Permission handling

---

## Success Criteria

### Phase 1 (Complete)
- [x] MCP servers load from CLI config files (user, project, local scopes)
- [x] OAuth credentials applied to HTTP servers automatically
- [x] Tools from MCP servers available in Claude responses
- [x] Server status visible in logs
- [x] Custom tool display for known MCP servers (dbhub, notion, playwright)
- [x] Modular frontend structure for adding new MCP servers
- [ ] Stdio servers spawn and communicate correctly (needs testing with playwright)

### Phase 2 (Planned)
- [ ] View all configured MCP servers from UI
- [ ] Add new MCP servers (HTTP, SSE, stdio) from UI
- [ ] Edit/delete existing servers
- [ ] Test server connections from UI
- [ ] Real-time server status indicators
- [ ] Per-project vs global scope management
- [ ] OAuth flow handling for HTTP servers
