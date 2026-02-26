<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';

const explorerContentRef = ref(null);

const props = defineProps({
  currentPath: String,
  items: Array,
  loading: Boolean,
});

const emit = defineEmits([
  'navigate',
  'select-file',
  'rename',
  'delete',
  'reference',
]);

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  item: null,
});

// Sort: folders first, then files, alphabetically
const sortedItems = computed(() => {
  if (!props.items) return [];
  return [...props.items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
});

function handleItemClick(item) {
  if (item.isDirectory) {
    emit('navigate', item.path);
  } else {
    emit('select-file', item);
  }
}

function handleItemRightClick(event, item) {
  event.preventDefault();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item,
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

function handleContextAction(action) {
  const item = contextMenu.value.item;
  closeContextMenu();

  switch (action) {
    case 'reference':
      emit('reference', item);
      break;
    case 'rename':
      emit('rename', item);
      break;
    case 'delete':
      emit('delete', item);
      break;
  }
}

defineExpose({
  getScrollTop: () => explorerContentRef.value?.scrollTop ?? 0,
  setScrollTop: (value) => {
    if (explorerContentRef.value) explorerContentRef.value.scrollTop = value;
  },
});

// Lifecycle - properly cleanup event listeners
onMounted(() => {
  document.addEventListener('click', closeContextMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
});
</script>

<template>
  <div class="file-explorer">
    <!-- File list -->
    <div ref="explorerContentRef" class="explorer-content">
      <div v-if="loading" class="explorer-loading">Loading...</div>
      <div v-else-if="!items || items.length === 0" class="explorer-empty">
        <p>Empty folder</p>
      </div>
      <div v-else class="file-list">
        <div
          v-for="item in sortedItems"
          :key="item.path"
          class="file-item"
          :class="{ directory: item.isDirectory }"
          @click="handleItemClick(item)"
          @contextmenu="handleItemRightClick($event, item)"
        >
          <div class="file-icon">
            <svg v-if="item.isDirectory" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <svg v-else-if="item.name.endsWith('.md')" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <span class="file-name">{{ item.name }}</span>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      >
        <button v-if="!contextMenu.item?.isDirectory" class="context-menu-item" @click="handleContextAction('reference')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Reference
        </button>
        <button class="context-menu-item" @click="handleContextAction('rename')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Rename
        </button>
        <button class="context-menu-item danger" @click="handleContextAction('delete')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.file-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.explorer-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.explorer-loading,
.explorer-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.file-item:hover {
  background: var(--bg-hover);
}

.file-item.directory {
  color: var(--accent-color);
}

.file-icon {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-item.directory .file-icon {
  color: var(--accent-color);
}

.file-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Context menu */
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: var(--bg-hover);
}

.context-menu-item.danger {
  color: var(--error-color);
}
</style>
