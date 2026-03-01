<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  sessions: {
    type: Array,
    default: () => [],
  },
  initialNewProjectMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close']);

const router = useRouter();
const { browseFolder, folderContents, currentFolder } = useWebSocket();

const searchQuery = ref('');
const selectedIndex = ref(0);
const inputRef = ref(null);

// New Project (folder selector) mode
const newProjectMode = ref(false);

function enterNewProjectMode() {
  newProjectMode.value = true;
  searchQuery.value = '';
  selectedIndex.value = 0;
  // Load current folder contents
  browseFolder(currentFolder.value);
  nextTick(() => inputRef.value?.focus());
}

function exitNewProjectMode() {
  newProjectMode.value = false;
  searchQuery.value = '';
  selectedIndex.value = 0;
  nextTick(() => inputRef.value?.focus());
}

// Folder listing: directories only, sorted (dirs first, then alpha)
const folderItems = computed(() => {
  const items = folderContents.value || [];
  return items
    .filter((item) => item.isDirectory && !item.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
});

function navigateFolder(path) {
  browseFolder(path);
  selectedIndex.value = 0;
}

function goUpFolder() {
  if (!currentFolder.value || currentFolder.value === '/') return;
  const parent = currentFolder.value.split('/').slice(0, -1).join('/') || '/';
  browseFolder(parent);
  selectedIndex.value = 0;
}

function selectFolder(folderPath) {
  const slug = `-${folderPath.replace(/^\//, '').replace(/\//g, '-')}`;
  emit('close');
  window.location.href = `/project/${slug}/session/new`;
}

function useCurrentFolder() {
  if (currentFolder.value) selectFolder(currentFolder.value);
}

// Group sessions by project
const groupedSessions = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  let sessionsToGroup = props.sessions;

  // Filter by search query if present
  if (query) {
    sessionsToGroup = props.sessions.filter((session) => {
      const title = (
        session.title ||
        session.firstPrompt ||
        'Untitled'
      ).toLowerCase();
      const project = (session.projectName || '').toLowerCase();
      return title.includes(query) || project.includes(query);
    });
  }

  // Group by project
  const groups = {};
  for (const session of sessionsToGroup) {
    const projectSlug = session.projectSlug;
    if (!groups[projectSlug]) {
      groups[projectSlug] = {
        projectSlug,
        projectName: session.projectName,
        sessions: [],
      };
    }
    groups[projectSlug].sessions.push(session);
  }

  // Convert to array and limit sessions per project
  return Object.values(groups)
    .map((group) => ({
      ...group,
      sessions: group.sessions.slice(0, 5), // Show max 5 sessions per project
    }))
    .slice(0, 10); // Show max 10 projects
});

// Flatten for keyboard navigation
const flattenedItems = computed(() => {
  const items = [];
  for (const group of groupedSessions.value) {
    items.push({ type: 'project', ...group });
    for (const session of group.sessions) {
      items.push({
        type: 'session',
        ...session,
        projectName: group.projectName,
      });
    }
  }
  return items;
});

// Reset state when palette opens
watch(
  () => props.show,
  (isVisible) => {
    if (isVisible) {
      searchQuery.value = '';
      selectedIndex.value = 0;
      if (props.initialNewProjectMode) {
        newProjectMode.value = true;
        browseFolder(currentFolder.value);
      } else {
        newProjectMode.value = false;
      }
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  },
);

// Reset selected index when results change
watch(flattenedItems, () => {
  selectedIndex.value = 0;
});

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (newProjectMode.value) {
      exitNewProjectMode();
    } else {
      emit('close');
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const max = newProjectMode.value
      ? folderItems.value.length - 1
      : flattenedItems.value.length - 1;
    if (selectedIndex.value < max) selectedIndex.value++;
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex.value > 0) selectedIndex.value--;
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (newProjectMode.value) {
      const item = folderItems.value[selectedIndex.value];
      if (item) navigateFolder(item.path);
      return;
    }
    const item = flattenedItems.value[selectedIndex.value];
    if (item?.type === 'session') {
      selectSession(item);
    } else if (item?.type === 'project') {
      createNewSession(item.projectSlug);
    }
    return;
  }
}

function selectSession(session) {
  if (!session) return;
  emit('close');
  // Use full page reload to ensure clean WebSocket state
  window.location.href = `/project/${session.projectSlug}/session/${session.sessionId}`;
}

function createNewSession(projectSlug) {
  if (!projectSlug) return;
  emit('close');
  // Use full page reload to ensure clean WebSocket state
  window.location.href = `/project/${projectSlug}/session/new`;
}

// Calculate flattened index for a given group and session
// sessionIndex = -1 means the project header itself
function calculateFlattenedIndex(groupIndex, sessionIndex) {
  let index = 0;
  // Count all items from previous groups
  for (let i = 0; i < groupIndex; i++) {
    const prevGroup = groupedSessions.value[i];
    index += 1 + prevGroup.sessions.length; // 1 for project header + sessions
  }
  // Add current group's offset
  if (sessionIndex === -1) {
    // Project header
    return index;
  }
  // Session within current group
  return index + 1 + sessionIndex; // +1 for current group's project header
}

// Use shared formatRelativeTime utility
const formatTime = formatRelativeTime;
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="palette-overlay" @click="$emit('close')">
      <div class="palette" @click.stop>
        <div class="palette-input-wrapper">
          <!-- Folder mode: up button + path display -->
          <template v-if="newProjectMode">
            <button class="palette-up-btn" @click="goUpFolder" :disabled="!currentFolder || currentFolder === '/'" title="Go up">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <span class="palette-folder-path">{{ currentFolder || '~' }}</span>
          </template>
          <!-- Folder mode: hidden focusable input to capture keydown -->
          <input v-if="newProjectMode" ref="inputRef" class="palette-input-hidden" @keydown="handleKeydown" readonly />
          <!-- Session mode: search icon + input -->
          <template v-else>
            <svg class="palette-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref="inputRef"
              v-model="searchQuery"
              type="text"
              class="palette-input"
              placeholder="Search sessions..."
              @keydown="handleKeydown"
            />
          </template>
          <!-- New Project toggle -->
          <button
            class="palette-new-project-toggle"
            :class="{ active: newProjectMode }"
            :title="newProjectMode ? 'Back to sessions' : 'New Project'"
            @click="newProjectMode ? exitNewProjectMode() : enterNewProjectMode()"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            {{ newProjectMode ? 'Sessions' : 'New Project' }}
          </button>
          <kbd v-if="!newProjectMode" class="palette-hint">esc</kbd>
        </div>

        <!-- Folder selector results -->
        <div v-if="newProjectMode" class="palette-results">
          <!-- Select current folder action -->
          <div class="palette-folder-select-row" @click="useCurrentFolder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="palette-folder-select-label">Use this folder</span>
            <span class="palette-folder-select-path">{{ currentFolder }}</span>
            <kbd class="palette-folder-select-hint">↵ enter</kbd>
          </div>
          <!-- Subdirectories -->
          <div
            v-for="(item, index) in folderItems"
            :key="item.path"
            class="palette-item palette-item-folder"
            :class="{ selected: index === selectedIndex }"
            @click="navigateFolder(item.path)"
            @mouseenter="selectedIndex = index"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="palette-folder-name">{{ item.name }}</span>
            <svg class="palette-folder-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
          <div v-if="folderItems.length === 0" class="palette-empty">
            <p>No subdirectories</p>
          </div>
        </div>

        <div class="palette-results" v-else-if="groupedSessions.length > 0">
          <template v-for="(group, groupIndex) in groupedSessions" :key="group.projectSlug">
            <!-- Project header -->
            <div
              class="palette-item palette-item-project"
              :class="{ selected: flattenedItems[selectedIndex]?.type === 'project' && flattenedItems[selectedIndex]?.projectSlug === group.projectSlug }"
              @mouseenter="selectedIndex = calculateFlattenedIndex(groupIndex, -1)"
            >
              <div class="palette-project-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="palette-project-name">{{ group.projectName }}</span>
              </div>
              <button
                class="palette-new-session-btn"
                @click.stop="createNewSession(group.projectSlug)"
                title="New session"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>

            <!-- Sessions under this project -->
            <div
              v-for="(session, sessionIndex) in group.sessions"
              :key="session.sessionId"
              class="palette-item palette-item-session"
              :class="{ selected: flattenedItems[selectedIndex]?.sessionId === session.sessionId }"
              @click="selectSession(session)"
              @mouseenter="selectedIndex = calculateFlattenedIndex(groupIndex, sessionIndex)"
            >
              <div class="palette-item-content">
                <span class="palette-item-title">{{ session.title || session.firstPrompt || 'Untitled' }}</span>
              </div>
              <span class="palette-item-time">{{ formatTime(session.modified) }}</span>
            </div>
          </template>
        </div>

        <div class="palette-empty" v-else-if="searchQuery">
          <p>No sessions found</p>
        </div>

        <div class="palette-empty" v-else>
          <p>No recent sessions</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  padding-top: 15vh;
  z-index: 1000;
}

.palette {
  width: 100%;
  max-width: 500px;
  max-height: 400px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.palette-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.palette-input {
  flex: 1;
  font-size: 14px;
  background: transparent;
  color: var(--text-primary);
}

.palette-input::placeholder {
  color: var(--text-muted);
}

.palette-hint {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.palette-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.1s;
}

.palette-item:hover,
.palette-item.selected {
  background: var(--bg-hover);
}

.palette-item.selected {
  background: var(--bg-tertiary);
}

.palette-item-project {
  position: relative;
  padding: 8px 12px;
  margin-bottom: 4px;
  background: var(--bg-secondary);
}

.palette-item-project:hover {
  background: var(--bg-tertiary);
}

.palette-item-session {
  padding-left: 32px;
}

.palette-project-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.palette-project-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-new-session-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.palette-new-session-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.palette-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.palette-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* New Project toggle button */
.palette-new-project-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  white-space: nowrap;
}

.palette-new-project-toggle:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.palette-new-project-toggle.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Folder mode styles */
.palette-up-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.palette-up-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.palette-up-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.palette-folder-path {
  flex: 1;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-input-hidden {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
}

.palette-folder-select-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.palette-folder-select-row:hover {
  background: var(--bg-tertiary);
}

.palette-folder-select-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.palette-folder-select-path {
  flex: 1;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-folder-select-hint {
  font-size: 10px;
  padding: 2px 5px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.palette-item-folder {
  gap: 8px;
  color: var(--text-secondary);
}

.palette-folder-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-folder-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
}
</style>
