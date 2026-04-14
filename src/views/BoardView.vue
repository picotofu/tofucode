<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AssigneeDropdown from '../components/AssigneeDropdown.vue';
import { useWebSocket } from '../composables/useWebSocket';
import { notionColorStyle } from '../utils/notion-colors.js';

const router = useRouter();

const {
  connected,
  boardTasks,
  boardTasksReady,
  boardTasksError,
  boardStatusField,
  boardStatusFieldType,
  boardColumnOrder,
  boardFilter,
  taskStatusOptions,
  taskAssignees,
  taskSelfId,
  getBoardTasks,
  setBoardFilter,
  getTaskStatusOptions,
  getTaskAssignees,
  updateTaskField,
  deleteTask,
  onMessage,
} = useWebSocket();

// ── Data loading ─────────────────────────────────────────────────────────────

onMounted(() => {
  if (connected.value) fetchBoard();
});

watch(connected, (c) => {
  if (c && !boardTasksReady.value) fetchBoard();
});

function fetchBoard() {
  if (taskStatusOptions.value.length === 0) getTaskStatusOptions();
  if (taskAssignees.value.length === 0) getTaskAssignees();
  getBoardTasks();
}

// ── Delete state ──────────────────────────────────────────────────────────────

// Set of pageIds currently being deleted (shows spinner + greyed card)
const deletingIds = ref(new Set());
// Error from a failed delete attempt
const deleteError = ref(null);

// Listen for delete results
const unsubDelete = onMessage((msg) => {
  if (msg.type !== 'tasks:delete_result') return;
  const newSet = new Set(deletingIds.value);
  newSet.delete(msg.pageId);
  deletingIds.value = newSet;
  contextMenu.value = null;
  if (!msg.success) {
    deleteError.value = msg.error || 'Failed to delete task';
  }
});

onBeforeUnmount(() => {
  unsubDelete();
});

// ── Assignee / label filter ───────────────────────────────────────────────────

// Head options for assignee dropdown: Anyone + Me (if selfId known)
const assigneeHeadOptions = computed(() => {
  const opts = [{ value: '', label: 'Anyone' }];
  if (taskSelfId.value) {
    opts.push({ value: '__self__', label: 'Me' });
  }
  return opts;
});

// All unique labels across all board tasks
const allLabels = computed(() => {
  const seen = new Set();
  const labels = [];
  for (const task of boardTasks.value) {
    for (const label of task.labels ?? []) {
      if (!seen.has(label.name)) {
        seen.add(label.name);
        labels.push(label);
      }
    }
  }
  return labels.sort((a, b) => a.name.localeCompare(b.name));
});

// Head options for label dropdown
const labelHeadOptions = computed(() => [{ value: '', label: 'Any label' }]);

// Local search input — not persisted
const boardSearch = ref('');

function onAssigneeChange(value) {
  setBoardFilter({ assignee: value });
  getBoardTasks();
}

function onLabelChange(value) {
  setBoardFilter({ label: value });
}

// ── Column status tint ────────────────────────────────────────────────────────

function columnTintClass(status) {
  if (!status) return 'col-tint-none';
  const lower = status.toLowerCase();
  if (lower.includes('done') || lower.includes('complete'))
    return 'col-tint-done';
  if (
    lower.includes('progress') ||
    lower.includes('active') ||
    lower.includes('review')
  )
    return 'col-tint-progress';
  if (lower.includes('blocked') || lower.includes('cancel'))
    return 'col-tint-blocked';
  return 'col-tint-todo';
}

// ── Column computation ────────────────────────────────────────────────────────

const columns = computed(() => {
  const opts = taskStatusOptions.value;
  if (!opts.length) return [];
  const order = boardColumnOrder.value;
  if (order.length) {
    const ordered = order.filter((s) => opts.includes(s));
    const remaining = opts.filter((s) => !order.includes(s));
    return [...ordered, ...remaining];
  }
  return opts;
});

function isDoneStatus(status) {
  return status.toLowerCase().includes('done');
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const aLabel = a.labels?.[0]?.name ?? null;
    const bLabel = b.labels?.[0]?.name ?? null;
    if (aLabel !== null && bLabel === null) return -1;
    if (aLabel === null && bLabel !== null) return 1;
    if (aLabel !== null && bLabel !== null) {
      const cmp = aLabel.localeCompare(bLabel);
      if (cmp !== 0) return cmp;
    }
    const aId = a.ticketId ?? '';
    const bId = b.ticketId ?? '';
    const aNum = Number.parseInt(aId.replace(/\D/g, ''), 10);
    const bNum = Number.parseInt(bId.replace(/\D/g, ''), 10);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return bNum - aNum;
    return bId.localeCompare(aId);
  });
}

// Apply label + search filters to a task list
function applyFilters(taskList) {
  const labelFilter = boardFilter.value.label;
  const search = boardSearch.value.trim().toLowerCase();
  return taskList.filter((t) => {
    if (labelFilter) {
      const hasLabel = (t.labels ?? []).some((l) => l.name === labelFilter);
      if (!hasLabel) return false;
    }
    if (search) {
      const title = (t.title ?? '').toLowerCase();
      const ticketId = (t.ticketId ?? '').toLowerCase();
      if (!title.includes(search) && !ticketId.includes(search)) return false;
    }
    return true;
  });
}

function buildColumnData(status) {
  let tasksInCol = boardTasks.value.filter((t) =>
    status === null ? !t.status : t.status === status,
  );

  if (status !== null && isDoneStatus(status)) {
    tasksInCol = tasksInCol.filter((t) => !t.archived);
  }

  tasksInCol = applyFilters(tasksInCol);
  tasksInCol = sortTasks(tasksInCol);

  return {
    status: status ?? '',
    displayName: status ?? 'No status',
    count: tasksInCol.length,
    tintClass: columnTintClass(status ?? ''),
    tasks: tasksInCol,
  };
}

const columnData = computed(() => {
  if (!boardTasksReady.value) return [];
  const noStatusCol = buildColumnData(null);
  const statusCols = columns.value.map((s) => buildColumnData(s));
  return noStatusCol.count > 0 ? [noStatusCol, ...statusCols] : statusCols;
});

// ── Drag and drop ─────────────────────────────────────────────────────────────

const draggedTask = ref(null);
const dragOverColumn = ref(null);

function onDragStart(task, e) {
  draggedTask.value = task;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', task.pageId);
}

function onDragEnd() {
  draggedTask.value = null;
  dragOverColumn.value = null;
}

function onDragOver(status, e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dragOverColumn.value = status;
}

function onDragLeave(colKey) {
  if (dragOverColumn.value === colKey) dragOverColumn.value = null;
}

function onDrop(targetStatus, e) {
  e.preventDefault();
  dragOverColumn.value = null;
  const task = draggedTask.value;
  draggedTask.value = null;
  if (!task || task.status === targetStatus) return;

  const field = boardStatusField.value;
  const fieldType = boardStatusFieldType.value;
  if (!field || !fieldType) return;

  task.status = targetStatus;
  updateTaskField(task.pageId, field, fieldType, targetStatus);
}

// ── Touch drag (mobile / Android PWA) ────────────────────────────────────────

const touchDragTask = ref(null);
const touchClone = ref(null);

function onTouchStart(task, e) {
  if (e.touches.length !== 1) return;
  touchDragTask.value = task;
  dragOverColumn.value = null;

  const card = e.currentTarget.closest('.board-card') ?? e.currentTarget;
  const rect = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    opacity: 0.75;
    pointer-events: none;
    z-index: 9999;
    box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    border-radius: 6px;
  `;
  document.body.appendChild(clone);
  touchClone.value = clone;
}

function onTouchMove(e) {
  if (!touchDragTask.value) return;
  e.preventDefault();

  const touch = e.touches[0];

  if (touchClone.value) {
    touchClone.value.style.left = `${touch.clientX - 60}px`;
    touchClone.value.style.top = `${touch.clientY - 20}px`;
  }

  if (touchClone.value) touchClone.value.style.display = 'none';
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (touchClone.value) touchClone.value.style.display = '';

  const colEl = el?.closest('[data-col-status]');
  dragOverColumn.value = colEl ? colEl.dataset.colStatus : null;
}

function onTouchEnd() {
  if (!touchDragTask.value) return;

  if (touchClone.value) {
    document.body.removeChild(touchClone.value);
    touchClone.value = null;
  }

  const task = touchDragTask.value;
  touchDragTask.value = null;
  const targetStatus = dragOverColumn.value;
  dragOverColumn.value = null;

  if (!targetStatus && targetStatus !== '') return;
  if (task.status === targetStatus) return;

  const field = boardStatusField.value;
  const fieldType = boardStatusFieldType.value;
  if (!field || !fieldType) return;

  task.status = targetStatus;
  updateTaskField(task.pageId, field, fieldType, targetStatus);
}

// ── Context menu (right-click) ────────────────────────────────────────────────

const contextMenu = ref(null); // { x, y, task }

function onCardContextMenu(task, e) {
  e.preventDefault();
  contextMenu.value = { x: e.clientX, y: e.clientY, task };
}

function confirmDelete(task) {
  const newSet = new Set(deletingIds.value);
  newSet.add(task.pageId);
  deletingIds.value = newSet;
  contextMenu.value = null;
  deleteTask(task.pageId);
}

function onDocMouseDown(e) {
  if (!contextMenu.value) return;
  const menu = document.querySelector('.board-context-menu');
  if (menu && !menu.contains(e.target)) {
    contextMenu.value = null;
  }
}

onMounted(() => document.addEventListener('mousedown', onDocMouseDown));
onBeforeUnmount(() =>
  document.removeEventListener('mousedown', onDocMouseDown),
);

// ── Navigation ────────────────────────────────────────────────────────────────

function openTask(pageId) {
  router.push(`/tasks/${pageId}?from=board`);
}

// ── Label style ───────────────────────────────────────────────────────────────

function labelPillStyle(label) {
  const s = notionColorStyle(label.color ?? 'default');
  return { background: s.background, color: s.color, borderColor: s.border };
}
</script>

<template>
  <div class="board-view">
    <!-- Header -->
    <div class="board-header">
      <h1 class="board-title">Board</h1>
      <button class="board-refresh-btn" title="Refresh" @click="fetchBoard">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="!boardTasksReady" class="board-loading">
      <div class="board-skeleton-columns">
        <div v-for="i in 3" :key="i" class="board-skeleton-col">
          <div class="board-skeleton-header" />
          <div v-for="j in 3" :key="j" class="board-skeleton-card" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="boardTasksError" class="board-error">
      {{ boardTasksError }}
    </div>

    <!-- Board columns -->
    <div
      v-else
      class="board-columns"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div
        v-for="col in columnData"
        :key="col.status || '__none__'"
        class="board-column"
        :class="[col.tintClass, { 'board-column--drag-over': dragOverColumn === col.status }]"
        :data-col-status="col.status"
        @dragover="onDragOver(col.status, $event)"
        @dragleave="onDragLeave(col.status)"
        @drop="onDrop(col.status, $event)"
      >
        <!-- Column header -->
        <div class="board-column-header">
          <span class="board-column-name">{{ col.displayName }}</span>
          <span class="board-column-count">{{ col.count }}</span>
        </div>

        <!-- Column body -->
        <div class="board-column-body">
          <div
            v-for="task in col.tasks"
            :key="task.pageId"
            class="board-card"
            :class="{
              'board-card--dragging': draggedTask?.pageId === task.pageId || touchDragTask?.pageId === task.pageId,
              'board-card--deleting': deletingIds.has(task.pageId),
            }"
            @click="!deletingIds.has(task.pageId) && openTask(task.pageId)"
            @contextmenu="!deletingIds.has(task.pageId) && onCardContextMenu(task, $event)"
          >
            <!-- Deleting overlay -->
            <div v-if="deletingIds.has(task.pageId)" class="board-card-deleting-overlay">
              <svg class="board-card-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div
              class="board-card-handle"
              :draggable="!deletingIds.has(task.pageId)"
              @dragstart="!deletingIds.has(task.pageId) && onDragStart(task, $event)"
              @dragend="onDragEnd"
              @touchstart.passive="!deletingIds.has(task.pageId) && onTouchStart(task, $event)"
              @click.stop
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </div>
            <div class="board-card-body">
              <p class="board-card-title">{{ task.title }}</p>
              <div class="board-card-meta">
                <span v-if="task.ticketId" class="board-card-id">{{ task.ticketId }}</span>
                <span
                  v-for="label in task.labels"
                  :key="label.name"
                  class="board-card-label"
                  :style="labelPillStyle(label)"
                >{{ label.name }}</span>
              </div>
            </div>
          </div>

          <!-- Empty column drop target -->
          <div v-if="col.count === 0" class="board-column-empty">
            drop here
          </div>
        </div>
      </div>

      <!-- No columns configured -->
      <div v-if="columnData.length === 0" class="board-empty">
        No status columns found. Make sure Notion is configured with a status or select field.
      </div>
    </div>

    <!-- Footer bar -->
    <Teleport to="#view-footer">
      <div class="board-footer-bar">
        <!-- Fuzzy search (grows) -->
        <input
          v-model="boardSearch"
          class="board-footer-search"
          placeholder="Search…"
          type="search"
        />
        <!-- Assignee filter -->
        <AssigneeDropdown
          class="board-footer-dropdown"
          :model-value="boardFilter.assignee"
          :assignees="taskAssignees"
          :head-options="assigneeHeadOptions"
          :popover-up="true"
          size="sm"
          @update:model-value="onAssigneeChange"
        />
        <!-- Label filter -->
        <AssigneeDropdown
          class="board-footer-dropdown"
          :model-value="boardFilter.label"
          :assignees="allLabels.map(l => ({ id: l.name, name: l.name }))"
          :head-options="labelHeadOptions"
          :popover-up="true"
          size="sm"
          @update:model-value="onLabelChange"
        />
      </div>
    </Teleport>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="board-context-menu"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
      >
        <button
          class="board-context-item board-context-item--danger"
          type="button"
          @click="confirmDelete(contextMenu.task)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          Delete
        </button>
      </div>
    </Teleport>

    <!-- Delete error modal -->
    <Teleport to="body">
      <div v-if="deleteError" class="board-error-backdrop" @click.self="deleteError = null">
        <div class="board-error-modal">
          <p class="board-error-modal-title">failed to delete task</p>
          <p class="board-error-modal-body">{{ deleteError }}</p>
          <button class="board-error-modal-close" type="button" @click="deleteError = null">dismiss</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────── */
.board-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-primary);
  overflow: hidden;
}

/* ── Header ──────────────────────────────────── */
.board-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.board-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  margin: 0;
}

.board-refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.board-refresh-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

/* ── Columns container ───────────────────────── */
.board-columns {
  display: flex;
  gap: 12px;
  padding: 16px;
  flex: 1;
  height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  align-items: stretch;
}

/* ── Column ──────────────────────────────────── */
.board-column {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}

.board-column--drag-over {
  border-color: var(--text-muted);
  background: var(--bg-tertiary);
}

/* ── Column status tints ─────────────────────── */
.col-tint-none {
  background: var(--bg-secondary);
}

.col-tint-todo {
  background: color-mix(in srgb, var(--bg-secondary) 94%, #6b7280 6%);
}

.col-tint-progress {
  background: color-mix(in srgb, var(--bg-secondary) 94%, #f59e0b 6%);
}

.col-tint-done {
  background: color-mix(in srgb, var(--bg-secondary) 94%, #22c55e 6%);
}

.col-tint-blocked {
  background: color-mix(in srgb, var(--bg-secondary) 94%, #ef4444 6%);
}

.board-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.board-column-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.board-column-count {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  padding: 1px 6px;
}

.board-column-body {
  display: block;
  padding: 6px;
  overflow-y: auto;
  min-height: 60px;
  flex: 1;
}

.board-column-body > * + * {
  margin-top: 4px;
}

/* ── Card ────────────────────────────────────── */
.board-card {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
  user-select: none;
  overflow: hidden;
}

.board-card:hover {
  border-color: var(--text-muted);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.board-card--dragging {
  opacity: 0.4;
}

.board-card--deleting {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
  position: relative;
}

.board-card-deleting-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  pointer-events: none;
}

@keyframes board-spin {
  to { transform: rotate(360deg); }
}

.board-card-spinner {
  color: var(--text-muted);
  animation: board-spin 0.8s linear infinite;
}

.board-card-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  padding: 8px 0;
  color: var(--border-color);
  cursor: grab;
  transition: color 0.15s;
  touch-action: none;
}

.board-card:hover .board-card-handle {
  color: var(--text-muted);
}

.board-card-handle:active {
  cursor: grabbing;
}

.board-card-body {
  flex: 1;
  min-width: 0;
  padding: 9px 10px 9px 0;
}

.board-card-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 4px;
  line-height: 1.3;
}

.board-card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px 5px;
  min-height: 14px;
}

.board-card-id {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  letter-spacing: 0.02em;
  margin: 0;
}

.board-card-label {
  display: inline-block;
  font-size: 9px;
  font-weight: 500;
  padding: 0 5px;
  border-radius: 8px;
  border: 1px solid;
  white-space: nowrap;
  line-height: 14px;
}

/* ── Empty / error states ────────────────────── */
.board-column-empty {
  padding: 16px;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.board-empty {
  padding: 40px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  max-width: 320px;
  margin: auto;
}

.board-error {
  padding: 40px 24px;
  text-align: center;
  color: var(--error-color);
  font-size: 13px;
}

.board-loading {
  flex: 1;
  padding: 16px;
  overflow: hidden;
}

/* ── Loading skeleton ────────────────────────── */
@keyframes board-shimmer {
  0% { opacity: 0.4; }
  50% { opacity: 0.7; }
  100% { opacity: 0.4; }
}

.board-skeleton-columns {
  display: flex;
  gap: 12px;
}

.board-skeleton-col {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-skeleton-header {
  height: 36px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  animation: board-shimmer 1.4s ease-in-out infinite;
}

.board-skeleton-card {
  height: 56px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  animation: board-shimmer 1.4s ease-in-out infinite;
  animation-delay: 0.1s;
}

/* ── Footer bar ──────────────────────────────── */
.board-footer-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: var(--bottom-bar-height);
  flex: 1;
  min-width: 0;
}

.board-footer-search {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s;
}

.board-footer-search:focus {
  border-color: var(--text-muted);
}

.board-footer-search::placeholder {
  color: var(--text-muted);
}

.board-footer-dropdown {
  flex-shrink: 0;
  width: 120px;
}
</style>

<!-- Context menu — teleported, must be unscoped -->
<style>
.board-context-menu {
  position: fixed;
  z-index: 9999;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 4px;
  min-width: 140px;
}

.board-context-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: calc(var(--radius-sm) - 2px);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.board-context-item:hover {
  background: var(--bg-secondary);
}

.board-context-item--danger {
  color: var(--error-color, #e05252);
}

.board-context-item--danger:hover {
  background: color-mix(in srgb, var(--bg-secondary) 80%, var(--error-color, #e05252) 20%);
}

/* ── Delete error modal ──────────────────────── */
.board-error-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

.board-error-modal {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  padding: 20px 24px;
  max-width: 340px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-error-modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--error-color, #e05252);
  margin: 0;
}

.board-error-modal-body {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
  word-break: break-word;
}

.board-error-modal-close {
  align-self: flex-end;
  margin-top: 4px;
  padding: 5px 14px;
  font-size: 12px;
  font-family: inherit;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.board-error-modal-close:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
</style>
