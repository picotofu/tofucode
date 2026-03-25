<script setup>
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import FileEditor from '../components/FileEditor.vue';
import { useFilesManager } from '../composables/useFilesManager';
import { useWebSocket } from '../composables/useWebSocket';

const route = useRoute();
const settingsContext = inject('settings');
const sidebar = inject('sidebar');
const { send, onMessage, connected } = useWebSocket();

const notesBasePath = computed(() => settingsContext.notesBasePath());
const autoSave = computed(() => settingsContext.autoSaveFiles());

// No homePath restriction — include paths may be outside the vault.
// The file manager needs to read/write files at arbitrary (user-configured) paths.
const fm = useFilesManager({
  send,
  onMessage,
});

const {
  openedFile,
  fileSize,
  totalLines,
  totalChars,
  fileEditorRef,
  handleFileSelect,
  handleFileSave,
  handleFileClose,
  handleFileDownload,
} = fm;

// Track daily note creation state
// Phase: 'idle' | 'reading' | 'creating' | 'template'
const dailyPhase = ref('idle');
const pendingDailyPath = ref('');

// Daily note template
function dailyNoteTemplate(dateStr) {
  return `# ${dateStr}\n`;
}

// Open or create a daily note (idempotent)
function openDailyNote(dateStr) {
  if (!notesBasePath.value) return;
  const dailyPath = `${notesBasePath.value}/daily/${dateStr}.md`;

  dailyPhase.value = 'reading';
  pendingDailyPath.value = dailyPath;

  // Try to read the file first
  openedFile.value = { path: dailyPath, content: '', loading: true };
  send({ type: 'files:read', path: dailyPath });
}

// Listen for daily note creation flow events
const unsubDailyCreate = onMessage((msg) => {
  if (dailyPhase.value === 'idle') return;
  const targetPath = pendingDailyPath.value;
  if (!targetPath) return;

  // Phase: reading — waiting for initial read result
  if (dailyPhase.value === 'reading') {
    if (msg.type === 'files:read:result' && msg.path === targetPath) {
      // File exists — useFilesManager already populated openedFile
      dailyPhase.value = 'idle';
      pendingDailyPath.value = '';
      return;
    }
    if (msg.type === 'files:read:error' && msg.path === targetPath) {
      // File doesn't exist — create daily/ dir then the file
      dailyPhase.value = 'creating';
      const dailyDir = `${notesBasePath.value}/daily`;
      send({ type: 'files:create', path: dailyDir, isDirectory: true });
      // Create the file after dir creation settles
      setTimeout(() => {
        fm.fileModals.value.pendingFileToOpen = targetPath;
        send({ type: 'files:create', path: targetPath });
      }, 200);
      return;
    }
  }

  // Phase: creating — file was created, waiting for read result to apply template
  if (dailyPhase.value === 'creating') {
    if (msg.type === 'files:read:result' && msg.path === targetPath) {
      if (msg.content === '') {
        // Newly created empty file — write template
        dailyPhase.value = 'template';
        const dateStr = targetPath.split('/').pop().replace('.md', '');
        const template = dailyNoteTemplate(dateStr);
        send({ type: 'files:write', path: targetPath, content: template });
        openedFile.value = {
          path: targetPath,
          content: template,
          size: template.length,
          isBinary: false,
          binaryReason: null,
          loading: false,
        };
        dailyPhase.value = 'idle';
        pendingDailyPath.value = '';
      } else {
        // File was concurrently created with content — just show it
        dailyPhase.value = 'idle';
        pendingDailyPath.value = '';
      }
    }
  }
});

onUnmounted(() => unsubDailyCreate());

// Route-driven file loading
const notePath = computed(() => {
  const p = route.params.notePath;
  if (!p) return '';
  const joined = Array.isArray(p) ? p.join('/') : p;
  return joined.replace(/\/+$/, '');
});

function loadNoteFromRoute(path, basePath) {
  if (!path) {
    if (openedFile.value) handleFileClose();
    return;
  }

  // Resolve full path — __abs prefix means absolute path (include paths)
  let fullPath;
  if (path.startsWith('__abs/')) {
    fullPath = `/${path.slice('__abs/'.length)}`;
  } else if (path.startsWith('/')) {
    fullPath = path;
  } else {
    if (!basePath) return;
    fullPath = `${basePath.replace(/\/+$/, '')}/${path}`;
  }

  if (fullPath.endsWith('.md')) {
    // Check if this is a daily note that might need creation
    const dailyMatch = fullPath.match(/\/daily\/(\d{4}-\d{2}-\d{2})\.md$/);
    if (dailyMatch) {
      openDailyNote(dailyMatch[1]);
    } else {
      handleFileSelect({ path: fullPath });
    }
  }
}

// Watch with immediate: true fires both on first setup and on subsequent changes.
// This handles all cases:
// - First mount from another view (notePath/notesBasePath already set → fires immediately)
// - notesBasePath loading after mount (settings arrive → watch re-fires)
// - Navigating between notes within the notes view (notePath changes → watch re-fires)
watch(
  [notePath, notesBasePath],
  ([path, basePath]) => {
    loadNoteFromRoute(path, basePath);
  },
  { immediate: true },
);

// Retry load when WS reconnects in case the initial send was dropped
watch(connected, async (isConnected) => {
  if (isConnected && notePath.value && openedFile.value?.loading) {
    await nextTick();
    loadNoteFromRoute(notePath.value, notesBasePath.value);
  }
});

// Strip trailing slash from path for display
const displayPath = computed(
  () => openedFile.value?.path?.replace(/\/$/, '') ?? '',
);

const configured = computed(() => !!notesBasePath.value);
</script>

<template>
  <div class="notes-view">
    <!-- Main content area -->
    <main class="notes-content">
      <FileEditor
        v-if="openedFile"
        ref="fileEditorRef"
        class="notes-editor"
        :file-path="openedFile.path"
        :content="openedFile.content"
        :loading="openedFile.loading"
        :is-binary="openedFile.isBinary"
        :binary-reason="openedFile.binaryReason"
        :file-size="openedFile.size"
        :auto-save="autoSave"
        @save="handleFileSave"
      />

      <!-- Empty state -->
      <div v-else-if="configured" class="notes-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <p class="empty-title">No note selected</p>
        <p class="empty-subtitle">Select a note from the sidebar or create a daily note</p>
      </div>

      <!-- Not configured state -->
      <div v-else class="notes-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <p class="empty-title">Notes not configured</p>
        <p class="empty-subtitle">Set a notes vault path in Settings → Notes</p>
      </div>
    </main>

    <!-- Bottom footer bar -->
    <div class="notes-footer-bar">
      <!-- Hamburger: toggle sidebar -->
      <button class="footer-btn" title="Toggle sidebar" @click="sidebar?.toggle()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>

      <!-- File path (truncated from left so filename is always visible) -->
      <span v-if="openedFile" class="footer-path" :title="displayPath">{{ displayPath }}</span>
      <span v-else class="footer-path footer-path--empty">Notes</span>

      <!-- Stats — hidden on mobile -->
      <span v-if="openedFile && !openedFile.loading" class="footer-stats">
        <span class="stat-item" :title="`File size: ${fileSize}`">{{ fileSize }}</span>
        <span class="stat-item" :title="`Total lines: ${totalLines}`">≡ {{ totalLines }}</span>
        <span class="stat-item" :title="`Total characters: ${totalChars}`">∑ {{ totalChars }}</span>
      </span>

      <!-- Dirty indicator -->
      <span v-if="fileEditorRef?.isDirty" class="footer-dirty" title="Unsaved changes">*</span>

      <!-- TOC toggle -->
      <button
        v-if="openedFile && fileEditorRef?.hasToc"
        class="footer-btn"
        :class="{ active: fileEditorRef?.tocVisible }"
        title="Toggle table of contents"
        @click="fileEditorRef?.toggleToc()"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="15" y2="12"/>
          <line x1="3" y1="18" x2="18" y2="18"/>
        </svg>
      </button>

      <!-- Download -->
      <button
        v-if="openedFile && !openedFile.loading && openedFile.content"
        class="footer-btn"
        title="Download"
        @click="handleFileDownload"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>

      <!-- Save -->
      <button
        v-if="openedFile"
        class="footer-btn"
        :disabled="!fileEditorRef?.isDirty || fileEditorRef?.isSaving"
        title="Save (Cmd+S)"
        @click="fileEditorRef?.save()"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.notes-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.notes-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.notes-editor {
  flex: 1;
  min-height: 0;
}

/* Bottom footer bar */
.notes-footer-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  height: 44px;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.footer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.footer-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.footer-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.footer-btn.active {
  color: var(--accent-color);
}

.footer-path {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.footer-path--empty {
  opacity: 0.5;
}

.footer-stats {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.stat-item {
  white-space: nowrap;
}

.footer-dirty {
  color: var(--accent-color);
  font-weight: bold;
  font-size: 16px;
  flex-shrink: 0;
  line-height: 1;
}

.notes-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  padding: 24px;
}

.empty-title {
  font-size: 15px;
  font-weight: 500;
  margin: 8px 0 0;
}

.empty-subtitle {
  font-size: 13px;
  opacity: 0.7;
}

@media (max-width: 768px) {
  .footer-stats {
    display: none;
  }
}
</style>
