# Changelog

All notable changes to cc-web (Claude Code Web).

## 2026-02-14 - CSV Editor, Image Viewer & File Editor Enhancements

### New Features
- **CSV Editor**: Interactive spreadsheet editor for `.csv` files using Tabulator
  - Inline cell editing with auto-save support
  - Header toggle checkbox (treat first row as header or data)
  - Custom theme matching design system
- **Image Viewer**: Preview images directly in the Files tab
  - Supports PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO
  - Centered display with proper scaling
- **Customizable Symbol Toolbar**: Configure symbols shown in text editor
  - New setting in Settings modal with textarea input
  - Default: top keyboard row + tilde, backtick, forward slash
  - Persists to settings file

### Bug Fixes
- Fixed symbol toolbar not triggering auto-save on insert
- Fixed settings not loading on page refresh (WebSocket timing issue)
- Fixed tablet view not showing Terminal tab text label
- Fixed mobile view showing "History" text instead of icon-only

### Improvements
- Mode tabs bar takes full width with proper flex layout
- Quick session switcher items truncate when space is limited

## 2026-02-13 - Progressive Web App & UI Enhancements

### New Features
- **Progressive Web App (PWA)**: Installable as standalone application with service worker caching
- **Session Switcher**: Quick access to 2 most recent sessions in toolbar
- **New Session Button**: Quick session creation from breadcrumb header
- **File Auto-Edit**: Created files open immediately for editing

### Improvements
- Debug mode popover redesigned to match styleguide
- Settings modal with custom checkbox design
- All resources served with Brotli/Gzip compression

## 2026-02-13 - Debug Mode & Settings

### New Features
- **Settings Modal**: Global settings with auto-save, stored in `~/.cc-web/settings.json`
- **Debug Mode**: Element inspector showing `#id .class` on hover

### Bug Fixes
- Fixed HTML caching causing module loading errors after rebuilds
- Fixed settings modal checkbox flicker from watch loop

## 2026-02-13 - Compression

### Performance
- HTML, static files, API responses all compressed (Brotli/Gzip)
- JS bundle: 72% reduction, CSS: 87% reduction
- WebSocket permessage-deflate compression enabled

## 2026-02-12 - Turn-Based Pagination

### New Features
- **Turn-Based Pagination**: Load conversations by turns instead of arbitrary entry counts
- **Turn Counter**: Shows current position (e.g., "3/47") with keyboard navigation

### Bug Fixes
- Fixed session loading stuck on error
- Fixed pagination offset calculation

## 2026-02-12 - Plan Mode Fix & File Editor UX

### New Features
- **MD Mode**: Filter Files tab to show only `.md` files with auto-save

### Bug Fixes
- Fixed plan content not displaying after ExitPlanMode
- Fixed markdown editor font not applying

## 2026-02-11 - File Reference & UX Improvements

### New Features
- **File Reference**: Right-click files to add `@filepath` references to chat input
- **Clear/Undo Chat Input**: Clear button with undo to restore cleared text

### Bug Fixes
- Fixed port binding failure during server restart (retry with backoff)

## 2026-02-10 - Enhanced CLI & Configuration

### New Features
- **Daemon Management**: `--stop`, `--restart`, `--status` commands
- **Config File Support**: JSON config via `--config` flag
- **Bypass Token**: `--bypass-token` for auth-free access

## 2026-02-08 - Security, Performance & QOL

### Security
- XSS prevention with DOMPurify sanitization
- Path sandboxing for file operations
- Auth file caching with TTL

### New Features
- **Conversation Turn Navigation**: Navigate between turns with arrow buttons and keyboard
- **Git Diff Modal**: Full-screen diff viewer from git status indicator
- **Keyboard Shortcuts**: Mode switching, terminal shortcuts, turn navigation

### Bug Fixes
- Fixed memory leak in task cleanup
- Fixed stop button not cancelling Claude API requests
- Fixed cross-session typing indicator

## 2026-02-07 - WebSocket Optimization & Refactoring

- Eliminated redundant WebSocket messages on task status
- Debounced session refresh to prevent redundant calls
- Deduplicated recent sessions across projects
- Extracted ChatMessages.vue component from ChatView

## 2026-02-06 - Diff Viewer & Version Upgrade

### New Features
- **Edit Tool Diff**: Inline collapsible diff view for edit operations in chat
- **Git Diff Modal**: File-by-file diff navigation with status badges
- **Version Upgrade**: One-click upgrade with daemon mode support

## 2026-02-05 - UI Improvements & Files Tab

- Files tab explorer with breadcrumb navigation and inline path editing
- File editor redesign with icon-only buttons
- Terminal replay button for command history
- Renamed to cc-web throughout UI

## 2025-02-05 - Model Badges & MCP Integration

- Model badges on assistant responses (Haiku/Sonnet/Opus)
- MCP auto-detection with three-level scope merging
- Concurrent session support across tabs

## 2025-02-04 - Session Status & Chat Persistence

- Chat input persistence across tab/session switches
- Real-time session status indicators in sidebar (running/completed/error)

## 2025-02-03 - v1.0.0 Release

- Published as npm package (`npx cc-web`)
- Model selector (Haiku/Sonnet/Opus)
- Inline markdown editor with TinyMDE
- Terminal mode with shell command execution
- Quick session switcher (Ctrl+K)
- Session active elsewhere warning

## 2025-02-02 - Sidebar & Navigation

- Sidebar with recent sessions and projects
- Breadcrumb navigation with editable session titles
- Connection status indicator
- Resizable textarea with drag handle

## 2025-02-01 - Vue 3 Migration

- Migrated to Vue 3 + Vite + Vue Router
- Modular backend event handlers
- Git status in toolbar
- Permission mode system

## 2025-01-31 - Background Tasks

- Background task execution with per-session tracking

## 2025-01-24 - Initial POC

- Express + WebSocket server with Claude Agent SDK integration
