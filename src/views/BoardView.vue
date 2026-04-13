<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
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
  boardFilterBySelf,
  taskStatusOptions,
  getBoardTasks,
  getTaskStatusOptions,
  updateTaskField,
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
  getBoardTasks();
}

function toggleSelfFilter() {
  boardFilterBySelf.value = !boardFilterBySelf.value;
  fetchBoard();
}

// ── Column status tint ────────────────────────────────────────────────────────

// Returns a CSS class name based on the status name for subtle column tinting
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

// Ordered columns: custom order if set, else Notion group order
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

// Detect if a status belongs to the "Done" group (heuristic: name contains "done")
function isDoneStatus(status) {
  return status.toLowerCase().includes('done');
}

// Sort tasks: by first label name (ascending), then ticket ID descending
// Tasks with no labels sort after labeled ones
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
    // Then by ticket ID descending (numeric suffix if present, else string)
    const aId = a.ticketId ?? '';
    const bId = b.ticketId ?? '';
    const aNum = Number.parseInt(aId.replace(/\D/g, ''), 10);
    const bNum = Number.parseInt(bId.replace(/\D/g, ''), 10);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return bNum - aNum;
    return bId.localeCompare(aId);
  });
}

// Build column data for a given status (or null for "no status")
function buildColumnData(status) {
  let tasksInCol = boardTasks.value.filter((t) =>
    status === null ? !t.status : t.status === status,
  );

  // Done columns: hide archived tasks
  if (status !== null && isDoneStatus(status)) {
    tasksInCol = tasksInCol.filter((t) => !t.archived);
  }

  // Sort: label asc, then ticket ID desc
  tasksInCol = sortTasks(tasksInCol);

  return {
    status: status ?? '',
    displayName: status ?? 'No status',
    count: tasksInCol.length,
    tintClass: columnTintClass(status ?? ''),
    tasks: tasksInCol,
  };
}

// Full column list: "No status" first, then status columns
const columnData = computed(() => {
  if (!boardTasksReady.value) return [];
  const noStatusCol = buildColumnData(null);
  const statusCols = columns.value.map((s) => buildColumnData(s));
  // Only include "No status" column if it has tasks or there are no status columns yet
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

  // Optimistic update
  task.status = targetStatus;
  // Persist to Notion
  updateTaskField(task.pageId, field, fieldType, targetStatus);
}

// ── Touch drag (mobile / Android PWA) ────────────────────────────────────────
// HTML5 drag-and-drop doesn't fire on touch devices — replicate with touch events.

const touchDragTask = ref(null);
const touchClone = ref(null);

function onTouchStart(task, e) {
  // Only track single-finger touch
  if (e.touches.length !== 1) return;
  touchDragTask.value = task;
  dragOverColumn.value = null;

  // Create a visual clone that follows the finger (clone the whole card, not just the handle)
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
  e.preventDefault(); // prevent page scroll while drag is active

  const touch = e.touches[0];

  // Move clone with finger
  if (touchClone.value) {
    touchClone.value.style.left = `${touch.clientX - 60}px`;
    touchClone.value.style.top = `${touch.clientY - 20}px`;
  }

  // Detect which column is under the finger
  if (touchClone.value) touchClone.value.style.display = 'none';
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (touchClone.value) touchClone.value.style.display = '';

  const colEl = el?.closest('[data-col-status]');
  dragOverColumn.value = colEl ? colEl.dataset.colStatus : null;
}

function onTouchEnd() {
  if (!touchDragTask.value) return;

  // Remove clone
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
      <button
        class="board-filter-btn"
        :class="{ 'board-filter-btn--active': boardFilterBySelf }"
        title="Filter: only my tasks"
        @click="toggleSelfFilter"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        Me
      </button>
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
            :class="{ 'board-card--dragging': draggedTask?.pageId === task.pageId || touchDragTask?.pageId === task.pageId }"
            @click="openTask(task.pageId)"
          >
            <div
              class="board-card-handle"
              draggable="true"
              @dragstart="onDragStart(task, $event)"
              @dragend="onDragEnd"
              @touchstart.passive="onTouchStart(task, $event)"
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

.board-filter-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.board-filter-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.board-filter-btn--active {
  background: var(--bg-tertiary);
  border-color: var(--text-muted);
  color: var(--text-primary);
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
</style>
