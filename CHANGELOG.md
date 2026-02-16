# Changelog

All notable changes to tofucode.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **AskUserQuestion interactive modal** - Claude's questions now display as standalone messages with an "Answer" button that opens a modal with selectable option cards and custom text input
  - Server-side stream interception pauses SDK, waits for user answers, injects tool_result back via `streamInput()`
  - No timeout - user must answer or cancel task (prevents unexpected stream termination)
  - Proper cleanup of pending questions when task is cancelled
- **Memo feature (Cmd+M)** - Quick access to TODO.md or custom file for notes and tasks
  - Toggle memo overlay with Cmd+M keyboard shortcut or memo button beside mode tabs
  - Always defaults to TODO.md if not configured in settings
  - Auto-focus in memo editor at end of content when opened
  - Escape key closes memo and refocuses chat input at end
  - Enable/disable via checkbox in settings (enabled by default)
  - Configurable memo file in settings (uses old quickAccessFile key for compatibility)
- Plan content max-height reduced to 400px for better readability

### Changed
- Symbol toolbar setting changed from textarea to single-line text input

### Fixed
- Git diff modal now correctly uses scoped WebSocket connection with project context
- Git changes viewer no longer shows "No project selected" error when clicking on git status indicator
- Plan content now displays in chat UI when ExitPlanMode is called, making plans visible before approval
- EnterPlanMode now shows clear indicator that Claude is entering planning phase
- AskUserQuestion modal now opens correctly (fixed `navigator.platform` access error)
- Memo editor focus now works correctly with TinyMDE contenteditable element
- Memo focus watcher initialization order fixed (no more ReferenceError on page load)

### Removed
- Screenshot generation scripts

## [1.0.2] - 2026-02-15

### Added
- Cmd+N keyboard shortcut to create new session from current project
- Cmd+J keyboard shortcut to jump to next displayed recent session
- Yellow badge indicator in sidebar showing running terminal count per session
- Terminal tab badge now shows running process count immediately on page load

### Changed
- Updated dependencies to latest compatible versions
  - @anthropic-ai/claude-agent-sdk: 0.2.37 → 0.2.42
  - @biomejs/biome: 2.3.13 → 2.3.15
  - marked: 17.0.1 → 17.0.2
  - tiny-markdown-editor: 0.2.18 → 0.2.19
  - vue: 3.5.27 → 3.5.28
  - qs: 6.14.1 → 6.15.0 (security fix)
- Now tracking package-lock.json for reproducible Docker builds
- Keyboard shortcuts modal now uses symbols (⌘/^) instead of text (Ctrl/Cmd)
- Restart server button moved from sidebar to settings modal
- Terminal count badges now use global WebSocket broadcast for real-time updates

### Fixed
- Security vulnerability in qs package (CVE-2026-2391)
- Keyboard shortcut display corrected from Cmd+? to Cmd+/ (matches actual shortcut)
- Terminal tab badge now displays correctly on page refresh without clicking terminal first

## [1.0.1] - 2026-02-15

### Changed
- Rebranded from cc-web to tofucode
- Updated repository URL to https://github.com/picotofu/tofucode
- Updated PWA manifest with new app name
- Updated all branding references throughout UI and documentation
- Files tab breadcrumb header moved above toolbar for cleaner layout
- Changed dotfiles toggle icon to dot-circle for better clarity

### Added
- **Docker Support** - Multi-architecture images (amd64/arm64) with flexible volume mounting
- **Markdown Table of Contents** - Auto-generated sidebar with click-to-scroll navigation for MD files
- File statistics in editor header (size, lines, characters)
- Android back button support for Files tab navigation
- New tofu mascot logo (evening/morning variants)
- Docker authentication options: credentials file, full .claude folder, or env var
- Comprehensive Docker documentation with mount strategies and examples

### Fixed
- Symbol toolbar now properly triggers auto-save
- Symbol toolbar focus remains on cursor position after insertion
- File statistics aligned to right side of editor header
- Files tab header spacing and padding for consistent alignment

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
