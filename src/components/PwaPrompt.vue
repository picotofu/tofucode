<script setup>
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { onMounted, ref } from 'vue';

const showInstallPrompt = ref(false);
const showUpdatePrompt = ref(false);

// Register service worker with update prompt
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegistered(r) {
    console.log('Service Worker registered:', r);
    // Check for updates when app comes to foreground
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && r) {
        r.update();
      }
    });
  },
  onRegisterError(error) {
    console.error('Service Worker registration error:', error);
  },
  onNeedRefresh() {
    showUpdatePrompt.value = true;
  },
  immediate: true,
});

// Install prompt
let deferredPrompt = null;

onMounted(() => {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallPrompt.value = true;
  });

  window.addEventListener('appinstalled', () => {
    showInstallPrompt.value = false;
    deferredPrompt = null;
  });
});

async function handleInstall() {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;

  console.log(
    `User ${outcome === 'accepted' ? 'accepted' : 'dismissed'} the install prompt`,
  );

  deferredPrompt = null;
  showInstallPrompt.value = false;
}

function dismissInstall() {
  showInstallPrompt.value = false;
  // Remember dismissal for this session
  sessionStorage.setItem('pwa-install-dismissed', 'true');
}

async function handleUpdate() {
  await updateServiceWorker();
  showUpdatePrompt.value = false;
}

function dismissUpdate() {
  showUpdatePrompt.value = false;
}

// Check if already dismissed this session
onMounted(() => {
  if (sessionStorage.getItem('pwa-install-dismissed')) {
    showInstallPrompt.value = false;
  }
});
</script>

<template>
  <!-- Install Prompt -->
  <div v-if="showInstallPrompt" class="pwa-prompt install-prompt">
    <div class="prompt-content">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <div class="prompt-text">
        <strong>Install tofucode</strong>
        <span>Install as an app for quick access</span>
      </div>
      <div class="prompt-actions">
        <button class="prompt-btn dismiss" @click="dismissInstall">Dismiss</button>
        <button class="prompt-btn install" @click="handleInstall">Install</button>
      </div>
    </div>
  </div>

  <!-- Update Prompt -->
  <div v-if="showUpdatePrompt || needRefresh" class="pwa-prompt update-prompt">
    <div class="prompt-content">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
      <div class="prompt-text">
        <strong>Update Available</strong>
        <span>A new version is ready to install</span>
      </div>
      <div class="prompt-actions">
        <button class="prompt-btn dismiss" @click="dismissUpdate">Later</button>
        <button class="prompt-btn update" @click="handleUpdate">Update</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pwa-prompt {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateX(-50%) translateY(100px);
    opacity: 0;
  }
  to {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
  }
}

.prompt-content {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  min-width: 320px;
  max-width: 90vw;
}

.prompt-content svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.prompt-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.prompt-text strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.prompt-text span {
  font-size: 12px;
  color: var(--text-secondary);
}

.prompt-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.prompt-btn {
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.prompt-btn.dismiss {
  background: transparent;
  color: var(--text-secondary);
}

.prompt-btn.dismiss:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.prompt-btn.install,
.prompt-btn.update {
  background: #F96F3D;
  color: #fff;
}

.prompt-btn.install:hover,
.prompt-btn.update:hover {
  background: #e5632d;
}

/* Mobile adjustments */
@media (max-width: 639px) {
  .pwa-prompt {
    bottom: 10px;
    left: 10px;
    right: 10px;
    transform: none;
  }

  .prompt-content {
    min-width: 0;
    max-width: none;
  }
}
</style>
