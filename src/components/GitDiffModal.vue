<script setup>
import { computed, onMounted, ref } from 'vue';
import { useWebSocket } from '../composables/useWebSocket';

const props = defineProps({
  projectPath: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close']);

const { sendAndWait } = useWebSocket();
const loading = ref(true);
const files = ref([]);
const diffs = ref({});
const selectedFile = ref(null);
const error = ref(null);
const showFileList = ref(true);

onMounted(() => {
  loadGitDiff();
});

async function loadGitDiff() {
  loading.value = true;
  error.value = null;

  try {
    const response = await sendAndWait(
      { type: 'get_git_diff', projectPath: props.projectPath },
      'git_diff',
    );

    files.value = response.files || [];
    diffs.value = response.diffs || {};
    if (response.error) {
      error.value = response.error;
    }
    // Auto-select first file
    if (files.value.length > 0) {
      selectedFile.value = files.value[0].path;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

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

function selectFile(path) {
  selectedFile.value = path;
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
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-container">
      <div class="modal-header">
        <h2 class="modal-title">Git Changes</h2>
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
          <!-- Mobile file list toggle -->
          <button class="mobile-toggle" @click="showFileList = !showFileList">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
            <span>{{ showFileList ? 'Hide' : 'Show' }} Files ({{ files.length }})</span>
          </button>

          <!-- File list sidebar -->
          <div class="file-list" :class="{ hidden: !showFileList }">
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
                <span class="additions" v-if="file.additions > 0">+{{ file.additions }}</span>
                <span class="deletions" v-if="file.deletions > 0">-{{ file.deletions }}</span>
              </span>
            </div>
          </div>

          <!-- Diff viewer -->
          <div class="diff-viewer">
            <div v-if="!selectedFile" class="diff-placeholder">
              Select a file to view changes
            </div>
            <div v-else-if="!selectedDiff" class="diff-placeholder">
              No diff available for this file
            </div>
            <div v-else class="diff-content">
              <div
                v-for="(line, index) in selectedDiff"
                :key="index"
                :class="['diff-line', line.type]"
              >
                <span class="line-content">{{ line.content }}</span>
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
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

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
  /* Removed overflow: hidden - children need to scroll independently */
}

/* File list */
.file-list {
  width: 320px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  overflow-y: auto;
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

/* Diff viewer */
.diff-viewer {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--bg-primary);
}

.diff-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

.diff-content {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  /* Changed from inline-block to block for proper scrolling */
  display: block;
  min-width: fit-content;
}

.diff-line {
  display: flex;
  padding: 0 16px;
  min-height: 21px;
  white-space: pre-wrap;
  word-break: break-all;
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

/* Mobile toggle button */
.mobile-toggle {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bg-secondary);
  border: none;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
  transition: background 0.15s;
}

.mobile-toggle:hover {
  background: var(--bg-hover);
}

.mobile-toggle svg {
  flex-shrink: 0;
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
  }

  .modal-container {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .mobile-toggle {
    display: flex;
  }

  .diff-layout {
    flex-direction: column;
  }

  .file-list {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    max-height: 40vh;
    overflow-y: auto;
  }

  .file-list.hidden {
    display: none;
  }

  .diff-viewer {
    width: 100%;
  }
}
</style>
