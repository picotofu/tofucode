<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { formatRelativeTime } from '../utils/format.js';
import AssigneeDropdown from './AssigneeDropdown.vue';

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  tasksReady: { type: Boolean, default: false },
  tasksError: { type: String, default: null },
  tasksNextCursor: { type: String, default: null },
  tasksFilter: {
    type: Object,
    default: () => ({
      filterByAssignee: '__self__',
      filterByStatus: '',
      titleSearch: '',
    }),
  },
  taskStatusOptions: { type: Array, default: () => [] },
  taskAssignees: { type: Array, default: () => [] },
});

const emit = defineEmits([
  'refresh',
  'load-more',
  'select-task',
  'open-settings',
  'filter-change',
  'create-task',
]);

// ── Filter state ───────────────────────────────────────────────────────────

const localAssignee = ref(props.tasksFilter.filterByAssignee ?? '__self__');
const localStatus = ref(props.tasksFilter.filterByStatus);
const localTitle = ref(props.tasksFilter.titleSearch);

let titleSearchTimer = null;

function emitFilter() {
  emit('filter-change', {
    filterByAssignee: localAssignee.value,
    filterByStatus: localStatus.value,
    titleSearch: localTitle.value,
  });
}

function onStatusChange() {
  emitFilter();
}

function onTitleInput() {
  clearTimeout(titleSearchTimer);
  titleSearchTimer = setTimeout(() => emitFilter(), 300);
}

// ── Assignee dropdown options ───────────────────────────────────────────────

const FILTER_HEAD_OPTIONS = [
  { value: '__self__', label: 'Me' },
  { value: '', label: 'Anyone' },
];

const CREATE_HEAD_OPTIONS = [{ value: '__self__', label: 'Me' }];

function onFilterAssigneeChange(value) {
  localAssignee.value = value;
  emitFilter();
}

// ── Create form ────────────────────────────────────────────────────────────

const createTitle = ref('');
const createAssignee = ref('__self__');

function confirmCreate() {
  const title = createTitle.value.trim();
  if (!title) return;
  // Pass assignee info alongside title; parent handles it
  emit('create-task', title, createAssignee.value);
  createTitle.value = '';
  createAssignee.value = '__self__';
}

function onCreateTitleKeydown(e) {
  if (e.key === 'Enter') confirmCreate();
}

// ── Infinite scroll ────────────────────────────────────────────────────────

const scrollSentinelRef = ref(null);
let scrollObserver = null;

onMounted(() => {
  scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && props.tasksNextCursor) {
        emit('load-more');
      }
    },
    { threshold: 0.1 },
  );
  if (scrollSentinelRef.value) scrollObserver.observe(scrollSentinelRef.value);
});

onBeforeUnmount(() => {
  scrollObserver?.disconnect();
  clearTimeout(titleSearchTimer);
});

// ── Helpers ────────────────────────────────────────────────────────────────

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
</script>

<template>
  <div class="tasks-panel">
    <!-- Error state -->
    <div v-if="tasksError" class="tasks-empty">
      <template v-if="tasksError === 'not_configured'">
        <p>Task provider is not configured.</p>
        <button class="tasks-link-btn" @click="emit('open-settings')">
          Configure in Settings → Notion
        </button>
      </template>
      <template v-else>
        <p class="tasks-error-text">{{ tasksError }}</p>
        <button class="tasks-link-btn" @click="emit('refresh')">Retry</button>
      </template>
    </div>

    <!-- Normal list view -->
    <template v-else>
      <!-- Filter bar -->
      <div class="tasks-filters">
        <!-- Row 1: Assignee + status + refresh -->
        <div class="tasks-filter-row">
          <!-- Assignee filter -->
          <AssigneeDropdown
            class="tasks-filter-assignee"
            :model-value="localAssignee"
            :assignees="taskAssignees"
            :head-options="FILTER_HEAD_OPTIONS"
            @update:model-value="onFilterAssigneeChange"
          />

          <!-- Status filter -->
          <select
            v-model="localStatus"
            class="tasks-filter-select"
            title="Filter by status"
            @change="onStatusChange"
          >
            <option value="">All statuses</option>
            <option value="__none__">No status</option>
            <option v-for="opt in taskStatusOptions" :key="opt" :value="opt">{{ opt }}</option>
          </select>

          <!-- Refresh -->
          <button class="tasks-toolbar-btn" title="Refresh" @click="emit('refresh')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        <!-- Row 2: Title search -->
        <div class="tasks-filter-search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="localTitle"
            type="text"
            placeholder="Search tickets…"
            class="tasks-filter-input"
            @input="onTitleInput"
          />
        </div>
      </div>

      <!-- Skeleton loading -->
      <ul v-if="!tasksReady" class="tasks-list">
        <li v-for="i in 5" :key="i" class="tasks-item tasks-skeleton-item">
          <div class="tasks-item-inner">
            <div class="skeleton-icon" />
            <div class="skeleton-text">
              <div class="skeleton-line skeleton-title" />
              <div class="skeleton-line skeleton-meta" />
            </div>
          </div>
        </li>
      </ul>

      <!-- Loaded -->
      <template v-else>
        <!-- Empty state -->
        <div v-if="tasks.length === 0" class="tasks-empty">
          No tasks found
        </div>

        <!-- Task list -->
        <ul v-else class="tasks-list">
          <li v-for="task in tasks" :key="task.pageId" class="tasks-item">
            <button class="tasks-item-inner" @click="emit('select-task', task.pageId)">
              <div class="tasks-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </div>
              <div class="tasks-item-content">
                <p class="tasks-item-title">{{ task.title }}</p>
                <p class="tasks-item-meta">
                  <span v-if="task.ticketId" class="tasks-item-ticket-id">{{ task.ticketId }}</span>
                  <template v-if="localAssignee !== '__self__' && task.assignees?.length">
                    <span v-for="name in task.assignees" :key="name" class="tasks-item-assignee-pill">{{ name }}</span>
                  </template>
                  <span v-if="!localStatus && task.status" class="status-badge" :class="statusClass(task.status)">{{ task.status }}</span>
                  <span v-if="task.lastEditedAt">{{ formatRelativeTime(task.lastEditedAt) }}</span>
                </p>
              </div>
            </button>
          </li>
        </ul>

        <!-- Infinite scroll sentinel -->
        <div ref="scrollSentinelRef" class="tasks-scroll-sentinel" />
      </template>
    </template>

    <!-- Pinned footer: create ticket -->
    <div v-if="!tasksError" class="tasks-footer">
      <div class="tasks-create-box">
        <!-- Row 1: title input -->
        <input
          v-model="createTitle"
          type="text"
          class="tasks-create-input"
          placeholder="New ticket title…"
          maxlength="200"
          @keydown="onCreateTitleKeydown"
        />

        <!-- Row 2: assignee dropdown + confirm button -->
        <div class="tasks-create-bottom">
          <!-- Assignee picker -->
          <AssigneeDropdown
            v-model="createAssignee"
            class="tasks-create-assignee"
            :assignees="taskAssignees"
            :head-options="CREATE_HEAD_OPTIONS"
            :popover-up="true"
            size="sm"
            :bare="true"
          />

          <!-- Confirm button (borderless) -->
          <button
            class="tasks-create-confirm"
            :disabled="!createTitle.trim()"
            title="Add ticket"
            @click="confirmCreate"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tasks-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Filters ──────────────────────────────────── */
.tasks-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  flex-shrink: 0;
}

.tasks-filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tasks-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.tasks-toolbar-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.tasks-filter-select {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  padding: 4px 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  appearance: auto;
}

.tasks-filter-select:focus {
  outline: none;
  border-color: var(--text-muted);
}

.tasks-filter-search {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  min-width: 0;
}

.tasks-filter-search:focus-within {
  border-color: var(--text-muted);
}

.tasks-filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.tasks-filter-input::placeholder {
  color: var(--text-muted);
}

/* ── Assignee dropdown sizing ─────────────────── */
.tasks-filter-assignee {
  flex: 1;
  min-width: 0;
}

.tasks-create-assignee {
  flex: 1;
  min-width: 0;
}

/* ── List ─────────────────────────────────────── */
.tasks-list {
  list-style: none;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.tasks-item {
  border-radius: var(--radius-md);
  transition: background 0.15s;
}

.tasks-item:hover {
  background: var(--bg-hover);
}

.tasks-item-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  width: 100%;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.tasks-skeleton-item .tasks-item-inner {
  pointer-events: none;
}

.tasks-item-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.tasks-item-content {
  flex: 1;
  min-width: 0;
}

.tasks-item-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.tasks-item-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.tasks-item-assignee-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  white-space: nowrap;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tasks-item-ticket-id {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* ── Status badges ────────────────────────────── */
.status-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}

.status-success {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success-color);
}

.status-warning {
  background: rgba(245, 158, 11, 0.15);
  color: var(--warning-color);
}

.status-error {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error-color);
}

.status-muted {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

/* ── Empty / error ────────────────────────────── */
.tasks-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  flex: 1;
}

.tasks-error-text {
  color: var(--error-color);
  margin-bottom: 8px;
}

.tasks-link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.tasks-link-btn:hover {
  color: var(--text-primary);
}

/* ── Load more ────────────────────────────────── */
.tasks-scroll-sentinel {
  height: 1px;
  flex-shrink: 0;
}

/* ── Footer (create) ──────────────────────────── */
.tasks-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  padding: 8px 10px;
}

.tasks-create-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tasks-create-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  transition: border-color 0.15s;
}

.tasks-create-input:focus {
  border-color: var(--text-muted);
}

.tasks-create-input::placeholder {
  color: var(--text-muted);
}

.tasks-create-bottom {
  display: flex;
  align-items: center;
  padding: 0 2px 0 0;
}

.tasks-create-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.tasks-create-confirm:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.tasks-create-confirm:not(:disabled):hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

/* ── Skeleton loading ─────────────────────────── */
@keyframes tasks-shimmer {
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
}

.skeleton-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  animation: tasks-shimmer 1.4s ease-in-out infinite;
}

.skeleton-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skeleton-line {
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: tasks-shimmer 1.4s ease-in-out infinite;
}

.skeleton-title {
  height: 12px;
  width: 75%;
}

.skeleton-meta {
  height: 10px;
  width: 50%;
  animation-delay: 0.2s;
}
</style>
