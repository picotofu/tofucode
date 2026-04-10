<script setup>
import { computed, inject } from 'vue';

const props = defineProps({
  activeTab: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['update:activeTab']);

const sidebar = inject('sidebar');

// Tab is highlighted only when the sidebar is open and that tab is selected
const highlightedTab = computed(() =>
  sidebar.open.value ? props.activeTab : null,
);

function selectTab(tab) {
  if (sidebar.isMobile.value) {
    // Mobile: tap opens sidebar, tap active tab again closes it
    if (sidebar.open.value && props.activeTab === tab) {
      sidebar.close();
      return;
    }
  }
  emit('update:activeTab', tab);
  sidebar.openSidebar();
}
</script>

<template>
  <nav class="sidebar-footer">
    <button
      class="sidebar-footer-btn"
      :class="{ active: highlightedTab === 'sessions' }"
      @click="selectTab('sessions')"
      title="Sessions (Ctrl+1)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
    <button
      class="sidebar-footer-btn"
      :class="{ active: highlightedTab === 'projects' }"
      @click="selectTab('projects')"
      title="Projects (Ctrl+2)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
    <button
      class="sidebar-footer-btn"
      :class="{ active: highlightedTab === 'tasks' }"
      @click="selectTab('tasks')"
      title="Tasks (Ctrl+3)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    </button>
    <button
      class="sidebar-footer-btn"
      :class="{ active: highlightedTab === 'notes' }"
      @click="selectTab('notes')"
      title="Notes (Ctrl+4)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  height: var(--bottom-bar-height);
  width: 100%;
  box-sizing: border-box;
}

.sidebar-footer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  color: var(--text-muted);
  background: transparent;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
  flex: 1;
}

.sidebar-footer-btn:hover {
  color: var(--text-secondary);
}

.sidebar-footer-btn.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}
</style>
