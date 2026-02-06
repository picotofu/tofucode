# cc-web

Web UI for Claude Code with full system access. Run Claude through a browser interface on remote VMs, servers, or local machines.

---

## Quick Start

```bash
# Run directly with npx (recommended)
npx cc-web

# Or install globally
npm install -g cc-web
cc-web
```

Open http://localhost:3000 and start chatting.

---

## Requirements

- **Node.js 18+**
- **Claude Code** installed and configured with API key
- **Anthropic API key** configured in Claude Code

---

## Setup

### 1. Install Claude Code

Follow the [Claude Code installation guide](https://github.com/anthropics/claude-agent-sdk) to set up the `claude` CLI with your API key.

### 2. First Run

```bash
npx cc-web
```

On first run:
1. Open http://localhost:3000
2. Create a password
3. Select a project from `~/.claude/projects/` or browse to a folder
4. Start chatting

---

## Usage

### Command Line Options

```bash
# Custom port
npx cc-web --port 8080

# Bind to specific host
npx cc-web --host 127.0.0.1

# Disable authentication (local/trusted networks only)
npx cc-web --no-auth
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Port to listen on | 3000 |
| `-h, --host <host>` | Host to bind to | 0.0.0.0 |
| `--no-auth` | Disable password authentication | false |

### Environment Variables

```bash
PORT=8080 npx cc-web
HOST=127.0.0.1 npx cc-web
AUTH_DISABLED=true npx cc-web
DEBUG=true npx cc-web  # Enable debug logging to cc-web.log
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `HOST` | Host to bind to | 0.0.0.0 |
| `AUTH_DISABLED` | Disable authentication | false |
| `DEBUG` | Enable debug logging to `cc-web.log` with timestamps | false |

---

## Features

- **Chat Interface** - Full markdown rendering, syntax highlighting, collapsible tool outputs
- **Terminal Mode** - Run shell commands with output streaming, command history
- **Files Mode** - Browse and edit project files with markdown support
- **Session Management** - Multiple sessions, rename, quick switcher (Ctrl+K)
- **Permission Modes** - Configure Claude's access: Default, Plan, Bypass, Skip
- **Multi-tab Support** - Session warnings, per-tab isolation
- **Authentication** - Password protection with session tokens (default enabled)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Quick session switcher |
| `Ctrl+L` | Scroll to bottom (chat) / Clear input (terminal) |
| `Escape` | Close palette / Blur input |
| `Up/Down` | Terminal command history |

---

## Security

- **Authentication enabled by default** - Set password on first run
- Use `--no-auth` only on trusted/local networks
- Sessions stored locally in `~/.claude/projects/`
- Auth data in `~/.cc-web/.auth.json`
- Full system access matching Claude Code permissions

---

## Contributing

### Development Setup

```bash
# Clone repository
git clone <repo-url>
cd cc-web

# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:3000
```

### Development Workflow

1. **Make changes** to frontend (`src/`) or backend (`server/`)
2. **Frontend:** Auto-reloads via Vite HMR
3. **Backend:** Press `rs` + Enter in nodemon terminal to restart
4. **Check logs:** `tail -f dev.log`
5. **Run checks:** `npm run check` (linting + formatting)
6. **Build:** `npm run build`

### Code Style

- **Always run `npm run check`** after implementation (Biome linting + formatting)
- Rebuild frontend with `npm run build` after code changes
- Follow existing patterns in the codebase
- Write clear commit messages

### Project Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Development guide and workflow
- **[PLAN.md](./PLAN.md)** - Architecture and technical overview
- **[CHANGELOG.md](./CHANGELOG.md)** - Release notes

### Feature Documentation

Feature documentation in the [`docs/`](./docs) folder:

**Implemented:**
- [Terminal Mode](./docs/FEATURE_TERMINAL.md) - Command execution with output streaming (✅ v1.0.0)
- [File Explorer](./docs/FEATURE_FILE_EXPLORER.md) - Browse and edit files (✅ v1.0.0)

**Planned:**
- [Diff Viewer](./docs/FEATURE_DIFF_VIEWER.md) - Inline diffs for Edit operations
- [Version Updates](./docs/FEATURE_UPDATE_VERSION.md) - Update checking
- [Claude Interactivity](./docs/FEATURE_CLAUDE_INTERACTIVE.md) - Permission prompts & Q&A
- [Terminal Interactivity](./docs/FEATURE_TERMINAL_INTERACTIVE.md) - stdin support for interactive programs

### Testing

No automated test suite yet. Manual testing workflow:

1. Test chat functionality (prompts, responses, tools)
2. Test terminal mode (commands, output, history)
3. Test files mode (browse, edit, save)
4. Test session management (create, switch, rename)
5. Test permission modes (default, plan, bypass)
6. Test authentication flow (setup, login, logout)
7. Test multi-tab behavior (warnings, synchronization)

---

## License

MIT

---

## Support

- **Issues:** Report bugs or feature requests on GitHub
- **Documentation:** See [CLAUDE.md](./CLAUDE.md) for development guide
- **Architecture:** See [PLAN.md](./PLAN.md) for technical overview
