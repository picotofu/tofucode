# Feature: Diff Viewer ✅

**Status:** Completed
**Completed:** 2026-02-06

## Overview

Implemented diff viewing capabilities in two areas:
1. **Edit Tool Diff**: Show inline diff when Claude performs Edit operations in chat history
2. **Git Diff Modal**: Full diff view of all changed/added/removed files when clicking the toolbar file changes indicator

Both features are now fully functional and integrated into the application.

---

## 1. Edit Tool Diff in Chat History

### Current Behavior

When Claude performs an Edit, the chat history shows:
- Tool icon: 📝
- Primary: File path (e.g., `/src/views/ChatView.vue`)
- Secondary: Truncated preview `"old text..." → "new text..."` (50 chars max)
- Collapsible tool result showing success/failure message

**File:** `src/utils/format.js` (lines 68-77)
```javascript
Edit: {
  icon: '📝',
  getDisplay: (input) => ({
    primary: input.file_path,
    secondary: input.old_string
      ? `"${truncate(input.old_string, 50)}" → "${truncate(input.new_string, 50)}"`
      : null,
    type: 'path',
  }),
},
```

### Enhanced Behavior

Add collapsible inline diff view showing the actual changes with syntax highlighting:

**Visual Design:**
```
┌─────────────────────────────────────────────────────┐
│ 📝 Edit                                              │
│ /src/views/ChatView.vue                              │
│ "const foo = 1" → "const foo = 2"                    │
│ ▶ Show diff                                    [▼]   │
├─────────────────────────────────────────────────────┤
│ @@ -145,3 +145,3 @@                                  │
│   function handleSubmit() {                          │
│ -   const foo = 1;                                   │
│ +   const foo = 2;                                   │
│   }                                                  │
└─────────────────────────────────────────────────────┘
```

### Implementation

#### 1.1 Create Diff Utility

**New File:** `src/utils/diff.js`

```javascript
/**
 * Generate unified diff from old and new strings
 * @param {string} oldStr - Original text
 * @param {string} newStr - New text
 * @param {string} filePath - File path for header
 * @returns {string} Unified diff format
 */
export function generateUnifiedDiff(oldStr, newStr, filePath = '') {
  // Simple line-by-line diff implementation
  // Or use a library like 'diff' (npm package)
}

/**
 * Parse unified diff into structured format for rendering
 * @param {string} diff - Unified diff string
 * @returns {Array<{type: 'header'|'context'|'add'|'remove', content: string}>}
 */
export function parseDiff(diff) {
  const lines = diff.split('\n');
  return lines.map(line => {
    if (line.startsWith('@@')) return { type: 'header', content: line };
    if (line.startsWith('+') && !line.startsWith('+++')) return { type: 'add', content: line };
    if (line.startsWith('-') && !line.startsWith('---')) return { type: 'remove', content: line };
    return { type: 'context', content: line };
  });
}
```

**Option A: Use npm `diff` package** (recommended)
- Well-tested, handles edge cases
- `diff.createPatch()` for unified diff
- ~15KB gzipped

**Option B: Simple custom implementation**
- Lighter weight
- Basic line comparison
- May miss edge cases

#### 1.2 Update MessageItem.vue

**File:** `src/components/MessageItem.vue`

Add diff expansion for Edit tool_use messages:

```vue
<template>
  <!-- Tool use -->
  <div v-else-if="messageType === 'tool_use'" class="tool-message">
    <div class="tool-header">
      <span class="tool-icon">{{ toolDisplay.icon }}</span>
      <span class="tool-label">{{ message.tool }}</span>
    </div>
    <div class="tool-content">
      <!-- ... existing display ... -->
    </div>

    <!-- NEW: Edit diff expansion -->
    <div v-if="message.tool === 'Edit' && hasEditDiff" class="edit-diff-section">
      <button class="diff-toggle" @click="diffExpanded = !diffExpanded">
        <span>{{ diffExpanded ? '▼' : '▶' }}</span>
        <span>{{ diffExpanded ? 'Hide' : 'Show' }} diff</span>
      </button>
      <div v-if="diffExpanded" class="diff-content">
        <DiffViewer :old-string="message.input.old_string"
                    :new-string="message.input.new_string"
                    :file-path="message.input.file_path" />
      </div>
    </div>
  </div>
</template>

<script setup>
const diffExpanded = ref(false);

const hasEditDiff = computed(() => {
  return message.tool === 'Edit' &&
         message.input?.old_string &&
         message.input?.new_string;
});
</script>
```

#### 1.3 Create DiffViewer Component

**New File:** `src/components/DiffViewer.vue`

```vue
<script setup>
import { computed } from 'vue';
import { generateUnifiedDiff, parseDiff } from '../utils/diff.js';

const props = defineProps({
  oldString: { type: String, required: true },
  newString: { type: String, required: true },
  filePath: { type: String, default: '' },
  maxLines: { type: Number, default: 50 }, // Limit for large diffs
});

const diffLines = computed(() => {
  const diff = generateUnifiedDiff(props.oldString, props.newString, props.filePath);
  const parsed = parseDiff(diff);

  // Truncate if too large
  if (parsed.length > props.maxLines) {
    return [...parsed.slice(0, props.maxLines), { type: 'truncated', content: `... ${parsed.length - props.maxLines} more lines` }];
  }
  return parsed;
});
</script>

<template>
  <div class="diff-viewer">
    <div
      v-for="(line, idx) in diffLines"
      :key="idx"
      class="diff-line"
      :class="line.type"
    >
      <span class="line-content">{{ line.content }}</span>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin-top: 8px;
}

.diff-line {
  padding: 2px 8px;
  white-space: pre;
}

.diff-line.header {
  color: var(--text-muted);
  background: var(--bg-secondary);
}

.diff-line.add {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.diff-line.remove {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.diff-line.context {
  color: var(--text-secondary);
}

.diff-line.truncated {
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
}
</style>
```

---

## 2. Git Diff Modal from Toolbar

### Current Behavior

The toolbar shows file changes indicator:
- Format: `+2 ~3 -1 files`
- Color: Warning (yellow/orange)
- **No click interaction**

**Location:** `src/views/ChatView.vue` toolbar-right section

### Enhanced Behavior

Clicking the file changes indicator opens a modal showing:
- List of all changed files with status (A/M/D)
- Click a file to see its diff
- Full unified diff with syntax highlighting
- Staged vs unstaged separation (optional)

**Visual Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ Changed Files                                          [×]  │
├─────────────────────────────────────────────────────────────┤
│ ┌─ Files ────────────────────────────────────────────────┐  │
│ │ A  src/components/NewFile.vue                          │  │
│ │ M  src/views/ChatView.vue                        ←active│  │
│ │ M  src/utils/format.js                                 │  │
│ │ D  src/old-file.js                                     │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│ ┌─ Diff: src/views/ChatView.vue ─────────────────────────┐  │
│ │ @@ -145,10 +145,15 @@ function handleSubmit() {        │  │
│ │    const prompt = inputValue.value.trim();              │  │
│ │ -  if (!prompt) return;                                 │  │
│ │ +  if (!prompt || isRunning.value) return;              │  │
│ │    inputValue.value = '';                               │  │
│ │ +                                                       │  │
│ │ +  // Clear saved input                                 │  │
│ │ +  clearChatInput();                                    │  │
│ │                                                         │  │
│ └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

#### 2.1 Add Server-Side Git Diff Handler

**New File:** `server/events/get-git-diff.js`

```javascript
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { slugToPath } from '../config.js';
import { send } from '../lib/ws.js';

export function handler(ws, message, context) {
  if (!context.currentProjectPath) {
    send(ws, { type: 'git_diff', error: 'No project selected' });
    return;
  }

  const cwd = slugToPath(context.currentProjectPath);

  if (!cwd || !existsSync(cwd)) {
    send(ws, { type: 'git_diff', error: 'Project directory not found' });
    return;
  }

  try {
    // Get list of changed files with status
    const statusOutput = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });

    const files = statusOutput.split('\n').filter(Boolean).map(line => {
      const status = line.substring(0, 2).trim();
      const path = line.substring(3);
      return {
        status: parseStatus(status),
        path,
        staged: line[0] !== ' ' && line[0] !== '?',
      };
    });

    // Get diff for specific file or all files
    const filePath = message.filePath;
    let diff = '';

    if (filePath) {
      // Single file diff
      diff = execSync(`git diff HEAD -- "${filePath}"`, {
        cwd,
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024, // 5MB
      });
    } else {
      // All files diff
      diff = execSync('git diff HEAD', {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    }

    send(ws, {
      type: 'git_diff',
      files,
      diff,
      filePath: filePath || null,
    });
  } catch (error) {
    send(ws, {
      type: 'git_diff',
      error: error.message,
    });
  }
}

function parseStatus(code) {
  if (code === '??' || code.includes('A')) return 'added';
  if (code.includes('M') || code.includes('R')) return 'modified';
  if (code.includes('D')) return 'deleted';
  return 'unknown';
}
```

**Update:** `server/events/index.js`
```javascript
export { handler as get_git_diff } from './get-git-diff.js';
```

#### 2.2 Update WebSocket Composable

**File:** `src/composables/useWebSocket.js`

Add new state and handler:

```javascript
// Add to scoped state
const gitDiff = ref(null); // { files: [], diff: '', error: null }

// Add case in handleMessage
case 'git_diff':
  gitDiff.value = {
    files: msg.files || [],
    diff: msg.diff || '',
    filePath: msg.filePath,
    error: msg.error || null,
  };
  break;

// Add action function
function getGitDiff(filePath = null) {
  send({ type: 'get_git_diff', filePath });
}

// Export in return
return {
  // ... existing
  gitDiff,
  getGitDiff,
};
```

#### 2.3 Create GitDiffModal Component

**New File:** `src/components/GitDiffModal.vue`

```vue
<script setup>
import { computed, ref, watch } from 'vue';
import DiffViewer from './DiffViewer.vue';

const props = defineProps({
  show: Boolean,
  files: { type: Array, default: () => [] },
  diff: { type: String, default: '' },
  error: { type: String, default: null },
});

const emit = defineEmits(['close', 'select-file']);

const selectedFile = ref(null);

// Auto-select first file when modal opens
watch(() => props.show, (show) => {
  if (show && props.files.length > 0 && !selectedFile.value) {
    selectedFile.value = props.files[0].path;
    emit('select-file', selectedFile.value);
  }
});

function selectFile(path) {
  selectedFile.value = path;
  emit('select-file', path);
}

function getStatusIcon(status) {
  switch (status) {
    case 'added': return { icon: 'A', class: 'status-added' };
    case 'modified': return { icon: 'M', class: 'status-modified' };
    case 'deleted': return { icon: 'D', class: 'status-deleted' };
    default: return { icon: '?', class: 'status-unknown' };
  }
}

// Parse diff into file sections
const fileDiffs = computed(() => {
  if (!props.diff) return {};

  const sections = {};
  let currentFile = null;
  let currentContent = [];

  for (const line of props.diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (currentFile) {
        sections[currentFile] = currentContent.join('\n');
      }
      // Extract file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      currentFile = match ? match[2] : null;
      currentContent = [line];
    } else if (currentFile) {
      currentContent.push(line);
    }
  }

  if (currentFile) {
    sections[currentFile] = currentContent.join('\n');
  }

  return sections;
});

const selectedDiff = computed(() => {
  if (!selectedFile.value) return '';
  return fileDiffs.value[selectedFile.value] || '';
});
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click="$emit('close')">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>Changed Files</h3>
          <button class="close-btn" @click="$emit('close')">×</button>
        </div>

        <div class="modal-body">
          <!-- Error state -->
          <div v-if="error" class="error-message">
            {{ error }}
          </div>

          <!-- File list and diff -->
          <template v-else>
            <div class="file-list">
              <div
                v-for="file in files"
                :key="file.path"
                class="file-item"
                :class="{ selected: selectedFile === file.path }"
                @click="selectFile(file.path)"
              >
                <span
                  class="file-status"
                  :class="getStatusIcon(file.status).class"
                >
                  {{ getStatusIcon(file.status).icon }}
                </span>
                <span class="file-path">{{ file.path }}</span>
              </div>
            </div>

            <div class="diff-panel">
              <div class="diff-header" v-if="selectedFile">
                {{ selectedFile }}
              </div>
              <div class="diff-content">
                <pre v-if="selectedDiff" class="diff-raw">{{ selectedDiff }}</pre>
                <div v-else class="no-diff">
                  Select a file to view diff
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  width: 90%;
  max-width: 900px;
  max-height: 80vh;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  font-size: 20px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.file-list {
  width: 280px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  flex-shrink: 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.file-item:hover {
  background: var(--bg-hover);
}

.file-item.selected {
  background: var(--bg-tertiary);
}

.file-status {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
  border-radius: 3px;
}

.status-added {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status-modified {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
}

.status-deleted {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.file-path {
  font-size: 12px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-header {
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.diff-content {
  flex: 1;
  overflow: auto;
  background: var(--bg-tertiary);
}

.diff-raw {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.5;
  white-space: pre;
}

.no-diff {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.error-message {
  padding: 24px;
  text-align: center;
  color: var(--error-color);
}
</style>
```

#### 2.4 Update ChatView.vue

**File:** `src/views/ChatView.vue`

Make the file changes indicator clickable:

```vue
<script setup>
// Add imports and state
import GitDiffModal from '../components/GitDiffModal.vue';

const showDiffModal = ref(false);
const { gitDiff, getGitDiff } = useChatWebSocket();

function openDiffModal() {
  showDiffModal.value = true;
  getGitDiff(); // Fetch all diffs
}

function handleSelectFile(filePath) {
  getGitDiff(filePath); // Fetch specific file diff
}
</script>

<template>
  <!-- Update the toolbar indicator to be clickable -->
  <button
    class="toolbar-item changes"
    v-if="fileChangesText"
    @click="openDiffModal"
    title="View changed files"
  >
    {{ fileChangesText }} files
  </button>

  <!-- Add modal at end of template -->
  <GitDiffModal
    :show="showDiffModal"
    :files="gitDiff?.files || []"
    :diff="gitDiff?.diff || ''"
    :error="gitDiff?.error"
    @close="showDiffModal = false"
    @select-file="handleSelectFile"
  />
</template>

<style scoped>
/* Make changes indicator look clickable */
.toolbar-item.changes {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.toolbar-item.changes:hover {
  background: var(--bg-hover);
}
</style>
```

---

## 3. Additional Enhancements

### 3.1 Syntax Highlighting for Diffs

Use highlight.js with diff language for enhanced readability:

```javascript
import hljs from 'highlight.js/lib/core';
import diffLanguage from 'highlight.js/lib/languages/diff';

hljs.registerLanguage('diff', diffLanguage);

// In DiffViewer component
const highlightedDiff = computed(() => {
  return hljs.highlight(props.diff, { language: 'diff' }).value;
});
```

### 3.2 Line Numbers

Add optional line numbers to diff view:

```vue
<div class="diff-line" v-for="(line, idx) in diffLines">
  <span class="line-number">{{ idx + 1 }}</span>
  <span class="line-content">{{ line.content }}</span>
</div>
```

### 3.3 Copy Diff Button

Add ability to copy diff to clipboard:

```vue
<button @click="copyDiff" class="copy-btn" title="Copy diff">
  📋
</button>

<script setup>
async function copyDiff() {
  await navigator.clipboard.writeText(props.diff);
  // Show toast notification
}
</script>
```

### 3.4 Side-by-Side View (Future)

For advanced users, consider adding a toggle for side-by-side diff view:
- Left panel: Original content
- Right panel: New content
- Synchronized scrolling
- Line-level alignment

### 3.5 Refresh Button

Add ability to refresh the git status and diff:

```vue
<button @click="refresh" class="refresh-btn" title="Refresh">
  🔄
</button>
```

---

## 4. File Structure

```
src/
├── components/
│   ├── DiffViewer.vue      # NEW - Reusable diff display component
│   ├── GitDiffModal.vue    # NEW - Modal for full git diff view
│   └── MessageItem.vue     # MODIFY - Add Edit diff expansion
├── utils/
│   └── diff.js             # NEW - Diff generation utilities
└── views/
    └── ChatView.vue        # MODIFY - Add diff modal trigger

server/
└── events/
    ├── get-git-diff.js     # NEW - Git diff handler
    └── index.js            # MODIFY - Register new handler
```

---

## 5. Dependencies

**Option A: Use `diff` npm package** (recommended)
```bash
npm install diff
```
- Battle-tested diff algorithm
- Supports multiple output formats
- ~15KB gzipped

**Option B: Custom implementation**
- No new dependencies
- Basic Myers diff algorithm
- May have edge cases

---

## 6. Implementation Order

1. ✅ Create `src/utils/diff.js` utility
2. ✅ Create `src/components/DiffViewer.vue` component
3. ✅ Update `src/components/MessageItem.vue` for Edit diff expansion
4. ✅ Create `server/events/get-git-diff.js` handler
5. ✅ Update `src/composables/useWebSocket.js` for git diff state
6. ✅ Create `src/components/GitDiffModal.vue` component
7. ✅ Update `src/views/ChatView.vue` with modal integration
8. ✅ Add syntax highlighting for diff display
9. ✅ Test with various file types and diff sizes

---

## 7. Testing Plan

1. **Edit Tool Diff**
   - Make Claude perform various Edit operations
   - Verify diff displays correctly for small/large changes
   - Test with different file types (JS, Vue, CSS, etc.)
   - Verify truncation works for very large diffs

2. **Git Diff Modal**
   - Test with mixed file changes (A/M/D)
   - Test with large diffs (many files, large files)
   - Test file selection and diff switching
   - Test modal close behavior (click outside, X button, Escape key)
   - Test in non-git directories (should show error gracefully)

3. **Edge Cases**
   - Binary files
   - Renamed files
   - Empty diffs
   - Very long file paths
   - Special characters in content

---

## 8. Performance Considerations

- **Large Diffs**: Limit display to first 500 lines with "Show more" option
- **Many Files**: Virtualize file list if > 100 files
- **Syntax Highlighting**: Use lazy loading for highlight.js languages
- **Caching**: Cache diff results until git status changes
