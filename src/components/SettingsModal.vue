<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  settings: {
    type: Object,
    default: () => ({ debugMode: false }),
  },
});

const emit = defineEmits(['close', 'update']);

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

      <div class="modal-body">
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
  background: #1e1e1e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
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
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #60a5fa;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.setting-description {
  margin: 8px 0 0 30px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
}
</style>
