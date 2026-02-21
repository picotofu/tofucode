<script setup>
import { computed, reactive, watch } from 'vue';

const props = defineProps({
  /** null = add mode, populated object = edit mode */
  server: {
    type: Object,
    default: null,
  },
  /** Whether a test is in progress */
  testing: {
    type: Boolean,
    default: false,
  },
  /** Result of the last test { success, statusCode?, error? } */
  testResult: {
    type: Object,
    default: null,
  },
  /** Whether a save operation is in progress */
  saving: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['save', 'cancel', 'test']);

const isEditMode = computed(() => props.server !== null);

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

const form = reactive({
  name: '',
  type: 'http',
  scope: 'local',
  // HTTP / SSE
  url: '',
  headers: [], // [{ key, value }]
  // Stdio
  command: '',
  args: '', // space-separated string
  env: [], // [{ key, value }]
});

const errors = reactive({
  name: '',
  url: '',
  command: '',
  headers: '',
  env: '',
});

// Populate form when editing
watch(
  () => props.server,
  (server) => {
    if (!server) return;
    form.name = server.name ?? '';
    form.type = server.type ?? 'http';
    form.scope = server.scope ?? 'local';
    form.url = server.url ?? '';
    form.command = server.command ?? '';
    form.args = (server.args ?? []).join(' ');
    // Headers: exclude Authorization (redacted as ***)
    form.headers = Object.entries(server.headers ?? {})
      .filter(([k]) => k.toLowerCase() !== 'authorization')
      .map(([key, value]) => ({ key, value }));
    form.env = Object.entries(server.env ?? {}).map(([key, value]) => ({
      key,
      value,
    }));
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Headers / env pair helpers
// ---------------------------------------------------------------------------

function addHeader() {
  form.headers.push({ key: '', value: '' });
}

function removeHeader(idx) {
  form.headers.splice(idx, 1);
}

function addEnvVar() {
  form.env.push({ key: '', value: '' });
}

function removeEnvVar(idx) {
  form.env.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SHELL_INJECTION_RE = /[;&|`$\n><]/;
const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validate() {
  let valid = true;

  errors.name = '';
  errors.url = '';
  errors.command = '';
  errors.headers = '';
  errors.env = '';

  if (!isEditMode.value) {
    if (!form.name.trim()) {
      errors.name = 'Name is required';
      valid = false;
    } else if (!VALID_NAME_RE.test(form.name.trim())) {
      errors.name = 'Alphanumeric, hyphens, underscores only (max 64 chars)';
      valid = false;
    }
  }

  if (form.type === 'http' || form.type === 'sse') {
    if (!form.url.trim()) {
      errors.url = 'URL is required';
      valid = false;
    } else {
      try {
        const parsed = new URL(form.url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.url = 'URL must use http or https';
          valid = false;
        }
      } catch {
        errors.url = 'Invalid URL';
        valid = false;
      }
    }
    // Check headers: value is required when a key is provided
    for (const h of form.headers) {
      if (h.key.trim() && !h.value.trim()) {
        errors.headers = `Header "${h.key}" has no value`;
        valid = false;
        break;
      }
    }
  } else {
    if (!form.command.trim()) {
      errors.command = 'Command is required';
      valid = false;
    } else if (SHELL_INJECTION_RE.test(form.command)) {
      errors.command = 'Command contains invalid shell characters';
      valid = false;
    }
    // Check env keys
    for (const e of form.env) {
      if (e.key && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(e.key)) {
        errors.env = `Invalid env var name: ${e.key}`;
        valid = false;
        break;
      }
    }
  }

  return valid;
}

// ---------------------------------------------------------------------------
// Build config payload
// ---------------------------------------------------------------------------

function buildConfig() {
  if (form.type === 'http' || form.type === 'sse') {
    const headers = {};
    for (const h of form.headers) {
      if (h.key.trim()) headers[h.key.trim()] = h.value;
    }
    const config = { type: form.type, url: form.url.trim() };
    if (Object.keys(headers).length > 0) config.headers = headers;
    return config;
  }
  // stdio
  const args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
  const env = {};
  for (const e of form.env) {
    if (e.key.trim()) env[e.key.trim()] = e.value;
  }
  const config = { type: 'stdio', command: form.command.trim() };
  if (args.length > 0) config.args = args;
  if (Object.keys(env).length > 0) config.env = env;
  return config;
}

function handleSave() {
  if (!validate()) return;
  emit('save', {
    name: isEditMode.value ? props.server.name : form.name.trim(),
    config: buildConfig(),
    scope: form.scope,
  });
}

function handleTest() {
  if (!form.url.trim()) return;
  const headers = {};
  for (const h of form.headers) {
    if (h.key.trim()) headers[h.key.trim()] = h.value;
  }
  emit('test', { url: form.url.trim(), headers });
}
</script>

<template>
  <div class="mcp-form">
    <div class="form-header">
      <button class="back-btn" @click="emit('cancel')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>
      <h3 class="form-title">{{ isEditMode ? `Edit "${server.name}"` : 'Add MCP Server' }}</h3>
    </div>

    <div class="form-body">
      <!-- Name (add mode only) -->
      <div v-if="!isEditMode" class="field">
        <label class="field-label">Server Name</label>
        <input
          v-model="form.name"
          class="field-input"
          :class="{ error: errors.name }"
          placeholder="e.g. my-db, playwright"
          autocomplete="off"
          spellcheck="false"
        />
        <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
      </div>

      <!-- Type selector -->
      <div class="field">
        <label class="field-label">Type</label>
        <div class="radio-group">
          <label class="radio-option" :class="{ active: form.type === 'http' }">
            <input type="radio" v-model="form.type" value="http" />
            <span class="radio-label">HTTP</span>
            <span class="radio-desc">Remote server via HTTP</span>
          </label>
          <label class="radio-option" :class="{ active: form.type === 'sse' }">
            <input type="radio" v-model="form.type" value="sse" />
            <span class="radio-label">SSE</span>
            <span class="radio-desc">Server-Sent Events</span>
          </label>
          <label class="radio-option" :class="{ active: form.type === 'stdio' }">
            <input type="radio" v-model="form.type" value="stdio" />
            <span class="radio-label">stdio</span>
            <span class="radio-desc">Local process</span>
          </label>
        </div>
      </div>

      <!-- Scope selector (read-only in edit mode — scope is fixed per server) -->
      <div class="field">
        <label class="field-label">
          Scope
          <span v-if="isEditMode" class="field-optional"> (fixed)</span>
        </label>
        <div class="radio-group" :class="{ disabled: isEditMode }">
          <label class="radio-option" :class="{ active: form.scope === 'local', locked: isEditMode && form.scope !== 'local' }">
            <input type="radio" v-model="form.scope" value="local" :disabled="isEditMode" />
            <span class="radio-label">Local</span>
            <span class="radio-desc">.mcp.json in project</span>
          </label>
          <label class="radio-option" :class="{ active: form.scope === 'project', locked: isEditMode && form.scope !== 'project' }">
            <input type="radio" v-model="form.scope" value="project" :disabled="isEditMode" />
            <span class="radio-label">Project</span>
            <span class="radio-desc">~/.claude.json (this project)</span>
          </label>
          <label class="radio-option" :class="{ active: form.scope === 'user', locked: isEditMode && form.scope !== 'user' }">
            <input type="radio" v-model="form.scope" value="user" :disabled="isEditMode" />
            <span class="radio-label">User</span>
            <span class="radio-desc">~/.claude.json (all projects)</span>
          </label>
        </div>
      </div>

      <!-- HTTP / SSE fields -->
      <template v-if="form.type === 'http' || form.type === 'sse'">
        <div class="field">
          <label class="field-label">URL</label>
          <input
            v-model="form.url"
            class="field-input mono"
            :class="{ error: errors.url }"
            placeholder="https://example.com/mcp"
            autocomplete="off"
            spellcheck="false"
          />
          <span v-if="errors.url" class="field-error">{{ errors.url }}</span>
        </div>

        <!-- Headers -->
        <div class="field">
          <div class="field-label-row">
            <label class="field-label">Headers <span class="field-optional">(optional)</span></label>
            <button class="add-pair-btn" @click="addHeader">+ Add</button>
          </div>
          <div v-if="form.headers.length > 0" class="pairs-list">
            <div v-for="(h, idx) in form.headers" :key="idx" class="pair-row">
              <input v-model="h.key" class="pair-input mono" placeholder="Key" spellcheck="false" />
              <input v-model="h.value" class="pair-input mono" placeholder="Value" spellcheck="false" />
              <button class="remove-pair-btn" @click="removeHeader(idx)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          <span v-if="errors.headers" class="field-error">{{ errors.headers }}</span>
        </div>

        <!-- Test connection -->
        <div class="field">
          <div class="test-row">
            <button
              class="test-btn"
              :disabled="!form.url.trim() || testing"
              @click="handleTest"
            >
              <svg v-if="!testing" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" class="spin">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
              </svg>
              {{ testing ? 'Testing…' : 'Test Connection' }}
            </button>
            <span v-if="testResult" class="test-result" :class="testResult.success ? 'ok' : 'fail'">
              <svg v-if="testResult.success" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              {{ testResult.success ? `${testResult.statusCode} OK` : (testResult.statusCode ? `${testResult.statusCode}${testResult.statusText ? ' ' + testResult.statusText : ''}` : testResult.error) }}
            </span>
          </div>
        </div>
      </template>

      <!-- Stdio fields -->
      <template v-else>
        <div class="field">
          <label class="field-label">Command</label>
          <input
            v-model="form.command"
            class="field-input mono"
            :class="{ error: errors.command }"
            placeholder="npx"
            autocomplete="off"
            spellcheck="false"
          />
          <span v-if="errors.command" class="field-error">{{ errors.command }}</span>
        </div>

        <div class="field">
          <label class="field-label">Args <span class="field-optional">(space-separated)</span></label>
          <input
            v-model="form.args"
            class="field-input mono"
            placeholder="@playwright/mcp@latest"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <!-- Env vars -->
        <div class="field">
          <div class="field-label-row">
            <label class="field-label">Environment Variables <span class="field-optional">(optional)</span></label>
            <button class="add-pair-btn" @click="addEnvVar">+ Add</button>
          </div>
          <div v-if="form.env.length > 0" class="pairs-list">
            <div v-for="(e, idx) in form.env" :key="idx" class="pair-row">
              <input v-model="e.key" class="pair-input mono" placeholder="KEY" spellcheck="false" />
              <input v-model="e.value" class="pair-input mono" placeholder="value" spellcheck="false" />
              <button class="remove-pair-btn" @click="removeEnvVar(idx)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          <span v-if="errors.env" class="field-error">{{ errors.env }}</span>
        </div>

        <p class="stdio-note">
          The command must already be installed on the server. tofucode does not manage binary installation.
        </p>
      </template>
    </div>

    <!-- Form actions -->
    <div class="form-footer">
      <button class="btn-cancel" @click="emit('cancel')">Cancel</button>
      <button class="btn-save" :disabled="saving" @click="handleSave">
        <svg v-if="saving" width="12" height="12" viewBox="0 0 24 24" class="spin">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
        </svg>
        {{ saving ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Add Server') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.mcp-form {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.form-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.back-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.form-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.form-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-optional {
  font-weight: 400;
  color: var(--text-muted);
}

.field-input {
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s;
}

.field-input.mono {
  font-family: var(--font-mono);
}

.field-input:focus {
  border-color: var(--text-muted);
}

.field-input.error {
  border-color: rgba(239,68,68,0.5);
}

.field-error {
  font-size: 11px;
  color: var(--error-color);
}

/* Radio groups */
.radio-group {
  display: flex;
  gap: 6px;
}

.radio-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.radio-option input[type="radio"] {
  display: none;
}

.radio-option.active {
  border-color: var(--text-muted);
  background: var(--bg-tertiary);
}

.radio-option:hover:not(.active):not(.locked) {
  border-color: var(--border-color);
  background: var(--bg-hover);
}

.radio-group.disabled {
  pointer-events: none;
}

.radio-option.locked {
  opacity: 0.35;
  cursor: default;
}

.radio-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.radio-desc {
  font-size: 10px;
  color: var(--text-muted);
}

/* Key-value pairs */
.pairs-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pair-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.pair-input {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  min-width: 0;
}

.pair-input:focus {
  border-color: var(--text-muted);
}

.add-pair-btn {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  transition: color 0.15s;
}

.add-pair-btn:hover {
  color: var(--text-primary);
}

.remove-pair-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.15s;
}

.remove-pair-btn:hover {
  color: var(--error-color);
  background: rgba(239,68,68,0.08);
}

/* Test connection row */
.test-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.test-btn:hover:not(:disabled) {
  color: var(--success-color);
  border-color: rgba(34,197,94,0.4);
  background: rgba(34,197,94,0.08);
}

.test-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
}

.test-result.ok { color: var(--success-color); }
.test-result.fail { color: var(--error-color); }

.stdio-note {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  margin: 0;
}

/* Form footer */
.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.btn-cancel {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.btn-save {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--bg-primary);
  background: var(--text-primary);
  border: 1px solid var(--text-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-save:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
