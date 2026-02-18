# tofucode

Web UI for Claude Code with full system access. Run Claude through a browser interface on remote VMs, servers, or local machines.

---

## Quick Start

### NPM

```bash
# Run directly with npx (recommended)
npx tofucode

# Or install globally
npm install -g tofucode
tofucode
```

Open http://localhost:3000 and start chatting.

### Docker

```bash
# Pull and run
docker run -d \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_key_here \
  -v $(pwd):/workspace \
  picotofu/tofucode:latest

# Open http://localhost:3000
```

**Mount Points:**
- `/home/appuser/.claude/.credentials.json` - required - API credentials (isolated, recommended)
- `/home/appuser/.claude` - required - full Claude config (alternative, for host interop)
- `ANTHROPIC_API_KEY` env var - required - API key (alternative)
- `/workspace` - optional - project directory
- `/home/appuser/.tofucode` - optional - auth, settings, state storage

**Note:** Only one API authentication method is required (credentials file, full `.claude` folder, or env var)

See [Docker Guide](./docs/DOCKER.md) for all configuration options.

---

## Screenshots

### Homepage
![Homepage](https://raw.githubusercontent.com/picotofu/tofucode/main/samples/homepage.png)

### Chat View
![Chat View](https://raw.githubusercontent.com/picotofu/tofucode/main/samples/chat-view.png)

### Terminal Mode
![Terminal Mode](https://raw.githubusercontent.com/picotofu/tofucode/main/samples/terminal-view.png)

### Files Browser
![Files Browser](https://raw.githubusercontent.com/picotofu/tofucode/main/samples/files-view.png)

### Markdown Editor
![Markdown Editor](https://raw.githubusercontent.com/picotofu/tofucode/main/samples/editor-view.png)

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
npx tofucode
```

On first run:
1. Open http://localhost:3000
2. Create a password
3. Select a project from `~/.claude/projects/` or browse to a folder
4. Start chatting

---

## Usage

```bash
# Start server (default command)
tofucode
tofucode start

# Custom port and host
tofucode start -p 8080 -h 127.0.0.1

# Run as daemon
tofucode start -d

# Lifecycle management
tofucode stop
tofucode restart
tofucode status

# Restrict access to a specific directory
tofucode start --root /path/to/project

# Use config file
tofucode start --config prod.json

# See all options
tofucode --help
```

### Configuration

**Three ways to configure (priority order):**

1. **CLI arguments:** `tofucode start -p 8080 --debug`
2. **Config file:** `tofucode start --config prod.json` (see `config.example.json`)
3. **Environment variables:** `PORT=8080 DEBUG=true tofucode`

| Setting | CLI | Config | Env Var |
|---------|-----|--------|---------|
| Port | `-p 3000` | `"port": 3000` | `PORT=3000` |
| Host | `-h 0.0.0.0` | `"host": "0.0.0.0"` | `HOST=0.0.0.0` |
| No auth | `--no-auth` | `"auth": false` | `AUTH_DISABLED=true` |
| Daemon | `-d` | `"daemon": true` | - |
| Debug | `--debug` | `"debug": true` | `DEBUG=true` |
| Log file | `--log-file <path>` | `"logFile": "<path>"` | `LOG_FILE=<path>` |
| Bypass token | `--bypass-token <token>` | `"bypassToken": "<token>"` | `DEBUG_TOKEN=<token>` |
| Root path | `--root <path>` | `"root": "<path>"` | `ROOT_PATH=<path>` |
| Disable update check | - | - | `DISABLE_UPDATE_CHECK=true` |
| Update check interval | - | - | `UPDATE_CHECK_INTERVAL=3600000` |
| Model: Haiku | - | - | `MODEL_HAIKU_SLUG=claude-haiku-4-5` |
| Model: Sonnet | - | - | `MODEL_SONNET_SLUG=claude-sonnet-4-6` |
| Model: Opus | - | - | `MODEL_OPUS_SLUG=claude-opus-4-6` |

Run `tofucode --help` for all options.

### Model Configuration

By default, tofucode uses the latest Claude model versions:
- **Haiku:** `claude-haiku-4-5`
- **Sonnet:** `claude-sonnet-4-6`
- **Opus:** `claude-opus-4-6`

You can override these defaults using environment variables:

```bash
# Use specific model versions
MODEL_SONNET_SLUG=claude-sonnet-4-5-20250929 \
MODEL_OPUS_SLUG=claude-opus-4-5-20251101 \
tofucode
```

Or in your `.env` file:

```bash
MODEL_HAIKU_SLUG=claude-haiku-4-5
MODEL_SONNET_SLUG=claude-sonnet-4-6
MODEL_OPUS_SLUG=claude-opus-4-6
```

This allows you to:
- Pin to specific model versions with snapshot dates
- Use legacy models if needed
- Test new models as they're released

See the [Anthropic Models documentation](https://docs.anthropic.com/en/docs/models-overview) for all available model identifiers.

### Security: Root Path Restriction

Use `--root` to restrict file and terminal access to a specific directory:

```bash
tofucode start --root /home/user/projects/myapp
```

**What it does:**
- Limits Files tab navigation to the specified directory
- Validates terminal working directory (best effort)
- Filters project/session lists to only show items within the root
- Displays a "Restricted Mode" banner on the homepage

**⚠️ Important: Best Effort Basis**

The `--root` restriction is **not foolproof**:
- File access is strictly validated ✅
- Terminal CWD is validated ✅
- But users can still run commands like `cat /etc/passwd` or `cd /` ⚠️

**For full isolation, use Docker:**

```bash
docker run -d \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_key_here \
  -e ROOT_PATH=/workspace \
  -v /path/to/project:/workspace \
  picotofu/tofucode:latest --root /workspace
```

Docker provides OS-level isolation that cannot be bypassed. See the [Docker Guide](./docs/DOCKER.md) for flexible volume mounting strategies.

---

## Features

### Core
- **Chat Interface** - Markdown rendering, syntax highlighting, collapsible tool outputs
- **Terminal Mode** - Shell commands with streaming output and history
- **Files Mode** - Browse, edit, and preview files (markdown, CSV, images)
- **Session Management** - Multiple sessions with quick switcher (Cmd+K)
- **Permission Modes** - Control Claude's access (Default/Plan/Bypass/Skip)

### Collaboration
- **Interactive Questions** - Claude can ask questions with selectable answers
- **Plan Mode** - Review implementation plans before execution
- **Git Integration** - View diffs and file changes
- **Memo Feature** - Quick-access notes (Cmd+M)

### Platform
- **Multi-tab Support** - Session isolation and conflict warnings
- **Authentication** - Password protection (enabled by default)
- **PWA Support** - Install as standalone app on desktop/mobile
- **Auto-Update** - One-click upgrades for npm installs
- **Docker Ready** - Multi-arch images with flexible mounting
- **MCP Integration** - Auto-detection of Model Context Protocol servers

### Keyboard Shortcuts

**Global:**
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+K` | Quick session switcher |
| `Ctrl/Cmd+B` | Toggle sidebar |
| `Ctrl/Cmd+,` | Open settings |
| `Ctrl/Cmd+1` | Switch to Chat mode |
| `Ctrl/Cmd+2` | Switch to Terminal mode |
| `Ctrl/Cmd+3` | Switch to Files mode |
| `Ctrl/Cmd+L` | Scroll to bottom (chat mode) |
| `Ctrl/Cmd+Enter` | Submit message (chat) / Run command (terminal) |
| `Ctrl/Cmd+↑` | Navigate to previous conversation turn (chat mode) |
| `Ctrl/Cmd+↓` | Navigate to next conversation turn (chat mode) |
| `Escape` | Close modals / Blur input |

**Terminal Mode:**
| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Clear current input |
| `Ctrl+U` | Clear from cursor to start |
| `Ctrl+K` | Clear from cursor to end |
| `Ctrl+A` | Move cursor to start |
| `Ctrl+E` | Move cursor to end |
| `Ctrl+L` | Clear input |
| `↑` / `↓` | Navigate command history |

---

## Settings

Access settings via the gear icon in the sidebar. Settings are persisted in `~/.tofucode/settings.json`.

**Available Settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| **Debug Mode** | Off | Hover over UI elements to see their ID and class names for development |
| **Auto-save Files** | On | Automatically save file changes after 1 second of inactivity in Files mode |
| **Symbol Toolbar** | Top row + ` ~ / | Customize symbols shown in the file editor toolbar for quick insertion |

**Tips:**
- Settings apply across all sessions and persist after server restart
- Changes take effect immediately without reload
- Use `Ctrl/Cmd+S` for immediate manual save when auto-save is disabled

---

## Progressive Web App (PWA)

tofucode can be installed as a standalone application on desktop and mobile devices:

### Installing as an App

**Desktop (Chrome/Edge/Brave):**
1. Open tofucode in your browser
2. Click the install icon (⊕) in the address bar
3. Click "Install" in the prompt
4. Launch from desktop/start menu like any native app

**Mobile (iOS/Android):**
1. Open tofucode in Safari (iOS) or Chrome (Android)
2. Tap the Share button (iOS) or Menu (Android)
3. Select "Add to Home Screen"
4. Launch from home screen

### Benefits

- **Standalone window** - Runs without browser chrome (no address bar/tabs)
- **Desktop/dock icon** - Quick launch like native applications
- **Offline UI** - App shell loads instantly (requires connection for chat)
- **Better mobile experience** - Full-screen on mobile devices
- **Auto-update notifications** - Get prompted when new versions are available

### How Updates Work

The PWA uses service workers to detect when the frontend code changes:

1. **Automatic detection** - Service worker checks for updates on page navigation
2. **Update prompt** - When a new version is available, you'll see a prompt to reload
3. **One-click update** - Click "Update" to activate the new version instantly
4. **Content-addressed caching** - Any JS/CSS change triggers an update notification

The PWA updates independently from the backend npm package. For full updates (backend + frontend), use the upgrade button in settings.

---

## Security

- **Authentication enabled by default** - Set password on first run
- Use `--no-auth` only on trusted/local networks
- Sessions stored locally in `~/.claude/projects/`
- Auth data in `~/.tofucode/.auth.json`
- Full system access matching Claude Code permissions

### Security Reports

Independent security assessments are conducted before each release to ensure user safety:

- **[v1.0.5 Security Report](./docs/security_report_v1.0.5.md)** - Command injection fix, input validation hardening, DoS protection
- **[v1.0.4 Security Report](./docs/security_report_v1.0.4.md)** - Code review, file access hardening, session security, dependency audit
- **[v1.0.3 Security Report](./docs/security_report_v1.0.3.md)** - WebSocket auth, file access, CORS, penetration testing

All security reports are publicly available in the `docs/` folder for transparency.

---

## Contributing

### Development Setup

```bash
# Clone repository
git clone <repo-url>
cd tofucode

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

The [`docs/`](./docs) folder is organized by implementation status:

- **[`docs/completed/`](./docs/completed)** - Completed features (Terminal, File Explorer, PWA, etc.)
- **[`docs/todo/`](./docs/todo)** - Planned features and ideas (Claude Interactivity, File Mentions, etc.)
- **[`docs/`](./docs)** - Reference documentation (DOCKER.md, STYLEGUIDE.md)

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
