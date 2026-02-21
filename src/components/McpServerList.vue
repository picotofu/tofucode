<script setup>
import { computed } from 'vue';
import McpServerItem from './McpServerItem.vue';

const props = defineProps({
  servers: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  testingServer: {
    type: String,
    default: null,
  },
  testResult: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['add', 'edit', 'remove', 'test']);

const scopeOrder = ['local', 'project', 'user'];

const scopeLabels = {
  local: 'Local (.mcp.json)',
  project: 'Project (~/.claude.json)',
  user: 'User (~/.claude.json global)',
};

const grouped = computed(() => {
  const groups = {};
  for (const server of props.servers) {
    if (!groups[server.scope]) groups[server.scope] = [];
    groups[server.scope].push(server);
  }
  // Return in defined order, only scopes that have servers
  return scopeOrder
    .filter((s) => groups[s])
    .map((s) => ({ scope: s, servers: groups[s] }));
});
</script>

<template>
  <div class="mcp-list">
    <!-- Loading state -->
    <div v-if="loading" class="mcp-loading">
      <svg width="16" height="16" viewBox="0 0 24 24" class="spin">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
      </svg>
      Loading servers…
    </div>

    <!-- Empty state -->
    <div v-else-if="servers.length === 0" class="mcp-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
        <path d="M7 7h.01"/>
      </svg>
      <p class="empty-title">No MCP servers configured</p>
      <p class="empty-sub">Add an HTTP, SSE, or stdio server to extend Claude's capabilities</p>
    </div>

    <!-- Server groups by scope -->
    <template v-else>
      <div v-for="group in grouped" :key="group.scope" class="scope-group">
        <div class="scope-heading">{{ scopeLabels[group.scope] }}</div>
        <div class="scope-items">
          <div v-for="server in group.servers" :key="server.name">
            <McpServerItem
              :server="server"
              @edit="emit('edit', server)"
              @remove="emit('remove', server)"
              @test="emit('test', server)"
            />
            <!-- Inline test result for this server -->
            <div
              v-if="testingServer === server.name || (testResult && testResult.serverName === server.name)"
              class="test-result"
              :class="{
                testing: testingServer === server.name,
                success: testResult?.serverName === server.name && testResult?.success,
                failure: testResult?.serverName === server.name && !testResult?.success
              }"
            >
              <template v-if="testingServer === server.name">
                <svg width="12" height="12" viewBox="0 0 24 24" class="spin">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
                </svg>
                Testing…
              </template>
              <template v-else-if="testResult?.serverName === server.name">
                <svg v-if="testResult.success" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                {{ testResult.success ? `${testResult.statusCode} OK` : (testResult.statusCode ? `${testResult.statusCode}${testResult.statusText ? ' ' + testResult.statusText : ''}` : testResult.error) }}
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Add button (always shown at the bottom) -->
    <button v-if="!loading" class="add-btn" @click="emit('add')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add MCP Server
    </button>
  </div>
</template>

<style scoped>
.mcp-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mcp-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 16px 0;
}

.mcp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted);
}

.empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.empty-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  max-width: 280px;
  line-height: 1.5;
}

.scope-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scope-heading {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}

.scope-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 5px 10px;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  margin-top: -4px;
  border: 1px solid var(--border-color);
  border-top: none;
}

.test-result.testing {
  color: var(--text-muted);
  background: var(--bg-tertiary);
}

.test-result.success {
  color: var(--success-color);
  background: rgba(34,197,94,0.06);
  border-color: rgba(34,197,94,0.2);
}

.test-result.failure {
  color: var(--error-color);
  background: rgba(239,68,68,0.06);
  border-color: rgba(239,68,68,0.2);
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
  width: 100%;
  justify-content: center;
}

.add-btn:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
