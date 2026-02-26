<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';

const explorerContentRef = ref(null);

const props = defineProps({
  currentPath: String,
  items: Array,
  loading: Boolean,
  projectPath: {
    type: String,
    default: null,
  },
});

const emit = defineEmits([
  'navigate',
  'select-file',
  'rename',
  'delete',
  'reference',
  'upload-done',
]);

// Settings injection for upload size limit
const settingsContext = inject('settings');

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  item: null,
});

// Sort: folders first, then files, alphabetically
const sortedItems = computed(() => {
  if (!props.items) return [];
  return [...props.items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
});

function handleItemClick(item) {
  if (item.isDirectory) {
    emit('navigate', item.path);
  } else {
    emit('select-file', item);
  }
}

function handleItemRightClick(event, item) {
  event.preventDefault();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item,
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

function handleContextAction(action) {
  const item = contextMenu.value.item;
  closeContextMenu();

  switch (action) {
    case 'reference':
      emit('reference', item);
      break;
    case 'rename':
      emit('rename', item);
      break;
    case 'delete':
      emit('delete', item);
      break;
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────

const fileInputRef = ref(null);
const uploads = ref([]); // [{ name, status: 'uploading'|'done'|'error', error? }]
const isDragOver = ref(false);
let uploadClearTimer = null;

function getUploadLimitMb() {
  return settingsContext?.settings?.value?.uploadMaxFileSizeMb ?? 10;
}

function triggerFileInput() {
  fileInputRef.value?.click();
}

function handleFileInputChange(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = ''; // reset so same file can be re-uploaded
  uploadFiles(files);
}

function handleDragOver(e) {
  e.preventDefault();
  isDragOver.value = true;
}

function handleDragLeave(e) {
  // Only clear if leaving the explorer entirely
  if (!explorerContentRef.value?.contains(e.relatedTarget)) {
    isDragOver.value = false;
  }
}

function handleDrop(e) {
  e.preventDefault();
  isDragOver.value = false;
  const files = Array.from(e.dataTransfer?.files || []);
  uploadFiles(files);
}

async function uploadFiles(files) {
  if (!files.length || !props.currentPath) return;

  const limitMb = getUploadLimitMb();
  const limitBytes = limitMb * 1024 * 1024;

  // Cancel any pending auto-clear
  if (uploadClearTimer) {
    clearTimeout(uploadClearTimer);
    uploadClearTimer = null;
  }

  // Add pending entries
  const entries = files.map((file) => ({
    name: file.name,
    status: file.size > limitBytes ? 'error' : 'uploading',
    error: file.size > limitBytes ? `Exceeds ${limitMb} MB limit` : null,
  }));
  uploads.value.push(...entries);

  // Upload each file that passed the size check
  await Promise.all(
    files.map(async (file, i) => {
      const entry = entries[i];
      if (entry.status === 'error') return;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('destPath', props.currentPath);
      if (props.projectPath) {
        formData.append('projectPath', props.projectPath);
      }

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          entry.status = 'error';
          entry.error = body.error || `Upload failed (${res.status})`;
        } else {
          entry.status = 'done';
          emit('upload-done', props.currentPath);
        }
      } catch (err) {
        entry.status = 'error';
        entry.error = err.message || 'Network error';
      }
    }),
  );

  // Auto-clear after 3s when all finished
  const allDone = uploads.value.every(
    (u) => u.status === 'done' || u.status === 'error',
  );
  if (allDone) {
    uploadClearTimer = setTimeout(() => {
      uploads.value = [];
      uploadClearTimer = null;
    }, 3000);
  }
}

defineExpose({
  getScrollTop: () => explorerContentRef.value?.scrollTop ?? 0,
  setScrollTop: (value) => {
    if (explorerContentRef.value) explorerContentRef.value.scrollTop = value;
  },
});

// Lifecycle - properly cleanup event listeners
onMounted(() => {
  document.addEventListener('click', closeContextMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
  if (uploadClearTimer) clearTimeout(uploadClearTimer);
});
</script>

<template>
  <div class="file-explorer">
    <!-- Hidden file input for click-to-upload -->
    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="upload-input-hidden"
      @change="handleFileInputChange"
    />

    <!-- File list -->
    <div
      ref="explorerContentRef"
      class="explorer-content"
      :class="{ 'drag-over': isDragOver }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div v-if="loading" class="explorer-loading">Loading...</div>
      <div v-else-if="!items || items.length === 0" class="explorer-empty">
        <p>Empty folder</p>
      </div>
      <div v-else class="file-list">
        <div
          v-for="item in sortedItems"
          :key="item.path"
          class="file-item"
          :class="{ directory: item.isDirectory }"
          @click="handleItemClick(item)"
          @contextmenu="handleItemRightClick($event, item)"
        >
          <div class="file-icon">
            <svg v-if="item.isDirectory" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <svg v-else-if="item.name.endsWith('.md')" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <span class="file-name">{{ item.name }}</span>
        </div>
      </div>
    </div>

    <!-- Upload button (shown when directory is loaded) -->
    <div v-if="!loading && currentPath" class="upload-bar">
      <button class="upload-btn" @click="triggerFileInput" title="Upload files">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>Upload</span>
      </button>
      <span class="upload-hint">or drag & drop files</span>
    </div>

    <!-- Upload progress list -->
    <div v-if="uploads.length" class="upload-list">
      <div
        v-for="(upload, i) in uploads"
        :key="i"
        class="upload-item"
        :class="upload.status"
      >
        <svg v-if="upload.status === 'uploading'" width="12" height="12" viewBox="0 0 24 24" class="spin">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
        </svg>
        <svg v-else-if="upload.status === 'done'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        <span class="upload-item-name" :title="upload.error || upload.name">{{ upload.name }}</span>
        <span v-if="upload.error" class="upload-item-error">{{ upload.error }}</span>
      </div>
    </div>

    <!-- Drag-over overlay -->
    <div v-if="isDragOver" class="drag-overlay">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span>Drop to upload</span>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      >
        <button v-if="!contextMenu.item?.isDirectory" class="context-menu-item" @click="handleContextAction('reference')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Reference
        </button>
        <button class="context-menu-item" @click="handleContextAction('rename')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Rename
        </button>
        <button class="context-menu-item danger" @click="handleContextAction('delete')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.file-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  position: relative;
}

.explorer-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.explorer-loading,
.explorer-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.file-item:hover {
  background: var(--bg-hover);
}

.file-item.directory {
  color: var(--accent-color);
}

.file-icon {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-item.directory .file-icon {
  color: var(--accent-color);
}

.file-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Context menu */
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: var(--bg-hover);
}

.context-menu-item.danger {
  color: var(--error-color);
}

/* Upload */
.upload-input-hidden {
  display: none;
}

.upload-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.upload-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.upload-hint {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upload-list {
  padding: 4px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.upload-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.upload-item.done {
  color: var(--success-color, #4caf50);
}

.upload-item.error {
  color: var(--error-color);
}

.upload-item.uploading {
  color: var(--text-secondary);
}

.upload-item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upload-item-error {
  font-size: 11px;
  color: var(--error-color);
  flex-shrink: 0;
}

.explorer-content.drag-over {
  outline: 2px dashed var(--accent-color);
  outline-offset: -4px;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
  color: var(--accent-color);
  font-size: 14px;
  font-weight: 500;
  pointer-events: none;
  z-index: 10;
}

/* Spin animation (reuse from existing pattern) */
.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
