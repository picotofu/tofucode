<script setup>
import { onMounted, onUnmounted } from 'vue';

const emit = defineEmits(['close']);

function handleEscape(e) {
  if (e.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape);
});

const shortcuts = [
  {
    category: 'Global',
    items: [
      { keys: ['⌘/^', 'K'], description: 'Open command palette' },
      { keys: ['⌘/^', 'B'], description: 'Toggle sidebar' },
      { keys: ['⌘/^', ','], description: 'Open settings' },
      {
        keys: ['⌘/^', '/'],
        description: 'Show keyboard shortcuts (this dialog)',
      },
    ],
  },
  {
    category: 'Chat View',
    items: [
      { keys: ['⌘/^', '1'], description: 'Switch to Chat tab' },
      { keys: ['⌘/^', '2'], description: 'Switch to Terminal tab' },
      { keys: ['⌘/^', '3'], description: 'Switch to Files tab' },
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
];
</script>

<template>
  <div class="modal-overlay" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>Keyboard Shortcuts</h2>
        <button class="close-btn" @click="$emit('close')" title="Close (Esc)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="shortcuts-container">
        <table class="shortcuts-table">
          <tbody v-for="section in shortcuts" :key="section.category">
            <tr class="section-header">
              <td colspan="2">{{ section.category }}</td>
            </tr>
            <tr v-for="(shortcut, index) in section.items" :key="index" class="shortcut-row">
              <td class="shortcut-keys">
                <kbd v-for="(key, i) in shortcut.keys" :key="i" class="key">
                  {{ key }}
                </kbd>
              </td>
              <td class="shortcut-description">{{ shortcut.description }}</td>
            </tr>
          </tbody>
        </table>
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
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}

.modal-content {
  background: var(--bg-secondary);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  max-width: 700px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.shortcuts-container {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.shortcuts-table {
  width: 100%;
  border-collapse: collapse;
}

.section-header td {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 16px 20px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.shortcuts-table tbody:first-child .section-header td {
  padding-top: 12px;
}

.shortcut-row {
  transition: background 0.15s;
}

.shortcut-row:hover {
  background: var(--bg-hover);
}

.shortcut-row td {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-color);
}

.shortcut-keys {
  width: 180px;
  white-space: nowrap;
}

.shortcut-keys .key {
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
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
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

/* Mobile responsive */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .modal-content {
    max-width: 100%;
    max-height: 90vh;
    border-radius: 12px 12px 0 0;
  }

  .section-header td {
    padding: 12px 16px 6px;
  }

  .shortcut-row td {
    padding: 8px 16px;
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

/* Scrollbar styling */
.shortcuts-container::-webkit-scrollbar {
  width: 8px;
}

.shortcuts-container::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

.shortcuts-container::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.shortcuts-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
