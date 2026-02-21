<script setup>
import { onMounted, onUnmounted, provide, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CommandPalette from './components/CommandPalette.vue';
import FilePicker from './components/FilePicker.vue';
import GitCloneModal from './components/GitCloneModal.vue';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue';
import McpModal from './components/McpModal.vue';
import PwaPrompt from './components/PwaPrompt.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';
import { useWebSocket } from './composables/useWebSocket';

const {
  connect,
  disconnect,
  connected,
  recentSessions,
  getRecentSessionsImmediate,
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

function openSettings() {
  showSettings.value = true;
}

function closeSettings() {
  showSettings.value = false;
}

// Help modal state
const showHelp = ref(false);

function openHelp() {
  showHelp.value = true;
}

function closeHelp() {
  showHelp.value = false;
}

// MCP modal state
const showMcp = ref(false);
const mcpServers = ref([]);
const mcpLoading = ref(false);
const mcpModalRef = ref(null);

function openMcp() {
  showMcp.value = true;
}

function closeMcp() {
  showMcp.value = false;
}

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

// Handle settings, usage, and MCP messages
onMessage((msg) => {
  if (msg.type === 'settings') {
    settings.value = msg.settings;
    if (msg.discordEnabled !== undefined) {
      discordEnabled.value = msg.discordEnabled;
    }
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
      mcpModalRef.value?.handleMutationSuccess();
    } else {
      mcpModalRef.value?.handleMutationError(msg.error ?? 'Operation failed');
    }
  } else if (msg.type === 'mcp:test_result') {
    mcpModalRef.value?.handleTestResult(msg);
  }
});

// Command palette state
const showPalette = ref(false);

// File picker state
const showFilePicker = ref(false);

function handleGlobalKeydown(e) {
  // Ctrl+K or Cmd+K: Open command palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showPalette.value = true;
    // Refresh sessions when opening palette (immediate for user action)
    getRecentSessionsImmediate();
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
    openSettings();
  }
  // Ctrl+? or Cmd+? or Ctrl+/ or Cmd+/: Show keyboard shortcuts
  if ((e.ctrlKey || e.metaKey) && (e.key === '?' || e.key === '/')) {
    e.preventDefault();
    showHelp.value = !showHelp.value;
  }
}

function closePalette() {
  showPalette.value = false;
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

// Sidebar state - shared across all pages
const isDesktop = window.innerWidth > 768;
const storedSidebarState = localStorage.getItem('sidebarOpen');
// On mobile, always start closed. On desktop, use stored state or default to open.
const sidebarOpen = ref(
  isDesktop
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
});
</script>

<template>
  <div class="app" :class="{ 'sidebar-open': sidebarOpen }">
    <Sidebar :open="sidebarOpen" @close="closeSidebar" @open-settings="openSettings" @open-help="openHelp" @open-mcp="openMcp" />
    <div class="app-main">
      <router-view />
    </div>
    <CommandPalette
      :show="showPalette"
      :sessions="recentSessions"
      @close="closePalette"
    />
    <FilePicker
      :show="showFilePicker"
      @close="closeFilePicker"
      @select="handleFileSelect"
      @reference="handleFileReference"
    />
    <SettingsModal
      :show="showSettings"
      :settings="settings"
      :connected="connected"
      :usage-stats="usageStats"
      :discord-enabled="discordEnabled"
      @close="closeSettings"
      @update="updateSettings"
      @restart="handleRestart"
      @fetch-usage="fetchUsageStats"
    />
    <GitCloneModal
      :show="showCloneDialog"
      :initial-target-dir="cloneInitialDir"
      @close="closeCloneDialog"
      @cloned="handleCloned"
    />
    <McpModal
      ref="mcpModalRef"
      :show="showMcp"
      :servers="mcpServers"
      :loading="mcpLoading"
      @close="closeMcp"
      @fetch="fetchMcpServers"
      @add="handleMcpAdd"
      @update="handleMcpUpdate"
      @remove="handleMcpRemove"
      @test="handleMcpTest"
    />
    <KeyboardShortcutsModal
      v-if="showHelp"
      @close="closeHelp"
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
