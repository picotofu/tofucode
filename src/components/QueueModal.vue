<script setup>
import { onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  messages: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'delete', 'clear']);

const confirmingClear = ref(false);

function closeModal() {
  confirmingClear.value = false;
  emit('close');
}

function handleDelete(messageId) {
  emit('delete', messageId);
}

function handleClearClick() {
  confirmingClear.value = true;
}

function handleClearConfirm() {
  confirmingClear.value = false;
  emit('clear');
}

function handleClearCancel() {
  confirmingClear.value = false;
}

function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncate(text, max = 120) {
  if (!text) return '';
  const single = text.replace(/\n/g, ' ').trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max)}…`;
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (confirmingClear.value) {
      handleClearCancel();
    } else {
      closeModal();
    }
  }
}

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      document.addEventListener('keydown', handleKeydown);
    } else {
      document.removeEventListener('keydown', handleKeydown);
      confirmingClear.value = false;
    }
  },
);

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="closeModal">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <div class="header-left">
          <h2>Message Queue</h2>
          <span class="queue-count">{{ messages.length }} queued</span>
        </div>
        <button class="close-btn" title="Close (Esc)" @click="closeModal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <p class="queue-hint">
          These messages will run automatically after the current task finishes.
        </p>

        <div v-if="messages.length === 0" class="empty-state">
          <span>Queue is empty</span>
        </div>

        <ul v-else class="queue-list">
          <li
            v-for="(msg, idx) in messages"
            :key="msg.id"
            class="queue-item"
          >
            <div class="item-position">{{ idx + 1 }}</div>
            <div class="item-body">
              <div class="item-prompt">{{ truncate(msg.prompt) }}</div>
              <div class="item-meta">
                <span v-if="msg.options?.model" class="item-model">{{ msg.options.model }}</span>
                <span class="item-time">{{ formatTime(msg.queuedAt) }}</span>
              </div>
            </div>
            <button
              class="delete-btn"
              title="Remove from queue"
              @click="handleDelete(msg.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </li>
        </ul>
      </div>

      <div class="modal-footer">
        <template v-if="confirmingClear">
          <span class="confirm-text">Clear all queued messages?</span>
          <button class="btn-cancel" @click="handleClearCancel">Cancel</button>
          <button class="btn-danger" @click="handleClearConfirm">Clear All</button>
        </template>
        <template v-else>
          <button
            class="btn-clear"
            :disabled="messages.length === 0"
            @click="handleClearClick"
          >
            Clear All
          </button>
          <button class="btn-close" @click="closeModal">Close</button>
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
  z-index: 1000;
  animation: fadeIn 0.15s ease-out;
  backdrop-filter: blur(4px);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  width: 90%;
  max-width: 520px;
  max-height: 70vh;
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
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.queue-count {
  padding: 2px 8px;
  background: rgba(239, 68, 68, 0.15);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: #f87171;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.queue-hint {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.empty-state {
  text-align: center;
  padding: 32px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.queue-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}

.item-position {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: var(--bg-hover);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 1px;
}

.item-body {
  flex: 1;
  min-width: 0;
}

.item-prompt {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.item-model {
  padding: 1px 6px;
  background: rgba(59, 130, 246, 0.12);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: #60a5fa;
}

.item-time {
  font-size: 11px;
  color: var(--text-muted);
}

.delete-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  transition: background 0.15s, color 0.15s;
  margin-top: 1px;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.confirm-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin-right: auto;
}

.btn-clear {
  padding: 7px 14px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  margin-right: auto;
}

.btn-clear:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: #ef4444;
  color: #f87171;
}

.btn-clear:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-cancel {
  padding: 7px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-cancel:hover {
  background: var(--bg-hover);
}

.btn-danger {
  padding: 7px 14px;
  background: #dc2626;
  border: none;
  border-radius: var(--radius-sm);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-danger:hover {
  background: #b91c1c;
}

.btn-close {
  padding: 7px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-close:hover {
  background: var(--bg-hover);
}
</style>
