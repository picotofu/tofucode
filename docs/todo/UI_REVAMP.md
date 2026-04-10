# UI Revamp - Named Layout Reference

Reference guide for the current UI layout. Use these names when describing UI changes.

---

## App Layout (CSS Grid)

The root layout is a CSS grid with two rows: content area + persistent bottom bar.

```
Desktop (sidebar open):
[sidebar          ] [main content              ]
[sidebar-footer   ] [view-footer               ]

Desktop (sidebar closed):
[main content                                   ]
[sidebar-footer] [view-footer                   ]

Mobile (sidebar closed):
[main content                                   ]
[view-footer                                    ]
[sidebar-footer                                 ]

Mobile (sidebar open):
[sidebar overlay                                ]
[sidebar-footer                                 ]
```

**Bottom Bar** — persistent row at bottom of screen, always visible
- `Sidebar Footer` (left): hamburger toggle + sidebar tabs (Sessions, Projects, Tasks, Notes)
- `View Footer` (right): content varies per view (teleported from each view)

---

## Sidebar (Left Panel)

The sidebar is a fixed left column on desktop, overlay on mobile/tablet. Sidebar tabs have moved to the bottom bar.

**Sidebar Header** — bottom of sidebar
- Logo, version badge, upgrade button, settings button

**Sidebar Content** — scrollable area showing content for the active tab
- **Sessions Tab** (Ctrl+1) — recent sessions list across all projects
- **Projects Tab** (Ctrl+2) — all project folders with sort and new project controls
- **Tasks Tab** (Ctrl+3) — Notion task list with filter and search
- **Notes Tab** (Ctrl+4) — file browser + daily notes calendar

---

## Home Page (`/`)

**Home Tabs** — teleported to view-footer (3 tabs: Sessions, Folders, Files)
- **Home / Sessions Tab** — recent sessions
- **Home / Folders Tab** — directory browser
- **Home / Files Tab** — file explorer for current directory

---

## Sessions Page (`/project/:project`)

**Sessions List** — list of sessions for a project
- Session title (editable), first prompt preview, relative time, delete button
- No view-footer content (bottom bar shows sidebar footer only)

---

## Chat Page (`/project/:project/session/:session`) — Most Complex

### Chat Header (AppHeader)
- Breadcrumb: project name → session title (editable)
- Connection status pill (right)

### Chat View Modes (4 modes, Ctrl+5–7 or mode tabs in view-footer)

- **Chat Mode** — main Claude conversation view
- **Terminal Mode** — terminal output with sub-tabs (see below)
- **Files Mode** — file explorer panel
- **Ports Mode** — running ports/services panel

### Terminal Sub-tabs (visible only in Terminal Mode, in the footer toolbar)
- **History Sub-tab** — completed commands
- **Active Sub-tab** — running processes with count badge
- **Bookmarks Sub-tab** — saved commands

### Chat Footer Toolbar (inside the view, above input)

**Footer / Git Area** (left side of toolbar row)
- Git branch name (clickable → opens git diff modal)
- Git status icon

**Footer / Model Selector** (right side, chat mode only — 3 tabs)
- **Haiku (H)** — fast, lightweight
- **Sonnet (S)** — balanced, default
- **Opus (O)** — most capable

**Footer / Permission Selector** (right side, chat mode only — 4 tabs)
- **Default** — ask for permissions
- **Plan Mode** — read-only, planning only
- **Accept Edits** — auto-approve file edits, block bash
- **Bypass** — no permission checks (dangerous)

### Chat View Footer (teleported to bottom bar)
- Chat | Terminal | Files | Ports mode tabs
- Recent sessions group (2 most recent)
- Task status indicator (running/completed/error)

### Chat Input Area (bottom, chat mode)
- Rich markdown editor (TinyMDE)
- Send button (Ctrl+Enter)
- Clear/Undo button

### Terminal Input Area (bottom, terminal mode)
- Command input with `$` prompt
- CWD label (editable)
- Run button

---

## Task Page (`/tasks/:pageId`)

**Task Header** — task title + Notion page ID
**Task Properties** — status, assignee, custom fields
**Task Body** — rich text editor with auto-save
**Task Comments** — comment thread + reply input
**Task View Footer** (teleported to bottom bar) — Notion URL + save status

---

## Notes Page (`/notes/:notePath`)

**Notes Editor** — file editor with syntax highlight
**Notes View Footer** (teleported to bottom bar) — file path, stats, save/download/TOC buttons

---

## Global Modals / Overlays

- **Command Palette** (Ctrl+K) — search sessions, create project
- **File Picker** (Ctrl+P) — filesystem browser, file reference
- **Settings Modal** (Ctrl+,) — 6 tabs: General, Usage, Notion, Discord, MCP, Keybindings
- **Git Diff Modal** — triggered from footer git branch button
- **Git Clone Modal** — triggered from sidebar projects toolbar
- **Ask User Question Modal** — agent-triggered permission/question dialog
- **Queue Modal** — manage queued messages
- **Memo Panel** — floating overlay quick-note panel

---

## Naming Conventions

When describing a UI requirement, use compound names to be precise:

- `Sidebar / Sessions Tab`
- `Sidebar / Tasks Tab`
- `Bottom Bar / Sidebar Footer`
- `Bottom Bar / View Footer`
- `Home / Files Tab`
- `Chat / Terminal Mode`
- `Chat / Terminal / Active Sub-tab`
- `Chat Footer / Model Selector`
- `Chat Footer / Permission Selector`
- `Chat View Footer / Mode Tabs`
- `Settings Modal / MCP Tab`
- `Settings Modal / Discord Tab`

---

## Status Indicators (shared)

Used throughout the app on sessions and tasks:
- **Running** — blue animated spinner
- **Completed** — green checkmark
- **Error** — red X
