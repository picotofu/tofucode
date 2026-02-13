# Changelog

All notable changes to cc-web (Claude Code Web).

## 2026-02-13 - Debug Mode & Settings

### New Features
- **Settings Modal**: Added global settings accessible from sidebar
  - Settings button (⚙️) beside restart button in sidebar
  - Clean modal interface with auto-save (no save button needed)
  - Settings stored in `~/.cc-web/settings.json`

- **Debug Mode**: Element inspector for development
  - Toggle in Settings modal (default: off)
  - Hover over any element to see `#id .class1 .class2` format
  - Filters out Vue runtime classes (e.g., `_abc123`)
  - Non-intrusive popover with syntax highlighting
  - Perfect for identifying elements during development discussions

### Technical Implementation
- **Backend**:
  - `server/lib/settings.js` - Settings persistence
  - `server/events/get-settings.js` & `update-settings.js` - WebSocket handlers
  - Settings auto-sync across browser tabs via WebSocket

- **Frontend**:
  - `SettingsModal.vue` - Settings UI with auto-save
  - `DebugPopover.vue` - Element info display
  - `useDebugMode.js` - Hover detection composable
  - Global settings context provided from App.vue
  - Fixed `onMessage` export in `useWebSocket()` composable

### Bug Fixes
- Fixed HTML caching issue causing module loading errors
  - Changed from startup cache to per-request read
  - Prevents stale asset references after rebuilds
- Fixed watch loop in SettingsModal causing checkbox flicker
  - Added `isUpdatingFromProps` flag to prevent circular updates
- Reduced spacing between sidebar buttons (8px → 4px)
- Added `/assets` path exclusion to SPA fallback

## 2026-02-13 - Compression Enabled (All Resources)

### Performance Improvements
- **HTML Compression**: Enabled Brotli compression for index.html
  - HTML now served through compression middleware (was bypassing before)
  - File read once at startup and cached in memory for fast serving
  - Cache headers: `no-cache` (browsers always check for updates)

- **Static File Compression**: Enabled Brotli/Gzip compression for all static assets
  - JS bundle: 441KB → 123KB (Brotli) = 72% reduction
  - CSS bundle: 86KB → 11KB (Brotli) = 87% reduction
  - Cache headers: `max-age=31536000, immutable` (1 year cache with hash-based busting)
  - Supports Brotli (preferred), Gzip, and Deflate based on client capabilities

- **API Response Compression**: Enabled for all API endpoints
  - Threshold: 512 bytes (responses below are not compressed)
  - Automatic content negotiation based on Accept-Encoding header
  - Same middleware handles HTML, static files, and API responses

- **WebSocket Compression**: Enabled permessage-deflate (RFC 7692)
  - Compression level: 3 (balanced performance/size)
  - Threshold: 1KB (messages below are not compressed)
  - Context takeover disabled for better small message handling
  - Successfully negotiated with all WebSocket clients

### Technical Changes
- Replaced `express-static-gzip` with standard `compression` middleware
  - More reliable and works with all clients
  - Runtime compression provides better compatibility
- Moved compression middleware to global scope
- Changed HTML serving from `sendFile()` to `res.send()` to enable compression
- Lowered compression threshold from 1KB to 512 bytes
- Added debug logging for WebSocket extension negotiation
- Added `/api/debug/ws-config` endpoint for diagnostics

### Cache Strategy
- **HTML files**: `no-cache` - Always revalidate to get latest version
- **Hashed assets** (JS/CSS with cache-busting): `max-age=1y, immutable` - Never revalidate
- **API responses**: Dynamic, no explicit caching

### Verification
- HTML: Tested with curl - confirmed `Content-Encoding: br` and `Cache-Control: no-cache`
- Static files: Confirmed `Content-Encoding: br` and `max-age=31536000, immutable`
- API endpoints: Confirmed compression middleware active (`Vary: Accept-Encoding`)
- WebSocket: Server logs show `permessage-deflate` successfully negotiated

## 2026-02-12 - Turn-Based Pagination & Session Loading Optimization

### Performance & UX Improvements
- **Turn-Based Pagination**: Replaced entry-count pagination with conversation turn-based loading
  - Initial load: Last **3 complete turns** (user → assistant exchanges)
  - Pagination: Load **5 turns** per click (was 100 arbitrary entries)
  - More predictable and user-friendly - always loads complete conversations
  - Button now shows "Load 5 more turns" instead of "Load older messages (100)"

- **Smart Turn Navigation**:
  - Turn counter shows total turns in session (e.g., "3/47")
  - Total turn count efficiently calculated during JSONL streaming (no extra overhead)
  - **Up arrow at top of chat loads previous turns** - keyboard-friendly navigation

- **Optimized Initial Load**: Session opens with just the last 3 turns instead of loading larger arbitrary chunks
  - Faster initial render
  - Better for long sessions with hundreds of messages

### Bug Fixes
- **Session Loading Error Handling**: Fixed frontend stuck on loading when session history fails
  - Added try-catch blocks in `select-session.js` and `load-older-messages.js`
  - Global WebSocket error handler now includes `sessionId` so frontend doesn't filter errors
  - Fixed variable scope issue with `offset` and `limit` declarations

- **Pagination Offset Calculation**: Fixed incorrect offset calculation in frontend
  - Was using message count instead of entry count
  - Now correctly uses loaded entry count for proper pagination

- **Backend Pagination Logic**: Fixed `hasOlderMessages` calculation
  - Was using parsed message count instead of JSONL entry count
  - One entry can expand to multiple messages, causing incorrect "has more" state

### Technical Details
- Backend returns `totalTurns` and `loadedTurns` in session_history and older_messages responses
- Frontend tracks turn count separately from message count
- Turn counting happens during single-pass JSONL streaming (efficient, no memory impact)
- Pagination offset remains entry-based internally for accurate buffer slicing

## 2026-02-12 - Plan Mode Fix & File Editor UX

### Bug Fixes
- **Plan Mode Output**: Fixed plan content not displaying after ExitPlanMode
  - Backend now handles `user` messages containing tool results
  - Added diagnostic logging for unhandled assistant content blocks
- **MD Mode Folder Filter**: Only shows folders containing `.md` files (recursive check up to 3 levels)
- **TinyMDE Font Override**: Fixed markdown editor font not applying (now uses `:deep()` selector)

### New Features
- **MD Mode for Files Tab**: Filter to show only `.md` files with auto-save
  - Toggle state persisted in localStorage across sessions
  - 1-second debounce on auto-save
  - Folders filtered by markdown content presence

### UX Improvements
- **File Editor Layout**: Moved editor header above footer for cleaner separation
- **File Editor Font**: Updated to match chat messages (14px, line-height 1.7)
  - Plain text: 13px → 14px
  - Markdown: Added explicit 14px sizing
  - Code files: Kept at 13px monospace for readability

### Dependencies Added
- **compression**: Runtime compression middleware for Express
- **express-static-gzip**: Serve pre-compressed static files
- **vite-plugin-compression2**: Generate gzip/brotli files during build

## 2026-02-11 - File Reference & UX Improvements

### New Features
- **File Reference Context Menu**: Right-click files in Files tab to add `@filepath` references to chat input
  - Smart whitespace handling: auto-adds space when needed
  - Auto-switches to chat mode
  - Only available for files (not directories)

### UX Improvements
- **Clear/Undo Chat Input**: Clear button with undo functionality to restore cleared text
- **Reconnecting State**: Shows "Reconnecting..." indicator when WebSocket disconnects
- **New Session Loading**: Better handling of new session creation and reconnection
- **Clear/Undo Button Reactivity**: Fixed reactivity issues with clear/undo button state

### Bug Fixes
- **Port Binding During Restart**: Added `UPGRADE_RETRY_BIND` environment variable to retry port binding
  - Fixes issue where server restart fails due to port still in use
  - Implements retry logic with exponential backoff (max 20 retries)
  - Critical for seamless in-app restart and one-click upgrade functionality

### Documentation
- **Environment Variables**: Documented `DISABLE_UPDATE_CHECK` and `UPDATE_CHECK_INTERVAL` in `.env.example` and README
- **Version Update Feature**: Moved completed feature documentation to `docs/completed/`

## 2026-02-10 - Enhanced CLI & Configuration System

### CLI Enhancements
- **Daemon Lifecycle Management**: `--stop`, `--restart`, `--status` commands for daemon control
- **Configuration File Support**: Load settings from JSON file via `--config` flag
- **Debug Mode**: `--debug` flag enables verbose logging with timestamps
- **Quiet Mode**: `--quiet` flag suppresses non-error output
- **Custom Log File**: `--log-file` to specify custom log location
- **Custom PID File**: `--pid-file` to specify custom PID file location
- **Bypass Token**: `--bypass-token` flag for auth-free access (automation/testing, uses DEBUG_TOKEN internally)
- **PID File Management**: Auto-creates `~/.cc-web/` directory, writes PID for daemon tracking
- **Graceful Shutdown**: Daemon stop with SIGTERM, force kill after timeout
- **Smart Restart**: Preserves CLI arguments when restarting daemon

### Configuration System
- **Priority Order**: CLI args > Config file > Environment variables > Defaults
- **Cross-Support**: All options available via CLI, config file, or environment variables
- **Config File Template**: Added `config.example.json` with all available options
- **Environment Variables**: Added `LOG_FILE` and `PID_FILE` env var support
- **Development vs Production**: Clarified `.env` is for development only, not distribution

### Bug Fixes
- **Copy Button Fix**: DOMPurify now allows `onclick` attributes for code block copy buttons

### Documentation
- **Configuration Reference Table**: Complete mapping of CLI args ↔ Config file ↔ Env vars
- **Enhanced README**: Comprehensive CLI usage guide with examples
- **Updated .env.example**: Clear section headers and usage notes
- **Development Clarity**: Documented that `.env` is only for local development

## 2026-02-08 - Security Hardening, Performance Optimizations & QOL Improvements

### Security Fixes (High Priority)
- **XSS Prevention**: Added DOMPurify sanitization to markdown rendering
- **Link Security**: Blocked `javascript:` protocol URLs and escaped link attributes
- **Path Sandboxing**: Restricted file operations to home directory and current project only
- **Auth File Caching**: Reduced I/O with 5-second TTL cache for session validation

### Critical Bug Fixes
- **Memory Leak**: Wired up `clearOldTasks()` to run hourly and clear on graceful shutdown
- **Computed Property Bug**: Fixed `toggleTerminalMode` assignment to read-only computed
- **ProcessManager Cleanup**: Added `destroy()` method to clear intervals on shutdown
- **Path Context Bug**: Fixed `context.projectPath` → `context.currentProjectPath` mismatch

### Performance Improvements
- **Array Operations**: Replaced array spread with `push()` in message streaming (avoids copying entire array)
- **Graceful Shutdown**: Added cleanup for version checker, process manager, and task intervals

### Code Quality & Deduplication
- **Shared Restart Utility**: Extracted `restartWithInvertedSpawn()` to `server/lib/restart.js`
- **API Error Mapper**: Created shared `server/lib/api-error-mapper.js` for error messages
- **Context Parameter**: Fixed missing `context` parameter in 3 internal `handleFilesBrowse` calls

### QOL Improvements
- **Auto-refresh Git Status**: Git branch and file changes auto-update after task completes
- **Session Loading Skeleton**: Animated skeleton placeholders instead of plain "Loading..." text
- **Git Branch Color Coding**: Visual color coding (green: main/master, orange: wip/hotfix, yellow: feature)
- **Terminal CWD Display**: Editable current working directory field below terminal input
- **Stop Button Fix**: Stop button now actually cancels the running Claude API request (passes abort controller to SDK)
- **Keyboard Shortcuts**: Mode switching (Ctrl+1/2/3), terminal shortcuts (Ctrl+C/U/K/A/E), turn navigation (Ctrl+Up/Down), enhanced Escape key behavior

### Conversation Turn Navigation
- **Turn-based message grouping**: Messages grouped by conversation turn (user message + all responses)
- **Up/down navigation buttons**: Navigate between turns with arrow buttons (bottom-right)
- **Turn counter**: Shows current position (e.g., "3/10") with auto-update on scroll
- **Smart scrolling**: First up press scrolls to top of last turn for easier reading
- **Smooth scroll animation**: Animated scroll to turn start
- **Disabled state**: Buttons disabled when at first/last turn

### Git Diff Modal Fixes
- **Vertical scrolling**: Fixed diff viewer not scrolling on long diffs (flex layout fix on modal-body)
- **No horizontal scrolling**: Long lines now wrap instead of causing horizontal overflow
- **Proper flex layout**: Modal body uses flex column layout for correct height constraints

### Session Title Fixes
- **Title persistence**: Reverted to separate `.session-titles.json` file (SDK-safe)
- **Consistent reads**: Unified all session title reads to use `.session-titles.json`

### Page Load Improvements
- **Cleaner page title**: Removed "cc-web" prefix, shows "project / session" directly
- **History-first rendering**: Wait for conversation history before showing chat UI
- **Typing indicator fix**: Fixed indicator not showing on page refresh by sending sessionId on session select

### Dependencies Added
- **dompurify**: HTML sanitization library for XSS prevention

### Bug Fixes
- **Session navigation**: Full page reload on session switch to prevent cross-session message streaming
- **WebSocket state**: Clean WebSocket connection on each session load
- **Cross-session typing**: Task status now correctly filtered by sessionId after reconnect

## 2026-02-07 - WebSocket Optimization & Code Refactoring

### WebSocket Flow Optimization
- **Eliminated triple-send on task status**: Reduced from 3 sends to single broadcast
- **Debounced session refresh**: `getRecentSessions()` now debounced (150ms) to prevent redundant calls
- **Consolidated task_status handling**: Global WS handles sidebar indicators and session refresh
- **Removed redundant broadcasts**: Session list no longer broadcast on new session (triggered by task_status instead)

### Session Management
- **Duplicate session elimination**: Recent sessions now deduplicated across projects
- **Most recent version preserved**: When same session ID exists in multiple project paths, keeps newest version
- **Accurate timestamps**: Uses JSONL file modification time to determine most recent version
- **Cleaner recent sessions list**: No more duplicate entries for moved/symlinked projects

### Code Refactoring
- **ChatMessages.vue component**: Extracted from ChatView.vue (~100 lines)
  - Message list rendering with tool grouping
  - Auto-scroll behavior (on new messages and when running)
  - Typing indicator animation
  - Jump-to-bottom button
  - Load older messages button
  - Empty/loading states

### Directory Renaming
- **Auth directory**: `~/.claude-web/` → `~/.cc-web/`
- **Process file**: `/tmp/claude-web-processes.json` → `/tmp/cc-web-processes.json`
- Consistent naming with package rename to `cc-web`

## 2026-02-06 - Diff Viewer Feature

### Edit Tool Diff in Chat History
- **Inline diff viewer**: Collapsible diff view for Edit tool operations
- **Line-by-line comparison**: Shows added (green) and removed (red) lines
- **Dual line numbers**: Old and new line numbers displayed side-by-side
- **File stats**: Additions/deletions count in header
- **Uses npm `diff` package**: Accurate line-by-line diff algorithm

### Git Diff Modal
- **Full-screen diff modal**: Click git branch indicator to view all changes
- **File list sidebar**: Shows all changed files with A/M/D/R status badges
- **File-by-file navigation**: Click files to view their diffs
- **Unified diff display**: Proper syntax highlighting for diff format
- **Untracked file support**: Shows entire content as added lines
- **Renamed file support**: Properly extracts new path from rename format

### Version Upgrade Feature
- **Version display**: Current version shown in sidebar header
- **Update notification**: Badge appears when new version available on npm
- **One-click upgrade**: Upgrade button with dismiss option
- **Daemon mode**: `npx cc-web -d` runs server in background
- **Inverted spawn strategy**: New process spawns, old exits cleanly

### Other Improvements
- **Recent projects section**: Added to homepage below recent sessions
- **Clickable project names**: Session list project names link to project page
- **Message count fix**: Unindexed sessions now show accurate message counts
- **Cloud-web favicon**: New monochrome cloud/web icon

## 2026-02-05 - UI Improvements & Bug Fixes

### Files Tab Reorganization
- **Explorer header moved below mode tabs**: Now appears in footer area for better layout
- **Inline breadcrumb navigation**: Clickable path segments for quick folder navigation
- **Quick navigation buttons**: "Go up directory" and "Go to project root" buttons
- **Inline path editing**: Click breadcrumb path to edit directly (replaces modal)
- **Mobile-friendly breadcrumbs**: Horizontally scrollable for long paths
- **Dotfiles toggle relocated**: Moved alongside create file/folder buttons in header

### File Editor Redesign
- **Cleaner header layout**: filename + spacer + save icon + close icon
- **Icon-only buttons**: Removed text labels for more compact design
- **Improved button contrast**: Better legibility with updated colors
- **Confirmation on close**: Warns if unsaved changes exist

### Model Selector Fix
- **Removed invalid 'opusplan' model**: Only valid SDK models (haiku, sonnet, opus)
- **Added debug logging**: Tracks model sent by client and returned by API
- **Model extraction fix**: Properly identifies model from API response

### Navigation Enhancements
- **Proper anchor tags**: Converted session/project links to router-links
- **Middle-click/right-click support**: Open in new tab functionality
- **Dynamic page title**: Format: "cc-web - project-name / session-title"
- **Fixed sidebar status indicator**: Now floats on right instead of new row

### Terminal Enhancement
- **Replay button**: Re-run commands from history with single click

### Bug Fixes
- **Cross-session typing indicator**: Fixed task_status filtering by sessionId
- **Session-specific files tab**: Files tab now updates when switching sessions
- **Cross-session message streaming**: Fixed race conditions in session clearing/setting

### Branding Update
- **Renamed to cc-web**: Changed from "claude-web" to "cc-web" throughout UI

## 2025-02-05 - Files Tab & UI Refinements

### Files Tab Enhancements
- Added dotfiles toggle button in files tab toolbar
- Added create file button in files tab toolbar
- Dotfiles (files starting with `.`) can now be hidden/shown with toggle
- Restructured files filter form with left/right sections for better organization

### UI Cleanup
- Removed file activity indicator from chat toolbar (cleaner interface)
- Changed modal accent colors to monochrome (light gray instead of blue)

## 2025-02-05 - Model Badges & MCP Integration

### Model Badges on Assistant Responses
- Model badges now displayed on Claude's responses (text and tool use)
- Shows which model handled each response: Sonnet, Opus, Haiku, or Opus Plan
- Especially useful with Opus Plan mode to see plan (Opus) vs implementation (Sonnet)
- Model information extracted from SDK's JSONL format
- Works for both real-time messages and loaded history
- Badge appears in footer for text messages, header for tool use

### MCP (Model Context Protocol) Phase 1
- Auto-detection and loading of MCP servers from CLI config
- Three-level scope merging: user (`~/.claude.json`) → project → local (`.mcp.json`)
- OAuth token injection with expiry checking (5 minute buffer)
- Credentials loaded from `~/.claude/.credentials.json`
- Enhanced tool display for MCP tools (dbhub, notion, playwright)
- Modular MCP tool structure in `src/utils/mcp-tools/` for maintainability
- MCP servers passed to Claude Agent SDK query options

### Concurrent Session Support
- Fixed blocking that prevented switching sessions while one was running
- Removed global `runningQuerySessionId` tracking
- Now only blocks concurrent queries on the same session
- Enables working on multiple sessions simultaneously in different tabs

## 2025-02-04 - QoL Improvements & Bug Fixes

### Chat Input Persistence
- Chat input now persists when switching between Chat/Terminal tabs
- Input preserved when switching between sessions
- Per-session localStorage storage (`chat-input:{project}:{session}`)
- Input automatically restored when returning to a session
- Cleared on successful message submission

### Session Status Indicators in Sidebar
- Real-time task status indicators next to sessions in sidebar
- Status visible across all browser tabs/windows
- Three states with visual indicators:
  - **Running**: Animated blue spinner while task executes
  - **Completed**: Green checkmark (cleared when session opened)
  - **Error**: Red X icon (cleared when session opened)
- Global WebSocket broadcasting for cross-tab synchronization
- `task_status` messages now include `sessionId` for tracking
- `session_opened` broadcast event clears indicators
- Indicators persist until user opens the session

### Bug Fixes
- Fixed terminal processes not loading when switching sessions (same project)
- Fixed terminal processes showing stale data when switching sessions
- Terminal processes now refresh automatically when switching to terminal tab
- Terminal state properly cleared on session change to prevent cross-session contamination

## 2025-02-03 - v1.0.0 Release

### npm Package
- Published as `claude-web` on npm (`npx claude-web`)
- CLI with `--port`, `--host`, `--no-auth` options
- Auth data moved to `~/.cc-web/.auth.json` for npx compatibility

### Model Selector
- Added model selector buttons in toolbar (H/S/O/P)
  - H: Haiku - Fast & lightweight
  - S: Sonnet - Balanced (default)
  - O: Opus - Most capable
  - P: Opus Plan - Extended thinking for complex tasks
- Model selection persisted in localStorage
- Model passed to Claude Agent SDK query options

### Inline Markdown Editor
- Integrated TinyMDE (tiny-markdown-editor) for Slack-style inline formatting
- Real-time markdown preview with syntax characters visible
- Supports bold, italic, code, headings, lists, links, etc.
- Contenteditable-based editor under 70KB (lightweight)
- Custom dark theme matching app styling
- Preserves Ctrl+Enter / Cmd+Enter submit behavior

### UI Improvements
- Chat messages auto-scroll to bottom on session load/switch
- Jump-to-bottom button appears when scrolling up (with slide-up animation)
- Improved scroll detection with 150px threshold for better UX
- User messages render as markdown with permission indicators
- Permission mode displayed with colored right border and icon in footer

## 2025-02-03 - Terminal & Multi-Tab Sync

### UI Redesign
- Mode tabs (Chat/Terminal) above textarea - VSCode-style toggle with running process badge
- Toolbar moved below input for cleaner layout
- Permission tabs hidden in terminal mode
- Chat bubble icon in chat input (color matches permission mode)

### Terminal Feature
- Added terminal mode to ChatView for running shell commands
- Active/History sub-tabs in terminal output
  - Active: Running processes only
  - History: Chronological order (newest at bottom, scroll anchored)
- Uses user's default shell (`$SHELL -i`) to load rc files
- Natural input: Enter submits, `\` at end for multiline
- Command history with up/down arrows (per-project localStorage)
- `Ctrl+L` clears input (matches real terminal behavior)
- Copy output button on process blocks
- Multiline textarea with resizable height
- Process management with spawn/kill functionality
- Output streaming with stdout/stderr differentiation
- Process state persistence to `/tmp/cc-web-processes.json`
- Graceful handling of server restarts (marks processes as killed)

### Quick Session Switcher
- `Ctrl+K` opens command palette from anywhere
- Search/filter sessions by title or project name
- Keyboard navigation (up/down, Enter, Escape)
- Shows recent sessions with timestamps

### Session Active Elsewhere Warning
- Warning banner when same session is open in multiple tabs
- Bidirectional notifications (both tabs notified when second opens, remaining tab notified when other closes)
- Session watcher tracking in `ws.js` with `watchSession`, `unwatchSession`, `unwatchAllSessions`
- Prevents JSONL corruption from concurrent writes

## 2025-02-02 - UI Enhancements: Sidebar, Breadcrumbs, File Indicator

- Added sidebar with tabs (Recent Sessions, Recent Projects) - isolated to ChatView only
- Hamburger toggle in chat header with responsive behavior (overlay on mobile)
- Breadcrumb navigation: [Project Name] / [Session Title] with clickable project link
- File activity indicator in toolbar (shows current file operation during task)
- Permission mode sync (auto-updates when Claude uses EnterPlanMode/ExitPlanMode)
- Permission mode UI changed from dropdown to 4 icon buttons with color-coded backgrounds
- Quick "New" session button on project items (sidebar and projects view)
- Fixed stale session timestamps: Use JSONL file mtime instead of sessions-index.json
- Refresh sessions list when task completes for up-to-date timestamps

## 2025-02-02 - QoL Medium Impact Features

- Implemented AppHeader component with connection status pill (green/orange/red)
- Added connectionState tracking to WebSocket composable
- Added message timestamps with relative time on hover
- Added resizable textarea with drag handle
- Implemented session titles/rename system with `.session-titles.json` metadata files
- Added editable session titles to SessionsView and ChatView
- Implemented stop/cancel button for running requests with AbortController

## 2025-02-01 - Continued UI Improvements

- Fixed SDK permission modes (`bypassPermissions` + `allowDangerouslySkipPermissions`)
- Added failsafe for git status in non-git directories
- Added "No git" indicator in toolbar
- Removed duplicate permission checkboxes (now only in chat toolbar dropdown)
- URL updates from `/session/new` to actual session ID after first message
- Loading state for existing sessions ("Loading..." vs "Start a conversation")
- Final result message now collapsed by default (shows metadata in header)
- Monospace font for chat input
- Permission mode reflected in input border color (green/yellow/orange)
- Reduced border radius globally
- Full width layout for all pages

## 2025-02-01 - Major UI Overhaul

- Migrated to Vue 3 + Vite + Vue Router
- Created 3-tab landing page (Recent Sessions, Recent Projects, Select Folder)
- Implemented folder browser with manual path input
- Added git branch and file change status to chat toolbar
- Added permission mode dropdown (default, plan, bypass, skip)
- Permission mode persisted per session in localStorage
- Refactored backend into modular event handlers (server/events/)
- Fixed multi-tab support (per-connection context)
- Fixed marked v17 renderer API (token objects)
- Fixed markdown link rendering (was showing [object Object])
- Expanded tool calls by default with nice formatting
- Added multiline chat input (Enter for newline, Ctrl+Enter to send)
- Full width layout for chat messages

## 2025-01-31 - Background Tasks & Production Planning

- Implemented background task execution
- Added per-session task tracking for parallel sessions
- Task status bar shows running/completed/error state

## 2025-01-25 - Session Persistence & Interop POC

- Confirmed CLI ↔ Web interoperability
- Sessions stored locally in ~/.claude/projects/
- JSONL parsing for message history

## 2025-01-24 - Initial POC

- Express + WebSocket server
- Claude Agent SDK integration
- Basic streaming messages
