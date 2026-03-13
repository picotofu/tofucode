# Changelog

All notable changes to tofucode.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Slack Bot Integration** — Baked-in Slack bot that listens to configured channels via Socket Mode and responds as the user's identity using Claude
  - Two-pass classifier: Haiku (fast/cheap) first, escalates to Sonnet on low confidence or when context is needed
  - Actions: `ignore`, `acknowledge`, `answer`, `ticket` (creates Notion ticket with Slack thread permalink), `work` (starts a tofucode session in the mapped project)
  - Confidence gate: low-confidence work actions fall back to ticket creation + waiting for user clarification instead of auto-starting
  - Notion ticket lifecycle: thread permalink linked on creation, updates on new thread replies, ticket set to In Progress before work starts, PR URL linked on detection
  - Session visibility: work sessions write JSONL to `~/.claude/projects/<slug>/` — appear naturally in the tofucode Web UI for monitoring
  - Classifier sessions optionally persisted to a configurable `sessionLogPath` (JSONL, readable in tofucode UI) with auto-generated titles like `[#channel] action: message snippet`
  - Settings UI: Slack tab with tokens, connectivity pill + Restart Bot button, fuzzy channel picker (public + private), project root path, session log path, identity and classifier prompt override
  - Channel picker fetches public and private channels via GET (Slack API quirk: POST ignores `types` filter); deduplicates by ID via two separate calls
- **3-tab homepage** — Homepage now has a bottom tab nav (Sessions, Folders, Files) with Heroicons; Sessions tab shows recent sessions and recent projects; Folders tab is a directory-only browser for launching sessions; Files tab is a standalone file browser defaulting to the home directory
- **Independent file browser** — Files tab on homepage provides a full-featured file browser (browse, search, open, edit, create, rename, delete) outside of any session, defaulting to the home directory and persisting the last visited path in localStorage
- **Traversal root guard** — File browser enforces a topmost browsable path (`--root` config if set, otherwise `homedir()`); breadcrumb segments above the root are shown as muted static text; up button and path edit are clamped to this boundary; session files tab defaults to the project path but allows traversal up to the root; homepage files tab defaults to the root itself
- **Server `homePath` in connected message** — Server includes `homePath` (root config path or `homedir()`) in the `connected` WebSocket message; clients use this to set the traversal root without a separate request

### Changed
- **Files toolbar moved into FilesPanel** — Dotfiles toggle, New File, New Folder, and MD Mode buttons are now part of the `FilesPanel` component rather than injected via slot, eliminating duplicate rendering when the component is reused
- **Breadcrumb path edit UX** — Tapping the path bar no longer opens edit mode; a pencil icon button toggles edit mode; a check button submits; Escape cancels; edit is clamped to root
- **Mobile toolbar layout** — On mobile (≤639px) the toolbar buttons wrap to their own row above the path bar, right-aligned

### Fixed
- **Memo sidebar broken** — `FileEditor` import was inadvertently removed during the 3-tab homepage refactor; memo overlay is now restored
- **Android back button** — pressing back now closes the memo sidebar, settings modal, and sessions sidebar (mobile only) instead of navigating away; implemented via a new `useBackButton` composable using the history sentinel pattern
- **Settings modal mobile layout** — now renders full-screen on mobile instead of a floating card
- **`isDesktop` not reactive** — sidebar initial state now uses `window.matchMedia` with a resize listener; switching to mobile auto-closes the sidebar
- **File download race condition** — concurrent file downloads no longer collide; tracking moved from a single ref to a `Map`
- **Slack settings save** — blocks save with an alert if Slack is enabled but bot token is empty
- **Notion field mapping overwrite** — "Analyse Structure" now prompts for confirmation before replacing existing manual mappings
- **`isUpdatingFromProps` timing** — replaced fragile `setTimeout(0)` with `nextTick` in SettingsModal
- **Silent `~/.claude.json` parse failure** — Slack MCP token fallback now logs a warning instead of swallowing the error
- Files tab on homepage was starting at filesystem root instead of home directory — server-side null path now defaults to `homedir()` before validation
- Traversal guard lost after session change — `resetState()` now restores `filesRootPath` to `homePath` instead of clearing it
- Muted breadcrumb segments were still receiving hover highlight — fixed with `pointer-events: none`
- Mobile session/project list now uses list view instead of cards (desktop retains card layout)

## [1.2.1] - 2026-03-08

### Added
- **Markdown TOC mobile toggle** — In the file editor, the table of contents sidebar is now hidden by default on mobile (≤768px) and toggles as a right-side overlay via a new list icon button in the stat bar; tapping the editor content area dismisses it; desktop layout unchanged
- **New Folder in project browsers** — Both the homepage folder browser and the Cmd+K New Project folder selector now have a "New Folder" button; clicking it shows an inline form to name and create the folder in the current directory; the list refreshes automatically on success; errors (e.g. folder already exists, permission denied) are shown inline with the form re-opened for retry

### Fixed
- Allow typing in chat input during WebSocket reconnection — input is no longer blocked by `pointer-events: none`; the reconnecting indicator is repositioned to the bottom-right corner so it doesn't obstruct the text area
- Draft sync failsafe on reconnect — if the user typed while disconnected, the local draft is pushed to the server immediately on reconnect instead of triggering a spurious conflict modal
- Cmd+P / Files tab search now ranks exact filename matches above prefix, substring, and fuzzy matches — previously client-side alphabetical sort was overriding server-side match quality ranking

## [1.2.0] - 2026-03-03

### Added
- **Mobile git diff** — Git diff modal is now mobile-friendly: file list and diff view are separate full-screen panels; tapping a file navigates to the diff view (all files concatenated, scrolled to the selected file); back button returns to the file list; each file's diff section scrolls independently; desktop layout unchanged
- **Git diff line numbers** — Two-column gutter (old | new) with accurate line numbers parsed from hunk headers; gutter is non-selectable and styled to not compete with diff content
- **Server-side draft sync** — Chat input drafts are now persisted server-side (per session) in addition to localStorage. On session load, the server draft is fetched: if no local draft exists it is silently restored; if both exist and differ, a yellow `⚠` indicator appears on the input form and a conflict modal lets you choose between the local (this device) and server (another device) version. Drafts are cleared server-side on submit.
- **Sidebar project toolbar** — Pinned toolbar in the Projects tab with three actions: New Project (opens Cmd+K folder selector), Sort A-Z toggle (persists within session), and Clone Repository icon button; the old full-width clone button is removed
- **Cmd+K folder selector** — New Project toggle in Cmd+K switches the palette into a folder browser mode; navigate subdirectories with arrow keys or click, Cmd+Enter selects the current folder to start a new session, Escape returns to session search
- **File Upload** — Upload files directly from the file browser via click-to-select or drag & drop. Progress is shown per-file with success/error feedback; the directory refreshes automatically on completion.
- **File size limit config** — Max file size for reads and uploads is controlled via `MAX_FILE_SIZE_MB` env var or `maxFileSizeMb` in `config.json`; defaults to 10 MB.
- **HTML render toggle** — File editor shows a toggle button for `.html`/`.htm` files to switch between source view and a sandboxed iframe preview.
- **File download** — Download button in the file editor header and in the Cmd+P file picker (files only). Cmd+P download fetches content on demand via WebSocket.
- **Cmd+P enhancements**:
  - Folders are now referenceable (link button shows on all items, not just files)
  - Cmd+Enter references the selected item in chat (instead of opening it)
  - Legend below the CWD bar: `↵ open · ⌘↵ reference`
  - Download button added alongside the reference button (files only)
  - Dotfile toggle synced with Files tab state
- **Files tab server-side search** — Search box in the files tab now uses the same server-side fuzzy/glob search as Cmd+P, scoped to the currently viewed folder (not the project root); searching across subfolders works naturally as you navigate
- **Hide footer when viewing a file** — Footer (breadcrumb, toolbar, search, mode tabs) is hidden when a file is open in the files tab, giving the editor full vertical space

### Fixed
- Docker: switch base image from Alpine to `node:24-slim` (Debian) — resolves Claude Code shell detection failure that prevented git operations inside containers; mount paths updated from `/home/appuser/` to `/home/node/`
- Binary and unsupported files no longer cause a flash loop — server returns file info instead of an error, frontend shows a "Binary file" info view
- Files larger than 10MB now show a "File too large to preview" info view instead of looping
- File URL watcher no longer re-fetches on loading state changes — only triggers on path open/close
- Links in chat now open in a new tab (`target="_blank"`) — DOMPurify allowlist updated for `target` and `rel` attributes
- Clone modal now closes on Escape key via document-level listener
- Clone and git diff icons replaced with cleaner fork/branch shape

### Security
- **Fixed upload filename injection** — `originalname` is now sanitised via `path.basename()` and the final path re-validated; prevents path traversal via crafted filenames
- **Removed client-controlled `projectPath` from upload** — upload path validation no longer accepts a client-supplied root, only allowing writes under `homedir()` or `config.rootPath`
- **Fixed symlink escape in non-rootPath mode** — `realpathSync` now applied in both `files.js` and `upload.js` for all path validation, not just when `--root` is set
- **Genericised error messages** — filesystem error details no longer forwarded to clients; full detail logged server-side only
- **Draft entry limit** — `.drafts.json` capped at 100 entries per project with LRU eviction to prevent unbounded file growth
- **Dependency updates** — minimatch (ReDoS), multer (DoS), rollup (path traversal) patched via `npm audit fix`
- See [v1.2.0 Security Report](docs/security_report_v1.2.0.md) for full audit details

## [1.1.0] - 2026-02-25

### Added
- **Message Queue** — Submit prompts while Claude is running; they queue server-side (FIFO) and execute automatically once the current task finishes
  - Red badge on chat prompt icon shows queue depth; click to open Queue Manager modal
  - Queue Manager: view queued prompts with position, preview, timestamp, and per-item delete; Clear All with confirmation
  - Queue pauses on task cancel — next item processes only after a task completes or errors
  - Queue state synced on session select/reconnect; cleared when session is deleted
  - Max 50 queued messages per session; empty/invalid prompts rejected before enqueue
  - Queue processing is single-file: each item runs to completion before the next dequeues
- **Discord Bot Integration** — Bring-your-own-bot support. Run Claude Code sessions from Discord threads, mirrored to the Web UI via an internal event bus. See [Discord Setup Guide](docs/DISCORD_SETUP_GUIDE.md).
  - Channel-to-project mapping via `/setup`
  - Thread-per-session model with persistent session storage
  - Slash commands: `/setup`, `/session`, `/cancel`, `/resume`, `/list`, `/status`
  - Minimal streaming output — tool activity shown as compact footer, AI response stays clean
  - Auto-rename threads from first message content
  - User mention on long-running task completion
  - Web UI → Discord sync via internal event bus (sessions started in Web UI create mirrored Discord threads)
- **Terminal watch mode** — Schedule a bookmarked command to re-run at a set interval; output renders as a table or raw stdout in the Active tab
- **Copy message button** — Hover over any user or Claude message to reveal a copy icon; copies raw markdown content to clipboard (not rendered HTML), with a 2-second checkmark feedback
- **MCP Server Manager** — Dedicated modal (plug icon in sidebar) to view, add, edit, and remove MCP servers across all config scopes (local, project, user)
  - HTTP/SSE servers: full CRUD with inline test connection (MCP handshake, status-aware result display)
  - Stdio servers: full config CRUD (command, args, env vars); binary installation is user's responsibility
  - OAuth-managed servers: read-only display with expiry badge and CLI reconfiguration hint
  - Scope selector locked in edit mode; saving/loading state on form; inline mutation error banner
- **Enhanced file picker search** — Cmd+P now matches across full relative paths and normalises word separators
  - Path substring: `docs/api` matches `docs/api/episodes.md` and `docs/api/profile.md`
  - Multi-token AND: `feature mcp` matches `FEATURE_MCP.md` (spaces match `_`, `-`, `/`)
  - Separator-agnostic: `feature_mcp`, `feature-mcp`, and `feature mcp` all find the same files
  - Match highlighted in the path row when matched via full path

### Fixed
- Session title overflow on mobile — long titles now truncate with ellipsis instead of causing horizontal scroll
- Session edit button no longer triggers row navigation (click was propagating to the parent `<a>` tag)
- Cmd+2 terminal subtab cycle order fixed: History → Active → Bookmarks

### Security
- `/docs` folder now requires authentication (previously publicly accessible)
- WebSocket Origin header validated on upgrade to prevent CSWSH attacks
- Security headers added: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- WebSocket max message size capped at 1MB
- Minimum password length increased from 4 to 8 characters
- Process history file moved from world-readable `/tmp/` to `~/.tofucode/` with `0o600` permissions
- Terminal output sanitized with DOMPurify as defense-in-depth layer
- Internal error details no longer sent to WebSocket clients

## [1.0.5] - 2026-02-18

### Added
- **Tab key handling in chat input** - Tab/Shift+Tab to indent/dedent list items in chat markdown editor (matches file editor behavior)
- **Cmd+2 terminal tab toggle** - Subsequent Cmd+2 presses toggle between active/history tabs when already in terminal mode
- **Folder path search in file picker** - File picker now shows files inside folders that match the search query
- **Cmd+L to scroll terminal to bottom** - Jump to bottom of terminal output in both active and history tabs
- **Terminal command navigation** - Navigate through terminal history with Cmd+Up/Down arrows or on-screen buttons with command counter (e.g., "3/15")
- **Configurable model slugs** - Override default Claude model versions via environment variables (`MODEL_HAIKU_SLUG`, `MODEL_SONNET_SLUG`, `MODEL_OPUS_SLUG`)
- **Turn-based message pagination** - Load older messages in turn-based chunks; button click jumps to new messages, up-arrow preserves scroll position

### Changed
- **CLI subcommands** - Use `tofucode start|stop|restart|status` instead of `--stop`, `--restart`, `--status` flags (legacy flags still supported for backwards compatibility)
- Log file location now consistently uses `~/.tofucode/tofucode.log` (was split between cwd and ~/.tofucode)
- **Default Sonnet model updated to 4.6** - Now uses `claude-sonnet-4-6` by default (was SDK default, likely 4.5)
- **Updated Claude Agent SDK to 0.2.45** - Latest SDK version with improved model support
- **Session history buffer increased to 5000 lines** - Supports larger JSONL sessions without pagination cutting off early turns

### Fixed
- One-click upgrade now properly restarts server with correct configuration, port, and daemon mode preserved
- One-click upgrade exits old process immediately to free port for new process (was blocking for 3+ seconds)
- Upgrade now spawns newly installed version instead of re-running old script path
- **Projects list now scans for actual session files** - Projects with empty/missing `sessions-index.json` are now properly detected (fixes missing projects in sidebar after renames/migrations)
  - Performance impact: +0.3ms average (negligible)
  - Recovers projects that were previously hidden
- **CLI-initiated sessions with no messages now load correctly** - Fixed infinite skeleton loader when opening sessions created from CLI (e.g., `/mcp` command dismissed) that have no user/assistant messages
  - Race condition fixed: Session selection now waits for project selection using `nextTick()`
  - Skeleton loaders now switch to empty state once `contextReady` is true
  - Empty sessions show "Start a conversation" message instead of loading indefinitely
- **Session message count now excludes system messages** - Session list displays accurate message count by only counting displayable messages (user, assistant, tool_result)
  - Fixes sessions showing "2 messages" when they appear empty (were only system messages)
  - Applied to both indexed sessions and unindexed sessions scanned from JSONL files
- **Session no longer stuck in "running" state** - Task is marked completed immediately when Claude emits a result message, not after the stream fully closes (fixes sessions appearing in-progress after Claude responds with a plain question)
- **Stale task detection improved** - Added 30-minute hard timeout in addition to abortController check; prevents ghost "running" indicators after server restarts

### Security
- **Fixed command injection in upgrade handler** - Version parameter now validated with strict regex (`latest` or semver only) before use in shell command
- **Added input validation for pagination parameters** - `offset`, `limit`, `turnLimit`, and `maxBufferSize` are now sanitized and clamped to prevent resource abuse
- **Added model string validation** - Only `opus`, `sonnet`, `haiku`, or well-formed `claude-*` strings accepted; arbitrary strings no longer reach the SDK
- **Bounded slugToPath complexity** - Added `MAX_SLUG_PARTS=30` and `MAX_SPAN_SIZE=8` limits to prevent exponential filesystem probing DoS
- **Removed `ALLOW_SOURCE_UPGRADE` development backdoor** - Was marked "remove before release" and has been eliminated
- See [v1.0.5 Security Report](docs/security_report_v1.0.5.md) for full audit details

## [1.0.4] - 2026-02-17

### Added
- **Fuzzy file picker (Cmd+P)** - Quick file search and navigation with folder support and glob patterns
- **PWA cache clear button** - Force clear service worker cache and update to latest version
- **AskUserQuestion modal** - Interactive answer UI with option cards and text input
- **Memo feature (Cmd+M)** - Quick-access overlay for TODO.md or custom notes file
- **File reference from picker** - Reference files directly from Cmd+P picker into chat input
- **Tab key handling in markdown editor** - Tab/Shift+Tab to indent/dedent list items in file editor

### Changed
- Settings UI improvements (inline reset button, connection status pill)
- Plan content max-height reduced to 400px
- File picker auto-scrolls selected item into view during keyboard navigation

### Fixed
- Git diff modal project context
- Plan mode display and indicators
- AskUserQuestion session handling and answer delivery
- Memo editor focus behavior
- New session message visibility during route transition

### Security
- Added path validation to file search handler (prevents directory enumeration outside allowed paths)
- Added session ownership check for AskUserQuestion answers (prevents cross-session injection)
- Added TTL expiry for pending questions map (prevents memory leak)
- Clean up SDK stream reference after task completion (prevents memory retention)
- Properly clean up tab key event listeners on component unmount
- Removed unauthenticated debug endpoint (`/api/debug/ws-config`)
- Refactored code copy buttons to use event delegation (removed `onclick` from DOMPurify whitelist)

### Removed
- Screenshot generation scripts

## [1.0.3] - 2026-02-15

### Added
- Screenshots section in README with showcase images

### Fixed
- Git diff modal using wrong WebSocket connection
- Process kill not terminating child processes

## [1.0.2] - 2026-02-15

### Added
- Cmd+N and Cmd+J keyboard shortcuts for session navigation
- Terminal process count badges in sidebar and terminal tab

### Changed
- Updated dependencies (Claude SDK 0.2.42, security fixes)
- Keyboard shortcuts modal UI improvements
- Restart server moved to settings modal

### Fixed
- Security vulnerability in qs package (CVE-2026-2391)
- Terminal badge display on page refresh

## [1.0.1] - 2026-02-15

### Added
- **Docker support** - Multi-architecture images with flexible authentication
- **Markdown table of contents** - Auto-generated navigation sidebar
- File statistics in editor header
- Android back button support
- New tofu mascot logo

### Changed
- Rebranded from cc-web to tofucode
- Files tab UI improvements

### Fixed
- Symbol toolbar auto-save and cursor position

## [1.0.0] - 2026-02-15

Initial release as tofucode.

### Added
- **Chat Interface** - Full markdown rendering, syntax highlighting, collapsible tool outputs
- **Terminal Mode** - Run shell commands with output streaming, command history
- **Files Mode** - Browse and edit files with markdown editor, CSV spreadsheet editor, and image viewer
- **CSV Editor** - Interactive spreadsheet editing with Tabulator
- **Image Viewer** - Preview images (PNG, JPG, GIF, WebP, SVG, BMP, ICO)
- **Session Management** - Multiple sessions, rename, quick switcher (Ctrl+K)
- **Permission Modes** - Configure Claude's access (Default, Plan, Bypass, Skip)
- **Authentication** - Password protection with session tokens
- **Progressive Web App** - Installable as standalone application
- **Auto-Update** - Version checking with one-click upgrade
- **Settings** - Debug mode, auto-save files, customizable symbol toolbar
- **Keyboard Shortcuts** - Mode switching, terminal shortcuts, turn navigation
- **Git Diff Viewer** - Full-screen diff modal with file-by-file navigation
- **MCP Integration** - Auto-detection with three-level scope merging
- **Multi-tab Support** - Session warnings and per-tab isolation
