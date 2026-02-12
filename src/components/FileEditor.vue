<script setup>
import { Editor as TinyMDE } from 'tiny-markdown-editor';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

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

// Detect file type
const fileType = computed(() => {
  if (!props.filePath) return 'text';
  const ext = props.filePath.split('.').pop()?.toLowerCase();

  if (ext === 'md') return 'markdown';
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

// Auto-save logic - debounced
let autoSaveTimeout = null;
watch(
  [() => editorContent.value, () => props.autoSave],
  ([_newContent, autoSaveEnabled]) => {
    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }

    // Only auto-save if enabled, dirty, and not currently saving
    if (autoSaveEnabled && isDirty.value && !isSaving.value) {
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
</style>
