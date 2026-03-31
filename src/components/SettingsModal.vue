<script setup>
import { computed, nextTick, onUnmounted, ref, toRaw, watch } from 'vue';
import { useWebSocket } from '../composables/useWebSocket';
import McpServerForm from './McpServerForm.vue';
import McpServerList from './McpServerList.vue';
import UsageStats from './UsageStats.vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  settings: {
    type: Object,
    default: () => ({ debugMode: false }),
  },
  connected: {
    type: Boolean,
    default: true,
  },
  usageStats: {
    type: Object,
    default: null,
  },
  discordEnabled: {
    type: Boolean,
    default: false,
  },
  notionConfig: {
    type: Object,
    default: null,
  },
  notionTestResult: {
    type: Object,
    default: null,
  },
  notionAnalyseResult: {
    type: Object,
    default: null,
  },
  mcpServers: {
    type: Array,
    default: () => [],
  },
  mcpLoading: {
    type: Boolean,
    default: false,
  },
  initialTab: {
    type: String,
    default: 'settings',
  },
});

const activeTab = ref('settings');

const emit = defineEmits([
  'close',
  'update',
  'restart',
  'fetch-usage',
  'notion-fetch-config',
  'notion-save-config',
  'notion-test',
  'notion-analyse',
  'mcp-fetch',
  'mcp-add',
  'mcp-update',
  'mcp-remove',
  'mcp-test',
]);

// Local copy of settings (deep-cloned to avoid mutating shared prop references)
const localSettings = ref(structuredClone(toRaw(props.settings)));

// Flag to prevent watch loop
let isUpdatingFromProps = false;

// Watch for external changes (from server)
watch(
  () => props.settings,
  (newSettings) => {
    isUpdatingFromProps = true;
    localSettings.value = structuredClone(toRaw(newSettings));
    // Reset flag after Vue's reactivity system has processed the change
    nextTick(() => {
      isUpdatingFromProps = false;
    });
  },
  { deep: true },
);

// Auto-save on change (only if not from external update)
watch(
  localSettings,
  (newSettings) => {
    if (!isUpdatingFromProps) {
      emit('update', newSettings);
    }
  },
  { deep: true },
);

function closeModal() {
  emit('close');
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    // Close folder browser first if open
    if (folderBrowser.value) {
      closeFolderBrowser();
      return;
    }
    // If MCP tab is in add/edit sub-view, return to list instead of closing modal
    if (activeTab.value === 'mcp' && mcpView.value !== 'list') {
      mcpOnFormCancel();
      return;
    }
    closeModal();
  }
}

// Add keyboard listener when modal is shown; fetch usage on open
watch(
  () => props.show,
  (isVisible) => {
    if (isVisible) {
      document.addEventListener('keydown', handleKeydown);
      activeTab.value = props.initialTab;
      emit('fetch-usage');
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  },
);

// Cleanup on unmount
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', onViewportResize);
  clearTimeout(mcpListTestTimer);
  clearTimeout(mcpFormTestTimer);
  clearTimeout(mcpMutationErrorTimer);
  clearTimeout(blurTimer);
  unsubFolderBrowserFn?.();
});

// ── Viewport dimensions ───────────────────────────────────────────────────────

const viewportWidth = ref(window.innerWidth);
const viewportHeight = ref(window.innerHeight);

function onViewportResize() {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
}

window.addEventListener('resize', onViewportResize);

// Close folder browser when leaving notes tab
watch(activeTab, (tab) => {
  if (tab !== 'notes') closeFolderBrowser();
  if (tab === 'notion') {
    if (!notionLocal.value) {
      notionLocal.value = structuredClone(NOTION_DEFAULTS);
    }
    notionLoading.value = true;
    emit('notion-fetch-config');
  }
});

// ── Notes include paths ─────────────────────────────────────────────────────

function addNotesIncludePath() {
  if (!localSettings.value.notesIncludePaths) {
    localSettings.value.notesIncludePaths = [];
  }
  localSettings.value.notesIncludePaths.push({ path: '', label: '' });
}

function removeNotesIncludePath(index) {
  if (!localSettings.value.notesIncludePaths) return;
  localSettings.value.notesIncludePaths.splice(index, 1);
}

// ── Folder browser ───────────────────────────────────────────────────────────

const { send: wsSend, onMessage: wsOnMessage } = useWebSocket();

// target: 'basePath' | { type: 'include', index: number }
const folderBrowser = ref(null);

function openFolderBrowser(target, initialPath) {
  // If already open for this target, don't re-fetch
  const existing = folderBrowser.value;
  if (existing) {
    const sameTarget =
      target === existing.target ||
      (target?.type === existing.target?.type &&
        target?.index === existing.target?.index);
    if (sameTarget) return;
  }
  const startPath = initialPath?.trim() || null;
  folderBrowser.value = {
    target,
    currentPath: startPath || '',
    pendingPath: startPath, // null = home dir (accept any result while loading)
    items: [],
    loading: true,
    error: null,
  };
  wsSend({ type: 'files:browse', path: startPath });
}

function closeFolderBrowser() {
  folderBrowser.value = null;
}

function folderBrowserNavigate(path) {
  if (!folderBrowser.value) return;
  folderBrowser.value.loading = true;
  folderBrowser.value.error = null;
  folderBrowser.value.pendingPath = path;
  wsSend({ type: 'files:browse', path });
}

function folderBrowserSelect() {
  if (!folderBrowser.value) return;
  const path = folderBrowser.value.currentPath;
  const target = folderBrowser.value.target;
  if (target === 'basePath') {
    localSettings.value.notesBasePath = path;
  } else if (target?.type === 'include') {
    if (!localSettings.value.notesIncludePaths) return;
    localSettings.value.notesIncludePaths[target.index].path = path;
  }
  closeFolderBrowser();
}

// Parent path helper
function folderBrowserParent(path) {
  if (!path || path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  parts.pop();
  return `/${parts.join('/')}` || '/';
}

// Handle focus leaving a path-input wrapper (input + browser panel)
// Use setTimeout so click events on the browser fire before blur closes it
let blurTimer = null;
function onPathWrapperFocusout(target, _initialPath) {
  clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    // Only close if this wrapper's browser is still open
    if (!folderBrowser.value) return;
    const fb = folderBrowser.value;
    const sameTarget =
      target === fb.target ||
      (target?.type === fb.target?.type && target?.index === fb.target?.index);
    if (sameTarget) closeFolderBrowser();
  }, 150);
}

function onPathWrapperFocusin(target, initialPath) {
  clearTimeout(blurTimer);
  openFolderBrowser(target, initialPath);
}

const unsubFolderBrowserFn = wsOnMessage((msg) => {
  const fb = folderBrowser.value;
  if (!fb || !fb.loading) return;
  if (msg.type === 'files:browse:result') {
    // If we have a known pending path, only accept matching result
    if (fb.pendingPath !== null && msg.path !== fb.pendingPath) return;
    fb.currentPath = msg.path;
    fb.pendingPath = null;
    fb.items = (msg.items || [])
      .filter((item) => item.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name));
    fb.loading = false;
    fb.error = null;
  } else if (msg.type === 'files:browse:error') {
    if (fb.pendingPath !== null && msg.path !== fb.pendingPath) return;
    fb.loading = false;
    fb.error = msg.error || 'Could not open folder';
  }
});

// --- Notion Settings ---
const NOTION_DEFAULTS = {
  enabled: false,
  token: '',
  ticketDatabaseUrl: '',
  fieldMappings: [],
};

const notionLocal = ref(null);
const notionSaving = ref(false);
const notionTesting = ref(false);
const notionAnalysing = ref(false);
const notionLoading = ref(false);
const notionTestDisplay = ref(null);
const notionAnalyseDisplay = ref(null);

// Sync incoming Notion config from server
watch(
  () => props.notionConfig,
  (cfg) => {
    notionLoading.value = false;
    if (!notionSaving.value) {
      notionLocal.value = {
        ...NOTION_DEFAULTS,
        ...(cfg || {}),
        fieldMappings: cfg?.fieldMappings ?? NOTION_DEFAULTS.fieldMappings,
      };
    }
  },
  { deep: true },
);

watch(
  () => props.notionTestResult,
  (result) => {
    notionTesting.value = false;
    notionTestDisplay.value = result;
  },
);

watch(
  () => props.notionAnalyseResult,
  (result) => {
    notionAnalysing.value = false;
    notionAnalyseDisplay.value = result;
    // Auto-populate field mappings from analyse result
    if (result?.success && result.fields?.length && notionLocal.value) {
      const hasExisting = (notionLocal.value.fieldMappings?.length ?? 0) > 0;
      if (
        hasExisting &&
        !confirm('Replace current field mappings with the analysed results?')
      ) {
        return;
      }
      notionLocal.value.fieldMappings = result.fields.map((f) => ({
        field: f.field,
        type: f.type,
        purpose: f.purpose,
      }));
    }
  },
);

function notionSave() {
  if (!notionLocal.value) return;
  notionSaving.value = true;
  emit('notion-save-config', notionLocal.value);
  setTimeout(() => {
    notionSaving.value = false;
  }, 1000);
}

function notionTest() {
  notionTesting.value = true;
  notionTestDisplay.value = null;
  emit('notion-test');
}

function notionAnalyse() {
  notionAnalysing.value = true;
  notionAnalyseDisplay.value = null;
  emit('notion-analyse', notionLocal.value?.ticketDatabaseUrl);
}

function addNotionFieldMapping() {
  if (!notionLocal.value) return;
  if (!notionLocal.value.fieldMappings) {
    notionLocal.value.fieldMappings = [];
  }
  notionLocal.value.fieldMappings.push({ field: '', type: '', purpose: '' });
}

function removeNotionFieldMapping(index) {
  if (!notionLocal.value?.fieldMappings) return;
  notionLocal.value.fieldMappings.splice(index, 1);
}

// --- MCP Settings ---
const mcpView = ref('list'); // 'list' | 'add' | 'edit'
const mcpEditingServer = ref(null);
const mcpTestingServer = ref(null);
const mcpListTestResult = ref(null);
let mcpListTestTimer = null;
const mcpFormTesting = ref(false);
const mcpFormTestResult = ref(null);
let mcpFormTestTimer = null;
const mcpFormSaving = ref(false);
const mcpMutationError = ref(null);
let mcpMutationErrorTimer = null;

// Fetch MCP servers when switching to MCP tab
watch(activeTab, (tab) => {
  if (tab === 'mcp') {
    mcpView.value = 'list';
    mcpEditingServer.value = null;
    mcpListTestResult.value = null;
    mcpFormTestResult.value = null;
    clearTimeout(mcpListTestTimer);
    clearTimeout(mcpFormTestTimer);
    emit('mcp-fetch');
  }
});

function mcpOnAdd() {
  mcpEditingServer.value = null;
  mcpFormTestResult.value = null;
  mcpView.value = 'add';
}

function mcpOnEdit(server) {
  mcpEditingServer.value = server;
  mcpFormTestResult.value = null;
  mcpView.value = 'edit';
}

function mcpOnRemove(server) {
  const confirmed = confirm(
    `Remove "${server.name}" from ${server.scope} scope?`,
  );
  if (!confirmed) return;
  emit('mcp-remove', { name: server.name, scope: server.scope });
}

function mcpOnTestFromList(server) {
  mcpTestingServer.value = server.name;
  mcpListTestResult.value = null;
  emit('mcp-test', {
    serverName: server.name,
    url: server.url,
    headers: server.headers ?? {},
  });
}

function mcpOnFormSave(payload) {
  mcpFormSaving.value = true;
  if (mcpView.value === 'edit') {
    emit('mcp-update', payload);
  } else {
    emit('mcp-add', payload);
  }
}

function mcpOnFormTest(payload) {
  mcpFormTesting.value = true;
  mcpFormTestResult.value = null;
  emit('mcp-test', { ...payload, _formLevel: true });
}

function mcpOnFormCancel() {
  mcpView.value = 'list';
  mcpEditingServer.value = null;
  mcpFormTestResult.value = null;
}

function handleMcpTestResult(result) {
  if (result._formLevel) {
    mcpFormTesting.value = false;
    mcpFormTestResult.value = result;
    clearTimeout(mcpFormTestTimer);
    mcpFormTestTimer = setTimeout(() => {
      mcpFormTestResult.value = null;
    }, 8000);
  } else {
    mcpTestingServer.value = null;
    mcpListTestResult.value = result;
    clearTimeout(mcpListTestTimer);
    mcpListTestTimer = setTimeout(() => {
      mcpListTestResult.value = null;
    }, 8000);
  }
}

function handleMcpMutationSuccess() {
  mcpFormSaving.value = false;
  mcpView.value = 'list';
  mcpEditingServer.value = null;
  mcpFormTestResult.value = null;
  mcpMutationError.value = null;
}

function handleMcpMutationError(error) {
  mcpFormSaving.value = false;
  mcpMutationError.value = error;
  clearTimeout(mcpMutationErrorTimer);
  mcpMutationErrorTimer = setTimeout(() => {
    mcpMutationError.value = null;
  }, 6000);
}

// Expose so App.vue can call MCP result handlers
defineExpose({
  handleMcpTestResult,
  handleMcpMutationSuccess,
  handleMcpMutationError,
});

// --- Keyboard Shortcuts data ---
const shortcuts = [
  {
    category: 'Global',
    items: [
      { keys: ['⌘/^', 'K'], description: 'Open command palette' },
      { keys: ['⌘/^', 'P'], description: 'Open file picker' },
      { keys: ['⌘/^', 'B'], description: 'Toggle sidebar' },
      { keys: ['⌘/^', '1'], description: 'Sidebar: Sessions tab' },
      { keys: ['⌘/^', '2'], description: 'Sidebar: Projects tab' },
      { keys: ['⌘/^', '3'], description: 'Sidebar: Tasks tab' },
      { keys: ['⌘/^', '4'], description: 'Sidebar: Notes tab' },
      { keys: ['⌘/^', ','], description: 'Open settings' },
      { keys: ['⌘/^', '/'], description: 'Show keyboard shortcuts' },
    ],
  },
  {
    category: 'Chat View',
    items: [
      { keys: ['⌘/^', '5'], description: 'Switch to Chat tab' },
      { keys: ['⌘/^', '6'], description: 'Switch to Terminal tab' },
      { keys: ['⌘/^', '7'], description: 'Switch to Files tab' },
      { keys: ['⌘/^', '8'], description: 'Switch to Ports tab' },
      { keys: ['⌘/^', 'M'], description: 'Toggle memo' },
      { keys: ['⌘/^', 'N'], description: 'New session from current project' },
      { keys: ['⌘/^', 'J'], description: 'Jump to next session' },
      { keys: ['⌘/^', 'L'], description: 'Scroll to bottom (clear view)' },
      { keys: ['⌘/^', '↑'], description: 'Navigate to previous turn' },
      { keys: ['⌘/^', '↓'], description: 'Navigate to next turn' },
      { keys: ['Escape'], description: 'Close modals / blur input' },
    ],
  },
  {
    category: 'Chat Input',
    items: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line in message' },
      { keys: ['⌘/^', 'Enter'], description: 'Send message (alternate)' },
    ],
  },
  {
    category: 'Terminal',
    items: [
      { keys: ['Enter'], description: 'Execute command' },
      { keys: ['\\'], description: 'Start multiline mode' },
    ],
  },
  {
    category: 'File Editor',
    items: [
      { keys: ['⌘/^', 'S'], description: 'Save file' },
      { keys: ['Escape'], description: 'Close editor' },
    ],
  },
  {
    category: 'Notes',
    items: [
      {
        keys: ['⌘/^', 'D'],
        description: "Jump to today's daily note",
      },
    ],
  },
];

// Restart functionality
const isRestarting = ref(false);
const showConnectionPill = ref(false);

// Reset restart state when reconnected
watch(
  () => props.connected,
  (isConnected) => {
    if (isConnected && isRestarting.value) {
      isRestarting.value = false;
      showConnectionPill.value = true;
      // Fade out after 3 seconds
      setTimeout(() => {
        showConnectionPill.value = false;
      }, 3000);
    }
  },
);

function handleRestart() {
  if (isRestarting.value) return;

  const confirmed = confirm(
    'Restart the server?\n\nThis will briefly disconnect all clients. They will automatically reconnect.',
  );

  if (confirmed) {
    isRestarting.value = true;
    showConnectionPill.value = true;
    emit('restart');
  }
}

// PWA update functionality
const isUpdatingPWA = ref(false);

async function handleClearCacheAndUpdate() {
  if (isUpdatingPWA.value) return;

  const confirmed = confirm(
    'Clear cache and update PWA?\n\nThis will:\n- Unregister the service worker\n- Clear all caches\n- Reload the page with the latest version',
  );

  if (!confirmed) return;

  isUpdatingPWA.value = true;

  try {
    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }

    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }

    // Navigate to reload — location.replace re-fetches index.html fresh (served no-cache by server)
    location.replace(location.href);
  } catch (error) {
    console.error('Failed to clear cache:', error);
    alert('Failed to clear cache. Please try manually clearing browser data.');
    isUpdatingPWA.value = false;
  }
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="closeModal">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="close-btn" @click="closeModal" title="Close">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'settings' }"
          @click="activeTab = 'settings'"
        >Settings</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'usage' }"
          @click="activeTab = 'usage'; emit('fetch-usage')"
        >Usage</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'notion' }"
          @click="activeTab = 'notion'"
        >Notion</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'mcp' }"
          @click="activeTab = 'mcp'"
        >MCP</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'notes' }"
          @click="activeTab = 'notes'"
        >Notes</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'shortcuts' }"
          @click="activeTab = 'shortcuts'"
        >Shortcuts</button>
      </div>

      <div class="modal-body">
        <!-- Usage Stats Tab -->
        <UsageStats v-if="activeTab === 'usage'" :stats="usageStats" />

        <!-- Settings Tab -->
        <template v-if="activeTab === 'settings'">
        <!-- Debug Mode Setting -->
        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              v-model="localSettings.debugMode"
              class="setting-checkbox"
            />
            <span class="setting-title">Debug Mode</span>
          </label>
          <p class="setting-description">
            Hover over elements to see their ID and class names for development
          </p>
        </div>

        <!-- Auto-save Files Setting -->
        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              v-model="localSettings.autoSaveFiles"
              class="setting-checkbox"
            />
            <span class="setting-title">Auto-save Files</span>
          </label>
          <p class="setting-description">
            Automatically save file changes after 1 second of inactivity
          </p>
        </div>

        <!-- Symbol Toolbar Setting -->
        <div class="setting-item">
          <div class="setting-header">
            <span class="setting-title">Symbol Toolbar</span>
          </div>
          <p class="setting-description">
            Customize symbols shown in the text editor toolbar. Enter symbols separated by spaces.
          </p>
          <div class="input-with-button">
            <input
              type="text"
              v-model="localSettings.symbolToolbar"
              class="setting-input"
              placeholder="` ~ ! @ # $ % ^ & * ( ) - _ = + /"
            />
            <button
              class="reset-btn-inline"
              @click="localSettings.symbolToolbar = '` ~ ! @ # $ % ^ & * ( ) - _ = + /'"
              title="Reset to Default"
            >
              Reset
            </button>
          </div>
        </div>

        <!-- Enable Memo Feature -->
        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              v-model="localSettings.enableMemo"
              class="setting-checkbox"
            />
            <span class="setting-title">Enable Memo</span>
          </label>
          <p class="setting-description">
            Enable quick memo access with Cmd+M. Shows memo button beside mode tabs.
          </p>
        </div>

        <!-- Quick Access File Setting -->
        <div class="setting-item" v-if="localSettings.enableMemo">
          <div class="setting-header">
            <span class="setting-title">Memo File</span>
          </div>
          <p class="setting-description">
            Filename for quick memo access. Defaults to TODO.md if not set.
          </p>
          <input
            type="text"
            v-model="localSettings.quickAccessFile"
            class="setting-input"
            placeholder="TODO.md"
          />
        </div>

        <!-- Discord Settings (only shown when DISCORD_ENABLED=true on server) -->
        <template v-if="discordEnabled">
          <hr class="divider" />
          <div class="section-heading">Discord</div>
          <div class="setting-item">
            <label class="setting-label">
              <input
                type="checkbox"
                v-model="localSettings.discordSyncEnabled"
                class="setting-checkbox"
              />
              <span class="setting-title">Enable Discord Syncing</span>
            </label>
            <p class="setting-description">
              Mirror Web UI sessions to Discord. Both your messages and Claude's responses will appear in the mapped Discord channel thread.
            </p>
          </div>
        </template>

        <hr class="divider" />

        <!-- Clear Cache & Update PWA -->
        <div class="setting-item">
          <div class="setting-header">
            <span class="setting-title">PWA & Cache</span>
          </div>
          <p class="setting-description">
            Force clear service worker cache and reload with the latest version. Use this if the app is not updating properly.
          </p>
          <div class="restart-container">
            <button
              class="restart-btn"
              @click="handleClearCacheAndUpdate"
              :disabled="isUpdatingPWA"
            >
              <svg v-if="!isUpdatingPWA" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              <span>{{ isUpdatingPWA ? 'Clearing...' : 'Clear Cache & Update' }}</span>
            </button>
            <a href="/api/sw-reset" class="sw-reset-link">If the button doesn't work, try the hard reset page</a>
          </div>
        </div>

        <!-- Restart Server -->
        <div class="setting-item">
          <div class="setting-header">
            <span class="setting-title">Server Control</span>
          </div>
          <p class="setting-description">
            Restart the server. All clients will be briefly disconnected and automatically reconnect.
          </p>
          <div class="restart-container">
            <button
              class="restart-btn"
              @click="handleRestart"
              :disabled="isRestarting"
            >
              <svg v-if="!isRestarting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6"/>
                <path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              <span>{{ isRestarting ? 'Restarting...' : 'Restart Server' }}</span>
            </button>
            <transition name="fade">
              <div v-if="showConnectionPill" class="connection-pill" :class="{ connected: !isRestarting && connected }">
                <div v-if="isRestarting" class="pill-spinner"></div>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>{{ isRestarting ? 'Connecting...' : 'Connected' }}</span>
              </div>
            </transition>
          </div>
        </div>

        <!-- Viewport -->
        <div class="setting-item">
          <div class="setting-header">
            <span class="setting-title">Viewport</span>
          </div>
          <p class="setting-description">Current browser window dimensions.</p>
          <div class="viewport-display">
            <span class="viewport-value">{{ viewportWidth }} × {{ viewportHeight }}</span>
            <span class="viewport-label">px</span>
          </div>
        </div>
        </template>

        <!-- Notion Tab -->
        <template v-if="activeTab === 'notion'">
          <div v-if="notionLoading && !notionLocal" class="integration-loading">
            <div class="pill-spinner" />
            <span>Loading...</span>
          </div>
          <template v-else-if="notionLocal">

          <!-- Enable Toggle -->
          <div class="setting-item">
            <label class="setting-label">
              <input
                type="checkbox"
                v-model="notionLocal.enabled"
                class="setting-checkbox"
              />
              <span class="setting-title">Enable Notion Integration</span>
            </label>
            <p class="setting-description">
              When enabled, tickets can be created in your Notion database from tofucode.
            </p>
          </div>

          <hr class="divider" />

          <!-- API Token -->
          <div class="section-heading">API Token</div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Integration Token</span>
            </div>
            <p class="setting-description">
              Notion Integration Token (starts with <code>secret_</code>). Create one at
              <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener" style="color: inherit; text-decoration: underline;">notion.so/profile/integrations</a>.
            </p>
            <input
              type="text"
              v-model="notionLocal.token"
              class="setting-input"
              placeholder="secret_..."
              autocomplete="off"
            />
            <div class="notion-actions">
              <button class="restart-btn" @click="notionTest" :disabled="notionTesting || !notionLocal.token">
                <svg v-if="!notionTesting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                <span>{{ notionTesting ? 'Testing...' : 'Test Connection' }}</span>
              </button>
            </div>
            <div v-if="notionTestDisplay" class="integration-test-result" :class="{ success: notionTestDisplay.success, error: !notionTestDisplay.success }">
              {{ notionTestDisplay.success ? notionTestDisplay.message : notionTestDisplay.error }}
            </div>
          </div>

          <hr class="divider" />

          <!-- Database -->
          <div class="section-heading">Ticket Database</div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Database URL</span>
            </div>
            <p class="setting-description">
              Notion database page URL where tickets will be created. Make sure your integration has access to this database.
            </p>
            <input
              type="text"
              v-model="notionLocal.ticketDatabaseUrl"
              class="setting-input"
              placeholder="https://www.notion.so/..."
            />
            <div class="notion-actions">
              <button class="restart-btn" @click="notionAnalyse" :disabled="notionAnalysing || !notionLocal.ticketDatabaseUrl || !notionLocal.token">
                <svg v-if="!notionAnalysing" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                <span>{{ notionAnalysing ? 'Analysing...' : 'Analyse Structure' }}</span>
              </button>
            </div>
            <div v-if="notionAnalyseDisplay && !notionAnalyseDisplay.success" class="integration-test-result error">
              {{ notionAnalyseDisplay.error }}
            </div>
            <div v-if="notionAnalyseDisplay?.success" class="integration-test-result success">
              {{ notionAnalyseDisplay.fields?.length }} fields detected — mappings populated below.
            </div>
          </div>

          <!-- Field Mappings -->
          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Field Mappings</span>
            </div>
            <p class="setting-description">
              Provide hints for how each Notion field should be filled when creating a ticket. Use "Analyse Structure" to auto-populate from your database.
            </p>
            <div
              v-for="(mapping, i) in notionLocal.fieldMappings"
              :key="i"
              class="mapping-row"
            >
              <div class="mapping-fields">
                <input
                  type="text"
                  v-model="mapping.field"
                  class="setting-input mapping-input"
                  placeholder="Field name"
                />
                <input
                  type="text"
                  v-model="mapping.purpose"
                  class="setting-input mapping-input"
                  placeholder="How to fill this field"
                />
              </div>
              <button class="remove-btn" @click="removeNotionFieldMapping(i)" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <button class="add-mapping-btn" @click="addNotionFieldMapping">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Field
            </button>
          </div>

          <hr class="divider" />

          <!-- Actions -->
          <div class="section-heading">Actions</div>

          <div class="integration-actions">
            <button class="restart-btn" @click="notionSave" :disabled="notionSaving">
              <svg v-if="!notionSaving" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              <span>{{ notionSaving ? 'Saving...' : 'Save Config' }}</span>
            </button>
          </div>

          </template><!-- end v-else-if="notionLocal" -->
        </template><!-- end Notion Tab -->

        <!-- MCP Tab -->
        <template v-if="activeTab === 'mcp'">
          <p class="mcp-desc">HTTP/SSE servers are fully managed here. stdio servers require manual installation — only config is managed.</p>

          <!-- Mutation error banner -->
          <div v-if="mcpMutationError" class="mcp-mutation-error">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {{ mcpMutationError }}
          </div>

          <!-- List view -->
          <McpServerList
            v-if="mcpView === 'list'"
            :servers="mcpServers"
            :loading="mcpLoading"
            :testing-server="mcpTestingServer"
            :test-result="mcpListTestResult"
            @add="mcpOnAdd"
            @edit="mcpOnEdit"
            @remove="mcpOnRemove"
            @test="mcpOnTestFromList"
          />

          <!-- Add / Edit form -->
          <McpServerForm
            v-else
            :server="mcpView === 'edit' ? mcpEditingServer : null"
            :testing="mcpFormTesting"
            :test-result="mcpFormTestResult"
            :saving="mcpFormSaving"
            @save="mcpOnFormSave"
            @cancel="mcpOnFormCancel"
            @test="mcpOnFormTest"
          />
        </template><!-- end MCP Tab -->

        <!-- Notes Tab -->
        <template v-if="activeTab === 'notes'">
          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Notes Vault Path</span>
            </div>
            <p class="setting-description">
              Primary notes vault. Daily notes, calendar, and quick note features use this path.
            </p>
            <div
              class="path-input-wrapper"
              @focusin="onPathWrapperFocusin('basePath', localSettings.notesBasePath)"
              @focusout="onPathWrapperFocusout('basePath')"
            >
              <input
                type="text"
                v-model="localSettings.notesBasePath"
                class="setting-input"
                placeholder="/home/user/notes"
              />
              <div v-if="folderBrowser?.target === 'basePath'" class="folder-browser" @mousedown.prevent>
                <div class="folder-browser-header">
                  <button
                    v-if="folderBrowserParent(folderBrowser.currentPath)"
                    class="folder-browser-up"
                    title="Go up"
                    @click="folderBrowserNavigate(folderBrowserParent(folderBrowser.currentPath))"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <span class="folder-browser-path">{{ folderBrowser.currentPath || '~' }}</span>
                  <button class="folder-browser-select" @click="folderBrowserSelect">Select</button>
                </div>
                <div v-if="folderBrowser.loading" class="folder-browser-loading">Loading…</div>
                <div v-else-if="folderBrowser.error" class="folder-browser-error">{{ folderBrowser.error }}</div>
                <ul v-else class="folder-browser-list">
                  <li
                    v-for="item in folderBrowser.items"
                    :key="item.path"
                    class="folder-browser-item"
                    @click="folderBrowserNavigate(item.path)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    {{ item.name }}
                  </li>
                  <li v-if="folderBrowser.items.length === 0" class="folder-browser-empty">No subfolders</li>
                </ul>
              </div>
            </div>
          </div>

          <hr class="divider" />

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Include Paths</span>
            </div>
            <p class="setting-description">
              Additional folders containing markdown files. These appear as linked folders in the notes sidebar for quick access.
            </p>

            <template v-for="(entry, i) in (localSettings.notesIncludePaths || [])" :key="i">
              <div class="notes-include-row">
                <input
                  type="text"
                  v-model="entry.label"
                  class="setting-input notes-include-label"
                  placeholder="Label"
                />
                <div
                  class="path-input-wrapper path-input-wrapper--flex"
                  @focusin="onPathWrapperFocusin({ type: 'include', index: i }, entry.path)"
                  @focusout="onPathWrapperFocusout({ type: 'include', index: i })"
                >
                  <input
                    type="text"
                    v-model="entry.path"
                    class="setting-input"
                    placeholder="/absolute/path"
                  />
                  <div v-if="folderBrowser?.target?.type === 'include' && folderBrowser?.target?.index === i" class="folder-browser" @mousedown.prevent>
                    <div class="folder-browser-header">
                      <button
                        v-if="folderBrowserParent(folderBrowser.currentPath)"
                        class="folder-browser-up"
                        title="Go up"
                        @click="folderBrowserNavigate(folderBrowserParent(folderBrowser.currentPath))"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="15 18 9 12 15 6"/>
                        </svg>
                      </button>
                      <span class="folder-browser-path">{{ folderBrowser.currentPath || '~' }}</span>
                      <button class="folder-browser-select" @click="folderBrowserSelect">Select</button>
                    </div>
                    <div v-if="folderBrowser.loading" class="folder-browser-loading">Loading…</div>
                    <div v-else-if="folderBrowser.error" class="folder-browser-error">{{ folderBrowser.error }}</div>
                    <ul v-else class="folder-browser-list">
                      <li
                        v-for="item in folderBrowser.items"
                        :key="item.path"
                        class="folder-browser-item"
                        @click="folderBrowserNavigate(item.path)"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        {{ item.name }}
                      </li>
                      <li v-if="folderBrowser.items.length === 0" class="folder-browser-empty">No subfolders</li>
                    </ul>
                  </div>
                </div>
                <button class="remove-btn" @click="removeNotesIncludePath(i)" title="Remove">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </template>

            <button class="notes-add-include-btn" @click="addNotesIncludePath">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add path
            </button>
          </div>
        </template><!-- end Notes Tab -->

        <!-- Keyboard Shortcuts Tab -->
        <template v-if="activeTab === 'shortcuts'">
          <table class="shortcuts-table">
            <tbody v-for="section in shortcuts" :key="section.category">
              <tr class="shortcuts-section-header">
                <td colspan="2">{{ section.category }}</td>
              </tr>
              <tr v-for="(shortcut, index) in section.items" :key="index" class="shortcut-row">
                <td class="shortcut-keys">
                  <kbd v-for="(key, i) in shortcut.keys" :key="i" class="shortcut-key">
                    {{ key }}
                  </kbd>
                </td>
                <td class="shortcut-description">{{ shortcut.description }}</td>
              </tr>
            </tbody>
          </table>
        </template><!-- end Shortcuts Tab -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  padding: 0 20px;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
  flex-shrink: 0;
}

.tab-bar::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

.tab-btn {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: -1px;
  white-space: nowrap;
  flex-shrink: 0;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.setting-item {
  margin-bottom: 20px;
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.setting-checkbox {
  appearance: none;
  width: 18px;
  height: 18px;
  cursor: pointer;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  transition: all 0.15s ease;
  position: relative;
  flex-shrink: 0;
}

.setting-checkbox:hover {
  border-color: var(--text-secondary);
}

.setting-checkbox:checked {
  background: var(--text-primary);
  border-color: var(--text-primary);
}

.setting-checkbox:checked::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 4px;
  height: 8px;
  border: solid var(--bg-primary);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-description {
  margin: 8px 0 0 30px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.setting-header {
  margin-bottom: 8px;
}

.section-heading {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.setting-textarea {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm);
  resize: vertical;
  outline: none;
  transition: all 0.15s ease;
}

.setting-textarea:hover {
  border-color: var(--text-muted);
}

.setting-textarea:focus {
  border-color: var(--text-primary);
}

.setting-textarea::placeholder {
  color: var(--text-muted);
}

.setting-input {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: all 0.15s ease;
}

.setting-input:hover {
  border-color: var(--text-muted);
}

.setting-input:focus {
  border-color: var(--text-primary);
}

.setting-input::placeholder {
  color: var(--text-muted);
}

.input-with-button {
  position: relative;
  margin-top: 8px;
}

.input-with-button .setting-input {
  margin-top: 0;
  padding-right: 70px; /* Space for button */
}

.reset-btn-inline {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.reset-btn-inline:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
  background: var(--bg-hover);
}

.reset-btn {
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.reset-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
  background: var(--bg-tertiary);
}

.divider {
  margin: 24px 0;
  border: none;
  border-top: 1px solid var(--border-color);
}

.restart-container {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.viewport-display {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 8px;
}

.viewport-value {
  font-size: 20px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.viewport-label {
  font-size: 12px;
  color: var(--text-muted);
}

.restart-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.restart-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  border-color: var(--text-muted);
}

.restart-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.restart-btn .spin {
  animation: spin 1s linear infinite;
}

.sw-reset-link {
  font-size: 11px;
  color: var(--text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.15s;
}

.sw-reset-link:hover {
  color: var(--text-secondary);
}

.connection-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  transition: opacity 0.3s ease;
}

.connection-pill.connected {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: rgb(34, 197, 94);
}

.pill-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-color);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.integration-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.mapping-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mapping-fields {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 6px;
}


.setting-select {
  width: 100%;
  padding: 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: all 0.15s ease;
  cursor: pointer;
}

.setting-select:hover {
  border-color: var(--text-muted);
}

.setting-select:focus {
  border-color: var(--text-primary);
}

.remove-btn {
  padding: 6px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.remove-btn:hover {
  color: #ef4444;
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

/* Notes include paths */
.notes-include-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-bottom: 6px;
}

.notes-include-label {
  width: 100px;
  flex-shrink: 0;
  margin-top: 0 !important;
}

.notes-include-row .remove-btn {
  flex-shrink: 0;
  height: 36px;
  width: 36px;
  padding: 0;
  margin-top: 0;
}

.notes-add-include-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  margin-top: 4px;
}

.notes-add-include-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Path input wrapper — opens folder browser on focus */
.path-input-wrapper {
  position: relative;
  margin-top: 8px;
}

.path-input-wrapper .setting-input {
  margin-top: 0;
}

.path-input-wrapper--flex {
  flex: 1;
  margin-top: 0;
}

/* Folder browser panel */
.folder-browser {
  margin-top: 4px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  overflow: hidden;
}

.folder-browser-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.folder-browser-up {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.folder-browser-up:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.folder-browser-path {
  flex: 1;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.folder-browser-select {
  flex-shrink: 0;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.folder-browser-select:hover {
  background: var(--text-primary);
  color: var(--bg-primary);
  border-color: var(--text-primary);
}

.folder-browser-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 180px;
  overflow-y: auto;
}

.folder-browser-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.1s ease;
}

.folder-browser-item:hover {
  background: var(--bg-hover);
}

.folder-browser-item svg {
  color: var(--text-muted);
  flex-shrink: 0;
}

.folder-browser-loading,
.folder-browser-error,
.folder-browser-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.folder-browser-error {
  color: #ef4444;
}

.add-mapping-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  justify-content: center;
}

.add-mapping-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
  background: var(--bg-secondary);
}

.notion-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}


.integration-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.integration-test-result {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: var(--radius-sm);
}

.integration-test-result.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: rgb(34, 197, 94);
}

.integration-test-result.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: rgb(239, 68, 68);
}


.optional-tag {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 6px;
  vertical-align: middle;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* --- MCP Tab --- */
.mcp-desc {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.mcp-mutation-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--error-color);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-sm);
}

/* --- Shortcuts Tab --- */
.shortcuts-table {
  width: 100%;
  border-collapse: collapse;
}

.shortcuts-section-header td {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 16px 4px 8px;
  border-bottom: 1px solid var(--border-color);
}

.shortcuts-table tbody:first-child .shortcuts-section-header td {
  padding-top: 4px;
}

.shortcut-row td {
  padding: 8px 4px;
  border-bottom: 1px solid var(--border-color);
}

.shortcut-row:hover {
  background: var(--bg-hover);
}

.shortcut-keys {
  width: 140px;
  white-space: nowrap;
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  margin-right: 4px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
}

.shortcut-description {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.4;
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
    align-items: stretch;
  }

  .modal-content {
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .shortcut-keys {
    width: auto;
    display: block;
    padding-bottom: 4px;
  }

  .shortcut-description {
    font-size: 12px;
  }
}
</style>
