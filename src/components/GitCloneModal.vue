<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWebSocket } from '../composables/useWebSocket';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  initialTargetDir: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['close', 'cloned']);

const { send, onMessage, currentFolder } = useWebSocket();

// Form state
const repoUrl = ref('');
const targetDir = ref('');
const sshKeyPath = ref('');

// Clone status
const status = ref('idle'); // 'idle' | 'cloning' | 'done' | 'error'
const outputLines = ref([]);
const errorMessage = ref('');
const processId = ref(null);

// Output pane ref for auto-scroll
const outputRef = ref(null);

// Unsubscribe function for the message listener
let unsubscribe = null;

// Pre-fill targetDir when dialog opens
// Priority: initialTargetDir prop > currentFolder (from folder browser, defaults to $HOME)
watch(
  () => [props.show, props.initialTargetDir],
  ([isShow, dir]) => {
    if (isShow) {
      targetDir.value = dir || currentFolder.value || '';
    }
  },
  { immediate: true },
);

// Also watch currentFolder reactively — it may arrive async (server responds to
// browse_folder request triggered by openCloneDialog when currentFolder was null)
watch(currentFolder, (folder) => {
  if (props.show && folder && !targetDir.value) {
    targetDir.value = folder;
  }
});

// Reset when dialog closes
watch(
  () => props.show,
  (isShow) => {
    if (!isShow) {
      cleanup();
    }
  },
);

function cleanup() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  reset();
}

function reset() {
  status.value = 'idle';
  outputLines.value = [];
  errorMessage.value = '';
  processId.value = null;
  repoUrl.value = '';
  sshKeyPath.value = '';
  // Keep targetDir — user may want to clone another repo to the same place
}

function handleClose() {
  if (status.value === 'cloning') {
    // Don't close during active clone — user must wait or the clone will continue
    // but they lose the progress view. Let them close if they want.
    const confirmed = window.confirm('Clone is in progress. Close anyway?');
    if (!confirmed) return;
  }
  cleanup();
  emit('close');
}

function handleKeydown(e) {
  if (e.key === 'Escape' && props.show) {
    e.preventDefault();
    if (status.value !== 'cloning') {
      handleClose();
    }
  }
}

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => document.removeEventListener('keydown', handleKeydown));

async function startClone() {
  if (!repoUrl.value.trim() || !targetDir.value.trim()) return;

  status.value = 'cloning';
  outputLines.value = [];
  errorMessage.value = '';
  processId.value = null;

  // Subscribe to clone events
  unsubscribe = onMessage((msg) => {
    if (msg.type === 'git_clone:started') {
      processId.value = msg.processId;
    } else if (msg.type === 'git_clone:output') {
      // Filter by processId once we have it
      if (processId.value && msg.processId !== processId.value) return;
      outputLines.value.push({ stream: msg.stream, text: msg.data });
      nextTick(() => {
        if (outputRef.value) {
          outputRef.value.scrollTop = outputRef.value.scrollHeight;
        }
      });
    } else if (msg.type === 'git_clone:done') {
      if (processId.value && msg.processId !== processId.value) return;
      status.value = 'done';
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      emit('cloned', {
        projectSlug: msg.projectSlug,
        projectName: msg.projectName,
        projectPath: msg.projectPath,
      });
    } else if (msg.type === 'git_clone:error') {
      if (processId.value && msg.processId !== processId.value) return;
      status.value = 'error';
      errorMessage.value = msg.message || 'Clone failed';
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }
  });

  send({
    type: 'git_clone',
    repoUrl: repoUrl.value.trim(),
    targetDir: targetDir.value.trim(),
    sshKeyPath: sshKeyPath.value.trim() || undefined,
  });
}

function retryClone() {
  // Ensure any stale listener is cleaned up before resetting
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  status.value = 'idle';
  outputLines.value = [];
  errorMessage.value = '';
  processId.value = null;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-backdrop" @click.self="handleClose">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Clone Repository">
        <!-- Header -->
        <div class="modal-header">
          <div class="modal-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="18" r="3"/>
              <circle cx="6" cy="6" r="3"/>
              <circle cx="18" cy="6" r="3"/>
              <path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
              <line x1="12" y1="15" x2="12" y2="12"/>
            </svg>
            Clone Repository
          </div>
          <button class="close-btn" @click="handleClose" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Form (idle state) -->
        <div v-if="status === 'idle'" class="modal-body">
          <div class="form-group">
            <label class="form-label" for="clone-repo-url">Repository URL</label>
            <input
              id="clone-repo-url"
              v-model="repoUrl"
              type="text"
              class="form-input"
              placeholder="git@github.com:user/repo.git or https://github.com/user/repo"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter="startClone"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="clone-target-dir">Clone into (parent directory)</label>
            <input
              id="clone-target-dir"
              v-model="targetDir"
              type="text"
              class="form-input font-mono"
              placeholder="/home/user/projects"
              autocomplete="off"
              spellcheck="false"
            />
            <p class="form-hint">The repository will be cloned as a subdirectory here.</p>
          </div>

          <div class="form-group">
            <label class="form-label" for="clone-ssh-key">
              SSH Key Path
              <span class="form-label-optional">(optional)</span>
            </label>
            <input
              id="clone-ssh-key"
              v-model="sshKeyPath"
              type="text"
              class="form-input font-mono"
              placeholder="~/.ssh/id_ed25519"
              autocomplete="off"
              spellcheck="false"
            />
            <p class="form-hint">Leave empty to use the default SSH key from your environment.</p>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary" @click="handleClose">Cancel</button>
            <button
              class="btn btn-primary"
              :disabled="!repoUrl.trim() || !targetDir.trim()"
              @click="startClone"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Clone
            </button>
          </div>
        </div>

        <!-- Progress (cloning state) -->
        <div v-else-if="status === 'cloning'" class="modal-body">
          <div class="clone-status">
            <svg width="16" height="16" viewBox="0 0 24 24" class="status-spinner">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
            </svg>
            <span>Cloning repository…</span>
          </div>
          <div class="output-pane" ref="outputRef">
            <template v-if="outputLines.length > 0">
              <span
                v-for="(line, i) in outputLines"
                :key="i"
                class="output-line"
                :class="line.stream"
              >{{ line.text }}</span>
            </template>
            <span v-else class="output-waiting">Waiting for output…</span>
          </div>
        </div>

        <!-- Done state (brief — App.vue navigates away, but show if navigation is slow) -->
        <div v-else-if="status === 'done'" class="modal-body">
          <div class="clone-done-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Clone successful! Navigating to project…</span>
          </div>
        </div>

        <!-- Error state -->
        <div v-else-if="status === 'error'" class="modal-body">
          <div class="clone-error-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{{ errorMessage }}</span>
          </div>
          <div v-if="outputLines.length > 0" class="output-pane output-pane-short" ref="outputRef">
            <span
              v-for="(line, i) in outputLines"
              :key="i"
              class="output-line"
              :class="line.stream"
            >{{ line.text }}</span>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" @click="handleClose">Close</button>
            <button class="btn btn-primary" @click="retryClone">Try Again</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 540px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-label-optional {
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 4px;
}

.form-input {
  padding: 8px 12px;
  font-size: 13px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: border-color 0.15s;
}

.form-input:focus {
  outline: none;
  border-color: var(--text-muted);
}

.font-mono {
  font-family: var(--font-mono);
}

.form-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-md);
  transition: background 0.15s, opacity 0.15s;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn-primary {
  background: var(--text-primary);
  color: var(--bg-primary);
  border: 1px solid transparent;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}

/* Progress state */
.clone-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 4px 0;
}

.status-spinner {
  animation: spin 1s linear infinite;
  color: var(--text-secondary);
  flex-shrink: 0;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.output-pane {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow-y: auto;
  max-height: 300px;
  min-height: 120px;
  white-space: pre-wrap;
  word-break: break-all;
}

.output-pane-short {
  max-height: 180px;
  min-height: 60px;
}

.output-line {
  display: block;
}

.output-line.stderr {
  color: var(--text-secondary);
}

.output-line.stdout {
  color: var(--text-primary);
}

.output-waiting {
  color: var(--text-muted);
  font-style: italic;
}

/* Done state */
.clone-done-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: #22c55e;
}

.clone-done-banner svg {
  flex-shrink: 0;
}

/* Error state */
.clone-error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: #ef4444;
}

.clone-error-banner svg {
  flex-shrink: 0;
}
</style>
