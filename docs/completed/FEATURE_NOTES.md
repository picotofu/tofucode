# Obsidian-like Notes Feature

## Context

Add a full markdown notes system to tofucode — an Obsidian-inspired vault browser + editor. The user sets a base path (vault root) in settings, and gets a sidebar file navigator, fuzzy search, daily notes with calendar, and the existing markdown editor for authoring. The goal is a lightweight, self-contained notes tool that reuses the existing file system infrastructure.

## Architecture Overview

```
Sidebar (new "Notes" tab)          Main View (new /notes route)
┌──────────────────────┐           ┌──────────────────────────────┐
│ [Search input       ]│           │ NotesView.vue                │
│ [Today] [📅] [+ New]│           │                              │
│ ┌──────────────────┐ │           │  ┌──────────────────────┐   │
│ │ MiniCalendar     │ │  click →  │  │ FileEditor.vue       │   │
│ │ (toggle)         │ │  router   │  │ (reused as-is)       │   │
│ └──────────────────┘ │  push     │  │ - TinyMDE for .md    │   │
│ 📁 daily/           │           │  │ - Symbol toolbar     │   │
│   📄 2026-03-23.md  │           │  │ - TOC sidebar        │   │
│   📄 2026-03-22.md  │           │  │ - Auto-save          │   │
│ 📁 projects/        │           │  └──────────────────────┘   │
│ 📄 ideas.md         │           │                              │
└──────────────────────┘           └──────────────────────────────┘
```

**Key decisions:**
- New `/notes` route (like `/tasks/:pageId`) — URL reflects state, browser nav works
- Two `useFilesManager` instances: one for sidebar browsing, one for the editor in main view
- Both use global WS (`useWebSocket`) — no new server events needed
- `notesBasePath` setting gates the entire feature (empty = disabled)
- Sidebar active tab persisted in localStorage (survives page refresh)
- Keyboard shortcuts: Cmd+1=sessions, Cmd+2=projects, Cmd+3=tasks, Cmd+4=notes; Cmd+5=chat, Cmd+6=terminal, Cmd+7=files

## Files to Modify

| File | Change |
|---|---|
| `server/lib/settings.js` | Add `notesBasePath: ''` to DEFAULT_SETTINGS |
| `src/App.vue` | Add `notesBasePath` to settings provide |
| `src/router/index.js` | Add `/notes/:notePath(.*)` route |
| `src/components/Sidebar.vue` | Add notes tab button + NotesPanel integration + shifted shortcuts + localStorage persist |
| `src/components/SettingsModal.vue` | Add "Notes" tab with base path input |

## Files to Create

| File | Purpose |
|---|---|
| `src/views/NotesView.vue` | Main notes view — FileEditor wrapper + daily note logic |
| `src/components/NotesPanel.vue` | Sidebar panel — file tree, search, toolbar, calendar |
| `src/components/MiniCalendar.vue` | Pure Vue mini calendar for daily note navigation |

**No changes to:** `FileEditor.vue`, `FileExplorer.vue`, `FilesPanel.vue`, `useFilesManager.js`, or any server event handlers.

## Implementation Steps

### Step 1: Settings — `notesBasePath`

**`server/lib/settings.js`** — add to DEFAULT_SETTINGS:
```js
notesBasePath: '', // Absolute path to notes vault root (e.g. /home/user/notes)
```

**`src/App.vue`** — add to `provide('settings', { ... })`:
```js
notesBasePath: () => settings.value.notesBasePath,
```

**`src/components/SettingsModal.vue`** — add "Notes" tab:
- New tab button with notebook icon between MCP and Shortcuts tabs
- Tab content: single text input for `localSettings.notesBasePath` with label "Notes vault path" and helper text "Absolute path to your markdown notes folder"
- Follow exact same pattern as other settings fields (two-way bind to `localSettings`, auto-save via existing deep watcher)

### Step 2: Router — `/notes` route

**`src/router/index.js`** — add:
```js
{ path: '/notes/:notePath(.*)*', name: 'notes', component: () => import('../views/NotesView.vue') }
```
Single route with optional catch-all param. `/notes` = vault root, `/notes/daily/2026-03-23.md` = specific file.

### Step 3: `MiniCalendar.vue`

Pure Vue component, zero dependencies.

**Props:** `existingDates: Set<string>`, `selectedDate: string`
**Emits:** `select-date(dateString)`

- `currentYear`/`currentMonth` refs, initialized to today
- Prev/next month nav arrows
- 7-column grid (Sun–Sat), computed day cells with leading blanks for day-of-week offset
- CSS classes: `.today`, `.has-note` (dot indicator), `.selected`, `.other-month` (greyed out)
- Compact sizing (~200px wide) for sidebar fit

### Step 4: `NotesPanel.vue`

Sidebar panel component following `TasksPanel` flex layout pattern.

**Layout (top to bottom):**
1. **Toolbar row** (flex-shrink: 0): Search input + "Today" button + calendar toggle + "New Note" button
2. **MiniCalendar** (conditionally shown, flex-shrink: 0)
3. **File list** (flex: 1, overflow-y: auto): Custom slim list (not FileExplorer — too heavy for sidebar)
4. **No footer needed** (unlike TasksPanel)

**State:**
- Gets `notesBasePath` via `inject('settings')`
- Own `useFilesManager` instance with global WS `send`/`onMessage` and `homePath = notesBasePath`
- Lazy-initializes on first tab activation (same pattern as tasks tab watcher in Sidebar.vue)
- `mdMode` forced to `true` by default (notes context = markdown only)

**Behaviour:**
- Empty state when `notesBasePath` is not set: "Configure notes path in Settings → Notes" with button to open settings
- Search input triggers `files:search` through the manager (debounced, existing logic)
- File click → `router.push({ name: 'notes', params: { notePath: relativePath } })`
- Folder click → navigate into folder (manager's `handleFilesNavigate`)
- "Today" button → `router.push` to `/notes/daily/YYYY-MM-DD.md`
- Calendar date click → same as above with selected date
- Active file highlighted by matching current route param

**Daily dates scanning:**
- On init, also browse `{notesBasePath}/daily/` to get file list
- Extract dates from `YYYY-MM-DD.md` filenames into `Set<string>` for MiniCalendar's `existingDates` prop
- Re-scan when returning to notes tab or after daily note creation

### Step 5: `NotesView.vue`

Main view for the `/notes` route.

**Structure:**
- Header bar with breadcrumb path + note title + close button
- Main area: `FileEditor` (reused) or empty state ("Select a note from the sidebar or create a daily note")
- Own `useFilesManager` instance with `homePath = notesBasePath`

**Route-driven file loading:**
- Watch `route.params.notePath` — when it changes:
  - If it looks like a file path (ends in `.md`): call `handleFileSelect({ path: fullPath })`
  - If it's a directory path or empty: show empty state

**Daily note creation (idempotent):**
1. Compute `{notesBasePath}/daily/YYYY-MM-DD.md`
2. Set `openedFile = { path, content: '', loading: true }`
3. Send `files:read` for that path
4. On `files:read:result`: file exists, display it (done)
5. On `files:read:error` (not found): send `files:create` with `isFile: true`, then the existing `files:create:result` handler in `useFilesManager` auto-opens it via `pendingFileToOpen`
6. Ensure `daily/` directory is created first (send `files:create` with `isDirectory: true` for the parent if browse shows it doesn't exist)

**Auto-save:** Pass `autoSave` computed from settings (`autoSaveFiles`) to FileEditor.

### Step 6: Sidebar Integration

**`src/components/Sidebar.vue`:**
- Import `NotesPanel`
- Add `'notes'` to activeTab type
- `TAB_KEYS`: `1=sessions, 2=projects, 3=tasks, 4=notes`
- Add tab button after tasks tab: notebook/pen SVG icon, title "Notes"
- Add `sidebar-content-notes` class (pass-through flex, same as `sidebar-content-tasks`)
- Add content block: `<NotesPanel v-else-if="activeTab === 'notes'" @open-settings="..." />`
- Lazy init watcher: when `activeTab` becomes `'notes'` for the first time, tell NotesPanel to initialize
- **Persist `activeTab` in localStorage** (`tofucode:sidebar-tab`), restore on mount

### Step 7: Polish & UX

- **Daily note template:** When creating a new daily note, pre-populate with a heading + sections
- **Recently opened notes:** Store last 5 opened note paths in localStorage, show as a quick-access list above the file tree in NotesPanel
- **Keyboard shortcut:** `Cmd+Shift+D` to create/open today's daily note from anywhere (register in App.vue)

## Obsidian Features — v1 Included

| Feature | How |
|---|---|
| File/folder navigator | Custom slim list in NotesPanel, powered by useFilesManager |
| Markdown editor + symbol toolbar | FileEditor.vue (reused as-is) |
| Table of Contents | FileEditor.vue built-in TOC sidebar |
| Auto-save | FileEditor.vue auto-save (1s debounce) |
| Fuzzy search across notes | files:search WS event (existing) |
| Quick daily note | Idempotent create `daily/YYYY-MM-DD.md` |
| Mini calendar | MiniCalendar.vue with note-exists indicators |
| Daily note template | Pre-populated heading + sections |
| Recently opened notes | localStorage last-5 list |

## Proposed for v2 (not in scope)

- `[[wikilink]]` click navigation — needs TinyMDE plugin
- Backlinks panel — needs server-side `notes:backlinks` event
- `#tag` extraction & sidebar — parse frontmatter + inline tags
- Graph view — needs d3 or similar
- Note templates (beyond daily) — template picker on "New Note"
- Pinned/starred notes
