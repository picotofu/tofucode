<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { formatRelativeTime } from '../utils/format.js';
import { notionColorStyle } from '../utils/notion-colors.js';
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
  taskSelfId: { type: String, default: null },
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

// ── Grouping ────────────────────────────────────────────────────────────────
// groupByAssignee: localAssignee === '' (Anyone)
// groupByStatus:  localStatus === ''
// Both: assignee outer, status inner

const groupByAssignee = computed(() => localAssignee.value === '');
const groupByStatus = computed(() => localStatus.value === '');

// Returns [{ key, label, items }] for assignee grouping
// items is either a flat array (status filtered) or [{ key, label, items }] for sub-grouping
const groupedTasks = computed(() => {
  if (!groupByAssignee.value && !groupByStatus.value) return null;

  if (groupByAssignee.value && !groupByStatus.value) {
    return groupByAssigneeOnly(props.tasks);
  }

  if (!groupByAssignee.value && groupByStatus.value) {
    return groupByStatusOnly(props.tasks);
  }

  // Both: assignee outer, status inner
  return groupByAssigneeOnly(props.tasks).map((g) => ({
    ...g,
    subGroups: groupByStatusOnly(g.items),
  }));
});

function groupByAssigneeOnly(tasks) {
  const map = new Map(); // assignee name → tasks[]
  for (const task of tasks) {
    const names = task.assignees?.length ? task.assignees : ['Unassigned'];
    for (const name of names) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(task);
    }
  }
  const groups = Array.from(map.entries()).map(([label, items]) => ({
    key: label,
    label,
    items,
  }));

  // Resolve "me" name from taskAssignees using selfId
  const myName = props.taskSelfId
    ? (props.taskAssignees.find((u) => u.id === props.taskSelfId)?.name ?? null)
    : null;

  return groups.sort((a, b) => {
    // "Unassigned" always last
    if (a.key === 'Unassigned') return 1;
    if (b.key === 'Unassigned') return -1;
    // "Me" always first
    if (myName && a.key === myName) return -1;
    if (myName && b.key === myName) return 1;
    // Rest alphabetical
    return a.label.localeCompare(b.label);
  });
}

function groupByStatusOnly(tasks) {
  const map = new Map(); // status → tasks[]
  for (const task of tasks) {
    const key = task.status || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  }
  const groups = Array.from(map.entries()).map(([key, items]) => ({
    key,
    label: key || 'No status',
    items,
  }));

  // Sort by Notion schema order (taskStatusOptions preserves it); "No status" first
  const schemaOrder = props.taskStatusOptions;
  return groups.sort((a, b) => {
    if (a.key === '') return -1;
    if (b.key === '') return 1;
    const ai = schemaOrder.indexOf(a.key);
    const bi = schemaOrder.indexOf(b.key);
    // Known statuses sorted by schema order; unknowns go after
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

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

function labelStyle(label) {
  const s = notionColorStyle(label.color);
  return { background: s.background, color: s.color, borderColor: s.border };
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

        <!-- Grouped list -->
        <ul v-else-if="groupedTasks" class="tasks-list">
          <template v-for="group in groupedTasks" :key="group.key">
            <!-- Assignee (or status-only) group header -->
            <li class="tasks-group-header">
              <span v-if="groupByStatus && !groupByAssignee" class="status-badge" :class="statusClass(group.key)">{{ group.label }}</span>
              <span v-else class="tasks-group-label">{{ group.label }}</span>
              <span class="tasks-group-count">{{ group.items.length }}</span>
            </li>

            <!-- Status sub-groups (when grouping by both) -->
            <template v-if="group.subGroups">
              <template v-for="sub in group.subGroups" :key="sub.key">
                <li class="tasks-group-header tasks-group-header-sub">
                  <span class="status-badge" :class="statusClass(sub.key)">{{ sub.label }}</span>
                  <span class="tasks-group-count">{{ sub.items.length }}</span>
                </li>
                <li v-for="task in sub.items" :key="task.pageId" class="tasks-item">
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
                        <span
                          v-for="label in task.labels"
                          :key="label.name"
                          class="tasks-item-label"
                          :style="labelStyle(label)"
                        >{{ label.name }}</span>
                        <span v-if="task.lastEditedAt">{{ formatRelativeTime(task.lastEditedAt) }}</span>
                      </p>
                    </div>
                  </button>
                </li>
              </template>
            </template>

            <!-- Flat items under group (status-only or assignee-only grouping) -->
            <template v-else>
              <li v-for="task in group.items" :key="task.pageId" class="tasks-item">
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
                      <!-- Show status badge when grouped by assignee (not grouped by status) -->
                      <span v-if="groupByAssignee && !groupByStatus && task.status" class="status-badge" :class="statusClass(task.status)">{{ task.status }}</span>
                      <span
                        v-for="label in task.labels"
                        :key="label.name"
                        class="tasks-item-label"
                        :style="labelStyle(label)"
                      >{{ label.name }}</span>
                      <span v-if="task.lastEditedAt">{{ formatRelativeTime(task.lastEditedAt) }}</span>
                    </p>
                  </div>
                </button>
              </li>
            </template>
          </template>

          <!-- Infinite scroll sentinel inside grouped list -->
          <li><div ref="scrollSentinelRef" class="tasks-scroll-sentinel" /></li>
        </ul>

        <!-- Flat list -->
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
                  <span v-if="!localStatus && task.status" class="status-badge" :class="statusClass(task.status)">{{ task.status }}</span>
                  <span
                    v-for="label in task.labels"
                    :key="label.name"
                    class="tasks-item-label"
                    :style="labelStyle(label)"
                  >{{ label.name }}</span>
                  <span v-if="task.lastEditedAt">{{ formatRelativeTime(task.lastEditedAt) }}</span>
                </p>
              </div>
            </button>
          </li>
        </ul>

        <!-- Infinite scroll sentinel (flat list) -->
        <div ref="scrollSentinelRef" class="tasks-scroll-sentinel" />
      </template>
    </template>

    <!-- Pinned footer: board link + create ticket -->
    <div v-if="!tasksError" class="tasks-footer">
      <RouterLink to="/board" class="tasks-board-link">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        Board view
      </RouterLink>
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
          />

          <!-- Confirm button -->
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
  flex: 1;
  min-height: 0;
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

/* ── Group headers ────────────────────────────── */
.tasks-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 4px;
  margin-top: 4px;
}

.tasks-group-header:first-child {
  margin-top: 0;
}

.tasks-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tasks-group-header-sub {
  padding-left: 14px;
  margin-top: 2px;
}

.tasks-group-header-sub .tasks-group-label {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  font-size: 11px;
}

.tasks-group-count {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 1px 6px;
  flex-shrink: 0;
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

/* ── Label pills (sidebar) ────────────────────── */
.tasks-item-label {
  display: inline-block;
  font-size: 9px;
  font-weight: 500;
  padding: 0 5px;
  line-height: 14px;
  border-radius: 8px;
  border: 1px solid;
  white-space: nowrap;
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

.tasks-board-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.tasks-board-link:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.tasks-create-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tasks-create-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
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
  border: 1px solid var(--border-color);
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
