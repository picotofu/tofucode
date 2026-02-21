<script setup>
import { onUnmounted, ref, watch } from 'vue';
import McpServerForm from './McpServerForm.vue';
import McpServerList from './McpServerList.vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  servers: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'fetch', 'add', 'update', 'remove', 'test']);

// ---------------------------------------------------------------------------
// View state: 'list' | 'add' | 'edit'
// ---------------------------------------------------------------------------
const view = ref('list');
const editingServer = ref(null);

// Test state
const testingServer = ref(null); // server name currently being tested from list
const listTestResult = ref(null); // { serverName, success, statusCode?, error? }
let listTestResultTimer = null;

// Form-level test state (for the form's inline test button)
const formTesting = ref(false);
const formTestResult = ref(null);
let formTestResultTimer = null;

// Save-in-progress state
const formSaving = ref(false);

// ---------------------------------------------------------------------------
// Keyboard handler
// ---------------------------------------------------------------------------
function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (view.value !== 'list') {
      view.value = 'list';
      editingServer.value = null;
    } else {
      emit('close');
    }
  }
}

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      document.addEventListener('keydown', handleKeydown);
      view.value = 'list';
      editingServer.value = null;
      listTestResult.value = null;
      formTestResult.value = null;
      clearTimeout(listTestResultTimer);
      clearTimeout(formTestResultTimer);
      emit('fetch');
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  },
);

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  clearTimeout(listTestResultTimer);
  clearTimeout(formTestResultTimer);
});

// ---------------------------------------------------------------------------
// List actions
// ---------------------------------------------------------------------------
function onAdd() {
  editingServer.value = null;
  formTestResult.value = null;
  view.value = 'add';
}

function onEdit(server) {
  editingServer.value = server;
  formTestResult.value = null;
  view.value = 'edit';
}

function onRemove(server) {
  const confirmed = confirm(
    `Remove "${server.name}" from ${server.scope} scope?`,
  );
  if (!confirmed) return;
  emit('remove', { name: server.name, scope: server.scope });
}

function onTestFromList(server) {
  testingServer.value = server.name;
  listTestResult.value = null;
  emit('test', {
    serverName: server.name,
    url: server.url,
    headers: server.headers ?? {},
  });
}

// ---------------------------------------------------------------------------
// Form actions
// ---------------------------------------------------------------------------
function onFormSave(payload) {
  formSaving.value = true;
  if (view.value === 'edit') {
    emit('update', payload);
  } else {
    emit('add', payload);
  }
}

function onFormTest(payload) {
  formTesting.value = true;
  formTestResult.value = null;
  emit('test', { ...payload, _formLevel: true });
}

function onFormCancel() {
  view.value = 'list';
  editingServer.value = null;
  formTestResult.value = null;
}

// ---------------------------------------------------------------------------
// Handle test results from parent (App.vue forwards mcp:test_result here)
// ---------------------------------------------------------------------------
function handleTestResult(result) {
  if (result._formLevel) {
    formTesting.value = false;
    formTestResult.value = result;
    // Auto-clear form test result after 8 seconds
    clearTimeout(formTestResultTimer);
    formTestResultTimer = setTimeout(() => {
      formTestResult.value = null;
    }, 8000);
  } else {
    testingServer.value = null;
    listTestResult.value = result;
    // Auto-clear list test result after 8 seconds
    clearTimeout(listTestResultTimer);
    listTestResultTimer = setTimeout(() => {
      listTestResult.value = null;
    }, 8000);
  }
}

// Inline error banner state (for failed add/update/remove)
const mutationError = ref(null);
let mutationErrorTimer = null;

// Handle add/update success — return to list
function handleMutationSuccess() {
  formSaving.value = false;
  view.value = 'list';
  editingServer.value = null;
  formTestResult.value = null;
  mutationError.value = null;
}

// Handle add/update/remove failure — show inline error
function handleMutationError(error) {
  formSaving.value = false;
  mutationError.value = error;
  clearTimeout(mutationErrorTimer);
  mutationErrorTimer = setTimeout(() => {
    mutationError.value = null;
  }, 6000);
}

// Expose so App.vue can call these
defineExpose({ handleTestResult, handleMutationSuccess, handleMutationError });
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="emit('close')">
    <div class="modal-content" @click.stop>
      <!-- Header -->
      <div class="modal-header">
        <div class="header-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
            <path d="M7 7h.01"/>
          </svg>
          <div class="header-title-group">
            <h2>MCP Servers</h2>
            <p class="header-desc">HTTP/SSE servers are fully managed here. stdio servers require manual installation — only config is managed.</p>
          </div>
        </div>
        <button class="close-btn" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Mutation error banner -->
      <div v-if="mutationError" class="mutation-error">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {{ mutationError }}
      </div>

      <!-- Body -->
      <div class="modal-body">
        <!-- List view -->
        <McpServerList
          v-if="view === 'list'"
          :servers="servers"
          :loading="loading"
          :testing-server="testingServer"
          :test-result="listTestResult"
          @add="onAdd"
          @edit="onEdit"
          @remove="onRemove"
          @test="onTestFromList"
        />

        <!-- Add / Edit form -->
        <McpServerForm
          v-else
          :server="view === 'edit' ? editingServer : null"
          :testing="formTesting"
          :test-result="formTestResult"
          :saving="formSaving"
          @save="onFormSave"
          @cancel="onFormCancel"
          @test="onFormTest"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  width: 90%;
  max-width: 620px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--text-secondary);
}

.header-left svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.header-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.header-title-group h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-desc {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mutation-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 12px;
  color: var(--error-color);
  background: rgba(239, 68, 68, 0.08);
  border-bottom: 1px solid rgba(239, 68, 68, 0.2);
  flex-shrink: 0;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
</style>
