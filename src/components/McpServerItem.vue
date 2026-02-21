<script setup>
defineProps({
  server: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['edit', 'remove', 'test']);

function getTypeLabel(type) {
  if (type === 'http') return 'HTTP';
  if (type === 'sse') return 'SSE';
  return 'stdio';
}

function getScopeLabel(scope) {
  if (scope === 'local') return 'local';
  if (scope === 'project') return 'project';
  return 'user';
}

function getOAuthLabel(server) {
  if (!server.isOAuthManaged) return null;
  if (server.oauthExpired) return 'Expired';
  if (!server.oauthExpiresAt) return 'OAuth';
  const diff = server.oauthExpiresAt - Date.now();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${hours}h`;
}

function getConnectionInfo(server) {
  if (server.type === 'stdio') {
    const parts = [server.command, ...(server.args ?? [])];
    return parts.join(' ');
  }
  return server.url ?? '';
}
</script>

<template>
  <div class="mcp-item">
    <div class="mcp-item-main">
      <div class="mcp-item-name">
        <!-- OAuth lock icon -->
        <svg v-if="server.isOAuthManaged" class="oauth-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span class="name-text">{{ server.name }}</span>
      </div>

      <div class="mcp-item-badges">
        <span class="badge type-badge" :class="'type-' + server.type">{{ getTypeLabel(server.type) }}</span>
        <span class="badge scope-badge" :class="'scope-' + server.scope">{{ getScopeLabel(server.scope) }}</span>
        <!-- OAuth expiry badge -->
        <span v-if="server.isOAuthManaged" class="badge oauth-badge" :class="{ expired: server.oauthExpired }">
          {{ getOAuthLabel(server) }}
        </span>
        <!-- Override indicator -->
        <span v-if="server.definedInScopes.length > 1" class="badge override-badge" :title="`Defined in: ${server.definedInScopes.join(', ')}`">
          overriding
        </span>
      </div>
    </div>

    <div class="mcp-item-info">
      <code class="connection-info">{{ getConnectionInfo(server) }}</code>
    </div>

    <!-- OAuth read-only hint -->
    <div v-if="server.isOAuthManaged" class="oauth-hint">
      Managed via OAuth — reconfigure with <code>claude mcp add-oauth</code> in terminal
    </div>

    <div class="mcp-item-actions">
      <!-- Test button (HTTP/SSE only, not OAuth-managed since we don't have the token) -->
      <button
        v-if="(server.type === 'http' || server.type === 'sse') && !server.isOAuthManaged"
        class="action-btn test-btn"
        @click="emit('test', server)"
        title="Test connection"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        Test
      </button>

      <!-- Edit / Remove (hidden for OAuth-managed) -->
      <template v-if="!server.isOAuthManaged">
        <button class="action-btn edit-btn" @click="emit('edit', server)" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit
        </button>
        <button class="action-btn remove-btn" @click="emit('remove', server)" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
          Remove
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mcp-item {
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mcp-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-item-name {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.oauth-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.name-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mcp-item-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.type-badge.type-http  { background: rgba(59,130,246,0.15); color: #60a5fa; }
.type-badge.type-sse   { background: rgba(34,211,238,0.15); color: #22d3ee; }
.type-badge.type-stdio { background: rgba(245,158,11,0.15);  color: #fbbf24; }

.scope-badge.scope-local   { background: rgba(34,197,94,0.12);  color: #4ade80; }
.scope-badge.scope-project { background: rgba(167,139,250,0.15); color: #c4b5fd; }
.scope-badge.scope-user    { background: rgba(160,160,160,0.12); color: var(--text-secondary); }

.oauth-badge {
  background: rgba(34,197,94,0.12);
  color: #4ade80;
}
.oauth-badge.expired {
  background: rgba(239,68,68,0.12);
  color: var(--error-color);
}

.override-badge {
  background: rgba(245,158,11,0.12);
  color: #fbbf24;
}

.mcp-item-info {
  overflow: hidden;
}

.connection-info {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.oauth-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.oauth-hint code {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
}

.mcp-item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.remove-btn:hover {
  border-color: rgba(239,68,68,0.4);
  color: var(--error-color);
  background: rgba(239,68,68,0.08);
}

.test-btn:hover {
  border-color: rgba(34,197,94,0.4);
  color: var(--success-color);
  background: rgba(34,197,94,0.08);
}
</style>
