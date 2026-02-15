# FEATURE: File Mentions (@-mention)

**Status**: Planning
**Created**: 2026-02-06
**Author**: Planning phase

## Requirements

- Allow users to type `@` in chat input to trigger file autocomplete
- Show dropdown/popup with files from current project
- Support fuzzy/substring search to filter files as user types
- Allow keyboard navigation (arrow keys, enter, escape)
- Insert file tag into message when selected
- Parse file tags from user message and inject file contents as context
- Handle file read errors gracefully (not found, too large, permission denied)

## Context

### Inspiration: Claude Code Desktop

Claude Code desktop has an `@` mention feature where:
1. User types `@` → autocomplete dropdown appears
2. Shows list of project files
3. Filters as user types (e.g., `@sidebar` → shows `Sidebar.vue`)
4. Selecting a file adds it as context tag (e.g., `@src/components/Sidebar.vue`)
5. Claude receives the file contents automatically

This significantly improves UX by:
- No need to manually copy-paste file contents
- Quick access to any project file
- Clear visual indicator of which files are in context
- Reduces token waste from unnecessary file content

### Current State in tofucode

Currently, users must:
- Manually reference files by path in their message
- Hope Claude asks for the file via tool use
- Or paste file contents directly (wasteful)

### Technical Foundation

**Frontend:**
- Vue 3 Composition API
- TinyMDE editor for chat input (Markdown editor)
- WebSocket for real-time communication

**Backend:**
- Node.js + Express
- Claude Agent SDK
- File system access to project directory

## Scope

### In Scope

**Phase 1: Basic Implementation**
- Detect `@` character in chat input
- Show file picker popup/dropdown
- List files from current project directory
- Basic substring search/filter
- Insert file tag on selection
- Parse file tags from message
- Read file contents and inject into context
- Handle common file types (code files, text files)

**Phase 2: Enhanced Search**
- Fuzzy search (like VSCode's Ctrl+P)
- Recent files prioritization
- File type icons
- File size limits and warnings
- Syntax highlighting preview

**Phase 3: Advanced Features**
- Multiple file selection
- Line range selection (e.g., `@file.js:10-20`)
- `.gitignore` respect
- File tree view option
- Cached file list for performance

### Out of Scope (for now)

- Mentioning symbols/functions (like `@MyComponent.render()`)
- Mentioning URLs or external resources
- Image file previews
- Diff/comparison mode
- Real-time file change detection

## Issues

### Technical Challenges

1. **TinyMDE Integration**
   - TinyMDE is a Markdown editor, not a plain textarea
   - Need to detect `@` at cursor position
   - Need to insert file tag at cursor without breaking formatting
   - May need to hook into TinyMDE's internal API

2. **File List Performance**
   - Large projects may have thousands of files
   - Need efficient file tree traversal
   - Consider caching file list with invalidation strategy
   - Virtual scrolling for large lists

3. **File Size Limits**
   - Large files (>100KB) could exceed context limits
   - Need to warn users or truncate
   - Consider showing file size in picker

4. **File Path Ambiguity**
   - Should paths be relative to project root?
   - What if user has multiple projects with same filename?
   - Need consistent path format

5. **Context Token Management**
   - Multiple file mentions = lots of tokens
   - Need to warn when approaching limits
   - Consider summarization for large files

6. **Race Conditions**
   - File might be deleted/modified between selection and send
   - Need to handle file read errors gracefully

### Design Decisions Needed

1. **File Tag Format**
   - Option A: `@src/components/Sidebar.vue` (plain text, human-readable)
   - Option B: `@file:src/components/Sidebar.vue` (explicit prefix)
   - Option C: `[Sidebar.vue](file://src/components/Sidebar.vue)` (Markdown link)
   - **Recommendation**: Option A (matches Claude Code desktop)

2. **File Search Strategy**
   - Option A: Glob/file tree scan on demand
   - Option B: Pre-cache file list on project load
   - Option C: Hybrid (cache + incremental updates)
   - **Recommendation**: Option B initially, Option C later

3. **Popup Position**
   - Option A: Below cursor (like autocomplete)
   - Option B: Floating modal (like command palette)
   - Option C: Inline expansion (like mentions in Slack)
   - **Recommendation**: Option A (most familiar)

4. **File Content Injection**
   - Option A: Replace tag with file contents in message
   - Option B: Keep tag, send file as separate context block
   - Option C: Send file as tool response (simulate tool use)
   - **Recommendation**: Option B (preserves message readability)

## Plan

### Phase 1: Basic Implementation (MVP)

#### 1.1 Backend: File List API

**File**: `server/events/get-project-files.js`

```javascript
// Event: get_project_files
// Returns list of files in current project
// Params: { projectPath: string, filter?: string }
// Response: { files: [{ path, name, size, type }] }
```

**Implementation:**
- Use `fast-glob` or similar for efficient file listing
- Filter by common code file extensions (.js, .ts, .vue, .py, etc.)
- Respect `.gitignore` (optional for MVP)
- Sort by name
- Limit to reasonable max (e.g., 1000 files)

**Register in**: `server/events/index.js`

#### 1.2 Backend: File Content Injection

**File**: `server/lib/message-parser.js`

```javascript
// Parse file mentions from user message
// Extract @file tags: /@([^\s]+)/g
// Read file contents
// Return augmented message with file context
```

**Integration point**: `server/events/send-prompt.js`
- Before sending to Claude SDK
- Parse message for file mentions
- Read file contents
- Format as additional context blocks

#### 1.3 Frontend: File Mention Input Component

**File**: `src/components/FileMentionPicker.vue`

**Features:**
- Detect `@` character in input
- Show popup below cursor
- Fetch file list from backend
- Display filtered results
- Handle keyboard navigation
- Insert selected file tag

**Key methods:**
```javascript
// Detect @ trigger
onInput(event) {
  const cursorPos = getCursorPosition()
  const textBefore = getTextBeforeCursor(cursorPos)
  if (textBefore.endsWith('@')) {
    showFilePicker()
  }
}

// Filter files
filterFiles(query) {
  return files.filter(f =>
    f.path.toLowerCase().includes(query.toLowerCase())
  )
}

// Insert file tag
selectFile(file) {
  insertAtCursor(`@${file.path}`)
  hideFilePicker()
}
```

#### 1.4 Frontend: TinyMDE Integration

**File**: `src/views/ChatView.vue`

**Changes needed:**
- Add FileMentionPicker component
- Pass TinyMDE editor instance to picker
- Handle cursor position tracking
- Intercept `@` key events

**Considerations:**
- TinyMDE uses CodeMirror under the hood
- May need to use CodeMirror API for cursor manipulation
- Test with existing keyboard shortcuts

#### 1.5 Testing Checklist

- [ ] Type `@` shows file picker
- [ ] Typing after `@` filters files
- [ ] Arrow keys navigate file list
- [ ] Enter key inserts file tag
- [ ] Escape key closes picker
- [ ] Clicking file inserts tag
- [ ] File tag is parsed correctly
- [ ] File contents are injected into context
- [ ] Claude receives file context
- [ ] Error handling: file not found
- [ ] Error handling: file too large
- [ ] Error handling: permission denied

### Phase 2: Enhanced Search (Future)

- Fuzzy search algorithm (Fuse.js or custom)
- Recent files tracking (localStorage)
- File type icons (by extension)
- File size display and warnings
- Syntax highlighting in preview pane

### Phase 3: Advanced Features (Future)

- Line range syntax: `@file.js:10-20`
- Multiple file selection (Ctrl+Click)
- `.gitignore` parsing
- File tree view mode
- Cached file list with file watcher
- Token usage counter

## Implementation Notes

### File Tag Format

**Chosen format**: `@path/to/file.ext`

**Examples:**
- `@src/components/Sidebar.vue`
- `@server/events/send-prompt.js`
- `@package.json`

**Parsing regex**: `/@([\w\-\/\.]+)/g`

### Context Injection Format

**Option 1: Separate context block (Recommended)**

```javascript
{
  role: 'user',
  content: [
    {
      type: 'text',
      text: 'Please review @src/components/Sidebar.vue and suggest improvements'
    },
    {
      type: 'text',
      text: '--- File: src/components/Sidebar.vue ---\n' + fileContents
    }
  ]
}
```

**Option 2: Inline replacement**

```javascript
{
  role: 'user',
  content: 'Please review this file:\n\n```vue\n' + fileContents + '\n```\n\nSuggest improvements'
}
```

**Recommendation**: Option 1 (cleaner, preserves original message)

### File Size Limits

- **Soft limit**: 50KB (warn user)
- **Hard limit**: 200KB (truncate with warning)
- **Token estimate**: ~1 token per 4 characters
- **Context window**: Claude 3.5 Sonnet = 200K tokens

### Performance Optimization

**File list caching:**
```javascript
// Cache file list per project
const fileCache = new Map() // projectPath -> { files, timestamp }

function getProjectFiles(projectPath, maxAge = 60000) {
  const cached = fileCache.get(projectPath)
  if (cached && Date.now() - cached.timestamp < maxAge) {
    return cached.files
  }

  const files = scanFiles(projectPath)
  fileCache.set(projectPath, { files, timestamp: Date.now() })
  return files
}
```

### UI/UX Considerations

**Popup styling:**
- Match sidebar/chat theme
- Max height: 300px (scrollable)
- Show ~10 items at a time
- Highlight matching text
- Show file path and name separately

**Keyboard shortcuts:**
- `@` - Trigger file picker
- `↑/↓` - Navigate list
- `Enter` - Select file
- `Esc` - Close picker
- `Tab` - Close picker (keep @ text)

**Visual feedback:**
- File tags styled differently (e.g., blue badge)
- Hover shows full path
- Click tag to edit/remove

## Open Questions

1. Should we support mentioning folders (all files in folder)?
2. Should we support glob patterns (e.g., `@src/**/*.vue`)?
3. Should we show a preview pane when hovering over file in picker?
4. Should we support mentioning files from other projects?
5. How to handle symlinks and node_modules?
6. Should we support mentioning git commits/branches?
7. Should file mentions persist in session history (JSONL)?

## References

- Claude Code Desktop: Existing @ mention implementation
- VSCode: File picker (Ctrl+P) for UX inspiration
- Slack/Discord: Mention system for interaction patterns
- GitHub: File reference syntax for format ideas

## Success Metrics

- Time saved: No need to copy-paste file contents
- Accuracy: Claude has exact file context
- Adoption: % of messages using file mentions
- Performance: File picker response time < 100ms
- Error rate: File read failures < 1%

## Next Steps

1. Review and approve this plan
2. Create task breakdown in PLAN.md
3. Implement Phase 1.1 (Backend: File List API)
4. Test file scanning performance on large projects
5. Implement Phase 1.2 (Backend: File Content Injection)
6. Prototype Phase 1.3 (Frontend: File Picker UI)
7. Test TinyMDE integration approach
8. Implement full Phase 1
9. User testing and feedback
10. Iterate on UX improvements
