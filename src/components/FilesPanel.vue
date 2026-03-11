<script setup>
import { nextTick, ref } from 'vue';
import FileEditor from './FileEditor.vue';
import FileExplorer from './FileExplorer.vue';

/**
 * FilesPanel — shared files UI consumed by both ChatView (session files tab)
 * and the standalone FilesView.
 *
 * Props:
 *   manager      — return value from useFilesManager()
 *   showReference — whether the "Reference" context-menu action is shown (default true)
 *
 * Emits:
 *   reference(item) — forwarded from FileExplorer when showReference is true
 */

const props = defineProps({
  manager: {
    type: Object,
    required: true,
  },
  showReference: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['reference']);

// Destructure manager for use in template
const {
  filesCurrentPath,
  filesRootPath,
  filesFilter,
  filesSearchResults,
  filesSearching,
  filteredFilesItems,
  filesBreadcrumbs,
  openedFile,
  openedFileName,
  fileSize,
  totalLines,
  totalChars,
  isHtmlFile,
  htmlRenderMode,
  fileEditorRef,
  fileExplorerRef,
  fileModals,
  showDotfiles,
  mdMode,
  filesLoading,
  autoSave,

  goUpDirectory,
  handleFilesNavigate,
  handleFileSelect,
  handleFileSave,
  handleFileClose,
  handleFileDownload,
  handleRename,
  handleDelete,
  handleEditPath,
  cancelEditPath,
  confirmEditPath,
  confirmCreateFile,
  confirmCreateFolder,
  confirmRename,
  confirmDelete,
} = props.manager;

// Path edit input ref — local to this component
const pathEditInputRef = ref(null);
const createFileInputRef = ref(null);

// Wrap handleEditPath to also focus the input after the form renders
function startEditPath() {
  handleEditPath();
  nextTick(() => {
    pathEditInputRef.value?.focus();
    pathEditInputRef.value?.select();
  });
}

// Reference — emit up to parent (ChatView injects into chat input; standalone noop)
function onReferenceItem(item) {
  if (props.showReference) {
    emit('reference', item);
  }
}
</script>

<template>
  <!-- Main content area: FileEditor or FileExplorer -->
  <main class="files-mode">
    <FileEditor
      v-if="openedFile"
      ref="fileEditorRef"
      :file-path="openedFile.path"
      :content="openedFile.content"
      :loading="openedFile.loading"
      :is-binary="openedFile.isBinary"
      :binary-reason="openedFile.binaryReason"
      :file-size="openedFile.size"
      :auto-save="autoSave"
      :render-html="htmlRenderMode"
      @save="handleFileSave"
      @close="handleFileClose"
    />
    <FileExplorer
      v-else
      ref="fileExplorerRef"
      :current-path="filesCurrentPath"
      :items="filesSearchResults ?? filteredFilesItems"
      :presorted="filesSearchResults !== null"
      :loading="filesLoading || filesSearching"
      :show-reference="showReference"
      @navigate="handleFilesNavigate"
      @select-file="handleFileSelect"
      @reference="onReferenceItem"
      @rename="handleRename"
      @delete="handleDelete"
      @upload-done="handleFilesNavigate"
    />
  </main>

  <!-- Editor header — shown only when a file is open -->
  <div v-if="openedFile" class="editor-header">
    <span class="editor-file-name">{{ openedFileName }}</span>
    <span v-if="fileEditorRef?.isDirty" class="editor-dirty-indicator" title="Unsaved changes">*</span>
    <div class="editor-header-spacer" />
    <span class="editor-stats">
      <span class="stat-item" :title="`File size: ${fileSize}`">{{ fileSize }}</span>
      <span class="stat-item" :title="`Total lines: ${totalLines}`">≡ {{ totalLines }}</span>
      <span class="stat-item" :title="`Total characters: ${totalChars}`">∑ {{ totalChars }}</span>
    </span>
    <button
      v-if="fileEditorRef?.hasToc"
      class="action-btn toc-toggle-btn"
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
    <button
      v-if="isHtmlFile && !openedFile.loading && !openedFile.isBinary"
      class="action-btn"
      :class="{ active: htmlRenderMode }"
      :title="htmlRenderMode ? 'View source' : 'Render HTML'"
      @click="htmlRenderMode = !htmlRenderMode"
    >
      <svg v-if="!htmlRenderMode" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    </button>
    <button
      v-if="!openedFile.loading && openedFile.content"
      class="action-btn"
      title="Download"
      @click="handleFileDownload"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
    <button
      class="action-btn"
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
    <button
      class="action-btn"
      title="Close"
      @click="fileEditorRef?.close()"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  <!-- Breadcrumb nav + toolbar actions (only when no file is open) -->
  <div v-if="!openedFile" class="files-explorer-header">
    <div class="files-breadcrumb">
      <button
        class="breadcrumb-btn"
        :disabled="!filesCurrentPath || filesCurrentPath === '/' || filesCurrentPath === filesRootPath"
        title="Go up"
        @click="goUpDirectory"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <!-- Inline path editing -->
      <form v-if="fileModals.editPath" class="breadcrumb-edit-form" @submit.prevent="confirmEditPath">
        <input
          ref="pathEditInputRef"
          v-model="fileModals.editPathValue"
          type="text"
          class="breadcrumb-edit-input"
          placeholder="/path/to/folder"
          @keydown.escape.prevent="cancelEditPath"
        />
      </form>
      <!-- Breadcrumb path display -->
      <div v-else class="breadcrumb-scroll">
        <span class="breadcrumb-path">
          <template v-if="!filesCurrentPath || filesCurrentPath === '/'">/</template>
          <template v-else>
            <span
              v-for="(crumb, index) in filesBreadcrumbs"
              :key="index"
              class="breadcrumb-item"
            >
              <span class="breadcrumb-separator">/</span>
              <button v-if="crumb.navigable" class="breadcrumb-link" @click.stop="handleFilesNavigate(crumb.path)">
                {{ crumb.name }}
              </button>
              <button v-else class="breadcrumb-link breadcrumb-static" :title="`Top level: ${filesRootPath}`" @click.stop="handleFilesNavigate(filesRootPath)">
                {{ crumb.name }}
              </button>
            </span>
          </template>
        </span>
      </div>
      <!-- Edit mode: check (submit) button; view mode: pencil button -->
      <button v-if="fileModals.editPath" class="breadcrumb-btn" title="Go to path" @click="confirmEditPath">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </button>
      <button v-else class="breadcrumb-btn" title="Edit path" @click="startEditPath">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>
    <!-- Toolbar actions: dotfiles, new file, new folder, MD mode -->
    <div class="files-toolbar">
      <button
        class="action-btn"
        :class="{ active: showDotfiles }"
        title="Show dotfiles"
        @click="showDotfiles = !showDotfiles"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="1"/>
        </svg>
      </button>
      <button
        class="action-btn"
        title="New file"
        @click="fileModals.createFile = true"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      </button>
      <button
        class="action-btn"
        title="New folder"
        @click="fileModals.createFolder = true"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
      </button>
      <button
        class="action-btn md-btn"
        :class="{ active: mdMode }"
        title="Markdown mode - filter .md files only with auto-save"
        @click="mdMode = !mdMode"
      >
        MD
      </button>
    </div>
  </div>

  <!-- Search input -->
  <div class="files-filter-form">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon">
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.35-4.35"/>
    </svg>
    <input
      v-model="filesFilter"
      type="text"
      class="files-filter-input"
      placeholder="Search files... (fuzzy & glob: *.md)"
    />
    <span v-if="filesSearching" class="files-filter-searching">Searching...</span>
    <button
      v-if="filesFilter"
      type="button"
      class="clear-btn"
      title="Clear search"
      @click="filesFilter = ''"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  <!-- File operation modals -->
  <Teleport to="body">
    <!-- Create file -->
    <div v-if="fileModals.createFile" class="modal-overlay" @click="fileModals.createFile = false">
      <div class="modal" @click.stop>
        <h3>Create New File</h3>
        <form @submit.prevent="confirmCreateFile">
          <input
            ref="createFileInputRef"
            v-model="fileModals.createFileName"
            type="text"
            placeholder="filename.txt"
            class="modal-input"
            autofocus
          />
          <div class="modal-actions">
            <button type="button" class="modal-btn cancel" @click="fileModals.createFile = false">Cancel</button>
            <button type="submit" class="modal-btn confirm">Create</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Create folder -->
    <div v-if="fileModals.createFolder" class="modal-overlay" @click="fileModals.createFolder = false">
      <div class="modal" @click.stop>
        <h3>Create New Folder</h3>
        <form @submit.prevent="confirmCreateFolder">
          <input
            v-model="fileModals.createFolderName"
            type="text"
            placeholder="folder-name"
            class="modal-input"
            autofocus
          />
          <div class="modal-actions">
            <button type="button" class="modal-btn cancel" @click="fileModals.createFolder = false">Cancel</button>
            <button type="submit" class="modal-btn confirm">Create</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Rename -->
    <div v-if="fileModals.rename" class="modal-overlay" @click="fileModals.rename = null">
      <div class="modal" @click.stop>
        <h3>Rename</h3>
        <form @submit.prevent="confirmRename">
          <input
            v-model="fileModals.renameNewName"
            type="text"
            :placeholder="fileModals.rename?.name"
            class="modal-input"
            autofocus
          />
          <div class="modal-actions">
            <button type="button" class="modal-btn cancel" @click="fileModals.rename = null">Cancel</button>
            <button type="submit" class="modal-btn confirm">Rename</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Delete confirmation -->
    <div v-if="fileModals.delete" class="modal-overlay" @click="fileModals.delete = null">
      <div class="modal" @click.stop>
        <h3>Delete {{ fileModals.delete?.isDirectory ? 'Folder' : 'File' }}</h3>
        <p>Are you sure you want to delete <strong>{{ fileModals.delete?.name }}</strong>?</p>
        <p v-if="fileModals.delete?.isDirectory" class="warning">This will delete the folder and all its contents!</p>
        <div class="modal-actions">
          <button type="button" class="modal-btn cancel" @click="fileModals.delete = null">Cancel</button>
          <button type="button" class="modal-btn danger" @click="confirmDelete">Delete</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── Files main area ────────────────────────────────────────────────────── */
.files-mode {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ─── Editor header ──────────────────────────────────────────────────────── */
.editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-top: 1px solid var(--border-color);
}

.editor-file-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.editor-dirty-indicator {
  color: var(--warning-color);
  font-size: 14px;
  font-weight: bold;
  line-height: 1;
  flex-shrink: 0;
  margin-left: -4px;
}

.editor-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.editor-stats .stat-item {
  white-space: nowrap;
}

.editor-header-spacer {
  flex: 1;
  min-width: 0;
}

.editor-header .action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s, opacity 0.15s;
  flex-shrink: 0;
}

.editor-header .action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.editor-header .action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.editor-header .action-btn.active {
  color: var(--text-primary);
}

/* ─── Breadcrumb nav ─────────────────────────────────────────────────────── */
.files-explorer-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 16px 6px;
  background: var(--bg-primary);
}

.files-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.files-explorer-header .breadcrumb-scroll {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--text-muted) transparent;
  padding: 4px 6px;
}

.breadcrumb-edit-form {
  flex: 1;
  min-width: 0;
}

.breadcrumb-edit-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 13px;
  font-family: var(--font-mono);
  background: var(--bg-primary);
  border: 1px solid var(--text-muted);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
}

.breadcrumb-edit-input:focus {
  border-color: var(--text-primary);
}

.files-explorer-header .breadcrumb-scroll::-webkit-scrollbar {
  height: 4px;
}

.files-explorer-header .breadcrumb-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.files-explorer-header .breadcrumb-scroll::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 2px;
}

.files-explorer-header .breadcrumb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.files-explorer-header .breadcrumb-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.files-explorer-header .breadcrumb-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.files-explorer-header .breadcrumb-path {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.files-explorer-header .breadcrumb-separator {
  color: var(--text-muted);
  margin: 0 4px;
}

.files-explorer-header .breadcrumb-link {
  color: var(--text-secondary);
  background: transparent;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.files-explorer-header .breadcrumb-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.files-explorer-header .breadcrumb-static {
  opacity: 0.5;
}

.files-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

@media (max-width: 639px) {
  .files-explorer-header {
    flex-wrap: wrap;
  }

  .files-toolbar {
    order: -1;
    width: 100%;
    justify-content: flex-end;
  }

  .files-breadcrumb {
    width: 100%;
    flex: none;
  }
}

.files-explorer-header .action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.files-explorer-header .action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.files-explorer-header .action-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.action-btn svg {
  flex-shrink: 0;
}

.md-btn {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 4px 6px;
}

/* ─── Search form ────────────────────────────────────────────────────────── */
.files-filter-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.files-filter-form:focus-within {
  border-color: var(--text-muted);
}

.files-filter-form .search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.files-filter-input {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
  color: var(--text-primary);
  border: none;
  outline: none;
  min-width: 0;
}

.files-filter-input::placeholder {
  color: var(--text-muted);
}

.files-filter-searching {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  flex-shrink: 0;
}

.files-filter-form .clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.files-filter-form .clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ─── Modal styles ───────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.modal h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal p {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.modal p.warning {
  color: var(--error-color);
  font-weight: 500;
}

.modal-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  margin-bottom: 16px;
  outline: none;
  transition: border-color 0.15s;
}

.modal-input:focus {
  border-color: var(--accent-color);
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.modal-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.modal-btn.cancel {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.modal-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-btn.confirm {
  background: var(--text-primary);
  color: var(--bg-primary);
}

.modal-btn.confirm:hover {
  opacity: 0.9;
}

.modal-btn.danger {
  background: var(--error-color);
  color: #fff;
}

.modal-btn.danger:hover {
  opacity: 0.9;
}
</style>
