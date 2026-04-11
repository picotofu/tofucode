<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';
import NotesPanel from './NotesPanel.vue';
import TasksPanel from './TasksPanel.vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: true,
  },
  activeTab: {
    type: String,
    default: null,
  },
  notionEnabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'open-settings', 'new-project']);

const route = useRoute();
const router = useRouter();
const {
  connected,
  projects,
  recentSessions,
  sessionsReady,
  sessionStatuses,
  terminalCounts,
  currentVersion,
  updateAvailable,
  tasks,
  tasksReady,
  tasksError,
  tasksNextCursor,
  tasksFilter,
  taskStatusOptions,
  taskAssignees,
  taskSelfId,
  lastCreatedPageId,
  getProjects,
  getRecentSessionsImmediate,
  getTasks,
  loadMoreTasks,
  setTasksFilter,
  createTask,
  getTaskStatusOptions,
  getTaskAssignees,
  dismissUpdate,
  send,
  onMessage,
  openCloneDialog,
} = useWebSocket();

// Resolved active tab — falls back to 'sessions' when null (sidebar closed state)
const resolvedTab = computed(() => props.activeTab ?? 'sessions');

// Project sort state (default: recent first; true = A-Z)
const sortAZ = ref(false);

const sortedProjects = computed(() => {
  if (!sortAZ.value) return projects.value;
  return [...projects.value].sort((a, b) => a.name.localeCompare(b.name));
});

// Upgrade state
const isUpgrading = ref(false);

// Reset state when reconnected
watch(connected, (isConnected) => {
  if (isConnected) {
    isUpgrading.value = false;
  }
});

// Listen for upgrade errors
onMessage((msg) => {
  if (msg.type === 'upgrade_error' || msg.type === 'restart_error') {
    isUpgrading.value = false;
    alert(`Upgrade failed: ${msg.message}`);
  }
});

function handleUpgrade() {
  if (isUpgrading.value) return;

  const version = updateAvailable.value?.latestVersion || 'latest';

  const confirmed = confirm(
    `Upgrade tofucode to v${version}?\n\nThis will:\n1. Download and install the update\n2. Restart the server\n3. Automatically reconnect\n\nThis may take 30-60 seconds.`,
  );

  if (confirmed) {
    isUpgrading.value = true;
    send({ type: 'upgrade', version });
  }
}

function handleDismissUpdate(e) {
  e.stopPropagation();
  if (updateAvailable.value) {
    dismissUpdate(updateAvailable.value.latestVersion);
  }
}

// Fetch tasks + status options + assignees once on first tab open
const tasksFetched = ref(false);

function fetchTasksIfNeeded() {
  if (resolvedTab.value === 'tasks' && !tasksFetched.value && connected.value) {
    getTasks();
    getTaskStatusOptions();
    getTaskAssignees();
    tasksFetched.value = true;
  }
}

watch(() => props.activeTab, fetchTasksIfNeeded, { immediate: true });
watch(connected, fetchTasksIfNeeded);

// Initialize notes panel on first tab open
const notesPanelRef = ref(null);

watch(
  () => props.activeTab,
  (tab) => {
    if (tab === 'notes') {
      notesPanelRef.value?.initNotes();
    }
  },
);

function openTodayNote() {
  notesPanelRef.value?.openTodayNote();
}

defineExpose({ openTodayNote });

// Navigate to task view when a new ticket is created
watch(lastCreatedPageId, (pageId) => {
  if (pageId) {
    router.push(`/tasks/${pageId}`);
  }
});

function handleSelectTask(pageId) {
  router.push(`/tasks/${pageId}`);
}

function handleFilterChange(filter) {
  setTasksFilter(filter);
}

function handleCreateTask(title, assigneeId) {
  createTask(title, assigneeId);
  // List will refresh after lastCreatedPageId triggers navigation
}

function handleRefreshTasks() {
  tasksFetched.value = true; // keep fetched flag — just re-fetch
  getTasks();
}

// Current route info for highlighting
const currentProject = computed(() => route.params.project);
const currentSession = computed(() => route.params.session);

// Fetch data when connected (use immediate for explicit user actions)
function fetchData() {
  if (connected.value) {
    getProjects();
    getRecentSessionsImmediate();
  }
}

// Fetch when connection becomes ready
watch(connected, (isConnected) => {
  if (isConnected) {
    fetchData();
  }
});

// Refresh data when sidebar opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      fetchData();
    }
  },
);

function startNewSession(projectSlug) {
  // Full page reload to ensure clean WebSocket state
  window.location.href = `/project/${projectSlug}/session/new`;
}

function handleOverlayClick() {
  emit('close');
}

onMounted(() => {
  fetchData();
});
</script>

<template>
  <aside class="sidebar" :class="{ open }">
    <div class="sidebar-header">
      <router-link :to="{ name: 'projects' }" class="sidebar-title">
        <img src="/icons/icon-192.png" alt="tofucode" class="sidebar-logo" />
      </router-link>

      <!-- Version display -->
      <span v-if="currentVersion" class="current-version">
        v{{ currentVersion }}
      </span>

      <!-- Upgrade button (shown when update available) -->
      <div v-if="updateAvailable" class="upgrade-btn-wrapper">
        <button
          class="upgrade-btn"
          @click="handleUpgrade"
          :disabled="isUpgrading"
          :title="`Upgrade to v${updateAvailable.latestVersion}`"
        >
          <svg v-if="!isUpgrading" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" class="spin">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
          </svg>
          <span>v{{ updateAvailable.latestVersion }}</span>
        </button>
        <button class="dismiss-btn" @click="handleDismissUpdate" title="Dismiss">×</button>
      </div>

      <!-- Settings button -->
      <button
        class="sidebar-icon-btn"
        @click="$emit('open-settings')"
        title="Settings (Ctrl+,)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>

    </div>
    <div class="sidebar-content" :class="{ 'sidebar-content-tasks': resolvedTab === 'tasks' && notionEnabled, 'sidebar-content-notes': resolvedTab === 'notes' }">
      <!-- Recent Sessions Tab -->
      <!-- Skeleton while sessions are loading -->
      <ul v-if="resolvedTab === 'sessions' && !sessionsReady" class="sidebar-list">
        <li v-for="i in 4" :key="i" class="sidebar-item sidebar-skeleton-item">
          <div class="sidebar-link">
            <div class="skeleton-icon"></div>
            <div class="skeleton-text">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line skeleton-meta"></div>
            </div>
          </div>
        </li>
      </ul>
      <!-- Actual sessions list -->
      <ul v-else-if="resolvedTab === 'sessions'" class="sidebar-list">
        <li
          v-for="session in recentSessions"
          :key="session.sessionId"
          class="sidebar-item"
          :class="{ active: currentSession === session.sessionId }"
        >
          <a
            :href="`/project/${session.projectSlug}/session/${session.sessionId}`"
            class="sidebar-link"
          >
            <div class="item-icon" :class="{ 'has-status': sessionStatuses.get(session.sessionId) }">
              <!-- Show status indicator if session has status -->
              <template v-if="sessionStatuses.get(session.sessionId)">
                <!-- Running: animated spinner -->
                <svg
                  v-if="sessionStatuses.get(session.sessionId).status === 'running'"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  class="status-spinner"
                  :class="sessionStatuses.get(session.sessionId).status"
                >
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                <!-- Completed: checkmark -->
                <svg
                  v-else-if="sessionStatuses.get(session.sessionId).status === 'completed'"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  :class="sessionStatuses.get(session.sessionId).status"
                >
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <!-- Error: X -->
                <svg
                  v-else-if="sessionStatuses.get(session.sessionId).status === 'error'"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  :class="sessionStatuses.get(session.sessionId).status"
                >
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </template>
              <!-- Default session icon when no status -->
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="item-content">
              <p class="item-title truncate">{{ session.title || session.firstPrompt }}</p>
              <p class="item-meta">
                <router-link
                  :to="{ name: 'sessions', params: { project: session.projectSlug } }"
                  class="item-project"
                  @click.stop
                >
                  {{ session.projectName }}
                </router-link>
                <span class="separator">·</span>
                <span>{{ formatRelativeTime(session.modified) }}</span>
              </p>
            </div>
            <!-- Terminal indicator badge -->
            <div v-if="terminalCounts.get(session.projectSlug)" class="terminal-badge">
              {{ terminalCounts.get(session.projectSlug) }}
            </div>
          </a>
        </li>
        <li v-if="recentSessions.length === 0" class="sidebar-empty">
          No recent sessions
        </li>
      </ul>

      <!-- Tasks Tab -->
      <template v-else-if="resolvedTab === 'tasks'">
        <div v-if="!notionEnabled" class="sidebar-list">
          <div class="sidebar-empty">
            Notion is not enabled. Configure it in
            <button class="sidebar-empty-link" @click="$emit('open-settings', 'notion')">Settings → Notion</button>
          </div>
        </div>
        <TasksPanel
          v-else
          :tasks="tasks"
          :tasks-ready="tasksReady"
          :tasks-error="tasksError"
          :tasks-next-cursor="tasksNextCursor"
          :tasks-filter="tasksFilter"
          :task-status-options="taskStatusOptions"
          :task-assignees="taskAssignees"
          :task-self-id="taskSelfId"
          @refresh="handleRefreshTasks"
          @load-more="loadMoreTasks"
          @select-task="handleSelectTask"
          @filter-change="handleFilterChange"
          @create-task="handleCreateTask"
          @open-settings="$emit('open-settings', 'notion')"
        />
      </template>

      <!-- Notes Tab -->
      <NotesPanel
        v-else-if="resolvedTab === 'notes'"
        ref="notesPanelRef"
        @open-settings="(tab) => $emit('open-settings', tab)"
      />

      <!-- Projects Tab -->
      <ul v-else-if="resolvedTab === 'projects'" class="sidebar-list">
        <li
          v-for="project in sortedProjects"
          :key="project.slug"
          class="sidebar-item project-item"
          :class="{ active: currentProject === project.slug }"
        >
          <router-link
            :to="{ name: 'sessions', params: { project: project.slug } }"
            class="sidebar-link"
          >
            <div class="item-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="item-content">
              <p class="item-title truncate">{{ project.name }}</p>
              <p class="item-meta">
                <span>{{ project.sessionCount }} sessions</span>
                <span class="separator">·</span>
                <span>{{ formatRelativeTime(project.lastModified) }}</span>
              </p>
            </div>
          </router-link>
          <button
            class="quick-new-btn"
            @click.stop="startNewSession(project.slug)"
            title="New session"
          >
            +
          </button>
        </li>
        <li v-if="projects.length === 0" class="sidebar-empty">
          No projects yet
        </li>
      </ul>
    </div>

    <!-- Projects toolbar (pinned, only in projects tab) -->
    <div v-if="resolvedTab === 'projects'" class="sidebar-project-toolbar">
      <!-- New Project -->
      <button class="project-toolbar-btn" title="New Project" @click="$emit('new-project')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
        New Project
      </button>
      <div class="project-toolbar-divider"></div>
      <!-- Sort A-Z toggle -->
      <button
        class="project-toolbar-icon-btn"
        :class="{ active: sortAZ }"
        :title="sortAZ ? 'Sorted A-Z (click for recent first)' : 'Sort A-Z'"
        @click="sortAZ = !sortAZ"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M7 12h10M11 18h2"/>
        </svg>
      </button>
      <!-- Clone -->
      <button class="project-toolbar-icon-btn" title="Clone Repository" @click="openCloneDialog()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="18" r="3"/>
          <circle cx="6" cy="6" r="3"/>
          <circle cx="18" cy="6" r="3"/>
          <path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
          <line x1="12" y1="15" x2="12" y2="12"/>
        </svg>
      </button>
    </div>
  </aside>

  <!-- Overlay for mobile -->
  <div
    v-if="open"
    class="sidebar-overlay"
    @click="handleOverlayClick"
  ></div>
</template>

<style scoped>
.sidebar {
  display: none;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100%;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  flex-shrink: 0;
}

.sidebar.open {
  display: flex;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  min-height: 57px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  text-decoration: none;
  transition: color 0.15s;
  line-height: 36px;
  margin-right: auto;
}

.sidebar-title:hover {
  color: var(--text-secondary);
}

.sidebar-logo {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}

.current-version {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
  font-family: var(--font-mono);
}

.upgrade-btn-wrapper {
  position: relative;
}

.upgrade-btn-wrapper .upgrade-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(217, 119, 6, 0.1);
  border: 1px solid rgba(217, 119, 6, 0.3);
  border-radius: var(--radius-sm);
  color: #d97706;
  cursor: pointer;
  transition: all 0.15s;
}

.upgrade-btn-wrapper .upgrade-btn:hover:not(:disabled) {
  background: rgba(217, 119, 6, 0.15);
  border-color: rgba(217, 119, 6, 0.4);
}

.upgrade-btn-wrapper .upgrade-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.upgrade-btn-wrapper .upgrade-btn .spin {
  animation: spin 1s linear infinite;
}

.upgrade-btn-wrapper .dismiss-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: var(--bg-secondary);
  border: 1px solid rgba(217, 119, 6, 0.3);
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  color: #d97706;
  cursor: pointer;
  transition: all 0.15s;
}

.upgrade-btn-wrapper .dismiss-btn:hover {
  background: rgba(217, 119, 6, 0.15);
  color: #b45309;
  border-color: rgba(217, 119, 6, 0.4);
}

.sidebar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  margin-right: 4px;
}

.sidebar-icon-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  padding-bottom: 0;
  min-height: 0;
}

/* When the tasks tab is active and TasksPanel is rendering, let the panel
   manage its own scroll/flex layout. We make sidebar-content a pass-through
   flex container so TasksPanel gets the full flex: 1 height. */
.sidebar-content-tasks,
.sidebar-content-notes {
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.sidebar-list {
  list-style: none;
}

.sidebar-item {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: var(--bg-hover);
}

.sidebar-item.active {
  background: var(--bg-tertiary);
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  color: inherit;
  text-decoration: none;
  flex: 1;
  min-width: 0;
  position: relative;
}

.terminal-badge {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: #f59e0b;
  color: #000;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
  line-height: 1.4;
}

.item-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.sidebar-item.active .item-icon {
  background: var(--bg-hover);
}

/* Status colors in icon */
.item-icon svg.running {
  color: #3b82f6;
}

.item-icon svg.completed {
  color: var(--success-color);
}

.item-icon svg.error {
  color: var(--error-color);
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
}

.item-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.item-project {
  font-family: var(--font-mono);
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.15s;
}

.item-project:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

.separator {
  margin: 0 4px;
}

.project-item {
  display: flex;
  align-items: center;
}

.project-item .sidebar-link {
  flex: 1;
  min-width: 0;
}

.project-item .quick-new-btn {
  opacity: 0;
  padding: 2px 8px;
  margin-right: 10px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.project-item:hover .quick-new-btn {
  opacity: 1;
}

.quick-new-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.sidebar-empty-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-secondary);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.sidebar-empty-link:hover {
  color: var(--text-primary);
}

.sidebar-project-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-top: 1px solid var(--border-color);
}

.project-toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  padding: 5px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.project-toolbar-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.project-toolbar-divider {
  flex: 1;
}

.project-toolbar-icon-btn {
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
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.project-toolbar-icon-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.project-toolbar-icon-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Animated spinner for running status */
.status-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Skeleton loading for sessions */
@keyframes shimmer {
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
}

.sidebar-skeleton-item .sidebar-link {
  pointer-events: none;
}

.skeleton-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
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
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-title {
  height: 13px;
  width: 75%;
}

.skeleton-meta {
  height: 11px;
  width: 50%;
  animation-delay: 0.2s;
}

/* Overlay (mobile only, controlled by media query) */
.sidebar-overlay {
  display: none;
}


/* Tablet styles - sidebar as overlay at desktop width */
@media (min-width: 641px) and (max-width: 1024px) {
  .sidebar.open {
    position: fixed;
    left: 0;
    top: 0;
    bottom: var(--bottom-bar-height);
    height: auto;
    z-index: 200;
    width: var(--sidebar-width);
  }

  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    bottom: var(--bottom-bar-height);
    background: rgba(0, 0, 0, 0.5);
    z-index: 199;
  }
}

/* Mobile styles - sidebar as overlay full width */
@media (max-width: 640px) {
  .sidebar.open {
    position: fixed;
    left: 0;
    top: 0;
    bottom: var(--bottom-bar-height);
    height: auto;
    z-index: 200;
    width: 100vw;
  }

  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    bottom: var(--bottom-bar-height);
    background: rgba(0, 0, 0, 0.5);
    z-index: 199;
  }
}
</style>
