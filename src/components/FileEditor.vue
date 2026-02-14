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
  tinyMdeInstance = null;
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }
});
</script>

<template>
  <div class="file-editor">
    <!-- Editor content -->
    <div class="editor-content">
      <div v-if="loading" class="editor-loading">Loading...</div>
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
