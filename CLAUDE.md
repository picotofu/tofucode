# Claude Code Web

Web UI wrapper for Claude Code running on a VM with full system access.

## Tech Stack

- **Frontend**: Vue 3 + Vite + Vue Router (history mode)
- **Backend**: Express 5 + WebSocket (ws library)
- **AI**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

## Project Structure

```
claude-code-web/
├── server/              # Express + WebSocket backend
│   ├── index.js         # Server entry point
│   ├── websocket.js     # WebSocket event router
│   ├── config.js        # Configuration & path utilities
│   ├── events/          # Event handlers (one file per event)
│   └── lib/             # Shared utilities
├── src/                 # Vue 3 frontend
│   ├── views/           # Page components
│   ├── components/      # Reusable components
│   ├── composables/     # Vue composables (useWebSocket)
│   └── utils/           # Utility functions
├── docs/                # Documentation
│   ├── todo/            # Planning and ideas not yet implemented
│   ├── completed/       # Completed feature documentation
│   └── *.md             # Misc reference documentation (DOCKER.md, STYLEGUIDE.md)
├── README.md            # User-facing: setup, usage, contribute
├── CLAUDE.md            # This file - development workflow
├── PLAN.md              # High-level task tracking
└── CHANGELOG.md         # Release notes
```

## Documentation Organization

**Root Level:**
- `README.md` - User-facing documentation (setup, usage, contribute)
- `CLAUDE.md` - Developer workflow and guidelines (this file)
- `PLAN.md` - High-level task tracking and project roadmap
- `CHANGELOG.md` - Version-based release notes following [Keep a Changelog](https://keepachangelog.com/) format

**`docs/` Folder:**
- `todo/` - Planning documents and ideas not yet implemented (FEATURE_*, BACKLOG_*, IMPLEMENTATION_*)
- `completed/` - Completed feature documentation (fully implemented features)
- `*.md` - Misc reference documentation (DOCKER.md, STYLEGUIDE.md, etc.)
- Keeps root clean while organizing detailed technical specs by status

## Development

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Run checks (linting + formatting)
npm run check
```

## Guidelines

### Server Management

- Dev server runs via nodemon in manual restart mode (no file watching) for resilience
- Press `rs` + Enter in the nodemon terminal to manually restart after code changes
- Server logs stream to `dev.log` - check for errors there
- **Server Restart Policy:**
  - **Always get user consent** before restarting the server
  - Exception: Small, safe, low-risk changes where auto-restart is explicitly permitted
  - When permitted, use: `npx tofucode --restart --port 3001 --bypass-token <token>`
  - Backend must remain resilient for testing; user manages server lifecycle

### Code Style

- Follow existing patterns in the codebase
- Use Vue 3 Composition API with `<script setup>`
- Prefer composables for shared state (`useWebSocket`)
- **Always run `npm run check` after implementation** - this runs Biome for linting, formatting, and import ordering
- After code changes, rebuild frontend with `npm run build`

### Environment Variables

- **All new environment variables must be documented in `.env.example`**
- Include clear comments explaining purpose, default values, and valid options
- Mark optional variables with `#` prefix (commented out)

### WebSocket Architecture

- **Global WebSocket** (`useWebSocket`): Shared state for project/session lists
- **Scoped WebSocket** (`useChatWebSocket`): Per-chat-view connection with isolated state
- Each browser tab can have its own chat session

### Session Storage

- Sessions stored in `~/.claude/projects/{project-slug}/`
- Session titles in `.session-titles.json` (per project, separate from Claude's JSONL)
- Project slug format: path with `/` replaced by `-` (e.g., `-home-ts-projects-myapp`)

### Key Patterns

- Slug ↔ Path conversion: Use `slugToPath()` for filesystem probing (handles ambiguity)
- Permission modes: `default`, `plan`, `bypassPermissions`, `skip` (dangerouslySkipPermissions)
- Task cancellation: AbortController pattern for stopping running requests

### Discord Bot Integration

**Isolation Principles:**
- Discord bot code lives in `server/discord/` folder (fully self-contained)
- **Web UI features have priority** - shared utilities must NOT be modified to accommodate Discord
- Discord creates its own transformation layers in `server/discord/lib/` when needed
- Discord is a parallel consumer of the Claude Agent SDK, NOT a WebSocket client

**Allowed Imports from Existing Code:**
- ✅ `server/config.js` - Path/slug conversion, config values
- ✅ `server/lib/tasks.js` - Task tracking (session-keyed, transport-agnostic)
- ✅ `server/lib/sessions.js` - Session listing, history loading
- ✅ `server/lib/session-titles.js` - Session title management
- ✅ `server/lib/mcp.js` - MCP server loading
- ✅ `server/lib/logger.js` - Logging utility
- ✅ `server/lib/projects.js` - Project listing
- ✅ `@anthropic-ai/claude-agent-sdk` - Direct SDK usage

**Forbidden Imports:**
- ❌ `server/lib/ws.js` - WebSocket-specific (send, broadcast, watchSession)
- ❌ `server/lib/auth.js` - Web UI authentication (Discord uses bot token)
- ❌ `server/events/*` - Web UI event handlers (Discord has own handlers)

**Architecture Pattern:**
- `server/discord/lib/executor.js` wraps SDK `query()` as async generator
- Yields structured events: `{ type: 'text' | 'tool_use' | 'result' | 'error', ... }`
- Discord event handlers consume events and transform to Discord messages
- Same session persistence (JSONL) as Web UI, different transport layer

**Mapping Strategy:**
- Channel = Project: Each Discord channel maps to one tofucode project folder
- Thread = Session: Each thread in a channel is a separate Claude Code session
- Configured via `/setup` slash command, persisted to `~/.tofucode/discord-*.json`

## Release Process

### Security Testing Requirements

**Before every release, perform thorough security and penetration testing:**

1. **Run Security Assessment**
   - Test authentication bypass attempts
   - Test file access controls and path traversal
   - Test WebSocket security and session validation
   - Test CORS and origin validation
   - Review credentials access and exposure risks
   - Document all findings

2. **Fix Security Issues**
   - Work with team to address any vulnerabilities found
   - Prioritize by severity (Critical → High → Medium → Low)
   - Re-test after fixes to verify resolution

3. **Document Results**
   - Create security report: `docs/security_report_v{version}.md`
   - Include test methodology, findings, and mitigations
   - Document both passed and failed tests
   - Add recommendations for future improvements

4. **Update README**
   - Link new security report in README.md Security section
   - Maintain transparency for public users

5. **Only Release When Secure**
   - All critical and high-severity issues must be resolved
   - Security report must show passing results
   - Document any accepted risks (low severity with mitigations)

**Example workflow:**
```bash
# 1. Run security tests
node pentest_ws.js
node pentest_cors.js

# 2. If issues found, fix and re-test
# (iterate until all critical issues resolved)

# 3. Document results
# Create docs/security_report_v1.0.4.md

# 4. Update README
# Add link to new security report

# 5. Proceed with release
npm run build
npm version patch
git push --tags
npm publish
```

## Reference

See `PLAN.md` for detailed implementation notes, WebSocket event documentation, and feature history.
