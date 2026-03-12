<script setup>
import { onUnmounted, ref, watch } from 'vue';
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
  slackEnabled: {
    type: Boolean,
    default: false,
  },
  slackConfig: {
    type: Object,
    default: null,
  },
  slackTestResult: {
    type: Object,
    default: null,
  },
  slackBotConnected: {
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
});

const activeTab = ref('settings');

const emit = defineEmits([
  'close',
  'update',
  'restart',
  'fetch-usage',
  'slack-fetch-config',
  'slack-save-config',
  'slack-test',
  'slack-restart',
  'notion-fetch-config',
  'notion-save-config',
  'notion-test',
  'notion-analyse',
]);

// Local copy of settings
const localSettings = ref({ ...props.settings });

// Flag to prevent watch loop
let isUpdatingFromProps = false;

// Watch for external changes (from server)
watch(
  () => props.settings,
  (newSettings) => {
    isUpdatingFromProps = true;
    localSettings.value = { ...newSettings };
    // Reset flag after Vue's reactivity system has processed the change
    setTimeout(() => {
      isUpdatingFromProps = false;
    }, 0);
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
    closeModal();
  }
}

// Add keyboard listener when modal is shown; fetch usage on open
watch(
  () => props.show,
  (isVisible) => {
    if (isVisible) {
      document.addEventListener('keydown', handleKeydown);
      activeTab.value = 'settings';
      emit('fetch-usage');
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  },
);

// Cleanup on unmount
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

// --- Slack Settings ---
const SLACK_DEFAULTS = {
  enabled: false,
  botToken: '',
  appToken: '',
  projectRootPath: '',
  sessionLogPath: '',
  watchedChannels: [],
  identity: { name: '', role: '', tone: 'concise, professional' },
  classifier: {
    systemPrompt: '',
  },
};

const slackLocal = ref(null);
const slackSaving = ref(false);
const slackTesting = ref(false);
const slackRestarting = ref(false);
const slackLoading = ref(false);

// Sync incoming config from server into local state
watch(
  () => props.slackConfig,
  (cfg) => {
    slackLoading.value = false;
    if (!slackSaving.value) {
      // Merge server config over defaults so all fields are always present
      slackLocal.value = {
        ...SLACK_DEFAULTS,
        ...(cfg || {}),
        identity: { ...SLACK_DEFAULTS.identity, ...(cfg?.identity || {}) },
        classifier: {
          ...SLACK_DEFAULTS.classifier,
          ...(cfg?.classifier || {}),
        },
      };
    }
  },
  { deep: true },
);

// Watch test results to reset testing state
watch(
  () => props.slackTestResult,
  () => {
    slackTesting.value = false;
  },
);

// Fetch Slack config when switching to Slack tab
watch(activeTab, (tab) => {
  if (tab === 'slack') {
    // Seed with defaults immediately so the form renders right away
    if (!slackLocal.value) {
      slackLocal.value = structuredClone(SLACK_DEFAULTS);
    }
    slackLoading.value = true;
    emit('slack-fetch-config');
  }
  if (tab === 'notion') {
    if (!notionLocal.value) {
      notionLocal.value = structuredClone(NOTION_DEFAULTS);
    }
    notionLoading.value = true;
    emit('notion-fetch-config');
  }
});

function slackSave() {
  if (!slackLocal.value) return;
  slackSaving.value = true;
  emit('slack-save-config', slackLocal.value);
  setTimeout(() => {
    slackSaving.value = false;
  }, 1000);
}

function slackTest() {
  slackTesting.value = true;
  emit('slack-test');
}

function slackRestartBot() {
  slackRestarting.value = true;
  emit('slack-restart');
  setTimeout(() => {
    slackRestarting.value = false;
  }, 3000);
}

function addWatchedChannel() {
  if (!slackLocal.value) return;
  if (!slackLocal.value.watchedChannels) {
    slackLocal.value.watchedChannels = [];
  }
  slackLocal.value.watchedChannels.push({
    id: '',
    name: '',
    respondMode: 'auto',
  });
}

function removeWatchedChannel(index) {
  if (!slackLocal.value?.watchedChannels) return;
  slackLocal.value.watchedChannels.splice(index, 1);
}

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

    // Reload the page to get fresh content
    window.location.reload(true);
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
          v-if="slackEnabled"
          class="tab-btn"
          :class="{ active: activeTab === 'slack' }"
          @click="activeTab = 'slack'"
        >Slack<span v-if="slackBotConnected" class="tab-status-dot" /></button>
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
        </template>

        <!-- Slack Tab -->
        <template v-if="activeTab === 'slack'">
          <div v-if="slackLoading && !slackLocal" class="slack-loading">
            <div class="pill-spinner" />
            <span>Loading...</span>
          </div>
          <template v-else-if="slackLocal">
          <!-- Enable Toggle -->
          <div class="setting-item">
            <label class="setting-label">
              <input
                type="checkbox"
                v-model="slackLocal.enabled"
                class="setting-checkbox"
              />
              <span class="setting-title">Enable Slack Bot</span>
            </label>
            <p class="setting-description">
              Listen and respond to messages in watched channels, DMs, and @mentions
            </p>
            <div class="slack-status-row">
              <div class="connection-pill" :class="{ connected: slackBotConnected }">
                <svg v-if="slackBotConnected" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>{{ slackBotConnected ? 'Socket Connected' : 'Socket Disconnected' }}</span>
              </div>
              <button class="restart-btn" @click="slackRestartBot" :disabled="slackRestarting">
                <svg v-if="!slackRestarting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 4v6h-6"/>
                  <path d="M1 20v-6h6"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                <span>{{ slackRestarting ? 'Restarting...' : 'Restart Bot' }}</span>
              </button>
            </div>
          </div>

          <hr class="divider" />

          <!-- Tokens -->
          <div class="section-heading">Tokens</div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Bot Token (xoxp-)</span>
            </div>
            <p class="setting-description">
              User OAuth Token from your Slack App. Posts as your identity.
            </p>
            <input
              type="text"
              v-model="slackLocal.botToken"
              class="setting-input"
              placeholder="xoxp-..."
              autocomplete="off"
            />
            <div class="notion-actions">
              <button class="restart-btn" @click="slackTest" :disabled="slackTesting || !slackLocal.botToken">
                <svg v-if="!slackTesting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                <span>{{ slackTesting ? 'Testing...' : 'Test Connection' }}</span>
              </button>
            </div>
            <div v-if="slackTestResult" class="slack-test-result" :class="{ success: slackTestResult.success, error: !slackTestResult.success }">
              <template v-if="slackTestResult.success">
                Connected as <strong>{{ slackTestResult.user }}</strong> ({{ slackTestResult.team }})
              </template>
              <template v-else>
                {{ slackTestResult.error }}
              </template>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">App Token (xapp-)</span>
            </div>
            <p class="setting-description">
              App-Level Token with <code>connections:write</code> scope for Socket Mode.
            </p>
            <input
              type="text"
              v-model="slackLocal.appToken"
              class="setting-input"
              placeholder="xapp-..."
              autocomplete="off"
            />
          </div>

          <hr class="divider" />

          <!-- Project Root Path -->
          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Project Root Path</span>
            </div>
            <p class="setting-description">
              Root directory containing your projects. The classifier will identify the correct project from this list when work is needed.
            </p>
            <input
              type="text"
              v-model="slackLocal.projectRootPath"
              class="setting-input"
              placeholder="/home/user/projects"
            />
          </div>

          <!-- Session Log Path -->
          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Session Log Path <span class="optional-tag">optional</span></span>
            </div>
            <p class="setting-description">
              Folder to persist Claude Code session logs from work triggers. Each session is saved as <code>{sessionId}.log</code>. Leave empty to disable.
            </p>
            <input
              type="text"
              v-model="slackLocal.sessionLogPath"
              class="setting-input"
              placeholder="/home/user/slack-sessions"
            />
          </div>

          <hr class="divider" />

          <!-- Watched Channels -->
          <div class="section-heading">Watched Channels</div>

          <div
            v-for="(ch, i) in slackLocal.watchedChannels"
            :key="i"
            class="channel-row"
          >
            <div class="channel-fields">
              <input
                type="text"
                v-model="ch.id"
                class="setting-input channel-input"
                placeholder="Channel ID (e.g. C06H7BFB2GL)"
              />
              <input
                type="text"
                v-model="ch.name"
                class="setting-input channel-input"
                placeholder="Display name"
              />
              <select v-model="ch.respondMode" class="setting-select">
                <option value="auto">Auto</option>
                <option value="mention-only">Mention Only</option>
                <option value="muted">Muted</option>
              </select>
            </div>
            <button class="remove-btn" @click="removeWatchedChannel(i)" title="Remove channel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <button class="add-channel-btn" @click="addWatchedChannel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Channel
          </button>

          <hr class="divider" />

          <!-- Identity -->
          <div class="section-heading">Identity</div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Name</span>
            </div>
            <input
              type="text"
              v-model="slackLocal.identity.name"
              class="setting-input"
              placeholder="Your name (e.g. Jane)"
            />
          </div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Role</span>
            </div>
            <input
              type="text"
              v-model="slackLocal.identity.role"
              class="setting-input"
              placeholder="Your role (e.g. Senior Backend Engineer)"
            />
          </div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">Tone</span>
            </div>
            <input
              type="text"
              v-model="slackLocal.identity.tone"
              class="setting-input"
              placeholder="Response tone (e.g. concise, professional)"
            />
          </div>

          <hr class="divider" />

          <!-- Classifier -->
          <div class="section-heading">Classifier</div>

          <div class="setting-item">
            <div class="setting-header">
              <span class="setting-title">System Prompt Override</span>
            </div>
            <p class="setting-description">
              Custom system prompt for the message classifier. Leave empty to use the default.
            </p>
            <textarea
              v-model="slackLocal.classifier.systemPrompt"
              class="setting-textarea"
              rows="4"
              placeholder="Optional: override the default classification prompt..."
            />
          </div>

          <p class="setting-description" style="margin: 0 0 8px;">
            Configure Notion in the <strong>Notion</strong> tab for task management (optional).
          </p>

          <hr class="divider" />

          <!-- Actions -->
          <div class="section-heading">Actions</div>

          <div class="slack-actions">
            <button class="restart-btn" @click="slackSave" :disabled="slackSaving">
              <svg v-if="!slackSaving" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" class="spin">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              <span>{{ slackSaving ? 'Saving...' : 'Save Config' }}</span>
            </button>
          </div>

          </template><!-- end v-else-if="slackLocal" -->
        </template><!-- end Slack Tab -->

        <!-- Notion Tab -->
        <template v-if="activeTab === 'notion'">
          <div v-if="notionLoading && !notionLocal" class="slack-loading">
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
              When enabled, the Slack bot will create tickets in your Notion database.
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
            <div v-if="notionTestDisplay" class="slack-test-result" :class="{ success: notionTestDisplay.success, error: !notionTestDisplay.success }">
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
            <div v-if="notionAnalyseDisplay && !notionAnalyseDisplay.success" class="slack-test-result error">
              {{ notionAnalyseDisplay.error }}
            </div>
            <div v-if="notionAnalyseDisplay?.success" class="slack-test-result success">
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
              class="channel-row"
            >
              <div class="channel-fields mapping-fields">
                <input
                  type="text"
                  v-model="mapping.field"
                  class="setting-input channel-input"
                  placeholder="Field name"
                />
                <input
                  type="text"
                  v-model="mapping.purpose"
                  class="setting-input channel-input"
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
            <button class="add-channel-btn" @click="addNotionFieldMapping">
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

          <div class="slack-actions">
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
  max-width: 500px;
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

/* Slack tab styles */
.slack-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.channel-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
}

.channel-fields {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.channel-input {
  margin-top: 0 !important;
  font-size: 12px !important;
  padding: 8px !important;
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
  margin-top: 2px;
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

.add-channel-btn {
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

.add-channel-btn:hover {
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

.mapping-fields {
  grid-template-columns: 1fr 2fr !important;
}

.slack-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.slack-test-result {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: var(--radius-sm);
}

.slack-test-result.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: rgb(34, 197, 94);
}

.slack-test-result.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: rgb(239, 68, 68);
}

.tab-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(34, 197, 94);
  margin-left: 5px;
  vertical-align: middle;
  margin-bottom: 1px;
}

.slack-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.slack-status-row .connection-pill {
  display: inline-flex;
}

.slack-status-row .restart-btn {
  margin-top: 0;
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
</style>
