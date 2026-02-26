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
});

const activeTab = ref('settings');

const emit = defineEmits(['close', 'update', 'restart', 'fetch-usage']);

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

        <hr class="divider" />
        <div class="section-heading">File Limits</div>

        <!-- Max file read size -->
        <div class="setting-item">
          <div class="setting-header">
            <span class="setting-title">Max Read Size (MB)</span>
          </div>
          <p class="setting-description">
            Maximum file size that can be opened in the file editor. Files larger than this will show an info view instead.
          </p>
          <div class="input-with-button">
            <input
              type="number"
              v-model.number="localSettings.maxFileSizeMb"
              class="setting-input"
              min="1"
              max="100"
              step="1"
              placeholder="10"
            />
            <button
              class="reset-btn-inline"
              @click="localSettings.maxFileSizeMb = 10"
              title="Reset to Default"
            >
              Reset
            </button>
          </div>
        </div>

        <!-- Max upload size -->
        <div class="setting-item">
          <div class="setting-header">
            <span class="setting-title">Max Upload Size (MB)</span>
          </div>
          <p class="setting-description">
            Maximum file size allowed for uploads via the file browser.
          </p>
          <div class="input-with-button">
            <input
              type="number"
              v-model.number="localSettings.uploadMaxFileSizeMb"
              class="setting-input"
              min="1"
              max="100"
              step="1"
              placeholder="10"
            />
            <button
              class="reset-btn-inline"
              @click="localSettings.uploadMaxFileSizeMb = 10"
              title="Reset to Default"
            >
              Reset
            </button>
          </div>
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
</style>
