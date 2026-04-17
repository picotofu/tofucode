<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AssigneeDropdown from '../components/AssigneeDropdown.vue';
import { useWebSocket } from '../composables/useWebSocket.js';
import { notionColorStyle } from '../utils/notion-colors.js';

const router = useRouter();
const {
  taskAssignees,
  taskSelfId,
  taskLabelOptions,
  getLabelOptions,
  getTaskAssignees,
  createTask,
  onMessage,
} = useWebSocket();

// Form state
const title = ref('');
const selectedLabel = ref('');
const selectedAssignee = ref('__self__');
const creating = ref(false);
const errorMsg = ref('');

// Fetch label options + assignees on mount
onMounted(() => {
  getLabelOptions();
  if (!taskAssignees.value.length) {
    getTaskAssignees();
  }
});

// Listen for create result
const unsubCreate = onMessage((msg) => {
  if (msg.type !== 'tasks:create_result') return;
  creating.value = false;
  if (msg.success) {
    router.push('/board');
  } else {
    errorMsg.value =
      msg.error || msg.reason || 'Failed to create ticket. Please try again.';
  }
});

onBeforeUnmount(() => {
  unsubCreate();
});

function handleCreate() {
  const t = title.value.trim();
  if (!t) return;
  errorMsg.value = '';
  creating.value = true;
  createTask(t, selectedAssignee.value, selectedLabel.value || undefined);
}

function handleCancel() {
  router.back();
}

function labelOptionStyle(opt) {
  const s = notionColorStyle(opt.color);
  return { background: s.background, color: s.color };
}
</script>

<template>
  <div class="new-ticket-view">
    <div class="new-ticket-header">
      <button class="new-ticket-back" @click="handleCancel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>
      <h1 class="new-ticket-title">New Ticket</h1>
    </div>

    <div class="new-ticket-body">
      <div class="new-ticket-card">
        <!-- Title -->
        <div class="nt-field">
          <label class="nt-label" for="nt-title">Title <span class="nt-required">*</span></label>
          <input
            id="nt-title"
            v-model="title"
            type="text"
            class="nt-input"
            placeholder="What needs to be done?"
            maxlength="200"
            :disabled="creating"
            autofocus
            @keydown.enter="handleCreate"
          />
        </div>

        <!-- Label (only shown if options are available) -->
        <div v-if="taskLabelOptions.length" class="nt-field">
          <label class="nt-label" for="nt-label">Label</label>
          <select
            id="nt-label"
            v-model="selectedLabel"
            class="nt-select"
            :disabled="creating"
          >
            <option value="">No label</option>
            <option
              v-for="opt in taskLabelOptions"
              :key="opt.name"
              :value="opt.name"
            >{{ opt.name }}</option>
          </select>
          <!-- Preview swatch if a label is selected -->
          <span
            v-if="selectedLabel"
            class="nt-label-preview"
            :style="labelOptionStyle(taskLabelOptions.find(o => o.name === selectedLabel) || { color: 'default' })"
          >{{ selectedLabel }}</span>
        </div>

        <!-- Assignee -->
        <div class="nt-field">
          <label class="nt-label">Assignee</label>
          <AssigneeDropdown
            v-model="selectedAssignee"
            :assignees="taskAssignees"
            :head-options="[{ value: '__self__', label: 'Me' }, { value: '', label: 'Unassigned' }]"
            :disabled="creating"
          />
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="nt-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {{ errorMsg }}
        </div>

        <!-- Actions -->
        <div class="nt-actions">
          <button class="nt-btn-cancel" :disabled="creating" @click="handleCancel">
            Cancel
          </button>
          <button
            class="nt-btn-create"
            :disabled="creating || !title.trim()"
            @click="handleCreate"
          >
            <template v-if="creating">
              <svg class="nt-spinner" width="14" height="14" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              Creating…
            </template>
            <template v-else>
              Create Ticket
            </template>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.new-ticket-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  overflow: auto;
}

/* ── Header ─────────────────────────────────────── */
.new-ticket-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.new-ticket-back {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 13px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.new-ticket-back:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.new-ticket-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

/* ── Body ────────────────────────────────────────── */
.new-ticket-body {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px 20px;
}

.new-ticket-card {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 28px;
}

/* ── Field ───────────────────────────────────────── */
.nt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nt-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nt-required {
  color: var(--error-color);
  margin-left: 2px;
}

.nt-input {
  padding: 9px 12px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s;
}

.nt-input:focus {
  border-color: var(--text-muted);
}

.nt-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nt-input::placeholder {
  color: var(--text-muted);
}

.nt-select {
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  appearance: auto;
  transition: border-color 0.15s;
}

.nt-select:focus {
  border-color: var(--text-muted);
}

.nt-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nt-label-preview {
  display: inline-flex;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

/* ── Error ────────────────────────────────────────── */
.nt-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--radius-sm);
  color: var(--error-color);
  font-size: 13px;
}

/* ── Actions ─────────────────────────────────────── */
.nt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color);
}

.nt-btn-cancel {
  padding: 7px 16px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nt-btn-cancel:hover:not(:disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.nt-btn-cancel:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nt-btn-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  color: var(--bg-primary);
  background: var(--text-primary);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity 0.15s;
}

.nt-btn-create:hover:not(:disabled) {
  opacity: 0.85;
}

.nt-btn-create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.nt-spinner {
  animation: spin 0.8s linear infinite;
}
</style>
