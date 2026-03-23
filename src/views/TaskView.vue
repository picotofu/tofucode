<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AssigneeDropdown from '../components/AssigneeDropdown.vue';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const route = useRoute();

const {
  fetchTaskDetail,
  taskDetail,
  taskDetailLoading,
  taskSaveStatus,
  taskStatusOptions,
  taskAssignees,
  taskComments,
  taskCommentsLoading,
  getTaskStatusOptions,
  getTaskAssignees,
  getTaskComments,
  addTaskComment,
  replaceTaskBody,
  updateTaskField,
} = useWebSocket();

const pageId = computed(() => route.params.pageId);

// Local editable state
const editBody = ref('');
// Per-field editable values: { [fieldName]: value }
const editFields = ref({});
let saveTimer = null;
// Per-field debounce timers
const fieldTimers = {};

// New comment input
const newComment = ref('');
const commentTextareaRef = ref(null);

// Track whether we've populated local state for the current page
let taskLoaded = false;

onMounted(() => {
  if (taskStatusOptions.value.length === 0) {
    getTaskStatusOptions();
  }
  if (taskAssignees.value.length === 0) {
    getTaskAssignees();
  }
  fetchTaskDetail(pageId.value);
  getTaskComments(pageId.value);
});

onUnmounted(() => {
  clearTimeout(saveTimer);
  for (const t of Object.values(fieldTimers)) clearTimeout(t);
});

// Populate local edit state when task detail loads
watch(taskDetail, (detail) => {
  if (taskLoaded) return;
  if (detail && detail.success !== false && !detail.error) {
    editBody.value = detail.body ?? '';
    // Populate all field values from properties
    const fields = {};
    if (detail.properties) {
      for (const [fieldName, info] of Object.entries(detail.properties)) {
        // For people fields, store the first assignee's id for the dropdown
        if (info.type === 'people') {
          const arr = Array.isArray(info.value) ? info.value : [];
          fields[fieldName] = arr[0]?.id ?? '';
        } else {
          fields[fieldName] = info.value;
        }
      }
    }
    editFields.value = fields;
    taskLoaded = true;
  }
});

// Re-fetch when route changes
watch(pageId, (id) => {
  if (id) {
    editBody.value = '';
    editFields.value = {};
    taskLoaded = false;
    fetchTaskDetail(id);
    getTaskComments(id);
  }
});

// Auto-save body with 2s debounce
function onBodyInput() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    replaceTaskBody(pageId.value, editBody.value);
  }, 2000);
}

// Field save — immediate for select/status/checkbox/date, 1s debounce for text-like inputs
function saveField(fieldName, fieldType, value, immediate = false) {
  if (immediate) {
    clearTimeout(fieldTimers[fieldName]);
    delete fieldTimers[fieldName];
    updateTaskField(pageId.value, fieldName, fieldType, value);
  } else {
    clearTimeout(fieldTimers[fieldName]);
    fieldTimers[fieldName] = setTimeout(() => {
      delete fieldTimers[fieldName];
      updateTaskField(pageId.value, fieldName, fieldType, value);
    }, 1000);
  }
}

function onFieldChange(fieldName, fieldType, value) {
  editFields.value[fieldName] = value;
  const immediate = ['select', 'status', 'checkbox', 'date', 'people'].includes(
    fieldType,
  );
  saveField(fieldName, fieldType, value, immediate);
}

// Auto-managed types — skip rendering (read-only system fields)
const AUTO_MANAGED_TYPES = new Set([
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'formula',
  'rollup',
  'unique_id',
  'relation',
]);

// Fields to render: from fieldMappings, skip auto-managed and title
const renderableFields = computed(() => {
  const detail = taskDetail.value;
  if (!detail?.fieldMappings) return [];
  return detail.fieldMappings.filter((m) => {
    if (AUTO_MANAGED_TYPES.has(m.type)) return false;
    if (m.type === 'title') return false;
    return true;
  });
});

// Get options for a select/status/multi_select field
function getFieldOptions(fieldName) {
  return taskDetail.value?.fieldOptions?.[fieldName] ?? [];
}

// Get the display tags for a multi_select field
function getMultiSelectDisplay(fieldName) {
  const val = taskDetail.value?.properties?.[fieldName]?.value;
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [];
}

function statusClass(status) {
  if (!status) return 'status-muted';
  const lower = status.toLowerCase();
  if (lower.includes('done') || lower.includes('complete'))
    return 'status-success';
  if (
    lower.includes('progress') ||
    lower.includes('active') ||
    lower.includes('review')
  )
    return 'status-warning';
  if (lower.includes('blocked') || lower.includes('cancel'))
    return 'status-error';
  return 'status-muted';
}

const saveLabel = computed(() => {
  if (taskSaveStatus.value === 'saving') return 'Saving…';
  if (taskSaveStatus.value === 'saved') return 'Saved';
  if (taskSaveStatus.value === 'error') return 'Save failed';
  return null;
});

// Comments
function submitComment() {
  const content = newComment.value.trim();
  if (!content) return;
  addTaskComment(pageId.value, content);
  newComment.value = '';
}

function onCommentKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submitComment();
  }
}
</script>

<template>
  <div class="task-view">
    <!-- Top bar: save indicator + Notion link -->
    <div class="task-topbar">
      <span
        v-if="saveLabel"
        class="task-save-indicator"
        :class="{ 'save-error': taskSaveStatus === 'error' }"
      >
        {{ saveLabel }}
      </span>
      <span v-else class="task-save-spacer" />

      <a
        v-if="taskDetail?.url"
        :href="taskDetail.url"
        target="_blank"
        rel="noopener"
        class="task-notion-link"
        title="Open in Notion"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Notion
      </a>
    </div>

    <!-- Scrollable content area -->
    <div class="task-scroll">
      <!-- Loading -->
      <div v-if="taskDetailLoading" class="task-loading">
        <div class="task-skeleton-title" />
        <div class="task-skeleton-meta" />
        <div v-for="i in 3" :key="i" class="task-skeleton-field" />
        <div class="task-skeleton-body" />
      </div>

      <!-- Error -->
      <div v-else-if="taskDetail?.error" class="task-error">
        {{ taskDetail.error }}
      </div>

      <!-- Loaded -->
      <template v-else-if="taskDetail">
        <!-- Title + meta -->
        <div class="task-title-section">
          <h1 class="task-title">{{ taskDetail.title }}</h1>
          <p class="task-meta">
            <span v-if="taskDetail.ticketId" class="task-ticket-id">{{ taskDetail.ticketId }}</span>
            <span v-if="taskDetail.ticketId && taskDetail.lastEditedAt" class="task-meta-sep">·</span>
            <span v-if="taskDetail.lastEditedAt" class="task-meta-time">{{ formatRelativeTime(taskDetail.lastEditedAt) }}</span>
          </p>
        </div>

        <!-- Properties -->
        <div v-if="renderableFields.length > 0" class="task-properties">
          <div v-for="field in renderableFields" :key="field.field" class="task-field-row">
            <label class="task-field-label">{{ field.field }}</label>

            <!-- select / status -->
            <template v-if="field.type === 'select' || field.type === 'status'">
              <select
                class="task-field-select"
                :class="field.type === 'status' ? statusClass(editFields[field.field]) : ''"
                :value="editFields[field.field] ?? ''"
                @change="onFieldChange(field.field, field.type, $event.target.value)"
              >
                <option value="">—</option>
                <option v-for="opt in getFieldOptions(field.field)" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </template>

            <!-- checkbox -->
            <template v-else-if="field.type === 'checkbox'">
              <input
                type="checkbox"
                class="task-field-checkbox"
                :checked="editFields[field.field] ?? false"
                @change="onFieldChange(field.field, field.type, $event.target.checked)"
              />
            </template>

            <!-- date -->
            <template v-else-if="field.type === 'date'">
              <input
                type="date"
                class="task-field-input"
                :value="editFields[field.field] ?? ''"
                @change="onFieldChange(field.field, field.type, $event.target.value)"
              />
            </template>

            <!-- number -->
            <template v-else-if="field.type === 'number'">
              <input
                type="number"
                class="task-field-input"
                :value="editFields[field.field] ?? ''"
                @input="onFieldChange(field.field, field.type, $event.target.valueAsNumber)"
              />
            </template>

            <!-- people — assignee dropdown -->
            <template v-else-if="field.type === 'people'">
              <AssigneeDropdown
                class="task-field-assignee"
                :model-value="editFields[field.field] ?? ''"
                :assignees="taskAssignees"
                @update:model-value="onFieldChange(field.field, field.type, $event)"
              />
            </template>

            <!-- multi_select — read-only tags -->
            <template v-else-if="field.type === 'multi_select'">
              <div class="task-field-tags">
                <span
                  v-for="tag in getMultiSelectDisplay(field.field)"
                  :key="tag"
                  class="task-tag"
                >{{ tag }}</span>
                <span v-if="getMultiSelectDisplay(field.field).length === 0" class="task-field-empty">—</span>
              </div>
            </template>

            <!-- text-like: rich_text, url, email, phone_number -->
            <template v-else>
              <input
                class="task-field-input"
                :type="field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'"
                :value="editFields[field.field] ?? ''"
                @input="onFieldChange(field.field, field.type, $event.target.value)"
              />
            </template>
          </div>
        </div>

        <!-- Divider -->
        <div class="task-section-divider" />

        <!-- Body editor -->
        <div class="task-body-section">
          <p class="task-section-label">Notes</p>
          <textarea
            v-model="editBody"
            class="task-body-editor"
            placeholder="Add notes, description, or task details…"
            spellcheck="false"
            @input="onBodyInput"
          />
        </div>

        <!-- Divider -->
        <div class="task-section-divider" />

        <!-- Comments section -->
        <div class="task-comments-section">
          <p class="task-section-label">Comments</p>

          <!-- Loading -->
          <div v-if="taskCommentsLoading" class="task-comments-loading">
            <div v-for="i in 2" :key="i" class="task-comment-skeleton" />
          </div>

          <!-- Comment list -->
          <div v-else class="task-comments-list">
            <div v-if="taskComments.length === 0" class="task-comments-empty">
              No comments yet
            </div>
            <div v-for="comment in taskComments" :key="comment.id" class="task-comment">
              <div class="task-comment-header">
                <span class="task-comment-author">{{ comment.createdBy || 'Unknown' }}</span>
                <span class="task-comment-time">{{ formatRelativeTime(comment.createdTime) }}</span>
              </div>
              <p class="task-comment-body">{{ comment.content }}</p>
            </div>
          </div>

          <!-- Add comment form -->
          <div class="task-comment-form">
            <textarea
              ref="commentTextareaRef"
              v-model="newComment"
              class="task-comment-input"
              placeholder="Add a comment… (Ctrl+Enter to post)"
              rows="2"
              @keydown="onCommentKeydown"
            />
            <button
              class="task-comment-submit"
              :disabled="!newComment.trim()"
              @click="submitComment"
            >
              Post
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.task-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  overflow: hidden;
}

/* ── Top bar ──────────────────────────────────── */
.task-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  min-height: 44px;
}

.task-save-indicator {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

.task-save-indicator.save-error {
  color: var(--error-color);
}

.task-save-spacer {
  flex: 1;
}

.task-notion-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  text-decoration: none;
  flex-shrink: 0;
  transition: color 0.15s;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}

.task-notion-link:hover {
  color: var(--text-secondary);
  border-color: var(--text-muted);
}

/* ── Scroll area ─────────────────────────────── */
.task-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* ── Loading skeleton ────────────────────────── */
.task-loading {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@keyframes task-shimmer {
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
}

.task-skeleton-title,
.task-skeleton-meta,
.task-skeleton-field,
.task-skeleton-body {
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: task-shimmer 1.4s ease-in-out infinite;
}

.task-skeleton-title {
  height: 22px;
  width: 65%;
}

.task-skeleton-meta {
  height: 12px;
  width: 35%;
  animation-delay: 0.1s;
}

.task-skeleton-field {
  height: 32px;
  width: 100%;
  animation-delay: 0.2s;
}

.task-skeleton-body {
  height: 120px;
  width: 100%;
  animation-delay: 0.3s;
}

/* ── Error ────────────────────────────────────── */
.task-error {
  padding: 40px 20px;
  text-align: center;
  color: var(--error-color);
  font-size: 14px;
}

/* ── Title section ───────────────────────────── */
.task-title-section {
  padding: 20px 20px 12px;
}

.task-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  line-height: 1.3;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.task-ticket-id {
  font-family: var(--font-mono);
  font-size: 11px;
}

.task-meta-sep {
  color: var(--border-color);
}

.task-meta-time {
  font-size: 11px;
}

/* ── Properties ──────────────────────────────── */
.task-properties {
  padding: 0 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-field-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

.task-field-label {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.task-field-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}

.task-field-input:focus {
  border-color: var(--text-muted);
}

.task-field-assignee {
  flex: 1;
  min-width: 0;
  max-width: 200px;
}

.task-field-select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  appearance: auto;
  max-width: 200px;
}

.task-field-select:focus {
  border-color: var(--text-muted);
}

/* Coloured status selects */
.task-field-select.status-success {
  background: rgba(34, 197, 94, 0.12);
  color: var(--success-color);
  border-color: rgba(34, 197, 94, 0.3);
}

.task-field-select.status-warning {
  background: rgba(245, 158, 11, 0.12);
  color: var(--warning-color);
  border-color: rgba(245, 158, 11, 0.3);
}

.task-field-select.status-error {
  background: rgba(239, 68, 68, 0.12);
  color: var(--error-color);
  border-color: rgba(239, 68, 68, 0.3);
}

.task-field-select.status-muted {
  color: var(--text-muted);
}

.task-field-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--text-secondary);
}

.task-field-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.task-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.task-field-empty {
  font-size: 13px;
  color: var(--text-muted);
}

/* ── Section divider ─────────────────────────── */
.task-section-divider {
  height: 1px;
  background: var(--border-color);
  margin: 0 20px;
}

/* ── Section label ───────────────────────────── */
.task-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 8px;
}

/* ── Body section ────────────────────────────── */
.task-body-section {
  padding: 16px 20px;
}

.task-body-editor {
  width: 100%;
  min-height: 160px;
  padding: 10px 12px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.task-body-editor:focus {
  border-color: var(--text-muted);
}

.task-body-editor::placeholder {
  color: var(--text-muted);
}

/* ── Comments section ────────────────────────── */
.task-comments-section {
  padding: 16px 20px 24px;
}

.task-comments-loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.task-comment-skeleton {
  height: 50px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  animation: task-shimmer 1.4s ease-in-out infinite;
}

.task-comments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.task-comments-empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 8px 0;
}

.task-comment {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.task-comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.task-comment-author {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.task-comment-time {
  font-size: 11px;
  color: var(--text-muted);
}

.task-comment-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Comment form ────────────────────────────── */
.task-comment-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-comment-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.15s;
  line-height: 1.5;
}

.task-comment-input:focus {
  border-color: var(--text-muted);
}

.task-comment-input::placeholder {
  color: var(--text-muted);
}

.task-comment-submit {
  align-self: flex-end;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.task-comment-submit:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.task-comment-submit:not(:disabled):hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}
</style>
