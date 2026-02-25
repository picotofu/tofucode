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

### Branch Strategy

- Features branch from `main` → `feature/*`
- Release prep uses a dedicated `release/v{major}.{minor}.{patch}` branch
- Feature branches merge into the release branch, then release branch merges into `main`
- Version bump type: `patch` for bug fixes, `minor` for new features, `major` for breaking changes

### Version Number

The version in `package.json` is typically bumped at the **start** of the release branch, not at publish time. So at release time, check first:

```bash
node -p "require('./package.json').version"
```

- **If version is already correct** (was bumped when branching): skip `npm version`, just tag manually
- **If version still needs bumping**: run `npm version minor` (or `patch`/`major`) — this updates `package.json`, `package-lock.json`, and creates a git tag automatically

### Pre-Release Checklist

1. **Security Audit** (static code review — no pentest scripts required)
   - Review all new code: auth, file access, WebSocket, input validation, credentials
   - Run `npm audit` to check for new dependency vulnerabilities
   - Fix all Critical and High severity issues before proceeding
   - Create `docs/security_report_v{version}.md` with findings, fixes, and accepted risks
   - All Critical/High must be resolved; document accepted Low/Medium risks

2. **Update CHANGELOG**
   - Move `## [Unreleased]` section content to `## [{version}] - {date}`
   - Add a new empty `## [Unreleased]` section at the top

3. **Update README**
   - Add new security report link in the Security section
   - Format: `- **[v{version} Security Report](./docs/security_report_v{version}.md)** - brief summary`

4. **Final build verification**
   - `npm run check` — lint + format (Biome)
   - `npm run build` — production frontend build
   - Confirm no errors

### Release Steps

```bash
# 1. Push the release branch to origin
git push origin release/v{version}

# 2. Tag the release (if not already tagged by npm version)
git tag v{version}
git push origin v{version}

# 3. Publish to npm
npm publish

# 4. Build and push Docker multi-arch image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag picotofu/tofucode:{version} \
  --tag picotofu/tofucode:latest \
  --push .

# 5. Merge release branch into main
git checkout main
git merge release/v{version}
git push origin main
```

### Post-Release

- Verify npm package is live: `npm info tofucode version`
- Verify Docker image: `docker pull picotofu/tofucode:latest`
- Archive the release branch (leave it; don't delete — useful for hotfix reference)

## Reference

See `PLAN.md` for detailed implementation notes, WebSocket event documentation, and feature history.
