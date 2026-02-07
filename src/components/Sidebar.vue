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

const emit = defineEmits(['close']);

const router = useRouter();
const route = useRoute();
const {
  connected,
  projects,
  recentSessions,
  sessionStatuses,
  currentVersion,
  updateAvailable,
  getProjects,
  getRecentSessionsImmediate,
  dismissUpdate,
  send,
} = useWebSocket();

// Upgrade/Restart state
const isUpgrading = ref(false);
const isRestarting = ref(false);

// Reset states when reconnected
watch(connected, (isConnected) => {
  if (isConnected) {
    isUpgrading.value = false;
    isRestarting.value = false;
  }
});

function handleUpgrade() {
  if (isUpgrading.value) return;

  const version = updateAvailable.value?.latestVersion || 'latest';

  const confirmed = confirm(
    `Upgrade cc-web to v${version}?\n\nThis will:\n1. Download and install the update\n2. Restart the server\n3. Automatically reconnect\n\nThis may take 30-60 seconds.`,
  );

  if (confirmed) {
    isUpgrading.value = true;
    send({ type: 'upgrade', version });
  }
}

function handleRestart() {
  if (isRestarting.value) return;

  const confirmed = confirm(
    'Restart the server?\n\nThis will briefly disconnect all clients. They will automatically reconnect.',
  );

  if (confirmed) {
    isRestarting.value = true;
    send({ type: 'restart' });
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
    <div class="sidebar-header">
      <router-link :to="{ name: 'projects' }" class="sidebar-title" @click="closeOnMobile">
        <svg class="sidebar-logo" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M 4 14 Q 4 11 6 10 Q 6 8 8 8 Q 9 6 12 6 Q 15 6 16 8 Q 18 8 18 10 Q 20 11 20 14 Q 20 16 18 16 H 6 Q 4 16 4 14 Z"/>
          <g opacity="0.7">
            <line x1="12" y1="11" x2="12" y2="8"/>
            <line x1="12" y1="11" x2="15" y2="9"/>
            <line x1="12" y1="11" x2="16" y2="12"/>
            <line x1="12" y1="11" x2="14" y2="14"/>
            <line x1="12" y1="11" x2="12" y2="15"/>
            <line x1="12" y1="11" x2="10" y2="14"/>
            <line x1="12" y1="11" x2="8" y2="12"/>
            <line x1="12" y1="11" x2="9" y2="9"/>
            <circle cx="12" cy="11" r="1"/>
          </g>
        </svg>
        <span>cc-web</span>
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

      <!-- Restart button (shown when no update available) -->
      <button
        v-if="!updateAvailable"
        class="restart-btn"
        @click="handleRestart"
        :disabled="isRestarting"
        title="Restart server"
      >
        <svg v-if="!isRestarting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6"/>
          <path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <nav class="sidebar-tabs">
      <button
        class="sidebar-tab"
        :class="{ active: activeTab === 'sessions' }"
        @click="activeTab = 'sessions'"
      >
        Sessions
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: activeTab === 'projects' }"
        @click="activeTab = 'projects'"
      >
        Projects
      </button>
    </nav>

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
            <div class="item-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
          </a>
          <!-- Task status indicator -->
          <div
            v-if="sessionStatuses.get(session.sessionId)"
            class="session-status-indicator"
            :class="sessionStatuses.get(session.sessionId).status"
          >
            <!-- Running: animated spinner -->
            <svg
              v-if="sessionStatuses.get(session.sessionId).status === 'running'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              class="status-spinner"
            >
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
            </svg>
            <!-- Completed: checkmark -->
            <svg
              v-else-if="sessionStatuses.get(session.sessionId).status === 'completed'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <!-- Error: X -->
            <svg
              v-else-if="sessionStatuses.get(session.sessionId).status === 'error'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </div>
        </li>
        <li v-if="recentSessions.length === 0" class="sidebar-empty">
          No recent sessions
        </li>
      </ul>

      <!-- Projects Tab -->
      <ul v-else-if="activeTab === 'projects'" class="sidebar-list">
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
            New
          </button>
        </li>
        <li v-if="projects.length === 0" class="sidebar-empty">
          No projects yet
        </li>
      </ul>
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
  flex-grow: 1;
  line-height: 36px;
}

.sidebar-title:hover {
  color: var(--text-secondary);
}

.sidebar-logo {
  flex-shrink: 0;
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

.restart-btn {
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
}

.restart-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.restart-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.restart-btn .spin {
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

.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-tab {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}

.sidebar-tab:hover {
  color: var(--text-primary);
}

.sidebar-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
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
  padding: 4px 8px;
  margin-right: 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.project-item:hover .quick-new-btn {
  opacity: 1;
}

.quick-new-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  color: #2563eb;
}

.sidebar-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Session status indicator */
.session-status-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-right: 10px;
}

.session-status-indicator.running {
  color: #3b82f6;
}

.session-status-indicator.completed {
  color: var(--success-color);
}

.session-status-indicator.error {
  color: var(--error-color);
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
