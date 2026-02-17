<script setup>
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
    default: 'history', // 'active' | 'history'
  },
});

const emit = defineEmits([
  'kill',
  'clear',
  'toggle-expand',
  'update:activeTab',
  'replay',
]);

const historyContentRef = ref(null);
const activeContentRef = ref(null);
const commandRefs = ref([]); // Refs for each command in history (for navigation)
const currentCommandIndex = ref(-1); // Currently visible command (for navigation)
const isNavigating = ref(false); // Flag to prevent scroll handler from overriding during navigation

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

// Running processes only (for Active tab)
const runningProcesses = computed(() =>
  props.processes.filter((p) => p.status === 'running'),
);

// All processes sorted by startedAt ascending (oldest first, newest at bottom)
const allProcesses = computed(() =>
  [...props.processes].sort((a, b) => a.startedAt - b.startedAt),
);

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
  return proc.output
    .map((chunk) => {
      const html = ansiToHtml(chunk.text);
      // Wrap in stream class for stderr coloring (only if no ANSI colors present)
      if (chunk.stream === 'stderr' && !chunk.text.includes('\x1b[')) {
        return `<span class="stream-stderr">${html}</span>`;
      }
      return html;
    })
    .join('');
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
  <div class="terminal-output">
    <!-- Active Tab Content -->
    <div class="tab-content" v-if="activeTab === 'active'" ref="activeContentRef">
      <div v-if="runningProcesses.length > 0" class="process-list">
        <div
          v-for="proc in runningProcesses"
          :key="proc.id"
          class="terminal-block running"
        >
          <div class="terminal-header">
            <span class="terminal-status running">
              <span class="spinner"></span>
            </span>
            <span class="terminal-command">$ {{ proc.command }}</span>
            <span class="terminal-meta">
              <span class="terminal-cwd">{{ formatCwd(proc.cwd) }}</span>
              <span class="terminal-pid">PID {{ proc.pid }}</span>
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
            <button class="kill-btn" @click="$emit('kill', proc.id)" title="Kill process">
              Kill
            </button>
          </div>
          <pre class="terminal-pre" v-html="getOutputHtml(proc)"></pre>
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
              v-if="proc.status !== 'running'"
              class="replay-btn"
              @click.stop="$emit('replay', proc.command, proc.cwd)"
              title="Run this command again"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
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
</style>
