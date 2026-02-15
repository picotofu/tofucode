<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
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
});

const emit = defineEmits(['close']);

const router = useRouter();
const searchQuery = ref('');
const selectedIndex = ref(0);
const inputRef = ref(null);

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
    emit('close');
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex.value < flattenedItems.value.length - 1) {
      selectedIndex.value++;
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
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
          <kbd class="palette-hint">esc</kbd>
        </div>

        <div class="palette-results" v-if="groupedSessions.length > 0">
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
</style>
