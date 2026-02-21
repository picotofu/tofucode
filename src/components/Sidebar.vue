<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['close', 'open-settings', 'open-help', 'open-mcp']);

const router = useRouter();
const route = useRoute();
const {
  connected,
  projects,
  recentSessions,
  sessionStatuses,
  terminalCounts,
  currentVersion,
  updateAvailable,
  getProjects,
  getRecentSessionsImmediate,
  dismissUpdate,
  send,
  onMessage,
  openCloneDialog,
} = useWebSocket();

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

function handleUpdateClick() {
  if (updateAvailable.value) {
    window.open(updateAvailable.value.updateUrl, '_blank');
  }
}

function handleDismissUpdate(e) {
  e.stopPropagation();
  if (updateAvailable.value) {
    dismissUpdate(updateAvailable.value.latestVersion);
  }
}

const activeTab = ref('sessions');

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

// Fetch on mount if already connected
onMounted(() => {
  fetchData();
});

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

// Only close sidebar on mobile (where it's an overlay)
function closeOnMobile() {
  if (window.innerWidth <= 768) {
    emit('close');
  }
}

function selectSession(session) {
  // Full page reload to ensure clean WebSocket state - prevents cross-session issues
  window.location.href = `/project/${session.projectSlug}/session/${session.sessionId}`;
}

function selectProject(project) {
  router.push({
    name: 'sessions',
    params: { project: project.slug },
  });
  closeOnMobile();
}

function startNewSession(projectSlug) {
  // Full page reload to ensure clean WebSocket state
  window.location.href = `/project/${projectSlug}/session/new`;
}

function handleOverlayClick() {
  emit('close');
}
</script>

<template>
  <aside class="sidebar" :class="{ open }">
    <div class="sidebar-content">
      <!-- Recent Sessions Tab -->
      <ul v-if="activeTab === 'sessions'" class="sidebar-list">
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
                  @click.stop="closeOnMobile"
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

      <!-- Projects Tab -->
      <ul v-else-if="activeTab === 'projects'" class="sidebar-list">
        <li class="sidebar-item clone-item">
          <button class="clone-project-btn" @click="openCloneDialog()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="18" r="3"/>
              <circle cx="6" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <path d="M6 9v3m0 0v3m0-3h3M15 6a9 9 0 0 0-9 9"/>
            </svg>
            Clone Repository
          </button>
        </li>
        <li
          v-for="project in projects"
          :key="project.slug"
          class="sidebar-item project-item"
          :class="{ active: currentProject === project.slug }"
        >
          <router-link
            :to="{ name: 'sessions', params: { project: project.slug } }"
            class="sidebar-link"
            @click="closeOnMobile"
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

    <nav class="sidebar-tabs">
      <button
        class="sidebar-tab"
        :class="{ active: activeTab === 'sessions' }"
        @click="activeTab = 'sessions'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Sessions
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: activeTab === 'projects' }"
        @click="activeTab = 'projects'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Projects
      </button>
    </nav>

    <div class="sidebar-header">
      <router-link :to="{ name: 'projects' }" class="sidebar-title" @click="closeOnMobile">
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

      <!-- MCP button -->
      <button
        class="sidebar-icon-btn"
        @click="$emit('open-mcp')"
        title="MCP Servers"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
          <path d="M7 7h.01"/>
        </svg>
      </button>

      <!-- Help button -->
      <button
        class="sidebar-icon-btn"
        @click="$emit('open-help')"
        title="Keyboard Shortcuts (Ctrl+?)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </button>

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
  width: var(--sidebar-width, 260px);
  height: 100vh;
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
  border-top: 1px solid var(--border-color);
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
  flex-grow: 1;
  line-height: 36px;
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

.sidebar-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.sidebar-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
  flex: 1;
  justify-content: center;
}

.sidebar-tab:hover {
  color: var(--text-secondary);
}

.sidebar-tab.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  padding-bottom: 0;
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

.clone-item {
  padding: 6px 4px;
}

.clone-project-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  cursor: pointer;
}

.clone-project-btn:hover {
  background: var(--bg-tertiary);
  border-color: var(--text-muted);
  color: var(--text-primary);
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

/* Overlay (mobile only, controlled by media query) */
.sidebar-overlay {
  display: none;
}

/* Mobile styles - sidebar as overlay */
@media (max-width: 768px) {
  .sidebar.open {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 200;
  }

  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 199;
  }
}
</style>
