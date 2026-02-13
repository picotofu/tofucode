<script setup>
import { onMounted, onUnmounted, provide, ref } from 'vue';
import CommandPalette from './components/CommandPalette.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';
import { useWebSocket } from './composables/useWebSocket';

const {
  connect,
  disconnect,
  recentSessions,
  getRecentSessionsImmediate,
  send,
  onMessage,
} = useWebSocket();

// Settings state
const showSettings = ref(false);
const settings = ref({ debugMode: false });

function openSettings() {
  showSettings.value = true;
}

function closeSettings() {
  showSettings.value = false;
}

function updateSettings(newSettings) {
  send({
    type: 'update_settings',
    settings: newSettings,
  });
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
});

onMounted(() => {
  connect();
  document.addEventListener('keydown', handleGlobalKeydown);
  // Load settings
  send({ type: 'get_settings' });
});

onUnmounted(() => {
  disconnect();
  document.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<template>
  <div class="app" :class="{ 'sidebar-open': sidebarOpen }">
    <Sidebar :open="sidebarOpen" @close="closeSidebar" @open-settings="openSettings" />
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
      @close="closeSettings"
      @update="updateSettings"
    />
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
