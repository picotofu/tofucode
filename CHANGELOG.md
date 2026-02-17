# Changelog

All notable changes to tofucode.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - Unreleased

### Changed
- **CLI subcommands** - Use `tofucode start|stop|restart|status` instead of `--stop`, `--restart`, `--status` flags (legacy flags still supported for backwards compatibility)
- Log file location now consistently uses `~/.tofucode/tofucode.log` (was split between cwd and ~/.tofucode)

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
