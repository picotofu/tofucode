<script setup>
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import FilesPanel from '../components/FilesPanel.vue';
import { useFilesManager } from '../composables/useFilesManager.js';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const router = useRouter();
const sidebar = inject('sidebar');

const {
  connected,
  projects,
  recentSessions,
  sessionsReady,
  folderContents,
  currentFolder,
  rootPath,
  homePath,
  connect,
  send,
  onMessage,
  getProjects,
  getRecentSessionsImmediate,
  browseFolder,
  createFolder,
  openCloneDialog,
} = useWebSocket();

// ─── Tab state ───────────────────────────────────────────────────────────────

const HOME_TAB_KEY = 'tofucode:home-tab';
const activeTab = ref(localStorage.getItem(HOME_TAB_KEY) || 'sessions');
watch(activeTab, (tab) => localStorage.setItem(HOME_TAB_KEY, tab));

// ─── Folder browser state ────────────────────────────────────────────────────

const isEditingPath = ref(false);
const manualPath = ref('');
const pathInputRef = ref(null);

// New folder state
const isCreatingFolder = ref(false);
const newFolderName = ref('');
const folderInputRef = ref(null);
const createFolderError = ref('');

// Listen for folder creation errors — re-open form with error message
const unsubscribeFolderError = onMessage((msg) => {
  if (msg.type === 'files:create:error' && activeTab.value === 'folders') {
    createFolderError.value = msg.error || 'Failed to create folder';
    isCreatingFolder.value = true;
    nextTick(() => folderInputRef.value?.focus());
  }
});
onUnmounted(() => unsubscribeFolderError());

// ─── Files tab state ─────────────────────────────────────────────────────────

const FILES_PATH_KEY = 'tofucode:home-files-path';

const fm = useFilesManager({ send, onMessage, homePath });

// Initialize files tab when first switching to it
let filesInitialized = false;
watch(activeTab, (tab) => {
  if (tab === 'files' && !filesInitialized) {
    filesInitialized = true;
    const savedPath = localStorage.getItem(FILES_PATH_KEY) || null;
    fm.initialize(savedPath);
  }
});

// Persist current files path
watch(fm.filesCurrentPath, (path) => {
  if (path) localStorage.setItem(FILES_PATH_KEY, path);
});

// ─── Quick access ─────────────────────────────────────────────────────────────

const quickSessions = computed(() => recentSessions.value.slice(0, 5));

const quickProjects = computed(() => projects.value.slice(0, 5));

// ─── Loading state ────────────────────────────────────────────────────────────

// True until the WS connects and initial data requests are sent
const dataReady = ref(false);

// ─── Mount ────────────────────────────────────────────────────────────────────

onMounted(() => {
  connect(() => {
    getProjects();
    getRecentSessionsImmediate();
    if (!currentFolder.value) {
      browseFolder(null);
    }
    // If landing on files tab directly (e.g. refreshed with tab persisted)
    if (activeTab.value === 'files' && !filesInitialized) {
      filesInitialized = true;
      const savedPath = localStorage.getItem(FILES_PATH_KEY) || null;
      fm.initialize(savedPath);
    }
    dataReady.value = true;
  });
});

// ─── Session handlers ─────────────────────────────────────────────────────────

const formatTime = formatRelativeTime;

// ─── Folder browser handlers ──────────────────────────────────────────────────

function selectFolder(folder) {
  if (folder.isDirectory) {
    browseFolder(folder.path);
  }
}

function goUpFolder() {
  if (currentFolder.value && currentFolder.value !== '/') {
    const parent = currentFolder.value.split('/').slice(0, -1).join('/') || '/';
    browseFolder(parent);
  }
}

function pathToSlug(path) {
  return `-${path.replace(/^\//, '').replace(/\//g, '-')}`;
}

function startNewSession(folderPath) {
  const slug = pathToSlug(folderPath);
  router.push({ name: 'sessions', params: { project: slug } });
}

function startEditingPath() {
  manualPath.value = currentFolder.value || '';
  isEditingPath.value = true;
  nextTick(() => {
    pathInputRef.value?.focus();
    pathInputRef.value?.select();
  });
}

function submitManualPath() {
  const path = manualPath.value.trim();
  if (path) {
    browseFolder(path);
  }
  isEditingPath.value = false;
}

function cancelEditingPath() {
  isEditingPath.value = false;
  manualPath.value = '';
}

function startCreatingFolder() {
  isCreatingFolder.value = true;
  newFolderName.value = '';
  createFolderError.value = '';
  nextTick(() => folderInputRef.value?.focus());
}

function confirmCreateFolder() {
  const name = newFolderName.value.trim();
  if (!name || !currentFolder.value) return;
  createFolderError.value = '';
  const folderPath = `${currentFolder.value}/${name}`.replace(/\/+/g, '/');
  createFolder(folderPath);
  isCreatingFolder.value = false;
  newFolderName.value = '';
}

function cancelCreateFolder() {
  isCreatingFolder.value = false;
  newFolderName.value = '';
  createFolderError.value = '';
}
</script>

<template>
  <div class="projects-view">
    <AppHeader :show-hamburger="true" @toggle-sidebar="sidebar.toggle" />

    <!-- Sessions tab -->
    <main v-if="activeTab === 'sessions'" class="main">
      <!-- Restricted Mode Indicator -->
      <div v-if="rootPath" class="restricted-mode-banner">
        <div class="banner-content">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div class="banner-text">
            <span class="banner-title">Restricted Mode</span>
            <span class="banner-path">{{ rootPath }}</span>
          </div>
        </div>
        <span class="banner-note">Best effort isolation • Use Docker for full security</span>
      </div>

      <!-- Loading -->
      <div v-if="!dataReady" class="tab-loading">
        <svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <p>Connecting...</p>
      </div>

      <template v-else>
        <!-- Recent Sessions skeleton while data loads -->
        <section v-if="!sessionsReady" class="quick-access">
          <h2 class="section-title">Recent Sessions</h2>
          <div class="quick-cards">
            <div v-for="i in 4" :key="i" class="quick-card quick-card-skeleton">
              <div class="skeleton-card-icon"></div>
              <div class="skeleton-card-title"></div>
              <div class="skeleton-card-meta"></div>
            </div>
          </div>
          <!-- Mobile list view skeleton -->
          <ul class="quick-list">
            <li v-for="i in 4" :key="i" class="quick-list-skeleton">
              <div class="skeleton-list-icon"></div>
              <div class="skeleton-list-text">
                <div class="skeleton-list-title"></div>
                <div class="skeleton-list-meta"></div>
              </div>
            </li>
          </ul>
        </section>

        <!-- Recent Sessions -->
        <section v-else-if="quickSessions.length > 0" class="quick-access">
          <h2 class="section-title">Recent Sessions</h2>
          <div class="quick-cards">
            <router-link
              v-for="session in quickSessions"
              :key="session.sessionId"
              :to="{
                name: 'chat',
                params: {
                  project: session.projectSlug,
                  session: session.sessionId,
                },
              }"
              class="quick-card"
            >
              <div class="quick-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p class="quick-card-title truncate">{{ session.title || session.firstPrompt }}</p>
              <p class="quick-card-meta truncate">{{ session.projectName }}</p>
            </router-link>
          </div>
          <!-- Mobile list view -->
          <ul class="quick-list">
            <li v-for="session in quickSessions" :key="session.sessionId">
              <router-link
                :to="{
                  name: 'chat',
                  params: {
                    project: session.projectSlug,
                    session: session.sessionId,
                  },
                }"
                class="quick-list-item"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="list-icon">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="list-title truncate">{{ session.title || session.firstPrompt }}</span>
                <span class="list-meta truncate">{{ session.projectName }}</span>
              </router-link>
            </li>
          </ul>
        </section>

        <!-- Recent Projects -->
        <section v-if="quickProjects.length > 0" class="quick-access">
          <h2 class="section-title">Recent Projects</h2>
          <div class="quick-cards">
            <router-link
              v-for="project in quickProjects"
              :key="project.slug"
              :to="{ name: 'sessions', params: { project: project.slug } }"
              class="quick-card"
            >
              <div class="quick-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p class="quick-card-title truncate">{{ project.name }}</p>
              <p class="quick-card-meta truncate">{{ project.sessionCount }} sessions · {{ formatTime(project.lastModified) }}</p>
            </router-link>
          </div>
          <!-- Mobile list view -->
          <ul class="quick-list">
            <li v-for="project in quickProjects" :key="project.slug">
              <router-link
                :to="{ name: 'sessions', params: { project: project.slug } }"
                class="quick-list-item"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="list-icon">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="list-title truncate">{{ project.name }}</span>
                <span class="list-meta truncate">{{ project.sessionCount }} sessions · {{ formatTime(project.lastModified) }}</span>
              </router-link>
            </li>
          </ul>
        </section>

        <div v-if="sessionsReady && quickSessions.length === 0 && quickProjects.length === 0" class="empty-sessions">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>No sessions yet — head to Folders to get started</p>
        </div>
      </template>
    </main>

    <!-- Folders tab -->
    <main v-else-if="activeTab === 'folders'" class="main">
      <!-- Restricted Mode Indicator -->
      <div v-if="rootPath" class="restricted-mode-banner">
        <div class="banner-content">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div class="banner-text">
            <span class="banner-title">Restricted Mode</span>
            <span class="banner-path">{{ rootPath }}</span>
          </div>
        </div>
        <span class="banner-note">Best effort isolation • Use Docker for full security</span>
      </div>

      <div v-if="!dataReady" class="tab-loading">
        <svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <p>Connecting...</p>
      </div>

      <section v-else class="folder-browser">
        <h2 class="section-title">Select a Folder</h2>

        <div class="folder-header">
          <button class="up-btn" :disabled="!currentFolder || currentFolder === '/'" @click="goUpFolder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div v-if="!isEditingPath" class="path-container" @click="startEditingPath">
            <p class="current-path truncate">{{ currentFolder || 'Click to enter path...' }}</p>
            <svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <form v-else class="path-form" @submit.prevent="submitManualPath">
            <input
              ref="pathInputRef"
              v-model="manualPath"
              type="text"
              class="path-input"
              placeholder="/path/to/folder"
              @keydown.escape.prevent="cancelEditingPath"
            />
          </form>
          <div class="folder-header-actions">
            <button class="clone-btn" :disabled="!currentFolder" title="Clone a git repository into this folder" @click="openCloneDialog(currentFolder)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="18" r="3"/>
                <circle cx="6" cy="6" r="3"/>
                <circle cx="18" cy="6" r="3"/>
                <path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
                <line x1="12" y1="15" x2="12" y2="12"/>
              </svg>
              Clone
            </button>
            <button class="clone-btn" :disabled="!currentFolder" title="Create a new folder here" @click="startCreatingFolder">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/>
                <line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
              New Folder
            </button>
            <button class="select-btn" :disabled="!currentFolder" @click="startNewSession(currentFolder)">
              Select This Folder
            </button>
          </div>
        </div>

        <form v-if="isCreatingFolder" class="new-folder-form" @submit.prevent="confirmCreateFolder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
          <input
            ref="folderInputRef"
            v-model="newFolderName"
            type="text"
            class="new-folder-input"
            placeholder="folder-name"
            @keydown.escape.prevent="cancelCreateFolder"
          />
          <button type="submit" class="new-folder-confirm" :disabled="!newFolderName.trim()">Create</button>
          <button type="button" class="new-folder-cancel" @click="cancelCreateFolder">Cancel</button>
          <span v-if="createFolderError" class="new-folder-error">{{ createFolderError }}</span>
        </form>

        <ul v-if="folderContents.some((i) => i.isDirectory)" class="folders">
          <li
            v-for="item in folderContents.filter((i) => i.isDirectory)"
            :key="item.path"
            class="folder-item directory"
            @click="selectFolder(item)"
          >
            <div class="folder-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <span class="folder-name">{{ item.name }}</span>
            <div class="folder-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </li>
        </ul>

        <div v-else-if="connected && currentFolder" class="empty">
          <p>No folders here</p>
        </div>

        <div v-else-if="!connected" class="loading">
          <p>Connecting...</p>
        </div>
      </section>
    </main>

    <!-- Files tab -->
    <div v-else-if="activeTab === 'files'" class="files-tab-layout">
      <div v-if="!dataReady" class="tab-loading">
        <svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <p>Connecting...</p>
      </div>
      <FilesPanel v-else :manager="fm" :show-reference="false" />
    </div>

    <!-- Bottom tab nav -->
    <nav class="bottom-nav">
      <button
        class="nav-tab"
        :class="{ active: activeTab === 'sessions' }"
        @click="activeTab = 'sessions'"
      >
        <!-- Heroicon: clock -->
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15 15"/>
        </svg>
        <span>Sessions</span>
      </button>
      <button
        class="nav-tab"
        :class="{ active: activeTab === 'folders' }"
        @click="activeTab = 'folders'"
      >
        <!-- Heroicon: folder-open -->
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h3.586a1 1 0 0 1 .707.293L10.414 6.5A1 1 0 0 0 11.121 6.793 1 1 0 0 0 11.5 7H19a2 2 0 0 1 2 2v1H3V7z"/>
          <path d="M3 10h18l-1.447 7.235A2 2 0 0 1 17.574 19H6.426a2 2 0 0 1-1.979-1.765L3 10z"/>
        </svg>
        <span>Folders</span>
      </button>
      <button
        class="nav-tab"
        :class="{ active: activeTab === 'files' }"
        @click="activeTab = 'files'"
      >
        <!-- Heroicon: document-text -->
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 12h6M9 16h6M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5z"/>
          <path d="M13 3v5h5"/>
        </svg>
        <span>Files</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.projects-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.main {
  flex: 1;
  padding: 16px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  overflow-y: auto;
}

/* ─── Files tab layout ───────────────────────────────────────────────────────── */
.files-tab-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 0 0;
}

/* FilesPanel renders as a fragment — children sit in the flex column directly */
.files-tab-layout > :deep(.files-mode) {
  flex: 1;
  overflow: hidden;
}

.files-tab-layout > :deep(.files-filter-form) {
  margin-top: 8px;
}

/* ─── Bottom nav ─────────────────────────────────────────────────────────────── */
.bottom-nav {
  display: flex;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.nav-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 8px;
  color: var(--text-muted);
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  transition: color 0.15s, background 0.15s;
  border-radius: 0;
}

.nav-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.nav-tab.active {
  color: var(--text-primary);
}

/* ─── Restricted Mode Banner ─────────────────────────────────────────────────── */
.restricted-mode-banner {
  background: linear-gradient(135deg, rgba(255, 193, 7, 0.1), rgba(255, 152, 0, 0.1));
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.banner-content svg {
  color: #ffc107;
  flex-shrink: 0;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.banner-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.banner-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-note {
  font-size: 11px;
  color: var(--text-muted);
  padding-left: 28px;
}

/* ─── Section title ──────────────────────────────────────────────────────────── */
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

/* ─── Quick Access Cards ─────────────────────────────────────────────────────── */
.quick-access {
  margin-bottom: 32px;
}

.quick-cards {
  display: flex;
  gap: 12px;
}

.quick-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  color: inherit;
  text-decoration: none;
}

.quick-card:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
  transform: translateY(-2px);
}

.quick-card-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.quick-card-title {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  width: 100%;
  margin-bottom: 4px;
}

.quick-card-meta {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  text-align: center;
  width: 100%;
}

.empty-sessions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
}

/* ─── Skeleton loading ────────────────────────────────────────────────────────── */
@keyframes shimmer {
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
}

.quick-card-skeleton {
  pointer-events: none;
}

.skeleton-card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  margin-bottom: 10px;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-card-title {
  height: 12px;
  width: 80%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  margin-bottom: 6px;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-card-meta {
  height: 10px;
  width: 55%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
  animation-delay: 0.2s;
}

.quick-list-skeleton {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}

.skeleton-list-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-list-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.skeleton-list-title {
  height: 13px;
  width: 70%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-list-meta {
  height: 11px;
  width: 45%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
  animation-delay: 0.2s;
}

/* ─── Tab loading ────────────────────────────────────────────────────────────── */
.tab-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}

/* ─── Mobile list view ───────────────────────────────────────────────────────── */

/* Desktop: show cards, hide list */
.quick-list {
  display: none;
  list-style: none;
}

/* Mobile: hide cards, show list */
@media (max-width: 639px) {
  .quick-cards {
    display: none;
  }

  .quick-list {
    display: flex;
    flex-direction: column;
  }

  .tab-loading {
    padding: 40px 0;
  }
}

.quick-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s;
}

.quick-list-item:last-child {
  border-bottom: none;
}

.quick-list-item:hover {
  color: var(--text-primary);
}

.quick-list-item .list-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.quick-list-item .list-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
}

.quick-list-item .list-meta {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
  max-width: 30%;
}

/* ─── Folder Browser ─────────────────────────────────────────────────────────── */
.folder-browser {
  margin-bottom: 24px;
}

.folders {
  list-style: none;
}

.folder-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin: 0 -12px;
  border-radius: var(--radius-md);
  transition: background 0.15s;
}

.folder-item.directory {
  cursor: pointer;
}

.folder-item.directory:hover {
  background: var(--bg-hover);
}

.folder-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}

.folder-name {
  flex: 1;
  font-size: 14px;
}

.folder-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
}

.folder-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin: 0 -12px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.folder-header-actions {
  display: contents;
}

@media (max-width: 480px) {
  .folder-header {
    row-gap: 8px;
  }

  .path-container,
  .path-form {
    order: 0;
  }

  .folder-header-actions {
    display: flex;
    width: 100%;
    gap: 8px;
    order: 1;
  }

  .clone-btn {
    flex: 1;
    justify-content: center;
    padding: 8px 10px;
    font-size: 12px;
  }

  .select-btn {
    flex: 2;
    white-space: nowrap;
  }
}

.up-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

.up-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.up-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.path-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
}

.path-container:hover {
  background: var(--bg-hover);
}

.current-path {
  flex: 1;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.edit-icon {
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s;
}

.path-container:hover .edit-icon {
  opacity: 1;
}

.path-form {
  flex: 1;
}

.path-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
}

.path-input:focus {
  outline: none;
  border-color: var(--text-muted);
}

.clone-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s, color 0.15s;
  white-space: nowrap;
}

.clone-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.clone-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.select-btn {
  padding: 8px 16px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s;
}

.select-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.select-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.new-folder-form {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-muted);
}

.new-folder-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.new-folder-input:focus {
  outline: none;
  border-color: var(--text-muted);
}

.new-folder-confirm,
.new-folder-cancel {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.new-folder-confirm {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.new-folder-confirm:hover:not(:disabled) {
  background: var(--bg-hover);
}

.new-folder-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.new-folder-cancel {
  background: transparent;
  color: var(--text-muted);
}

.new-folder-cancel:hover {
  color: var(--text-primary);
}

.new-folder-error {
  font-size: 12px;
  color: var(--error-color, #ef4444);
  white-space: nowrap;
}

.empty,
.loading {
  text-align: center;
  padding: 32px 0;
  color: var(--text-secondary);
}
</style>
