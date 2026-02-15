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
# Start server
tofucode

# Custom port and host
tofucode -p 8080 -h 127.0.0.1

# Run as daemon
tofucode -d

# Stop/restart/status
tofucode --stop
tofucode --restart
tofucode --status

# Restrict access to a specific directory
tofucode --root /path/to/project

# Use config file
tofucode --config prod.json

# See all options
tofucode --help
```

### Configuration

**Three ways to configure (priority order):**

1. **CLI arguments:** `tofucode -p 8080 --debug`
2. **Config file:** `tofucode --config prod.json` (see `config.example.json`)
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

Run `tofucode --help` for all options.

### Security: Root Path Restriction

Use `--root` to restrict file and terminal access to a specific directory:

```bash
tofucode --root /home/user/projects/myapp
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

- **Chat Interface** - Full markdown rendering, syntax highlighting, collapsible tool outputs
- **Terminal Mode** - Run shell commands with output streaming, command history
- **Files Mode** - Browse and edit files with markdown, CSV spreadsheet, and image viewer support
- **Session Management** - Multiple sessions, rename, quick switcher (Ctrl+K)
- **Permission Modes** - Configure Claude's access: Default, Plan, Bypass, Skip
- **Multi-tab Support** - Session warnings, per-tab isolation
- **Authentication** - Password protection with session tokens (default enabled)
- **Auto-Update** - Version checking with one-click upgrade for npm installs
- **Progressive Web App** - Installable as standalone app, works on desktop and mobile

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

The PWA updates independently from the backend npm package. For full updates (backend + frontend), use `tofucode --upgrade` or the upgrade button in settings.

---

## Security

- **Authentication enabled by default** - Set password on first run
- Use `--no-auth` only on trusted/local networks
- Sessions stored locally in `~/.claude/projects/`
- Auth data in `~/.tofucode/.auth.json`
- Full system access matching Claude Code permissions

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
