<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  send: { type: Function, required: true },
  onMessage: { type: Function, required: true },
  connected: { type: Boolean, required: true },
});

const ports = ref([]);
const loading = ref(false);
const error = ref(null);
const killing = ref(new Set());

let refreshInterval = null;

function refresh() {
  if (!props.connected) return;
  loading.value = true;
  error.value = null;
  props.send({ type: 'ports:list' });
}

function killPort(pid) {
  killing.value = new Set([...killing.value, pid]);
  props.send({ type: 'ports:kill', pid });
}

const cleanupMessage = props.onMessage((msg) => {
  if (msg.type === 'ports:list:result') {
    ports.value = msg.ports;
    loading.value = false;
  } else if (msg.type === 'ports:list:error') {
    error.value = msg.error;
    loading.value = false;
  } else if (msg.type === 'ports:kill:result') {
    const next = new Set(killing.value);
    next.delete(msg.pid);
    killing.value = next;
    refresh();
  } else if (msg.type === 'ports:kill:error') {
    const next = new Set(killing.value);
    next.delete(msg.pid);
    killing.value = next;
    error.value = msg.error;
  }
});

onMounted(() => {
  // Watch connected — fire initial load as soon as WS is open (handles async connect)
  const stopWatch = watch(
    () => props.connected,
    (isConnected) => {
      if (isConnected) {
        refresh();
        refreshInterval = setInterval(refresh, 5000);
        stopWatch();
      }
    },
    { immediate: true },
  );
});

onUnmounted(() => {
  clearInterval(refreshInterval);
  cleanupMessage?.();
});
</script>

<template>
  <main class="ports-panel">
    <div class="ports-header">
      <span class="ports-title">Listening Ports</span>
      <button
        class="refresh-btn"
        :class="{ spinning: loading }"
        :disabled="loading"
        title="Refresh"
        @click="refresh"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>

    <div v-if="error" class="ports-notice ports-error">{{ error }}</div>

    <div v-else-if="!ports.length && !loading" class="ports-notice">
      No listening ports found.
    </div>

    <div v-else-if="ports.length" class="ports-table">
      <div class="ports-row header">
        <span>Port</span>
        <span>PID</span>
        <span>Process</span>
        <span>Addresses</span>
        <span />
      </div>
      <div
        v-for="entry in ports"
        :key="`${entry.pid ?? entry.addresses[0]}-${entry.port}`"
        class="ports-row"
      >
        <span class="port-num desktop-only">{{ entry.port }}</span>
        <span class="port-pid desktop-only">{{ entry.pid ?? '—' }}</span>
        <span class="port-process">
          <span class="port-meta mobile-only">
            <span class="port-meta-port">:{{ entry.port }}</span>
            <span v-if="entry.pid" class="port-meta-pid"> · pid {{ entry.pid }}</span>
          </span>
          <span class="port-cmd">{{ entry.cmd ?? entry.process }}</span>
          <span v-if="entry.cwd" class="port-cwd">{{ entry.cwd }}</span>
          <span class="port-address-inline mobile-only">{{ entry.addresses.join(', ') }}</span>
        </span>
        <span class="port-address desktop-only">{{ entry.addresses.join(', ') }}</span>
        <button
          class="kill-btn"
          :class="{ killing: killing.has(entry.pid) }"
          :disabled="entry.pid === null || killing.has(entry.pid)"
          :title="entry.pid === null ? 'PID unknown' : 'Kill process'"
          @click="killPort(entry.pid)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.ports-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  gap: 12px;
}

.ports-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ports-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.refresh-btn {
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  padding: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.refresh-btn.spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ports-notice {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 0;
}

.ports-error {
  color: var(--error-color);
}

/* Table */
.ports-table {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 12px;
}

.ports-row {
  display: grid;
  grid-template-columns: 60px 70px 1fr 130px 32px;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  align-items: start;
}

.ports-row.header {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding-bottom: 4px;
  align-items: center;
}

.ports-row:not(.header) {
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: background 0.1s;
}

.ports-row:not(.header):hover {
  background: var(--bg-hover);
}

.port-num,
.port-pid,
.port-address {
  padding-top: 1px;
}

.port-num,
.port-pid {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.port-process {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.port-cmd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
}

.port-cwd {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.4;
}

.port-address {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  align-self: start;
}

/* Kill button */
.kill-btn {
  align-self: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  padding: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}

.kill-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  color: var(--error-color);
}

.kill-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.kill-btn.killing svg {
  animation: spin 0.8s linear infinite;
}

/* ── Responsive ─────────────────────────────────── */
.mobile-only { display: none; }

@media (max-width: 640px) {
  .desktop-only { display: none; }
  .mobile-only { display: block; }

  .ports-row.header { display: none; }

  .ports-row:not(.header) {
    grid-template-columns: 1fr 32px;
  }

  .port-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
    margin-bottom: 1px;
  }

  .port-meta-port {
    font-weight: 600;
    color: var(--text-primary);
  }

  .port-address-inline {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    word-break: break-all;
    margin-top: 1px;
  }
}
</style>
