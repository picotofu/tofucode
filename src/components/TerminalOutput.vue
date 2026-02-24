<script setup>
import DOMPurify from 'dompurify';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ansiToHtml } from '../utils/ansi';

const props = defineProps({
  processes: {
    type: Array,
    default: () => [],
  },
  expandedHistory: {
    type: Set,
    default: () => new Set(),
  },
  activeTab: {
    type: String,
    default: 'history', // 'bookmarks' | 'active' | 'history'
  },
  bookmarks: {
    type: Object,
    default: () => ({ global: [], project: [] }),
  },
  watchEnabledIds: {
    type: Set,
    default: () => new Set(),
  },
  projectSlug: {
    type: String,
    default: '',
  },
});

const emit = defineEmits([
  'kill',
  'clear',
  'toggle-expand',
  'update:activeTab',
  'replay',
  'add-bookmark',
  'remove-bookmark',
  'play-bookmark',
  'watch-update',
]);

const historyContentRef = ref(null);
const activeContentRef = ref(null);
const commandRefs = ref([]); // Refs for each command in history (for navigation)
const currentCommandIndex = ref(-1); // Currently visible command (for navigation)
const isNavigating = ref(false); // Flag to prevent scroll handler from overriding during navigation

// Scope picker state
const showScopePicker = ref(null); // processId that has scope picker open, or null

// Watch panel state — bookmarkId whose panel is open, or null
const showWatchPanel = ref(null);

// Local watch config edits while the panel is open { interval, mode }
const watchPanelConfig = ref({ interval: 10, mode: 'stdout' });

function openWatchPanel(b) {
  if (showWatchPanel.value === b.id) {
    showWatchPanel.value = null;
    return;
  }
  showWatchPanel.value = b.id;
  watchPanelConfig.value = {
    interval: b.watch?.interval ?? 10,
    mode: b.watch?.mode ?? 'stdout',
  };
}

function closeWatchPanel() {
  showWatchPanel.value = null;
}

function getBookmarkScope(b) {
  if (props.bookmarks.global.some((g) => g.id === b.id)) return 'global';
  return 'project';
}

function toggleWatch(b) {
  const scope = getBookmarkScope(b);
  const isEnabled = props.watchEnabledIds.has(b.id);
  emit('watch-update', b.id, scope, {
    enabled: !isEnabled,
    interval: watchPanelConfig.value.interval,
    mode: watchPanelConfig.value.mode,
  });
  if (!isEnabled) {
    // Closing panel when enabling — watch will now show in Active tab
    showWatchPanel.value = null;
  }
}

// Always disables the watch — used by the Stop button on process cards in the Active tab.
// Unlike toggleWatch (which reads isEnabled), this unconditionally sends enabled:false.
function disableWatch(b) {
  if (!b) return;
  const scope = getBookmarkScope(b);
  emit('watch-update', b.id, scope, {
    enabled: false,
    interval: b.watch?.interval ?? 10,
    mode: b.watch?.mode ?? 'stdout',
  });
}

function setWatchMode(b, mode) {
  watchPanelConfig.value.mode = mode;
  // If already watching, update live
  if (props.watchEnabledIds.has(b.id)) {
    const scope = getBookmarkScope(b);
    emit('watch-update', b.id, scope, {
      enabled: true,
      interval: watchPanelConfig.value.interval,
      mode,
    });
  }
}

const MIN_INTERVAL_S = 1;
const MAX_INTERVAL_S = 3600;

function clampInterval(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return MIN_INTERVAL_S;
  return Math.max(MIN_INTERVAL_S, Math.min(MAX_INTERVAL_S, Math.round(n)));
}

// Table parsing for watch table mode.
// Supports both TSV (tab-separated) and space-aligned CLI table output (e.g. gcloud, kubectl).
// Returns { headers, rows } on success, or null to fall back to raw stdout display.
function parseTable(proc) {
  const text = proc.output.map((c) => c.text).join('');
  // Strip ANSI escape codes before parsing
  // biome-ignore lint/suspicious/noControlCharactersInRegex: needed to strip ANSI
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = plain.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;

  // --- TSV path ---
  if (plain.includes('\t')) {
    const allRows = lines.map((l) => l.split('\t'));
    const headers = allRows[0];
    const colCount = headers.length;
    if (colCount < 2) return null;
    const rows = allRows.slice(1).map((row) => {
      const r = row.slice(0, colCount);
      while (r.length < colCount) r.push('');
      return r;
    });
    return { headers, rows };
  }

  // --- Space-aligned path (gcloud, kubectl style) ---
  // Detect column boundaries from the header line: columns are separated by 2+ spaces.
  const header = lines[0];
  // Find start positions of each column by splitting on 2+ spaces
  const colStarts = [];
  let i = 0;
  while (i < header.length) {
    // Skip leading spaces at start
    if (i === 0 && header[i] === ' ') {
      i++;
      continue;
    }
    colStarts.push(i);
    // Find end of this word
    const spaceRun = header.indexOf('  ', i);
    if (spaceRun === -1) break;
    // Skip past the 2+ space gap to next column
    i = spaceRun;
    while (i < header.length && header[i] === ' ') i++;
  }
  if (colStarts.length < 2) return null;

  // Extract header names from their positions
  const headers = colStarts.map((start, idx) => {
    const end = colStarts[idx + 1] ?? header.length;
    return header.slice(start, end).trim();
  });

  // Extract data rows using the same column boundaries
  const rows = lines.slice(1).map((line) =>
    colStarts.map((start, idx) => {
      const end = colStarts[idx + 1] ?? line.length;
      return start < line.length ? line.slice(start, end).trim() : '';
    }),
  );

  // Sanity check: at least one non-empty data row
  if (rows.length === 0) return null;

  return { headers, rows };
}

// Local expanded state - new processes start expanded
const localExpandedState = ref(new Map());

// Initialize expanded state for new processes
watch(
  () => props.processes,
  (newProcesses) => {
    for (const proc of newProcesses) {
      // Only set if not already tracked and not running
      if (!localExpandedState.value.has(proc.id) && proc.status !== 'running') {
        localExpandedState.value.set(proc.id, true); // Expanded by default
      }
    }
  },
  { immediate: true, deep: true },
);

// Processes shown in the Active tab:
// - all non-watch running processes
// - all watch processes regardless of status (keep last output visible between ticks)
const runningProcesses = computed(() =>
  props.processes.filter((p) => p.status === 'running' || p.isWatch),
);

// All bookmarks as a flat list (global + project)
const allBookmarks = computed(() => [
  ...props.bookmarks.global,
  ...props.bookmarks.project,
]);

// Map of bookmarkId → bookmark for quick lookup
const bookmarkById = computed(() => {
  const map = new Map();
  for (const b of allBookmarks.value) map.set(b.id, b);
  return map;
});

// Watch bookmarks that have no process entry at all yet (before the first tick runs).
// Once a tick has run (even if completed), the process entry stays visible — no placeholder needed.
const idleWatches = computed(() => {
  const trackedWatchIds = new Set(
    props.processes
      .filter((p) => p.isWatch && p.watchBookmarkId)
      .map((p) => p.watchBookmarkId),
  );
  return Array.from(props.watchEnabledIds)
    .filter((id) => !trackedWatchIds.has(id))
    .map((id) => bookmarkById.value.get(id))
    .filter(Boolean);
});

// Returns true if this command has an active watch on it
function isCommandWatched(command) {
  return allBookmarks.value.some(
    (b) => b.command === command && props.watchEnabledIds.has(b.id),
  );
}

// All processes sorted by startedAt ascending (oldest first, newest at bottom)
const allProcesses = computed(() =>
  [...props.processes].sort((a, b) => a.startedAt - b.startedAt),
);

// Check bookmark state for a command
function bookmarkState(command) {
  if (props.bookmarks.global.some((b) => b.command === command))
    return 'global';
  if (props.bookmarks.project.some((b) => b.command === command))
    return 'project';
  return '';
}

function getBookmarkId(command, scope) {
  const list =
    scope === 'global' ? props.bookmarks.global : props.bookmarks.project;
  return list.find((b) => b.command === command)?.id ?? null;
}

function handleBookmarkClick(proc) {
  const state = bookmarkState(proc.command);
  if (state) {
    // Already bookmarked — remove it
    const id = getBookmarkId(proc.command, state);
    if (id) emit('remove-bookmark', state, id);
  } else {
    // Not bookmarked — show scope picker
    showScopePicker.value = showScopePicker.value === proc.id ? null : proc.id;
  }
}

function confirmBookmark(proc, scope) {
  emit('add-bookmark', scope, proc.command, proc.cwd);
  showScopePicker.value = null;
}

function closeScopePicker() {
  showScopePicker.value = null;
  showWatchPanel.value = null;
}

// Scroll to bottom (works for both active and history tabs)
function scrollHistoryToBottom() {
  const activeRef =
    props.activeTab === 'history' ? historyContentRef : activeContentRef;
  if (activeRef.value) {
    activeRef.value.scrollTop = activeRef.value.scrollHeight;
  }
}

// Scroll to bottom on mount and when processes change
onMounted(() => {
  nextTick(() => {
    scrollHistoryToBottom();
    updateCurrentCommandIndex();
  });
});

watch(
  () => props.processes.length,
  () => {
    nextTick(() => {
      scrollHistoryToBottom();
      updateCurrentCommandIndex();
    });
  },
);

// Scroll to bottom when switching to history tab
watch(
  () => props.activeTab,
  (tab) => {
    if (tab === 'history') {
      nextTick(() => {
        scrollHistoryToBottom();
        updateCurrentCommandIndex();
      });
    }
  },
);

// Update current command index when processes change
watch(
  () => allProcesses.value.length,
  (newLength) => {
    // Auto-navigate to newest command when new commands are added
    if (
      currentCommandIndex.value === -1 ||
      currentCommandIndex.value >= newLength - 1
    ) {
      currentCommandIndex.value = Math.max(0, newLength - 1);
    }
  },
  { immediate: true },
);

// Handle scroll to update current command index
function handleScroll() {
  // Skip updates during programmatic navigation
  if (isNavigating.value) return;
  updateCurrentCommandIndex();
}

// Update which command is currently in view based on scroll position
function updateCurrentCommandIndex() {
  if (!historyContentRef.value || commandRefs.value.length === 0) return;
  if (isNavigating.value) return; // Don't update during navigation

  const containerTop = historyContentRef.value.scrollTop;
  const containerHeight = historyContentRef.value.clientHeight;
  const viewportMiddle = containerTop + containerHeight / 3; // Upper third of viewport

  // Find the command whose top is closest to (but not below) the viewport middle
  let closestIndex = 0;
  for (let i = 0; i < commandRefs.value.length; i++) {
    const el = commandRefs.value[i];
    if (el) {
      const commandTop = el.offsetTop;
      if (commandTop <= viewportMiddle) {
        closestIndex = i;
      }
    }
  }
  currentCommandIndex.value = closestIndex;
}

// Command navigation functions (similar to chat turn navigation)
function goToPreviousCommand() {
  const targetIndex = Math.max(0, currentCommandIndex.value - 1);
  scrollToCommand(targetIndex);
}

function goToNextCommand() {
  const targetIndex = Math.min(
    allProcesses.value.length - 1,
    currentCommandIndex.value + 1,
  );
  scrollToCommand(targetIndex);
}

function scrollToCommand(index) {
  const el = commandRefs.value[index];
  if (el && historyContentRef.value) {
    // Set navigation flag to prevent scroll handler from overriding
    isNavigating.value = true;
    currentCommandIndex.value = index;

    // Find the command-line element within the terminal-block
    const commandLineEl = el.querySelector('.command-line');
    if (commandLineEl) {
      // Calculate absolute position: parent offset + child offset
      const scrollTop = el.offsetTop + commandLineEl.offsetTop - 16;
      historyContentRef.value.scrollTo({
        top: scrollTop,
        behavior: 'smooth',
      });
    } else {
      // Fallback to terminal-block if command-line not found
      historyContentRef.value.scrollTo({
        top: el.offsetTop - 16,
        behavior: 'smooth',
      });
    }

    // Clear navigation flag after scroll completes (smooth scroll takes ~300-500ms)
    setTimeout(() => {
      isNavigating.value = false;
    }, 600);
  }
}

function setCommandRef(index, el) {
  commandRefs.value[index] = el;
}

function formatCwd(cwd) {
  if (!cwd) return '';
  // Show last 2 path segments
  const parts = cwd.split('/');
  return parts.slice(-2).join('/');
}

function formatDuration(startedAt, endedAt) {
  const duration = (endedAt || Date.now()) - startedAt;
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
  return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
}

function getStatusIcon(status) {
  switch (status) {
    case 'running':
      return null; // Use spinner instead
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
    case 'killed':
      return '■';
    default:
      return '?';
  }
}

function isExpanded(processId) {
  return localExpandedState.value.get(processId) ?? false;
}

function toggleExpand(processId) {
  const current = localExpandedState.value.get(processId) ?? false;
  localExpandedState.value.set(processId, !current);
}

function setTab(tab) {
  emit('update:activeTab', tab);
}

// Copy output functionality
const copiedProcessId = ref(null);

function getOutputText(proc) {
  return proc.output.map((chunk) => chunk.text).join('');
}

// Convert output to HTML with ANSI colors
function getOutputHtml(proc) {
  const raw = proc.output
    .map((chunk) => {
      const html = ansiToHtml(chunk.text);
      // Wrap in stream class for stderr coloring (only if no ANSI colors present)
      if (chunk.stream === 'stderr' && !chunk.text.includes('\x1b[')) {
        return `<span class="stream-stderr">${html}</span>`;
      }
      return html;
    })
    .join('');
  // Defense-in-depth: sanitize even though ansiToHtml escapes HTML
  return DOMPurify.sanitize(raw);
}

async function copyOutput(proc, e) {
  e.stopPropagation(); // Don't trigger expand/collapse
  try {
    await navigator.clipboard.writeText(getOutputText(proc));
    copiedProcessId.value = proc.id;
    setTimeout(() => {
      copiedProcessId.value = null;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

// Expose navigation functions for parent component
defineExpose({
  scrollHistoryToBottom,
  goToPreviousCommand,
  goToNextCommand,
});
</script>

<template>
  <div class="terminal-output" @click="closeScopePicker">
    <!-- Bookmarks Tab Content -->
    <div class="tab-content" v-if="activeTab === 'bookmarks'">
      <template v-if="bookmarks.global.length || bookmarks.project.length">
        <!-- Global bookmarks -->
        <div class="bookmark-section" v-if="bookmarks.global.length">
          <div class="bookmark-section-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Global
          </div>
          <div v-for="b in bookmarks.global" :key="b.id" class="bookmark-row-wrapper">
            <div class="bookmark-row">
              <span class="bookmark-command">{{ b.command }}</span>
              <span v-if="b.cwd" class="bookmark-cwd">{{ formatCwd(b.cwd) }}</span>
              <div class="bookmark-actions">
                <button
                  v-if="!watchEnabledIds.has(b.id)"
                  class="bookmark-action-btn"
                  @click.stop="$emit('play-bookmark', b.command, b.cwd)"
                  title="Run this command"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
                <button
                  class="bookmark-action-btn"
                  :class="{ 'watch-active': watchEnabledIds.has(b.id) }"
                  @click.stop="openWatchPanel(b)"
                  :title="watchEnabledIds.has(b.id) ? 'Watch active — click to configure' : 'Set up watch mode'"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button
                  class="bookmark-action-btn remove"
                  @click.stop="$emit('remove-bookmark', 'global', b.id)"
                  title="Remove bookmark"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            <!-- Watch panel -->
            <div v-if="showWatchPanel === b.id" class="watch-panel" @click.stop>
              <div class="watch-panel-row">
                <span class="watch-panel-label">Mode</span>
                <div class="watch-mode-btns">
                  <button
                    class="watch-mode-btn"
                    :class="{ active: watchPanelConfig.mode === 'stdout' }"
                    @click.stop="setWatchMode(b, 'stdout')"
                  >stdout</button>
                  <button
                    class="watch-mode-btn"
                    :class="{ active: watchPanelConfig.mode === 'table' }"
                    @click.stop="setWatchMode(b, 'table')"
                  >table</button>
                </div>
                <span class="watch-panel-label">Interval</span>
                <input
                  class="watch-interval-input"
                  type="number"
                  min="1"
                  max="3600"
                  :value="watchPanelConfig.interval"
                  @input="watchPanelConfig.interval = clampInterval($event.target.value)"
                  @blur="watchPanelConfig.interval = clampInterval($event.target.value)"
                  @click.stop
                />
                <span class="watch-panel-label">sec</span>
                <button
                  class="watch-toggle-btn"
                  :class="{ 'watch-enabled': watchEnabledIds.has(b.id) }"
                  @click.stop="toggleWatch(b)"
                >
                  {{ watchEnabledIds.has(b.id) ? 'Stop' : 'Start' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Project bookmarks -->
        <div class="bookmark-section" v-if="bookmarks.project.length">
          <div class="bookmark-section-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Project
          </div>
          <div v-for="b in bookmarks.project" :key="b.id" class="bookmark-row-wrapper">
            <div class="bookmark-row">
              <span class="bookmark-command">{{ b.command }}</span>
              <span v-if="b.cwd" class="bookmark-cwd">{{ formatCwd(b.cwd) }}</span>
              <div class="bookmark-actions">
                <button
                  v-if="!watchEnabledIds.has(b.id)"
                  class="bookmark-action-btn"
                  @click.stop="$emit('play-bookmark', b.command, b.cwd)"
                  title="Run this command"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
                <button
                  class="bookmark-action-btn"
                  :class="{ 'watch-active': watchEnabledIds.has(b.id) }"
                  @click.stop="openWatchPanel(b)"
                  :title="watchEnabledIds.has(b.id) ? 'Watch active — click to configure' : 'Set up watch mode'"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button
                  class="bookmark-action-btn remove"
                  @click.stop="$emit('remove-bookmark', 'project', b.id)"
                  title="Remove bookmark"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            <!-- Watch panel -->
            <div v-if="showWatchPanel === b.id" class="watch-panel" @click.stop>
              <div class="watch-panel-row">
                <span class="watch-panel-label">Mode</span>
                <div class="watch-mode-btns">
                  <button
                    class="watch-mode-btn"
                    :class="{ active: watchPanelConfig.mode === 'stdout' }"
                    @click.stop="setWatchMode(b, 'stdout')"
                  >stdout</button>
                  <button
                    class="watch-mode-btn"
                    :class="{ active: watchPanelConfig.mode === 'table' }"
                    @click.stop="setWatchMode(b, 'table')"
                  >table</button>
                </div>
                <span class="watch-panel-label">Interval</span>
                <input
                  class="watch-interval-input"
                  type="number"
                  min="1"
                  max="3600"
                  :value="watchPanelConfig.interval"
                  @input="watchPanelConfig.interval = clampInterval($event.target.value)"
                  @blur="watchPanelConfig.interval = clampInterval($event.target.value)"
                  @click.stop
                />
                <span class="watch-panel-label">sec</span>
                <button
                  class="watch-toggle-btn"
                  :class="{ 'watch-enabled': watchEnabledIds.has(b.id) }"
                  @click.stop="toggleWatch(b)"
                >
                  {{ watchEnabledIds.has(b.id) ? 'Stop' : 'Start' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div class="terminal-empty" v-else>
        <p>No bookmarks yet</p>
        <p class="hint">Click ☆ on any history command to save it</p>
      </div>
    </div>

    <!-- Active Tab Content -->
    <div class="tab-content" v-if="activeTab === 'active'" ref="activeContentRef">
      <div v-if="runningProcesses.length > 0 || idleWatches.length > 0" class="process-list">
        <!-- Idle watch placeholders (between ticks) -->
        <div
          v-for="b in idleWatches"
          :key="`idle-${b.id}`"
          class="terminal-block running watch-process watch-idle"
        >
          <div class="terminal-header">
            <span class="terminal-status running">
              <span class="spinner"></span>
            </span>
            <span class="watch-badge">👁 Watch</span>
            <span class="terminal-command">$ {{ b.command }}</span>
            <span class="terminal-meta">
              <span class="terminal-cwd">{{ formatCwd(b.cwd) }}</span>
              <span class="watch-idle-label">waiting…</span>
            </span>
            <button
              class="kill-btn"
              @click="disableWatch(b)"
              title="Stop watch"
            >
              Stop
            </button>
          </div>
          <div class="watch-idle-hint">Next run in ~{{ b.watch?.interval ?? 10 }}s</div>
        </div>
        <div
          v-for="proc in runningProcesses"
          :key="proc.id"
          class="terminal-block"
          :class="{
            running: proc.status === 'running',
            'watch-process': proc.isWatch,
          }"
        >
          <div class="terminal-header">
            <span class="terminal-status" :class="proc.status === 'running' ? 'running' : 'completed'">
              <span v-if="proc.status === 'running'" class="spinner"></span>
              <template v-else>✓</template>
            </span>
            <span v-if="proc.isWatch" class="watch-badge">👁 Watch</span>
            <span class="terminal-command">$ {{ proc.command }}</span>
            <span class="terminal-meta">
              <span class="terminal-cwd">{{ formatCwd(proc.cwd) }}</span>
              <span v-if="proc.status === 'running'" class="terminal-pid">PID {{ proc.pid }}</span>
            </span>
            <button
              v-if="proc.output.length > 0"
              class="copy-btn"
              :class="{ copied: copiedProcessId === proc.id }"
              @click="copyOutput(proc, $event)"
              :title="copiedProcessId === proc.id ? 'Copied!' : 'Copy output'"
            >
              {{ copiedProcessId === proc.id ? '✓' : 'Copy' }}
            </button>
            <!-- Running watch: Kill stops the current tick; completed watch: Stop disables the watch -->
            <button
              v-if="proc.isWatch && proc.status !== 'running'"
              class="kill-btn"
              @click="disableWatch(bookmarkById.get(proc.watchBookmarkId))"
              title="Stop watch"
            >
              Stop
            </button>
            <button
              v-else
              class="kill-btn"
              @click="$emit('kill', proc.id)"
              title="Kill process"
            >
              Kill
            </button>
          </div>
          <!-- Table mode for watch processes -->
          <div v-if="proc.isWatch && proc.watchMode === 'table'" class="watch-table-wrapper">
            <template v-if="parseTable(proc)">
              <table class="watch-table">
                <thead>
                  <tr>
                    <th v-for="(h, i) in parseTable(proc).headers" :key="i">{{ h }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in parseTable(proc).rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
            <pre v-else class="terminal-pre" v-html="getOutputHtml(proc)"></pre>
          </div>
          <pre v-else class="terminal-pre" v-html="getOutputHtml(proc)"></pre>
        </div>
      </div>
      <div class="terminal-empty" v-else>
        <p>No active processes</p>
        <p class="hint">Running commands will appear here</p>
      </div>
    </div>

    <!-- History Tab Content -->
    <div class="tab-content" v-if="activeTab === 'history'" ref="historyContentRef" @scroll="handleScroll">
      <div v-if="allProcesses.length > 0" class="process-list history">
        <div
          v-for="(proc, index) in allProcesses"
          :key="proc.id"
          :ref="(el) => setCommandRef(index, el)"
          class="terminal-block"
          :class="{ running: proc.status === 'running', expanded: isExpanded(proc.id) }"
        >
          <!-- Command line -->
          <div class="command-line" @click="proc.status !== 'running' && toggleExpand(proc.id)">
            <span class="terminal-status" :class="proc.status">
              <span v-if="proc.status === 'running'" class="spinner"></span>
              <template v-else>{{ getStatusIcon(proc.status) }}</template>
            </span>
            <span class="prompt">$</span>
            <span class="command-text">{{ proc.command }}</span>
            <span class="terminal-meta">
              <template v-if="proc.status === 'running'">
                <span class="terminal-cwd">{{ formatCwd(proc.cwd) }}</span>
                <span class="terminal-pid">PID {{ proc.pid }}</span>
              </template>
              <template v-else>
                <span class="terminal-exit" :class="proc.status">
                  exit {{ proc.exitCode ?? proc.signal }}
                </span>
                <span class="terminal-duration">{{ formatDuration(proc.startedAt, proc.endedAt) }}</span>
              </template>
            </span>
            <button
              v-if="proc.status !== 'running' && !isCommandWatched(proc.command)"
              class="replay-btn"
              @click.stop="$emit('replay', proc.command, proc.cwd)"
              title="Run this command again"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>

            <!-- Bookmark button (only for completed commands) -->
            <div v-if="proc.status !== 'running'" class="bookmark-btn-wrapper" @click.stop>
              <button
                class="bookmark-btn"
                :class="{
                  'is-global': bookmarkState(proc.command) === 'global',
                  'is-project': bookmarkState(proc.command) === 'project',
                }"
                @click.stop="handleBookmarkClick(proc)"
                :title="bookmarkState(proc.command) ? 'Remove bookmark' : 'Bookmark command'"
              >
                <!-- Globe icon when global bookmark -->
                <svg v-if="bookmarkState(proc.command) === 'global'" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12" stroke="var(--bg-primary)" stroke-width="1.5"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="var(--bg-primary)" stroke-width="1.5"/>
                </svg>
                <!-- Folder icon when project bookmark -->
                <svg v-else-if="bookmarkState(proc.command) === 'project'" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <!-- Outline star/bookmark when not bookmarked -->
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>

              <!-- Scope picker popover -->
              <div v-if="showScopePicker === proc.id" class="scope-picker" @click.stop>
                <button class="scope-option" @click.stop="confirmBookmark(proc, 'global')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  Global
                </button>
                <button class="scope-option" @click.stop="confirmBookmark(proc, 'project')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  Project
                </button>
              </div>
            </div>

            <button
              v-if="proc.output.length > 0 && (proc.status === 'running' || isExpanded(proc.id))"
              class="copy-btn"
              :class="{ copied: copiedProcessId === proc.id }"
              @click="copyOutput(proc, $event)"
              :title="copiedProcessId === proc.id ? 'Copied!' : 'Copy output'"
            >
              {{ copiedProcessId === proc.id ? '✓' : 'Copy' }}
            </button>
            <button
              v-if="proc.status === 'running'"
              class="kill-btn"
              @click.stop="$emit('kill', proc.id)"
              title="Kill process"
            >
              Kill
            </button>
          </div>

          <!-- Output -->
          <pre v-if="proc.status === 'running' || isExpanded(proc.id)" class="terminal-pre" v-html="getOutputHtml(proc)"></pre>
        </div>
      </div>
      <div class="terminal-empty" v-else>
        <p>No commands yet</p>
        <p class="hint">Type a command below to execute</p>
      </div>
    </div>

    <!-- Command navigation buttons (bottom-right, only in history tab) -->
    <div class="command-navigation" v-if="activeTab === 'history' && allProcesses.length > 1">
      <button
        class="command-nav-btn"
        :disabled="currentCommandIndex <= 0"
        @click="goToPreviousCommand"
        title="Previous command"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </button>
      <span class="command-counter">{{ currentCommandIndex + 1 }}/{{ allProcesses.length }}</span>
      <button
        class="command-nav-btn"
        :disabled="currentCommandIndex >= allProcesses.length - 1"
        @click="goToNextCommand"
        title="Next command"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.terminal-output {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  font-family: var(--font-mono);
  font-size: 13px;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.process-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}

/* Active tab - keep boxed style */
.process-list:not(.history) .terminal-block {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.process-list:not(.history) .terminal-block.running {
  border-color: var(--warning-color);
  border-left-width: 3px;
}

.process-list:not(.history) .terminal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
}

/* History tab - flat terminal style */
.process-list.history {
  gap: 0;
  padding: 16px;
}

.process-list.history .terminal-block {
  position: relative;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.process-list.history .terminal-block.running {
  border-left: none;
  background: rgba(251, 146, 60, 0.05);
  padding-left: 12px;
  margin-left: -12px;
  padding-right: 12px;
  margin-right: -12px;
  border-radius: var(--radius-sm);
}

/* History tab inline replay button */
.process-list.history .replay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.process-list.history .replay-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

/* Bookmark button */
.bookmark-btn-wrapper {
  position: relative;
}

.bookmark-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
}

.bookmark-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.bookmark-btn.is-global {
  color: var(--accent-color);
}

.bookmark-btn.is-global:hover {
  color: var(--accent-color);
  background: rgba(147, 51, 234, 0.1);
}

.bookmark-btn.is-project {
  color: var(--warning-color);
}

.bookmark-btn.is-project:hover {
  color: var(--warning-color);
  background: rgba(245, 158, 11, 0.1);
}

/* Scope picker popover */
.scope-picker {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 4px;
  z-index: 100;
  box-shadow: var(--shadow-md);
  white-space: nowrap;
}

.scope-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
  text-align: left;
}

.scope-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Bookmarks tab */
.bookmark-section {
  padding: 12px 16px 8px;
}

.bookmark-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.bookmark-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.bookmark-command {
  flex: 1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.bookmark-cwd {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.bookmark-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.bookmark-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.bookmark-action-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.bookmark-action-btn.remove:hover {
  color: var(--error-color);
  background: rgba(239, 68, 68, 0.1);
}

.command-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  cursor: pointer;
  line-height: 1.6;
}

.command-line .prompt {
  color: var(--text-muted);
  font-weight: 600;
  flex-shrink: 0;
}

.command-line .command-text {
  flex: 1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.terminal-status {
  flex-shrink: 0;
  font-weight: 600;
}

.terminal-status.running {
  color: var(--warning-color);
}

.terminal-status.completed {
  color: var(--success-color);
}

.terminal-status.error {
  color: var(--error-color);
}

.terminal-status.killed {
  color: var(--text-muted);
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--warning-color);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Active tab command styling */
.process-list:not(.history) .terminal-command {
  flex: 1;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.terminal-cwd,
.terminal-pid,
.terminal-duration {
  font-size: 11px;
  color: var(--text-muted);
}

.terminal-exit {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.terminal-exit.completed {
  background: rgba(34, 197, 94, 0.1);
  color: var(--success-color);
}

.terminal-exit.error {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error-color);
}

.terminal-exit.killed {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

/* Active tab replay button (inline) */
.process-list:not(.history) .replay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.process-list:not(.history) .replay-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.kill-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--error-color);
  background: rgba(239, 68, 68, 0.1);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.kill-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

.copy-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.copy-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.copy-btn.copied {
  color: var(--success-color);
  background: rgba(34, 197, 94, 0.1);
}

/* Active tab terminal output */
.process-list:not(.history) .terminal-pre {
  margin: 0;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  line-height: 1.5;
}

.process-list:not(.history) .terminal-block.running .terminal-pre {
  max-height: 400px;
}

/* History tab terminal output - flat style */
.process-list.history .terminal-pre {
  margin: 0;
  padding: 8px 0 8px 24px; /* Indent to align with command */
  max-height: none; /* No height limit - fully expanded */
  overflow-y: visible; /* No scroll */
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  line-height: 1.5;
  background: transparent;
}

.process-list.history .terminal-block.running .terminal-pre {
  max-height: none;
  padding-left: 24px;
}

.stream-stdout {
  color: var(--text-primary);
}

.stream-stderr {
  color: var(--error-color);
}

.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 48px;
  color: var(--text-secondary);
}

.terminal-empty .hint {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

/* Command navigation buttons (matches chat turn navigation) */
.command-navigation {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 4px;
  z-index: 10;
  box-shadow: var(--shadow-md);
}

.command-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--text-secondary);
  background: transparent;
  transition: background 0.15s, color 0.15s;
}

.command-nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.command-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.command-counter {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 0 4px;
  min-width: 36px;
  text-align: center;
}

/* Bookmark row wrapper (includes watch panel) */
.bookmark-row-wrapper {
  border-bottom: 1px solid var(--border-color);
}

.bookmark-row-wrapper .bookmark-row {
  border-bottom: none;
}

/* Eye / watch button active state */
.bookmark-action-btn.watch-active {
  color: var(--accent-color);
  background: rgba(147, 51, 234, 0.1);
}

.bookmark-action-btn.watch-active:hover {
  background: rgba(147, 51, 234, 0.2);
}

/* Watch panel */
.watch-panel {
  padding: 8px 0 10px 0;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  margin: 0 0 4px 0;
}

.watch-panel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  flex-wrap: wrap;
}

.watch-panel-label {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.watch-mode-btns {
  display: flex;
  gap: 2px;
}

.watch-mode-btn {
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.watch-mode-btn.active {
  color: var(--accent-color);
  background: rgba(147, 51, 234, 0.15);
}

.watch-mode-btn:hover:not(.active) {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.watch-interval-input {
  width: 52px;
  padding: 3px 6px;
  font-size: 11px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  text-align: center;
}

.watch-toggle-btn {
  margin-left: auto;
  padding: 3px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  transition: background 0.15s, color 0.15s;
}

.watch-toggle-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.watch-toggle-btn.watch-enabled {
  color: var(--error-color);
  background: rgba(239, 68, 68, 0.1);
}

.watch-toggle-btn.watch-enabled:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Watch process badge in Active tab */
.watch-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-color);
  background: rgba(147, 51, 234, 0.12);
  border-radius: var(--radius-sm);
  padding: 2px 7px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Watch process border accent */
.process-list:not(.history) .terminal-block.watch-process {
  border-color: var(--accent-color);
}

/* Watch table rendering */
.watch-table-wrapper {
  padding: 8px 12px 12px;
  overflow-x: auto;
}

.watch-table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
  min-width: max-content;
}

.watch-table th {
  text-align: left;
  padding: 4px 12px 4px 0;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.watch-table td {
  padding: 4px 12px 4px 0;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.watch-table tbody tr:last-child td {
  border-bottom: none;
}

.watch-table tbody tr:hover td {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* Idle watch placeholder (between ticks) */
.watch-idle {
  opacity: 0.75;
}

.watch-idle-label {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.watch-idle-hint {
  padding: 6px 12px 8px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}
</style>
