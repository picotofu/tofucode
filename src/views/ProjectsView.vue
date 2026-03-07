<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const router = useRouter();
const sidebar = inject('sidebar');

const {
  connected,
  projects,
  recentSessions,
  folderContents,
  currentFolder,
  rootPath,
  connect,
  getProjects,
  getRecentSessionsImmediate,
  browseFolder,
  createFolder,
  openCloneDialog,
  onMessage,
} = useWebSocket();

const isEditingPath = ref(false);
const manualPath = ref('');
const pathInputRef = ref(null);

// New folder state
const isCreatingFolder = ref(false);
const newFolderName = ref('');
const folderInputRef = ref(null);
const createFolderError = ref('');

// Listen for folder creation errors — re-open form with error message
const unsubscribe = onMessage((msg) => {
  if (msg.type === 'files:create:error') {
    createFolderError.value = msg.error || 'Failed to create folder';
    isCreatingFolder.value = true;
    nextTick(() => folderInputRef.value?.focus());
  }
});
onUnmounted(() => unsubscribe());

// Get top 5 recent sessions for quick access cards
const quickSessions = computed(() => recentSessions.value.slice(0, 5));

// Get top 5 recent projects
const quickProjects = computed(() => projects.value.slice(0, 5));

// Connect on mount and fetch data when ready
onMounted(() => {
  connect(() => {
    getProjects();
    getRecentSessionsImmediate();
    // Start folder browser from home
    if (!currentFolder.value) {
      browseFolder(null);
    }
  });
});

function selectRecentSession(session) {
  const { sessionId, projectSlug } = session;

  if (!sessionId || !projectSlug) {
    console.error('Invalid session data:', session);
    return;
  }

  router.push({
    name: 'chat',
    params: { project: projectSlug, session: sessionId },
  });
}

const formatTime = formatRelativeTime;

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

    <main class="main">
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

      <!-- Quick Access Cards (like browser new tab) -->
      <section class="quick-access" v-if="quickSessions.length > 0">
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
      </section>

      <!-- Recent Projects -->
      <section class="quick-access" v-if="quickProjects.length > 0">
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
      </section>

      <!-- Folder Browser -->
      <section class="folder-browser">
        <h2 class="section-title">Select a Folder</h2>

        <div class="folder-header">
          <button class="up-btn" @click="goUpFolder" :disabled="!currentFolder || currentFolder === '/'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="path-container" v-if="!isEditingPath" @click="startEditingPath">
            <p class="current-path truncate">{{ currentFolder || 'Click to enter path...' }}</p>
            <svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <form v-else class="path-form" @submit.prevent="submitManualPath">
            <input
              ref="pathInputRef"
              type="text"
              v-model="manualPath"
              class="path-input"
              placeholder="/path/to/folder"
              @keydown.escape.prevent="cancelEditingPath"
            />
          </form>
          <button class="clone-btn" @click="openCloneDialog(currentFolder)" :disabled="!currentFolder" title="Clone a git repository into this folder">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="18" r="3"/>
              <circle cx="6" cy="6" r="3"/>
              <circle cx="18" cy="6" r="3"/>
              <path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
              <line x1="12" y1="15" x2="12" y2="12"/>
            </svg>
            Clone
          </button>
          <button class="clone-btn" @click="startCreatingFolder" :disabled="!currentFolder" title="Create a new folder here">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            New Folder
          </button>
          <button class="select-btn" @click="startNewSession(currentFolder)" :disabled="!currentFolder">
            Select This Folder
          </button>
        </div>

        <form v-if="isCreatingFolder" class="new-folder-form" @submit.prevent="confirmCreateFolder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
          <input
            ref="folderInputRef"
            type="text"
            v-model="newFolderName"
            class="new-folder-input"
            placeholder="folder-name"
            @keydown.escape.prevent="cancelCreateFolder"
          />
          <button type="submit" class="new-folder-confirm" :disabled="!newFolderName.trim()">Create</button>
          <button type="button" class="new-folder-cancel" @click="cancelCreateFolder">Cancel</button>
          <span v-if="createFolderError" class="new-folder-error">{{ createFolderError }}</span>
        </form>

        <ul class="folders" v-if="folderContents.length > 0">
          <li
            v-for="item in folderContents"
            :key="item.path"
            class="folder-item"
            :class="{ directory: item.isDirectory }"
            @click="selectFolder(item)"
          >
            <div class="folder-icon">
              <svg v-if="item.isDirectory" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
            </div>
            <span class="folder-name">{{ item.name }}</span>
            <div class="folder-arrow" v-if="item.isDirectory">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </li>
        </ul>

        <div class="empty" v-else-if="connected && currentFolder">
          <p>Empty folder</p>
        </div>

        <div class="loading" v-else-if="!connected">
          <p>Connecting...</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.projects-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow-y: auto;
}

.main {
  padding: 16px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

/* Restricted Mode Banner */
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

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

/* Quick Access Cards */
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

/* Folder Browser */
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

.folder-item:not(.directory) {
  opacity: 0.5;
  cursor: default;
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

.empty, .loading {
  text-align: center;
  padding: 32px 0;
  color: var(--text-secondary);
}
</style>
