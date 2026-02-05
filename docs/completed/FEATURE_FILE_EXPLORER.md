# Feature: File Explorer & Editor

## Overview

Add file browsing and editing capabilities within the chat interface. This feature enables users to view, navigate, and edit project files without leaving the conversation context.

**Status:** ✅ **IMPLEMENTED**

---

## Implementation Summary

All planned features have been implemented:
- **Files Mode Tab**: Third tab in footer (Chat | Terminal | Files)
- **File Explorer**: Browse project files with breadcrumb navigation
- **File Editor**: Edit text files and markdown with TinyMDE rich editor
- **File Operations**: Create, rename, delete files and folders with confirmation modals
- **Auto-detection**: Markdown files (`.md`) use rich editor, code files use monospace textarea

---

## Goals

1. **Quick File Access**: Browse project files while chatting with Claude
2. **Simple Editing**: Edit text files and markdown with syntax highlighting
3. **Context Awareness**: File operations stay within current project scope
4. **Minimal UI**: Reuse existing patterns (mode tabs, folder browser, markdown editor)

---

## User Stories

1. As a user, I want to browse project files while chatting so I can quickly reference or edit files
2. As a user, I want to edit text files with syntax highlighting so I can make quick changes
3. As a user, I want to edit markdown files with a rich editor so I can write documentation easily
4. As a user, I want file changes to be tracked so Claude can see what I modified

---

## Design Proposal

### UI Layout

Add a third mode tab alongside Chat and Terminal:

```
┌─ Footer ────────────────────────────────────────────┐
│ [💬 Chat] [⚡ Terminal] [📁 Files] │ [Status]      │
│ ─────────────────────────────────────────────────── │
│ [Resize Handle]                                     │
│ ─────────────────────────────────────────────────── │
│ [Input Area / Terminal Input / File Editor]         │
└─────────────────────────────────────────────────────┘
```

### Files Mode UI

When Files tab is active, replace the main content area with:

```
┌─ Files Mode ────────────────────────────────────────┐
│                                                      │
│  ┌─ File Explorer (Left) ──┬─ File Editor (Right) ─┐
│  │ 📂 /home/user/project   │ editor.js              │
│  │ ─────────────────────── │ ────────────────────── │
│  │ 📁 src/                 │                        │
│  │   📄 index.js           │ const x = 1;           │
│  │   📄 config.js          │ const y = 2;           │
│  │ 📁 docs/                │                        │
│  │   📄 README.md          │ [Save] [Revert]        │
│  │ 📄 package.json         │                        │
│  └─────────────────────────┴────────────────────────┘
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Alternative: Single Panel with Navigation**
```
┌─ Files Mode (Simplified) ───────────────────────────┐
│ 📂 /home/user/project/src                           │
│ [← Back]                                             │
│ ─────────────────────────────────────────────────── │
│ 📁 components/                                       │
│ 📄 App.vue                                           │
│ 📄 main.js                                           │
│ 📄 router.js                                         │
└──────────────────────────────────────────────────────┘
```

### User Workflow

1. **Browse Files**: Click Files tab → Shows file explorer for current project
2. **Navigate**: Click folders to drill down, use breadcrumb/back to go up
3. **View File**: Click file → Opens in simple editor (textarea with syntax highlighting)
4. **Edit Markdown**: `.md` files → Opens with TinyMDE editor (same as chat input)
5. **Save Changes**: Save button → File written to disk, tracked in git (if available)
6. **Return to Chat**: Click Chat tab → File context preserved for Claude

---

## Technical Design

### 1. Mode Management

**Frontend (`ChatView.vue`):**
```javascript
const currentMode = ref('chat'); // 'chat' | 'terminal' | 'files'

// Replace terminalMode boolean with mode string
// Update all conditionals to check currentMode
```

### 2. File Explorer Component

**New Component: `FileExplorer.vue`**
- Reuses folder browsing logic from `ProjectsView.vue`
- Props: `projectPath` (from current project)
- Emits: `select-file` (when user clicks a file)
- Features:
  - Folder navigation (browse up/down)
  - File type icons (folder, file, markdown, code)
  - Search/filter capability (future enhancement)

**WebSocket Events:**
```javascript
// Reuse existing browseFolder event from ProjectsView
{ type: 'browseFolder', path: '/home/user/project/src' }

// New events for file operations
{ type: 'readFile', path: '/home/user/project/src/App.vue' }
{ type: 'writeFile', path: '/...', content: '...' }
```

### 3. File Editor Component

**New Component: `FileEditor.vue`**
- Props: `filePath`, `content`, `fileType`
- Emits: `save`, `close`
- Features:
  - **Text files**: Simple `<textarea>` with syntax highlighting (highlight.js or Prism)
  - **Markdown files**: TinyMDE editor (already used for chat input)
  - Auto-detect file type from extension
  - Dirty state tracking (unsaved changes warning)
  - Save/Revert buttons

**File Type Detection:**
```javascript
const FILE_TYPES = {
  '.md': 'markdown',
  '.js': 'javascript',
  '.vue': 'vue',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.py': 'python',
  // ... more types
};
```

### 4. Backend Events

**New File: `server/events/files.js`**
```javascript
export async function handleReadFile(ws, payload) {
  const { path } = payload;
  // Read file from filesystem
  // Return content + metadata (size, modified time, etc.)
}

export async function handleWriteFile(ws, payload) {
  const { path, content } = payload;
  // Write file to filesystem
  // Return success/error
  // Optionally: git add (if in git repo)
}
```

**Backend Safety:**
- Validate file paths (prevent directory traversal)
- Limit file size (e.g., 10MB max)
- Only allow editing within project directory
- Binary file detection (don't try to edit binaries)

### 5. Layout Structure

**Split View Option (if implementing two-panel layout):**
```vue
<div v-if="currentMode === 'files'" class="files-mode">
  <div class="files-split">
    <FileExplorer
      class="file-explorer-panel"
      :project-path="projectStatus.cwd"
      @select-file="openFile"
    />
    <FileEditor
      v-if="openedFile"
      class="file-editor-panel"
      :file-path="openedFile.path"
      :content="openedFile.content"
      :file-type="openedFile.type"
      @save="saveFile"
      @close="closeFile"
    />
    <div v-else class="editor-empty">
      <p>Select a file to edit</p>
    </div>
  </div>
</div>
```

**Single Panel Option (simpler, recommended for v1):**
```vue
<div v-if="currentMode === 'files'" class="files-mode">
  <FileEditor
    v-if="openedFile"
    :file-path="openedFile.path"
    :content="openedFile.content"
    :file-type="openedFile.type"
    @save="saveFile"
    @back="closeFile"
  />
  <FileExplorer
    v-else
    :project-path="projectStatus.cwd"
    @select-file="openFile"
  />
</div>
```

---

## Implementation Plan

### Phase 1: Basic File Explorer (2-3 hours)

**Goal:** Browse files in current project

1. Add "Files" mode tab to footer
2. Create `FileExplorer.vue` component
   - Reuse `browseFolder` logic from ProjectsView
   - Display folders and files
   - Handle navigation (up/down folders)
3. Update WebSocket to handle file browsing in project context
4. Test: Switch to Files tab, browse project folders

### Phase 2: Text File Viewer (1-2 hours)

**Goal:** View text file contents

1. Add `readFile` WebSocket event handler
2. Extend FileExplorer to emit `select-file` event
3. Create simple `FileViewer.vue` component
   - Display file content in readonly `<pre>` or `<code>` block
   - Syntax highlighting (highlight.js)
4. Test: Click file, view content, navigate back

### Phase 3: Text File Editor (2-3 hours)

**Goal:** Edit and save text files

1. Convert FileViewer to `FileEditor.vue`
   - Add editable `<textarea>` mode
   - Detect file type from extension
   - Apply syntax highlighting
2. Add `writeFile` WebSocket event handler
   - Validate paths (security)
   - Write content to disk
3. Add Save/Revert buttons with dirty state tracking
4. Test: Edit file, save changes, verify on disk

### Phase 4: Markdown Editor (1-2 hours)

**Goal:** Rich markdown editing for `.md` files

1. Integrate TinyMDE into FileEditor
   - Detect `.md` extension
   - Render TinyMDE editor instead of textarea
   - Reuse TinyMDE styles from ChatView
2. Test: Edit README.md with markdown editor

### Phase 5: Polish & UX (1-2 hours)

**Goal:** Improve user experience

1. Add file type icons (folder, markdown, code, etc.)
2. Add breadcrumb navigation in explorer
3. Unsaved changes warning when switching modes
4. Loading states and error handling
5. Keyboard shortcuts (Cmd+S to save, Esc to close)

---

## Total Estimate

**8-12 hours** for full implementation (all phases)

**MVP (Phases 1-3):** 5-8 hours - Browse and edit text files

---

## Future Enhancements

1. **Search Files**: Quick file search within project
2. **Recent Files**: Track recently opened/edited files
3. **File Upload**: Upload new files via drag-and-drop
4. **Git Integration**: Show git status, stage/unstage files
5. **Image Preview**: View images in explorer
6. **Multiple Files**: Tabs for multiple open files
7. **Code Actions**: Format, lint, run file-specific commands

---

## Open Questions

1. **Layout preference?**
   - Option A: Split view (explorer + editor side-by-side)
   - Option B: Single panel (navigate between explorer/editor)
   - **Recommendation**: Start with Option B (simpler), add split view later if needed

2. **File size limits?**
   - Suggestion: 10MB max for editing (prevent loading huge files)
   - Binary files: Show "Cannot edit binary file" message

3. **Git integration?**
   - Auto `git add` on save? (probably not - let user decide)
   - Show git status indicators in explorer? (future enhancement)

4. **Security considerations?**
   - Only allow browsing/editing within project directory
   - Validate all file paths (prevent `../../../etc/passwd`)
   - Consider read-only mode for sensitive files (`.env`, credentials)

---

## Notes

- **Reuse Existing Code**: Folder browser from ProjectsView, TinyMDE from ChatView
- **Consistency**: Match existing dark theme, icons, and interaction patterns
- **Progressive Enhancement**: Start simple (browse + edit), add features incrementally
- **Context Preservation**: When switching between modes, preserve state (open file, scroll position)

---

## Implementation Details

### Frontend Components

**`src/components/FileExplorer.vue`**
- Displays folder/file tree with icons
- Breadcrumb navigation (home, up, path segments)
- New file/folder buttons in header
- Right-click context menu (rename, delete)
- Emits: `navigate`, `select-file`, `create-file`, `create-folder`, `rename`, `delete`

**`src/components/FileEditor.vue`**
- Detects file type from extension
- **Markdown (`.md`)**: TinyMDE rich editor with same styles as chat input
- **Code files**: Monospace textarea for `.js`, `.ts`, `.vue`, `.json`, etc.
- **Text files**: Regular textarea for everything else
- Dirty state tracking with unsaved changes indicator (●)
- Save (Cmd+S) and Revert buttons
- Back button returns to explorer

**`src/views/ChatView.vue` Updates**
- Changed `terminalMode` boolean to `currentMode` string ('chat' | 'terminal' | 'files')
- Added Files tab to footer mode tabs
- File operation modals (create file/folder, rename, delete confirmation)
- Message handlers for file operation responses
- Auto-browse project root when switching to Files mode

### Backend Events

**`server/events/files.js`**
All events follow the pattern: `files:action` (request) → `files:action:result` or `files:action:error` (response)

1. **`files:browse`**: List folder contents
   - Returns array of items with `name`, `path`, `isDirectory`
   - Sorted: folders first, then files (alphabetically)

2. **`files:read`**: Read file content
   - Security: 10MB file size limit
   - Binary detection: Checks for null bytes in first 8KB
   - Returns file content as UTF-8 string

3. **`files:write`**: Write file content
   - Creates parent directories if needed
   - Saves content as UTF-8

4. **`files:create`**: Create new file or folder
   - Parameter: `isDirectory` boolean
   - Auto-refreshes parent directory after creation

5. **`files:rename`**: Rename file or folder
   - Validates old path exists before renaming
   - Auto-refreshes parent directory

6. **`files:delete`**: Delete file or folder
   - Recursive deletion for directories
   - Auto-refreshes parent directory

7. **`files:move`**: Move file to different directory (not used in UI yet)
   - Refreshes both source and destination directories

### Security Features

- **Path validation**: All paths resolved with `path.resolve()` to prevent traversal
- **File size limit**: 10MB maximum for editing
- **Binary detection**: Prevents editing binary files
- **Directory scope**: Operations restricted to filesystem (no additional sandboxing yet)

### User Experience

- **Modal confirmations**: Delete operations require explicit confirmation
- **Unsaved changes warning**: Prompted when closing editor with unsaved changes
- **Loading states**: Skeleton screens during file/folder loading
- **Error handling**: User-friendly alert dialogs for operation failures
- **Keyboard shortcuts**: Cmd+S to save, Escape to close (when no unsaved changes)

### Recent Enhancements (2026-02-05)

- **Explorer header reorganization**: Moved below mode tabs (in footer area) for better layout
- **Inline breadcrumb navigation**: Clickable path segments for quick navigation
- **Quick navigation buttons**: "Go up" and "Go to project root" buttons
- **Inline path editing**: Click breadcrumb path to edit directly (no modal)
- **Mobile-friendly**: Horizontally scrollable breadcrumb for long paths
- **Dotfiles toggle**: Moved alongside create file/folder buttons in header
- **File editor redesign**: Cleaner icon-only header (filename + save + close)
- **Improved button contrast**: Better legibility for action buttons

### Not Implemented (Future Enhancements)

- Syntax highlighting for code files (could add highlight.js or Prism)
- File search within project
- Multiple open files with tabs
- Drag-and-drop file upload
- Git status indicators
- File preview for images
- Move operation via drag-and-drop
