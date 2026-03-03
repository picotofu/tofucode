<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
  projectPath: {
    type: String,
    required: false,
    default: '',
  },
  sendAndWait: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits(['close']);
const loading = ref(true);
const files = ref([]);
const diffs = ref({});
const selectedFile = ref(null);
const error = ref(null);

// Mobile navigation: 'list' | 'diff'
const mobileView = ref('list');

const diffViewerRef = ref(null);

onMounted(() => {
  loadGitDiff();
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

async function loadGitDiff() {
  loading.value = true;
  error.value = null;

  // Validate projectPath before making the request
  if (!props.projectPath) {
    error.value = 'No project selected';
    loading.value = false;
    return;
  }

  try {
    const response = await props.sendAndWait(
      { type: 'get_git_diff', projectPath: props.projectPath },
      'git_diff',
    );

    files.value = response.files || [];
    diffs.value = response.diffs || {};
    if (response.error) {
      error.value = response.error;
    }
    // Auto-select first file on desktop
    if (files.value.length > 0) {
      selectedFile.value = files.value[0].path;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

// All files' parsed diffs for the combined diff view
const allParsedDiffs = computed(() => {
  return files.value.map((file) => ({
    file,
    lines: diffs.value[file.path] ? parseDiff(diffs.value[file.path]) : null,
  }));
});

// Selected file's parsed diff (desktop single-file view)
const selectedDiff = computed(() => {
  if (!selectedFile.value || !diffs.value[selectedFile.value]) {
    return null;
  }
  return parseDiff(diffs.value[selectedFile.value]);
});

function parseDiff(diffText) {
  if (!diffText) return null;

  const lines = diffText.split('\n');
  const parsedLines = [];

  for (const line of lines) {
    let type = 'unchanged';
    let content = line;

    if (line.startsWith('+++') || line.startsWith('---')) {
      type = 'header';
    } else if (line.startsWith('@@')) {
      type = 'hunk';
    } else if (line.startsWith('+')) {
      type = 'added';
      content = line.substring(1); // Remove the leading +
    } else if (line.startsWith('-')) {
      type = 'removed';
      content = line.substring(1); // Remove the leading -
    }

    parsedLines.push({ content, type });
  }

  return parsedLines;
}

function fileAnchorId(filePath) {
  // Create a safe DOM id from the file path
  return `diff-file-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

async function selectFile(path) {
  selectedFile.value = path;
  // On mobile: switch to diff view and scroll to the file section
  mobileView.value = 'diff';
  await nextTick();
  const anchorId = fileAnchorId(path);
  const el = diffViewerRef.value?.querySelector(`#${anchorId}`);
  if (el) {
    el.scrollIntoView({ block: 'start' });
  }
}

function goBackToList() {
  mobileView.value = 'list';
}

function getStatusColor(status) {
  switch (status) {
    case 'A':
      return '#22c55e';
    case 'M':
      return '#f59e0b';
    case 'D':
      return '#ef4444';
    case 'R':
      return '#3b82f6';
    default:
      return 'var(--text-secondary)';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'A':
      return 'Added';
    case 'M':
      return 'Modified';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case '?':
      return 'Untracked';
    default:
      return 'Changed';
  }
}

function close() {
  emit('close');
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    // On mobile diff view, Escape goes back to list first
    if (mobileView.value === 'diff') {
      goBackToList();
    } else {
      close();
    }
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-container">
      <!-- Header -->
      <div class="modal-header">
        <!-- Mobile back button (only in diff view) -->
        <button v-if="mobileView === 'diff'" class="back-btn mobile-only" @click="goBackToList">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <h2 class="modal-title">
          <span v-if="mobileView === 'diff' && selectedFile" class="mobile-only title-file">{{
            selectedFile
          }}</span>
          <span v-else>Git Changes</span>
        </h2>
        <button class="close-btn" @click="close">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div v-if="loading" class="loading-state">
          <span class="spinner"></span>
          <span>Loading changes...</span>
        </div>

        <div v-else-if="error" class="error-state">
          <span class="error-icon">⚠</span>
          <span>{{ error }}</span>
        </div>

        <div v-else-if="files.length === 0" class="empty-state">
          <span class="empty-icon">✓</span>
          <span>No changes to display</span>
        </div>

        <div v-else class="diff-layout">
          <!-- File list sidebar (desktop always visible; mobile only in 'list' view) -->
          <div class="file-list" :class="{ 'mobile-hidden': mobileView === 'diff' }">
            <div class="file-list-header">
              <span class="file-count">{{ files.length }} changed files</span>
            </div>
            <div
              v-for="file in files"
              :key="file.path"
              :class="['file-item', { active: selectedFile === file.path }]"
              @click="selectFile(file.path)"
            >
              <span
                class="file-status"
                :style="{ color: getStatusColor(file.status) }"
                :title="getStatusLabel(file.status)"
              >
                {{ file.status }}
              </span>
              <span class="file-path">{{ file.path }}</span>
              <span class="file-stats">
                <span v-if="file.additions > 0" class="additions">+{{ file.additions }}</span>
                <span v-if="file.deletions > 0" class="deletions">-{{ file.deletions }}</span>
              </span>
              <!-- Mobile chevron -->
              <svg
                class="mobile-only file-chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>

          <!-- Diff viewer (desktop: single selected file; mobile: all files, 'diff' view only) -->
          <div
            ref="diffViewerRef"
            class="diff-viewer"
            :class="{ 'mobile-hidden': mobileView === 'list' }"
          >
            <!-- Desktop: single selected file diff -->
            <template class="desktop-only">
              <div v-if="!selectedFile" class="diff-placeholder desktop-only">
                Select a file to view changes
              </div>
              <div v-else-if="!selectedDiff" class="diff-placeholder desktop-only">
                No diff available for this file
              </div>
              <div v-else class="diff-scroll desktop-only">
                <div class="diff-content">
                  <div
                    v-for="(line, index) in selectedDiff"
                    :key="index"
                    :class="['diff-line', line.type]"
                  >
                    <span class="line-content">{{ line.content }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- Mobile: all files concatenated -->
            <div class="mobile-only mobile-all-diffs">
              <div v-for="entry in allParsedDiffs" :key="entry.file.path" class="mobile-file-section">
                <div :id="fileAnchorId(entry.file.path)" class="mobile-file-heading">
                  <span
                    class="file-status"
                    :style="{ color: getStatusColor(entry.file.status) }"
                    :title="getStatusLabel(entry.file.status)"
                  >
                    {{ entry.file.status }}
                  </span>
                  <span class="mobile-file-heading-path">{{ entry.file.path }}</span>
                  <span class="file-stats">
                    <span v-if="entry.file.additions > 0" class="additions">+{{ entry.file.additions }}</span>
                    <span v-if="entry.file.deletions > 0" class="deletions">-{{ entry.file.deletions }}</span>
                  </span>
                </div>
                <div v-if="entry.lines" class="diff-scroll">
                  <div class="diff-content">
                    <div
                      v-for="(line, index) in entry.lines"
                      :key="index"
                      :class="['diff-line', line.type]"
                    >
                      <span class="line-content">{{ line.content }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="diff-placeholder-inline">No diff available</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  width: 100%;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  min-width: 0;
}

.modal-title {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  min-width: 0;
}

.title-file {
  font-size: 13px;
  font-family: var(--font-mono);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.back-btn,
.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

.back-btn:hover,
.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Loading/Empty/Error states */
.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-color);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-icon,
.empty-icon {
  font-size: 32px;
}

/* Diff layout */
.diff-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* File list */
.file-list {
  width: 320px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  overflow-y: auto;
  flex-shrink: 0;
}

.file-list-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.file-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
  transition: background 0.15s;
}

.file-item:hover {
  background: var(--bg-hover);
}

.file-item.active {
  background: var(--bg-tertiary);
  border-left: 3px solid var(--primary-color);
}

.file-status {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}

.file-path {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-stats {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}

.additions {
  color: #22c55e;
}

.deletions {
  color: #ef4444;
}

.file-chevron {
  flex-shrink: 0;
  color: var(--text-secondary);
}

/* Diff viewer */
.diff-viewer {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--bg-primary);
  min-width: 0;
}

.diff-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

/* Scroll container wrapping diff-content — horizontal scroll scoped per section */
.diff-scroll {
  overflow-x: auto;
  overflow-y: visible;
}

.diff-content {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  display: block;
  min-width: fit-content;
}

.diff-line {
  display: flex;
  padding: 0 16px;
  min-height: 21px;
  white-space: pre;
}

.diff-line.header {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-weight: 500;
  padding: 4px 16px;
}

.diff-line.hunk {
  background: rgba(96, 165, 250, 0.1);
  color: #60a5fa;
  padding: 4px 16px;
}

.diff-line.added {
  background: rgba(34, 197, 94, 0.1);
  color: var(--text-primary);
}

.diff-line.added::before {
  content: '+';
  color: #22c55e;
  font-weight: 600;
  margin-right: 8px;
}

.diff-line.removed {
  background: rgba(239, 68, 68, 0.1);
  color: var(--text-primary);
}

.diff-line.removed::before {
  content: '-';
  color: #ef4444;
  font-weight: 600;
  margin-right: 8px;
}

.diff-line.unchanged {
  color: var(--text-secondary);
}

.diff-line.unchanged::before {
  content: ' ';
  margin-right: 8px;
}

.line-content {
  white-space: pre;
}

/* Mobile-only / desktop-only visibility helpers */
.mobile-only {
  display: none;
}

/* Mobile all-files diff */
.mobile-all-diffs {
  display: none;
}

.mobile-file-section {
  border-bottom: 2px solid var(--border-color);
}

.mobile-file-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 1;
}

.mobile-file-heading-path {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-placeholder-inline {
  padding: 12px 16px;
  color: var(--text-secondary);
  font-size: 13px;
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
  }

  .modal-container {
    max-width: 100%;
    max-height: 100dvh;
    height: 100dvh;
    border-radius: 0;
  }

  .mobile-only {
    display: flex;
  }

  .desktop-only {
    display: none !important;
  }

  /* Switch between screens */
  .file-list {
    width: 100%;
    border-right: none;
    flex: 1;
    max-height: none;
  }

  .file-list.mobile-hidden {
    display: none;
  }

  .diff-viewer {
    flex: 1;
    width: 100%;
    overflow-x: auto;
  }

  .diff-viewer.mobile-hidden {
    display: none;
  }

  .mobile-all-diffs {
    display: block;
  }

  .diff-layout {
    flex-direction: column;
  }
}
</style>
