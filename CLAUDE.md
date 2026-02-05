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
├── docs/                # Feature documentation
│   ├── completed/       # Completed feature documentation
│   ├── FEATURE_*.md     # Active feature plans and status documents
│   └── *.md             # Other reference documentation
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
- `CHANGELOG.md` - Short release notes (date-based pre-1.0, version-based post-1.0)

**`docs/` Folder:**
- `FEATURE_*.md` - Active feature planning and status documents
- `completed/` - Completed feature documentation (fully implemented features)
- Any other reference documentation with specialized prefixes
- Keeps root clean while organizing detailed technical specs

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
- **NEVER restart the server automatically** - always prompt the user to do it
- Backend must remain resilient for testing; user manages server lifecycle

### Code Style

- Follow existing patterns in the codebase
- Use Vue 3 Composition API with `<script setup>`
- Prefer composables for shared state (`useWebSocket`)
- **Always run `npm run check` after implementation** - this runs Biome for linting, formatting, and import ordering
- After code changes, rebuild frontend with `npm run build`

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

## Reference

See `PLAN.md` for detailed implementation notes, WebSocket event documentation, and feature history.
