<script setup>
import { Editor as TinyMDE } from 'tiny-markdown-editor';
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import CsvEditor from './CsvEditor.vue';
import '../styles/tabulator-custom.css';

const props = defineProps({
  filePath: String,
  content: String,
  loading: Boolean,
  isBinary: {
    type: Boolean,
    default: false,
  },
  binaryReason: {
    type: String,
    default: null, // null | 'too_large'
  },
  fileSize: {
    type: Number,
    default: null,
  },
  autoSave: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['save', 'close', 'dirty']);

const editorContent = ref(props.content || '');
const isDirty = ref(false);
const isSaving = ref(false);
const textareaRef = ref(null);
const mdEditorRef = ref(null);
let tinyMdeInstance = null;
let tabKeyHandler = null;
let tabKeyElement = null;

// Get settings
const settingsContext = inject('settings');

// Symbol list for toolbar - from settings or default
const symbolList = computed(() => {
  const customSymbols = settingsContext?.symbolToolbar?.() || '';
  if (customSymbols.trim()) {
    // Split by spaces and filter out empty strings
    return customSymbols.split(/\s+/).filter((s) => s.length > 0);
  }
  // Default symbols (keyboard layout order)
  return [
    '`',
    '~',
    '!',
    '@',
    '#',
    '$',
    '%',
    '^',
    '&',
    '*',
    '(',
    ')',
    '-',
    '_',
    '=',
    '+',
    '[',
    ']',
    '{',
    '}',
    '\\',
    '|',
    ':',
    "'",
    '"',
    ',',
    '.',
    '<',
    '>',
    '/',
    '?',
  ];
});

// Detect file type
const fileType = computed(() => {
  if (!props.filePath) return 'text';
  const ext = props.filePath.split('.').pop()?.toLowerCase();

  if (ext === 'md') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext))
    return 'image';
  if (
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'vue',
      'json',
      'css',
      'html',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'sh',
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'text';
});

const fileName = computed(() => {
  if (!props.filePath) return '';
  return props.filePath.split('/').pop();
});

const formattedFileSize = computed(() => {
  const size = props.fileSize;
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
});

// Parse markdown headings for TOC
const markdownHeadings = computed(() => {
  if (fileType.value !== 'markdown' || !editorContent.value) return [];

  const lines = editorContent.value.split('\n');
  const headings = [];
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      headings.push({
        level,
        text,
        line: lineNumber,
        id: text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-'),
      });
    }
  }

  return headings;
});

const showToc = computed(() => {
  return fileType.value === 'markdown' && markdownHeadings.value.length > 0;
});

// Scroll to heading
function scrollToHeading(heading) {
  // The scrollable container is the .markdown-editor div
  const container = mdEditorRef.value;
  if (!container) return;

  // TinyMDE uses contenteditable div, not textarea
  const tinyMDEElement = container.querySelector('.TinyMDE');
  if (!tinyMDEElement) return;

  // Use nextTick to ensure DOM is updated
  nextTick(() => {
    // Get all child elements (each line/block is a separate element)
    const children = Array.from(tinyMDEElement.children);

    // Find the child element at or near the target line
    // Each block element (heading, paragraph, etc.) can span multiple lines
    let targetElement = null;
    let currentLine = 1;

    for (const child of children) {
      const text = child.textContent || '';
      const lineCount = text.split('\n').length;

      if (currentLine + lineCount > heading.line) {
        targetElement = child;
        break;
      }
      currentLine += lineCount;
    }

    // If we found the target element, scroll to it
    if (targetElement) {
      const elementTop = targetElement.offsetTop;
      const scrollTop = Math.max(0, elementTop - 16);

      container.scroll({
        top: scrollTop,
        behavior: 'smooth',
      });
    }
  });
}

// Handle Tab key for markdown editor
function handleMarkdownTab(event) {
  if (!tinyMdeInstance) return;

  const selection = tinyMdeInstance.getSelection();
  if (!selection) return;

  const content = tinyMdeInstance.getContent();
  const lines = content.split('\n');
  const currentLine = lines[selection.row];

  // Check if current line is a list item
  const listMatch = currentLine.match(/^(\s*)([+*-]|\d+[.)])\s/);

  if (event.shiftKey) {
    // Shift+Tab: Dedent
    if (listMatch) {
      // Dedent list item (remove up to 2 spaces from beginning)
      const leadingSpaces = listMatch[1];
      if (leadingSpaces.length >= 2) {
        const newLine = currentLine.replace(/^ {2}/, '');
        lines[selection.row] = newLine;
        tinyMdeInstance.setContent(lines.join('\n'));

        // Restore cursor position (adjusted for removed spaces)
        const newCol = Math.max(0, selection.col - 2);
        tinyMdeInstance.setSelection({ row: selection.row, col: newCol });
      }
    } else {
      // Not a list - remove up to 2 spaces from beginning
      if (currentLine.startsWith('  ')) {
        const newLine = currentLine.replace(/^ {2}/, '');
        lines[selection.row] = newLine;
        tinyMdeInstance.setContent(lines.join('\n'));

        // Restore cursor position
        const newCol = Math.max(0, selection.col - 2);
        tinyMdeInstance.setSelection({ row: selection.row, col: newCol });
      }
    }
  } else {
    // Tab: Indent
    if (listMatch) {
      // Indent list item (add 2 spaces at beginning)
      const newLine = `  ${currentLine}`;
      lines[selection.row] = newLine;
      tinyMdeInstance.setContent(lines.join('\n'));

      // Restore cursor position (adjusted for added spaces)
      tinyMdeInstance.setSelection({
        row: selection.row,
        col: selection.col + 2,
      });
    } else {
      // Not a list - insert 2 spaces at cursor
      tinyMdeInstance.paste('  ');
    }
  }

  // Mark as dirty
  isDirty.value = true;
  editorContent.value = tinyMdeInstance.getContent();
}

// Setup tab key handling for markdown editor
function setupMarkdownTabHandling() {
  // Clean up previous listener if any
  cleanupTabKeyHandler();

  if (!mdEditorRef.value) return;

  const editorElement = mdEditorRef.value.querySelector('.TinyMDE');
  if (!editorElement) return;

  tabKeyHandler = (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      handleMarkdownTab(event);
    }
  };
  tabKeyElement = editorElement;
  editorElement.addEventListener('keydown', tabKeyHandler);
}

// Clean up tab key event listener
function cleanupTabKeyHandler() {
  if (tabKeyHandler && tabKeyElement) {
    tabKeyElement.removeEventListener('keydown', tabKeyHandler);
    tabKeyHandler = null;
    tabKeyElement = null;
  }
}

// Watch for content changes from parent (new file loaded)
watch(
  () => props.content,
  (newContent) => {
    editorContent.value = newContent || '';
    isDirty.value = false;

    // Reinitialize TinyMDE with new content
    if (tinyMdeInstance) {
      tinyMdeInstance.setContent(editorContent.value);
    }
  },
);

// Initialize/cleanup markdown editor based on file type
watch(
  [fileType, () => props.loading],
  async ([type, loading]) => {
    // Clean up old instance first
    if (tinyMdeInstance) {
      cleanupTabKeyHandler();
      tinyMdeInstance = null;
    }

    // Only init if markdown and not loading
    if (type === 'markdown' && !loading) {
      await nextTick();
      if (mdEditorRef.value) {
        tinyMdeInstance = new TinyMDE({
          element: mdEditorRef.value,
          content: editorContent.value,
        });

        tinyMdeInstance.addEventListener('change', () => {
          const newContent = tinyMdeInstance.getContent();
          if (newContent !== editorContent.value) {
            editorContent.value = newContent;
            isDirty.value = true;
          }
        });

        // Add tab key handling for markdown editor
        setupMarkdownTabHandling();
      }
    }
  },
  { immediate: true },
);

// Handle textarea input for non-markdown files
function handleTextareaInput(event) {
  editorContent.value = event.target.value;
  isDirty.value = true;
}

// Handle CSV editor changes
function handleCsvChange(newContent) {
  isDirty.value = true; // Set dirty flag FIRST
  editorContent.value = newContent; // Then update content (triggers watch)
}

// Auto-save logic - debounced
let autoSaveTimeout = null;
watch(
  [() => editorContent.value, () => props.autoSave, () => isDirty.value],
  ([_newContent, autoSaveEnabled, dirty]) => {
    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }

    // Only auto-save if enabled, dirty, and not currently saving
    if (autoSaveEnabled && dirty && !isSaving.value) {
      autoSaveTimeout = setTimeout(() => {
        handleSave();
      }, 1000); // 1 second debounce
    }
  },
);

// Save file
function handleSave() {
  if (isSaving.value || !isDirty.value) return;

  isSaving.value = true;
  emit('save', {
    path: props.filePath,
    content: editorContent.value,
  });
  isDirty.value = false;
  isSaving.value = false;
}

// Revert changes
function handleRevert() {
  if (!isDirty.value) return;

  const confirmed = confirm('Discard unsaved changes?');
  if (confirmed) {
    editorContent.value = props.content || '';
    isDirty.value = false;

    if (tinyMdeInstance) {
      tinyMdeInstance.setContent(editorContent.value);
    }
  }
}

// Close editor
function handleClose() {
  if (isDirty.value) {
    const confirmed = confirm('You have unsaved changes. Close anyway?');
    if (!confirmed) return;
  }
  emit('close');
}

// Insert symbol at cursor position
function insertSymbol(symbol) {
  if (fileType.value === 'markdown' && tinyMdeInstance) {
    // For TinyMDE, get current content and selection
    const content = tinyMdeInstance.getContent();
    const selection = window.getSelection();
    const range = selection?.getRangeAt(0);

    if (range) {
      // Insert at cursor
      range.deleteContents();
      range.insertNode(document.createTextNode(symbol));
      range.collapse(false);

      // Mark as dirty FIRST, then update content (to trigger watch correctly)
      isDirty.value = true;
      editorContent.value = tinyMdeInstance.getContent();

      // Ensure focus returns to editor after Vue updates
      nextTick(() => {
        if (mdEditorRef.value) {
          mdEditorRef.value.focus();
        }
      });
    }
  } else if (textareaRef.value) {
    // For textarea
    const textarea = textareaRef.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    // Insert symbol at cursor position
    const newText = text.substring(0, start) + symbol + text.substring(end);
    const newCursorPos = start + symbol.length;

    // Mark as dirty FIRST, then update content (to trigger watch correctly)
    isDirty.value = true;
    editorContent.value = newText;

    // Restore cursor position and focus after Vue updates the textarea
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.value.focus();
      }
    });
  }
}

// Keyboard shortcuts
function handleKeydown(event) {
  // Cmd/Ctrl+S to save
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault();
    handleSave();
  }
  // Escape to close (if no unsaved changes)
  if (event.key === 'Escape' && !isDirty.value) {
    handleClose();
  }
}

defineExpose({
  isDirty,
  isSaving,
  save: handleSave,
  close: handleClose,
});

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  cleanupTabKeyHandler();
  tinyMdeInstance = null;
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }
});
</script>

<template>
  <div class="file-editor" :class="{ 'with-toc': showToc }">
    <!-- Editor content -->
    <div class="editor-content">
      <div v-if="loading" class="editor-loading">Loading...</div>
      <div v-else-if="isBinary" class="binary-info">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <div class="binary-info-name">{{ fileName }}</div>
        <div class="binary-info-meta">
          <span>Binary file</span>
          <span v-if="formattedFileSize" class="binary-info-sep">·</span>
          <span v-if="formattedFileSize">{{ formattedFileSize }}</span>
          <span v-if="filePath?.split('.').pop()?.toUpperCase()" class="binary-info-sep">·</span>
          <span>{{ filePath?.split('.').pop()?.toUpperCase() }}</span>
        </div>
        <div class="binary-info-note">{{ binaryReason === 'too_large' ? 'File too large to preview (max 10MB)' : 'This file cannot be previewed' }}</div>
      </div>
      <template v-else>
        <!-- Markdown editor (TinyMDE) -->
        <div
          v-if="fileType === 'markdown'"
          ref="mdEditorRef"
          class="markdown-editor"
        ></div>

        <!-- CSV editor (Tabulator) -->
        <CsvEditor
          v-else-if="fileType === 'csv'"
          :content="editorContent"
          :file-path="props.filePath"
          @change="handleCsvChange"
        />

        <!-- Image viewer -->
        <div v-else-if="fileType === 'image'" class="image-viewer">
          <img :src="editorContent" :alt="props.filePath" />
        </div>

        <!-- Plain text / code editor -->
        <textarea
          v-else
          ref="textareaRef"
          class="text-editor"
          :class="{ code: fileType === 'code' }"
          :value="editorContent"
          @input="handleTextareaInput"
          spellcheck="false"
          placeholder="Start typing..."
        ></textarea>
      </template>
    </div>

    <!-- Table of Contents (Markdown only) -->
    <div v-if="showToc" class="toc-sidebar">
      <div class="toc-header">Contents</div>
      <div class="toc-list">
        <button
          v-for="heading in markdownHeadings"
          :key="heading.line"
          class="toc-item"
          :class="`toc-level-${heading.level}`"
          @click="scrollToHeading(heading)"
          :title="heading.text"
        >
          {{ heading.text }}
        </button>
      </div>
    </div>

    <!-- Symbol toolbar (not shown for CSV or image files) -->
    <div v-if="!loading && fileType !== 'csv' && fileType !== 'image'" class="symbol-toolbar">
      <button
        v-for="symbol in symbolList"
        :key="symbol"
        class="symbol-btn"
        @mousedown.prevent="insertSymbol(symbol)"
        :title="`Insert ${symbol}`"
      >
        {{ symbol }}
      </button>
    </div>
  </div>
</template>

<style scoped>
@import 'tiny-markdown-editor/dist/tiny-mde.min.css';

.file-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  position: relative;
}

.file-editor.with-toc {
  display: grid;
  grid-template-columns: 1fr 240px;
  grid-template-rows: 1fr auto;
}

.file-editor.with-toc .editor-content {
  grid-column: 1;
  grid-row: 1;
  border-right: 1px solid var(--border-color);
}

.file-editor.with-toc .toc-sidebar {
  grid-column: 2;
  grid-row: 1;
}

.file-editor.with-toc .symbol-toolbar {
  grid-column: 1 / -1;
  grid-row: 2;
}

.editor-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.binary-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-muted);
}

.binary-info svg {
  opacity: 0.4;
}

.binary-info-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.binary-info-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.binary-info-sep {
  opacity: 0.5;
}

.binary-info-note {
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.7;
}

/* Markdown editor */
.markdown-editor {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  font-size: 14px;
  line-height: 1.7;
}

/* Text / code editor */
.text-editor {
  flex: 1;
  padding: 16px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
  background: transparent;
  border: none;
  resize: none;
  outline: none;
  overflow-y: auto;
}

.text-editor.code {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;
}

.text-editor::placeholder {
  color: var(--text-muted);
}

/* Image viewer */
.image-viewer {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
  background: var(--bg-primary);
}

.image-viewer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* TinyMDE dark theme overrides */
.markdown-editor :deep(.TinyMDE) {
  background: transparent;
  color: var(--text-primary);
  border: none;
  font-size: 14px;
  line-height: 1.7;
}

.markdown-editor :deep(.TinyMDE.TinyMDE_empty::before) {
  color: var(--text-muted);
}

/* Symbol toolbar */
.symbol-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  overflow-x: auto;
  overflow-y: hidden;
  /* Prevent scrollbar on desktop */
  scrollbar-width: thin;
  scrollbar-color: var(--text-muted) transparent;
}

.symbol-toolbar::-webkit-scrollbar {
  height: 4px;
}

.symbol-toolbar::-webkit-scrollbar-track {
  background: transparent;
}

.symbol-toolbar::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 2px;
}

.symbol-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  user-select: none;
}

.symbol-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Table of Contents sidebar */
.toc-sidebar {
  width: 240px;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
}

.toc-header {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border-color);
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.toc-item {
  width: 100%;
  padding: 6px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.toc-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Indentation based on heading level */
.toc-item.toc-level-1 {
  padding-left: 16px;
  font-weight: 600;
}

.toc-item.toc-level-2 {
  padding-left: 24px;
}

.toc-item.toc-level-3 {
  padding-left: 32px;
  font-size: 12px;
}

.toc-item.toc-level-4 {
  padding-left: 40px;
  font-size: 12px;
}

.toc-item.toc-level-5 {
  padding-left: 48px;
  font-size: 11px;
}

.toc-item.toc-level-6 {
  padding-left: 56px;
  font-size: 11px;
}

.symbol-btn:active {
  transform: scale(0.95);
}

/* Mobile optimization */
@media (max-width: 768px) {
  .symbol-toolbar {
    padding: 6px 8px;
    gap: 3px;
  }

  .symbol-btn {
    min-width: 36px;
    height: 36px;
    font-size: 15px;
  }
}
</style>
