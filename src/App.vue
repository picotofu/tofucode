<script setup>
import { onMounted, onUnmounted, provide, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CommandPalette from './components/CommandPalette.vue';
import FilePicker from './components/FilePicker.vue';
import GitCloneModal from './components/GitCloneModal.vue';
import PwaPrompt from './components/PwaPrompt.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';
import { useBackButton } from './composables/useBackButton.js';
import { useWebSocket } from './composables/useWebSocket';

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
});

// Server capability flags (not user settings — set by server environment)
const discordEnabled = ref(false);
const slackEnabled = ref(false);
const maxFileSizeMb = ref(10);

// Slack config state (separate from general settings)
const slackConfig = ref(null);
const slackTestResult = ref(null);
const slackBotConnected = ref(false);
const slackChannels = ref([]);

// Notion config state (independent of Slack)
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

// Slack event handlers
function fetchSlackConfig() {
  send({ type: 'slack:get_config' });
}

function saveSlackConfig(config) {
  send({ type: 'slack:save_config', config });
}

function testSlackConnection() {
  slackTestResult.value = null;
  send({ type: 'slack:test' });
}

function restartSlackBot() {
  send({ type: 'slack:restart' });
}

function fetchSlackChannels() {
  send({ type: 'slack:list_channels' });
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
    if (msg.slackEnabled !== undefined) {
      slackEnabled.value = msg.slackEnabled;
    }
    if (msg.maxFileSizeMb !== undefined) {
      maxFileSizeMb.value = msg.maxFileSizeMb;
    }
  } else if (msg.type === 'slack:config') {
    slackConfig.value = msg.config;
  } else if (msg.type === 'slack:status') {
    slackBotConnected.value = msg.connected;
  } else if (msg.type === 'slack:test_result') {
    slackTestResult.value = msg;
  } else if (msg.type === 'slack:channels') {
    slackChannels.value = msg.channels || [];
  } else if (msg.type === 'slack:save_result') {
    // Save acknowledged — config will follow as separate slack:config message
  } else if (msg.type === 'slack:restart_result') {
    // Restart acknowledged
  } else if (msg.type === 'notion:config') {
    notionConfig.value = msg.config;
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

function handleGlobalKeydown(e) {
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
const desktopMq = window.matchMedia('(min-width: 769px)');
const isDesktop = ref(desktopMq.matches);
function onDesktopMqChange(e) {
  isDesktop.value = e.matches;
  // Auto-close sidebar when switching to mobile
  if (!e.matches) {
    closeSidebar();
  }
}
desktopMq.addEventListener('change', onDesktopMqChange);

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

function closeSidebar() {
  sidebarOpen.value = false;
  localStorage.setItem('sidebarOpen', 'false');
}

// Android back button closes sessions sidebar on mobile instead of navigating away
useBackButton(sidebarOpen, closeSidebar, { mobileOnly: true });

// Provide sidebar state to child components
provide('sidebar', {
  open: sidebarOpen,
  toggle: toggleSidebar,
  close: closeSidebar,
});

// Provide settings to child components
provide('settings', {
  settings,
  debugMode: () => settings.value.debugMode,
  autoSaveFiles: () => settings.value.autoSaveFiles,
  symbolToolbar: () => settings.value.symbolToolbar,
  quickAccessFile: () => settings.value.quickAccessFile,
  enableMemo: () => settings.value.enableMemo,
  maxFileSizeMb, // server cap (ref)
});

onMounted(() => {
  connect(() => {
    // Load settings once WebSocket is connected
    send({ type: 'get_settings' });
  });
  document.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  disconnect();
  document.removeEventListener('keydown', handleGlobalKeydown);
  desktopMq.removeEventListener('change', onDesktopMqChange);
});
</script>

<template>
  <div class="app" :class="{ 'sidebar-open': sidebarOpen }">
    <Sidebar :open="sidebarOpen" @close="closeSidebar" @open-settings="openSettings" @new-project="openPaletteNewProject" />
    <div class="app-main">
      <router-view />
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
      :slack-enabled="slackEnabled"
      :slack-config="slackConfig"
      :slack-test-result="slackTestResult"
      :slack-bot-connected="slackBotConnected"
      :slack-channels="slackChannels"
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
      @slack-fetch-config="fetchSlackConfig"
      @slack-save-config="saveSlackConfig"
      @slack-test="testSlackConnection"
      @slack-restart="restartSlackBot"
      @slack-list-channels="fetchSlackChannels"
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
  display: flex;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Mobile: sidebar is overlay */
@media (max-width: 768px) {
  .app {
    display: block;
  }
}
</style>
