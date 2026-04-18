<script setup>
import { computed, onMounted, ref } from 'vue';
import AppHeader from '../components/AppHeader.vue';
import { useWebSocket } from '../composables/useWebSocket';
import { formatRelativeTime } from '../utils/format.js';

const {
  projects,
  recentSessions,
  sessionsReady,
  rootPath,
  connect,
  getProjects,
  getRecentSessionsImmediate,
} = useWebSocket();

// ─── Quick access ─────────────────────────────────────────────────────────────

const quickSessions = computed(() => recentSessions.value.slice(0, 5));

const quickProjects = computed(() => projects.value.slice(0, 5));

// ─── Loading state ────────────────────────────────────────────────────────────

// True until the WS connects and initial data requests are sent
const dataReady = ref(false);

// ─── Mount ────────────────────────────────────────────────────────────────────

onMounted(() => {
  connect(() => {
    getProjects();
    getRecentSessionsImmediate();
    dataReady.value = true;
  });
});

// ─── Session handlers ─────────────────────────────────────────────────────────

const formatTime = formatRelativeTime;
</script>

<template>
  <div class="projects-view">
    <AppHeader />

    <main class="main">
      <!-- Restricted Mode Indicator -->
      <div v-if="rootPath" class="restricted-mode-banner">
        <div class="banner-content">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div class="banner-text">
            <span class="banner-title">Restricted Mode</span>
            <span class="banner-path">{{ rootPath }}</span>
          </div>
        </div>
        <span class="banner-note">Best effort isolation • Use Docker for full security</span>
      </div>

      <!-- Loading -->
      <div v-if="!dataReady" class="tab-loading">
        <svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <p>Connecting...</p>
      </div>

      <template v-else>
        <!-- Recent Sessions skeleton while data loads -->
        <section v-if="!sessionsReady" class="quick-access">
          <h2 class="section-title">Recent Sessions</h2>
          <div class="quick-cards">
            <div v-for="i in 4" :key="i" class="quick-card quick-card-skeleton">
              <div class="skeleton-card-icon"></div>
              <div class="skeleton-card-title"></div>
              <div class="skeleton-card-meta"></div>
            </div>
          </div>
          <!-- Mobile list view skeleton -->
          <ul class="quick-list">
            <li v-for="i in 4" :key="i" class="quick-list-skeleton">
              <div class="skeleton-list-icon"></div>
              <div class="skeleton-list-text">
                <div class="skeleton-list-title"></div>
                <div class="skeleton-list-meta"></div>
              </div>
            </li>
          </ul>
        </section>

        <!-- Recent Sessions -->
        <section v-else-if="quickSessions.length > 0" class="quick-access">
          <h2 class="section-title">Recent Sessions</h2>
          <div class="quick-cards">
            <router-link
              v-for="session in quickSessions"
              :key="session.sessionId"
              :to="{
                name: 'chat',
                params: {
                  project: session.projectSlug,
                  session: session.sessionId,
                },
              }"
              class="quick-card"
            >
              <div class="quick-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p class="quick-card-title truncate">{{ session.title || session.firstPrompt }}</p>
              <p class="quick-card-meta truncate">{{ session.projectName }}</p>
            </router-link>
          </div>
          <!-- Mobile list view -->
          <ul class="quick-list">
            <li v-for="session in quickSessions" :key="session.sessionId">
              <router-link
                :to="{
                  name: 'chat',
                  params: {
                    project: session.projectSlug,
                    session: session.sessionId,
                  },
                }"
                class="quick-list-item"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="list-icon">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="list-title truncate">{{ session.title || session.firstPrompt }}</span>
                <span class="list-meta truncate">{{ session.projectName }}</span>
              </router-link>
            </li>
          </ul>
        </section>

        <!-- Recent Projects -->
        <section v-if="quickProjects.length > 0" class="quick-access">
          <h2 class="section-title">Recent Projects</h2>
          <div class="quick-cards">
            <router-link
              v-for="project in quickProjects"
              :key="project.slug"
              :to="{ name: 'sessions', params: { project: project.slug } }"
              class="quick-card"
            >
              <div class="quick-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p class="quick-card-title truncate">{{ project.name }}</p>
              <p class="quick-card-meta truncate">{{ project.sessionCount }} sessions · {{ formatTime(project.lastModified) }}</p>
            </router-link>
          </div>
          <!-- Mobile list view -->
          <ul class="quick-list">
            <li v-for="project in quickProjects" :key="project.slug">
              <router-link
                :to="{ name: 'sessions', params: { project: project.slug } }"
                class="quick-list-item"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="list-icon">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="list-title truncate">{{ project.name }}</span>
                <span class="list-meta truncate">{{ project.sessionCount }} sessions · {{ formatTime(project.lastModified) }}</span>
              </router-link>
            </li>
          </ul>
        </section>

        <div v-if="sessionsReady && quickSessions.length === 0 && quickProjects.length === 0" class="empty-sessions">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>No sessions yet</p>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.projects-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.main {
  flex: 1;
  padding: 16px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  overflow-y: auto;
}

/* ─── Restricted Mode Banner ─────────────────────────────────────────────────── */
.restricted-mode-banner {
  background: linear-gradient(135deg, rgba(255, 193, 7, 0.1), rgba(255, 152, 0, 0.1));
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.banner-content svg {
  color: #ffc107;
  flex-shrink: 0;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.banner-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.banner-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-note {
  font-size: 11px;
  color: var(--text-muted);
  padding-left: 28px;
}

/* ─── Section title ──────────────────────────────────────────────────────────── */
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

/* ─── Quick Access Cards ─────────────────────────────────────────────────────── */
.quick-access {
  margin-bottom: 32px;
}

.quick-cards {
  display: flex;
  gap: 12px;
}

.quick-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  color: inherit;
  text-decoration: none;
}

.quick-card:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
  transform: translateY(-2px);
}

.quick-card-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.quick-card-title {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  width: 100%;
  margin-bottom: 4px;
}

.quick-card-meta {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  text-align: center;
  width: 100%;
}

.empty-sessions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
}

/* ─── Skeleton loading ────────────────────────────────────────────────────────── */
@keyframes shimmer {
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
}

.quick-card-skeleton {
  pointer-events: none;
}

.skeleton-card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  margin-bottom: 10px;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-card-title {
  height: 12px;
  width: 80%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  margin-bottom: 6px;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-card-meta {
  height: 10px;
  width: 55%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
  animation-delay: 0.2s;
}

.quick-list-skeleton {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}

.skeleton-list-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-list-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.skeleton-list-title {
  height: 13px;
  width: 70%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-list-meta {
  height: 11px;
  width: 45%;
  border-radius: 4px;
  background: var(--bg-tertiary);
  animation: shimmer 1.4s ease-in-out infinite;
  animation-delay: 0.2s;
}

/* ─── Tab loading ────────────────────────────────────────────────────────────── */
.tab-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}

/* ─── Mobile list view ───────────────────────────────────────────────────────── */

/* Desktop: show cards, hide list */
.quick-list {
  display: none;
  list-style: none;
}

/* Mobile: hide cards, show list */
@media (max-width: 639px) {
  .quick-cards {
    display: none;
  }

  .quick-list {
    display: flex;
    flex-direction: column;
  }

  .tab-loading {
    padding: 40px 0;
  }
}

.quick-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s;
}

.quick-list-item:last-child {
  border-bottom: none;
}

.quick-list-item:hover {
  color: var(--text-primary);
}

.quick-list-item .list-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.quick-list-item .list-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
}

.quick-list-item .list-meta {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
  max-width: 30%;
}
</style>
