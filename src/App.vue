<script setup>
import { onMounted, onUnmounted, provide, ref } from 'vue';
import CommandPalette from './components/CommandPalette.vue';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue';
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
  send,
  onMessage,
} = useWebSocket();

// Settings state
const showSettings = ref(false);
const settings = ref({
  debugMode: false,
  autoSaveFiles: true,
  symbolToolbar: '` ~ ! @ # $ % ^ & * ( ) - _ = + /',
  quickAccessFile: 'TODO.md',
});

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

function updateSettings(newSettings) {
  send({
    type: 'update_settings',
    settings: newSettings,
  });
}

function handleRestart() {
  send({ type: 'restart' });
}

// Handle settings messages
onMessage((msg) => {
  if (msg.type === 'settings') {
    settings.value = msg.settings;
  } else if (msg.type === 'settings_updated') {
    if (msg.success) {
      settings.value = msg.settings;
    }
  }
});

// Command palette state
const showPalette = ref(false);

function handleGlobalKeydown(e) {
  // Ctrl+K or Cmd+K: Open command palette
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showPalette.value = true;
    // Refresh sessions when opening palette (immediate for user action)
    getRecentSessionsImmediate();
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
    <Sidebar :open="sidebarOpen" @close="closeSidebar" @open-settings="openSettings" @open-help="openHelp" />
    <div class="app-main">
      <router-view />
    </div>
    <CommandPalette
      :show="showPalette"
      :sessions="recentSessions"
      @close="closePalette"
    />
    <SettingsModal
      :show="showSettings"
      :settings="settings"
      :connected="connected"
      @close="closeSettings"
      @update="updateSettings"
      @restart="handleRestart"
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
