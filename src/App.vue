<script setup>
import { onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CommandPalette from './components/CommandPalette.vue';
import FilePicker from './components/FilePicker.vue';
import GitCloneModal from './components/GitCloneModal.vue';
import PwaPrompt from './components/PwaPrompt.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';
import SidebarFooter from './components/SidebarFooter.vue';
import { useBackButton } from './composables/useBackButton.js';
import { setBoardColumnOrder, useWebSocket } from './composables/useWebSocket';

const {
  connect,
  disconnect,
  connected,
  recentSessions,
  getRecentSessionsForPalette,
  getProjects,
  send,
  onMessage,
  showCloneDialog,
  cloneInitialDir,
  closeCloneDialog,
} = useWebSocket();

const route = useRoute();
const router = useRouter();

// Provide selected file path for ChatView to pick up
const selectedFilePath = ref(null);
provide('selectedFilePath', selectedFilePath);

// Provide file reference for ChatView to pick up
const fileReference = ref(null);
provide('fileReference', fileReference);

// Usage stats state
const usageStats = ref(null);

function fetchUsageStats() {
  send({ type: 'get_usage_stats' });
}

// Settings state
const showSettings = ref(false);
const settingsInitialTab = ref('settings');
const settingsModalRef = ref(null);
const settings = ref({
  debugMode: false,
  autoSaveFiles: true,
  symbolToolbar: '` ~ ! @ # $ % ^ & * ( ) - _ = + /',
  quickAccessFile: 'TODO.md',
  enableMemo: true,
  discordSyncEnabled: true,
  notesBasePath: '',
  notesIncludePaths: [],
});

// Server capability flags (not user settings — set by server environment)
const discordEnabled = ref(false);
const maxFileSizeMb = ref(10);

// Notion config state
const notionConfig = ref(null);
const notionTestResult = ref(null);
const notionAnalyseResult = ref(null);

// MCP state
const mcpServers = ref([]);
const mcpLoading = ref(false);

function openSettings(tab) {
  settingsInitialTab.value = tab || 'settings';
  showSettings.value = true;
}

function closeSettings() {
  showSettings.value = false;
}

// Android back button closes settings modal instead of navigating away (mobile only)
useBackButton(showSettings, closeSettings, { mobileOnly: true });

function fetchMcpServers() {
  mcpLoading.value = true;
  send({ type: 'mcp:list' });
}

function handleMcpAdd({ name, config, scope }) {
  send({ type: 'mcp:add', name, config, scope });
}

function handleMcpUpdate({ name, config, scope }) {
  send({ type: 'mcp:update', name, config, scope });
}

function handleMcpRemove({ name, scope }) {
  send({ type: 'mcp:remove', name, scope });
}

function handleMcpTest({ serverName, url, headers, _formLevel }) {
  send({
    type: 'mcp:test',
    url,
    headers,
    _formLevel: _formLevel ?? false,
    serverName: serverName ?? null,
  });
}

function updateSettings(newSettings) {
  send({
    type: 'update_settings',
    settings: newSettings,
  });
}

function handleRestart() {
  send({ type: 'restart' });
}

// Notion event handlers
function fetchNotionConfig() {
  send({ type: 'notion:get_config' });
}

function saveNotionConfig(config) {
  send({ type: 'notion:save_config', config });
}

function testNotionConnection() {
  notionTestResult.value = null;
  send({ type: 'notion:test' });
}

function analyseNotionDatabase(ticketDatabaseUrl) {
  notionAnalyseResult.value = null;
  send({ type: 'notion:analyse', ticketDatabaseUrl });
}

// Handle settings, usage, and MCP messages
onMessage((msg) => {
  if (msg.type === 'settings') {
    settings.value = msg.settings;
    if (msg.discordEnabled !== undefined) {
      discordEnabled.value = msg.discordEnabled;
    }
    if (msg.maxFileSizeMb !== undefined) {
      maxFileSizeMb.value = msg.maxFileSizeMb;
    }
  } else if (msg.type === 'notion:config') {
    notionConfig.value = msg.config;
    setBoardColumnOrder(msg.config?.boardColumnOrder ?? []);
  } else if (msg.type === 'notion:test_result') {
    notionTestResult.value = msg;
  } else if (msg.type === 'notion:save_result') {
    // Save acknowledged — config will follow as separate notion:config message
  } else if (msg.type === 'notion:analyse_result') {
    notionAnalyseResult.value = msg;
  } else if (msg.type === 'settings_updated') {
    if (msg.success) {
      settings.value = msg.settings;
    }
  } else if (msg.type === 'usage_stats') {
    usageStats.value = msg.stats;
  } else if (msg.type === 'mcp:servers') {
    mcpServers.value = msg.servers;
    mcpLoading.value = false;
  } else if (
    msg.type === 'mcp:added' ||
    msg.type === 'mcp:updated' ||
    msg.type === 'mcp:removed'
  ) {
    if (msg.success) {
      mcpServers.value = msg.servers;
      settingsModalRef.value?.handleMcpMutationSuccess();
    } else {
      settingsModalRef.value?.handleMcpMutationError(
        msg.error ?? 'Operation failed',
      );
    }
  } else if (msg.type === 'mcp:test_result') {
    settingsModalRef.value?.handleMcpTestResult(msg);
  } else if (
    msg.type === 'files:read:result' &&
    pendingDownloads.has(msg.path)
  ) {
    // Handle download triggered from FilePicker
    if (msg.content !== undefined) {
      pendingDownloads.delete(msg.path);
      const fileName = msg.path.split('/').pop();
      let href;
      if (msg.content.startsWith('data:')) {
        href = msg.content;
      } else {
        const blob = new Blob([msg.content], { type: 'text/plain' });
        href = URL.createObjectURL(blob);
      }
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      a.click();
      if (!msg.content.startsWith('data:')) URL.revokeObjectURL(href);
    }
  }
});

// Command palette state
const showPalette = ref(false);
const paletteNewProjectMode = ref(false);

function openPaletteNewProject() {
  paletteNewProjectMode.value = true;
  showPalette.value = true;
}

// File picker state
const showFilePicker = ref(false);

// Sidebar ref — used to call exposed methods (e.g. openTodayNote)
const sidebarRef = ref(null);

function handleGlobalKeydown(e) {
  // Cmd+D / Ctrl+D: Jump to today's daily note (from any view)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'd') {
    e.preventDefault();
    const today = new Date().toISOString().slice(0, 10);
    router.push({ name: 'notes', params: { notePath: `daily/${today}.md` } });
  }
  // Ctrl+K or Cmd+K: Open command palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showPalette.value = true;
    // Fetch with higher limit so palette search covers full history
    getRecentSessionsForPalette();
  }
  // Ctrl+P or Cmd+P: Open file picker (only in project/session context)
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    // Only open if we're in a project context
    if (route.params.project) {
      showFilePicker.value = true;
    }
  }
  // Ctrl+B or Cmd+B: Toggle sidebar
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  // Ctrl+, or Cmd+,: Open settings
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    openSettings('settings');
  }
  // Ctrl+? or Cmd+? or Ctrl+/ or Cmd+/: Show keyboard shortcuts
  if ((e.ctrlKey || e.metaKey) && (e.key === '?' || e.key === '/')) {
    e.preventDefault();
    if (showSettings.value) {
      closeSettings();
    } else {
      openSettings('shortcuts');
    }
  }
  // Ctrl/Cmd+1-4: switch sidebar tabs and open sidebar
  const TAB_KEYS = { 1: 'sessions', 2: 'projects', 3: 'tasks', 4: 'notes' };
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && TAB_KEYS[e.key]) {
    e.preventDefault();
    sidebarActiveTab.value = TAB_KEYS[e.key];
    openSidebar();
  }
}

function closePalette() {
  showPalette.value = false;
  paletteNewProjectMode.value = false;
}

function handleCloned({ projectSlug }) {
  closeCloneDialog();
  // Refresh projects list so sidebar shows the newly cloned project
  getProjects();
  router.push({ name: 'sessions', params: { project: projectSlug } });
}

function closeFilePicker() {
  showFilePicker.value = false;
}

function handleFileSelect(file) {
  // Set the selected file path for ChatView to pick up
  selectedFilePath.value = file.path;

  // Navigate to the current session with file mode
  const projectSlug = route.params.project;
  const sessionId = route.params.session;

  if (projectSlug && sessionId) {
    // Already in a session, navigate with mode and file query params
    if (file.isDirectory) {
      // For folders, navigate to Files mode and browse to that folder
      router.push({
        name: 'chat',
        params: { project: projectSlug, session: sessionId },
        query: { mode: 'files', folder: file.path },
      });
    } else {
      // For files, open in editor
      router.push({
        name: 'chat',
        params: { project: projectSlug, session: sessionId },
        query: { mode: 'files', file: file.path },
      });
    }
    // Close the file picker after navigation
    closeFilePicker();
  } else if (projectSlug) {
    // In project view, navigate to the most recent session or create new
    // For now, just go to sessions view
    router.push({
      name: 'sessions',
      params: { project: projectSlug },
    });
    closeFilePicker();
  }
}

function handleFileReference(file) {
  // Set the file reference for ChatView to pick up
  fileReference.value = file.path;

  // Close the file picker
  closeFilePicker();
}

// Pending downloads — Map<path, true> to support concurrent downloads without race conditions
const pendingDownloads = new Map();

function handleFilePickerDownload(file) {
  if (!file || file.isDirectory) return;
  pendingDownloads.set(file.path, true);
  // Request file content via WebSocket
  send({
    type: 'files:read',
    path: file.path,
    projectPath: route.params.project,
  });
  closeFilePicker();
}

// Sidebar state - shared across all pages
// Desktop = >1024px. Tablet (641-1024px) behaves like mobile (overlay sidebar).
const desktopMq = window.matchMedia('(min-width: 1025px)');
const isDesktop = ref(desktopMq.matches);
function onDesktopMqChange(e) {
  isDesktop.value = e.matches;
  // Auto-close sidebar when switching to tablet/mobile
  if (!e.matches) {
    closeSidebar();
  }
}
desktopMq.addEventListener('change', onDesktopMqChange);

// Mobile = <=640px. Tablet (641-1024px) shares hamburger-only behaviour with desktop.
const mobileMq = window.matchMedia('(max-width: 640px)');
const isMobile = ref(mobileMq.matches);
function onMobileMqChange(e) {
  isMobile.value = e.matches;
}
mobileMq.addEventListener('change', onMobileMqChange);

const storedSidebarState = localStorage.getItem('sidebarOpen');
// On mobile, always start closed. On desktop, use stored state or default to open.
const sidebarOpen = ref(
  isDesktop.value
    ? storedSidebarState !== null
      ? storedSidebarState === 'true'
      : true
    : false,
);

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
  localStorage.setItem('sidebarOpen', sidebarOpen.value.toString());
}

function openSidebar() {
  sidebarOpen.value = true;
  localStorage.setItem('sidebarOpen', 'true');
}

function closeSidebar() {
  sidebarOpen.value = false;
  localStorage.setItem('sidebarOpen', 'false');
}

// Android back button closes sessions sidebar on mobile instead of navigating away
const { consumeSentinel } = useBackButton(sidebarOpen, closeSidebar, {
  mobileOnly: true,
});

// On mobile, close sidebar whenever the route changes (e.g. tapping a note/task/project).
// Consume the useBackButton sentinel first so it doesn't call history.back() and race
// with the just-completed navigation.
watch(route, () => {
  if (!isDesktop.value && sidebarOpen.value) {
    consumeSentinel();
    closeSidebar();
  }
});

// Sidebar tab state (lifted from Sidebar.vue for shared access with SidebarFooter)
const SIDEBAR_TAB_KEY = 'tofucode:sidebar-tab';
const VALID_TABS = new Set(['sessions', 'projects', 'tasks', 'notes']);

function loadSavedTab() {
  const saved = localStorage.getItem(SIDEBAR_TAB_KEY);
  return saved && VALID_TABS.has(saved) ? saved : 'sessions';
}

const sidebarActiveTab = ref(sidebarOpen.value ? loadSavedTab() : null);

watch(sidebarActiveTab, (tab) => {
  if (tab) localStorage.setItem(SIDEBAR_TAB_KEY, tab);
});

// Sync tab state with sidebar open/close
watch(sidebarOpen, (isOpen) => {
  if (!isOpen) {
    sidebarActiveTab.value = null;
  } else if (!sidebarActiveTab.value) {
    // Restore last-used tab when sidebar reopens (e.g. via hamburger)
    sidebarActiveTab.value = loadSavedTab();
  }
});

// Provide sidebar state to child components
provide('sidebar', {
  open: sidebarOpen,
  isMobile,
  toggle: toggleSidebar,
  openSidebar,
  close: closeSidebar,
  activeTab: sidebarActiveTab,
});

// Provide settings to child components
provide('settings', {
  settings,
  debugMode: () => settings.value.debugMode,
  autoSaveFiles: () => settings.value.autoSaveFiles,
  symbolToolbar: () => settings.value.symbolToolbar,
  quickAccessFile: () => settings.value.quickAccessFile,
  enableMemo: () => settings.value.enableMemo,
  notesBasePath: () => settings.value.notesBasePath,
  notesIncludePaths: () => settings.value.notesIncludePaths || [],
  maxFileSizeMb, // server cap (ref)
});

onMounted(() => {
  connect(() => {
    // Load settings and Notion config once WebSocket is connected
    send({ type: 'get_settings' });
    send({ type: 'notion:get_config' });
  });
  document.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  disconnect();
  document.removeEventListener('keydown', handleGlobalKeydown);
  desktopMq.removeEventListener('change', onDesktopMqChange);
  mobileMq.removeEventListener('change', onMobileMqChange);
});
</script>

<template>
  <div class="app" :class="{ 'sidebar-open': sidebarOpen }">
    <Sidebar ref="sidebarRef" :open="sidebarOpen" :active-tab="sidebarActiveTab" :notion-enabled="notionConfig?.enabled ?? false" @close="closeSidebar" @open-settings="openSettings" @new-project="openPaletteNewProject" />
    <div class="app-main">
      <router-view />
    </div>
    <div class="bottom-bar">
      <button class="bottom-bar-hamburger" title="Toggle sidebar (Ctrl+B)" @click="toggleSidebar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <SidebarFooter v-model:active-tab="sidebarActiveTab" class="bottom-bar-tabs" />
      <div id="view-footer" class="bottom-bar-view"></div>
    </div>
    <CommandPalette
      :show="showPalette"
      :sessions="recentSessions"
      :initial-new-project-mode="paletteNewProjectMode"
      @close="closePalette"
    />
    <FilePicker
      :show="showFilePicker"
      @close="closeFilePicker"
      @select="handleFileSelect"
      @reference="handleFileReference"
      @download="handleFilePickerDownload"
    />
    <SettingsModal
      ref="settingsModalRef"
      :show="showSettings"
      :settings="settings"
      :connected="connected"
      :usage-stats="usageStats"
      :discord-enabled="discordEnabled"
      :notion-config="notionConfig"
      :notion-test-result="notionTestResult"
      :notion-analyse-result="notionAnalyseResult"
      :mcp-servers="mcpServers"
      :mcp-loading="mcpLoading"
      :initial-tab="settingsInitialTab"
      @close="closeSettings"
      @update="updateSettings"
      @restart="handleRestart"
      @fetch-usage="fetchUsageStats"
      @notion-fetch-config="fetchNotionConfig"
      @notion-save-config="saveNotionConfig"
      @notion-test="testNotionConnection"
      @notion-analyse="analyseNotionDatabase"
      @mcp-fetch="fetchMcpServers"
      @mcp-add="handleMcpAdd"
      @mcp-update="handleMcpUpdate"
      @mcp-remove="handleMcpRemove"
      @mcp-test="handleMcpTest"
    />
    <GitCloneModal
      :show="showCloneDialog"
      :initial-target-dir="cloneInitialDir"
      @close="closeCloneDialog"
      @cloned="handleCloned"
    />
    <PwaPrompt />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: 1fr auto;
  height: 100vh;
  overflow: hidden;
}

.app:not(.sidebar-open) {
  grid-template-columns: 1fr;
}

.app-main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Bottom bar: persistent row at bottom spanning full width */
.bottom-bar {
  grid-column: 1 / -1;
  min-width: 0;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--border-color);
  background: var(--bg-primary);
  flex-shrink: 0;
}

/* Hamburger: desktop/tablet only, fixed width, leftmost */
.bottom-bar-hamburger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: var(--bottom-bar-height);
  flex-shrink: 0;
  color: var(--text-muted);
  transition: color 0.15s;
}

.bottom-bar-hamburger:hover {
  color: var(--text-secondary);
}

/* When sidebar closed, hamburger carries the separator border */
.app:not(.sidebar-open) .bottom-bar-hamburger {
  border-right: 1px solid var(--border-color);
}

/* Tabs: fixed sidebar-width minus hamburger on desktop with sidebar open,
   hidden on desktop with sidebar closed */
.bottom-bar-tabs {
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
}

/* When sidebar is open, tabs + hamburger together = sidebar width */
.sidebar-open .bottom-bar-tabs {
  width: calc(var(--sidebar-width) - 44px);
}

/* When sidebar is closed, tabs are hidden — hamburger stays, view footer fills rest */
.app:not(.sidebar-open) .bottom-bar-tabs {
  display: none;
}

.bottom-bar-view {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

/* Tablet: overlay sidebar — grid is always single column */
@media (max-width: 1024px) {
  .app,
  .app.sidebar-open {
    grid-template-columns: 1fr;
  }
}

/* Mobile: stacked bottom bar, no hamburger */
@media (max-width: 640px) {
  .bottom-bar {
    flex-direction: column-reverse;
  }

  /* Hide hamburger on mobile */
  .bottom-bar-hamburger {
    display: none;
  }

  /* Tabs: full width row */
  .bottom-bar-tabs,
  .sidebar-open .bottom-bar-tabs,
  .app:not(.sidebar-open) .bottom-bar-tabs {
    display: flex;
    width: 100%;
    border-right: none;
    border-top: 1px solid var(--border-color);
  }

  /* View footer: own row above tabs, hidden when empty */
  .bottom-bar-view {
    width: 100%;
    border-top: 1px solid var(--border-color);
  }

  .bottom-bar-view:empty {
    display: none;
  }
}
</style>
