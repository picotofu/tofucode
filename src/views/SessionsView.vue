<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const router = useRouter();
const route = useRoute();
const {
  connected,
  sessions,
  projects,
  connect,
  selectProject,
  setSessionTitle,
  deleteSession,
} = useWebSocket();

// Get sidebar from App.vue
const sidebar = inject('sidebar');

// Session title editing
const editingSessionId = ref(null);
const editingTitle = ref('');
const titleInputRef = ref(null);

const projectSlug = computed(() => route.params.project);

// Find project info from projects list
const projectInfo = computed(() => {
  return (
    projects.value.find((p) => p.slug === projectSlug.value) || {
      slug: projectSlug.value,
      name: projectSlug.value,
      path: projectSlug.value,
    }
  );
});

// Connect on mount and load sessions when ready
onMounted(() => {
  connect(() => {
    // This callback runs once connection is ready
    if (projectSlug.value) {
      selectProject(projectSlug.value);
    }
  });
});

// Watch for project changes (when navigating via sidebar)
watch(projectSlug, (newSlug) => {
  if (connected.value && newSlug) {
    selectProject(newSlug);
  }
});

function selectSession(sessionId) {
  router.push({
    name: 'chat',
    params: {
      project: projectSlug.value,
      session: sessionId,
    },
  });
}

function startNewSession() {
  router.push({
    name: 'chat',
    params: {
      project: projectSlug.value,
      session: 'new',
    },
  });
}

// Use shared utility
const formatTime = formatRelativeTime;

function startEditingTitle(session, event) {
  event.stopPropagation();
  editingSessionId.value = session.sessionId;
  editingTitle.value = session.title || '';
  nextTick(() => {
    titleInputRef.value?.focus();
    titleInputRef.value?.select();
  });
}

function saveTitle() {
  if (editingSessionId.value) {
    setSessionTitle(editingSessionId.value, editingTitle.value);
    editingSessionId.value = null;
    editingTitle.value = '';
  }
}

function cancelEditingTitle() {
  editingSessionId.value = null;
  editingTitle.value = '';
}

function getDisplayTitle(session) {
  return session.title || session.firstPrompt;
}

function handleDeleteSession(sessionId, event) {
  event.stopPropagation();
  if (confirm('Are you sure you want to delete this session?')) {
    deleteSession(sessionId);
  }
}
</script>

<template>
  <div class="sessions-view">
    <AppHeader
      :show-hamburger="true"
      :title="projectInfo.name"
      :subtitle="projectInfo.path"
      @toggle-sidebar="sidebar.toggle"
    />

    <main class="main">
      <ul class="sessions">
        <!-- New Session as first item -->
        <li class="session-item new-session" @click="startNewSession">
          <div class="session-icon new">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </div>
          <div class="session-content">
            <p class="session-prompt">New Session</p>
            <p class="session-meta">Start a fresh conversation</p>
          </div>
          <div class="session-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </li>

        <!-- Existing sessions -->
        <li
          v-for="session in sessions"
          :key="session.sessionId"
          class="session-item"
        >
          <router-link
            :to="{
              name: 'chat',
              params: {
                project: projectSlug,
                session: session.sessionId,
              },
            }"
            class="session-link"
          >
            <div class="session-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="session-content">
            <!-- Editing title -->
            <form
              v-if="editingSessionId === session.sessionId"
              class="title-edit-form"
              @submit.prevent="saveTitle"
              @click.stop
            >
              <input
                ref="titleInputRef"
                type="text"
                v-model="editingTitle"
                class="title-input"
                placeholder="Session title..."
                @keydown.escape.prevent="cancelEditingTitle"
                @blur="saveTitle"
              />
            </form>
            <!-- Display title -->
            <div v-else class="session-title-row">
              <p class="session-prompt truncate">{{ getDisplayTitle(session) }}</p>
              <button
                class="edit-title-btn"
                @click="startEditingTitle(session, $event)"
                title="Rename session"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
            <p v-if="session.title" class="session-subtitle truncate">{{ session.firstPrompt }}</p>
            <p class="session-meta">
              <span>{{ formatTime(session.modified) }}</span>
              <span class="separator">·</span>
              <span>{{ session.messageCount }} messages</span>
            </p>
          </div>
            <div class="session-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </router-link>
          <button
            class="delete-session-btn"
            @click.stop="handleDeleteSession(session.sessionId, $event)"
            title="Delete session"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </li>
      </ul>

      <div class="empty" v-if="sessions.length === 0 && connected">
        <p>No sessions yet.</p>
        <p class="empty-hint">Click "New Session" above to begin.</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.sessions-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow-y: auto;
}

.main {
  padding: 0 16px;
}

.sessions {
  list-style: none;
}

.session-item {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 -12px;
  border-radius: var(--radius-md);
  transition: background 0.15s;
}

.session-item:hover {
  background: var(--bg-hover);
}

.session-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  flex: 1;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.session-item.new-session {
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
  cursor: pointer;
  padding: 12px;
}

.session-item.new-session {
  gap: 12px;
}

.session-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}

.session-icon.new {
  background: var(--bg-tertiary);
  border: 1px dashed var(--text-muted);
  color: var(--text-secondary);
}

.session-content {
  flex: 1;
  min-width: 0;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.session-prompt {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.edit-title-btn {
  opacity: 0;
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.session-item:hover .edit-title-btn {
  opacity: 1;
}

.edit-title-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.title-edit-form {
  margin-bottom: 4px;
}

.title-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 14px;
  font-weight: 500;
  background: var(--bg-primary);
  border: 1px solid var(--text-muted);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.title-input:focus {
  outline: none;
  border-color: var(--text-secondary);
}

.session-subtitle {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.session-meta {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.separator {
  margin: 0 6px;
  flex-shrink: 0;
}

.delete-session-btn {
  opacity: 0;
  margin: 0 8px;
  padding: 8px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: var(--bg-primary);
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.session-item:hover .delete-session-btn {
  opacity: 1;
}

.delete-session-btn:hover {
  background: #ef4444;
  color: white;
}

.session-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
}

.empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-secondary);
}

.empty-hint {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
