<script setup>
import { computed, ref } from 'vue';
import { formatRelativeTime, formatToolDisplay } from '../utils/format.js';
import { renderMarkdown } from '../utils/markdown.js';
import DiffViewer from './DiffViewer.vue';

const props = defineProps({
  message: Object,
});

const resultExpanded = ref(false);
const finalResultExpanded = ref(false);
const diffExpanded = ref(false);

// Format timestamp for display
const formattedTimestamp = computed(() => {
  return formatRelativeTime(props.message.timestamp);
});

// Full timestamp for tooltip
const fullTimestamp = computed(() => {
  const ts = props.message.timestamp;
  if (!ts) return null;
  return new Date(ts).toLocaleString();
});

const messageType = computed(() => props.message.type);

const displayContent = computed(() => {
  const msg = props.message;
  if (msg.type === 'user') return msg.content;
  if (msg.type === 'text') return msg.content;
  if (msg.type === 'error') return msg.message;
  if (msg.type === 'summary') return msg.content;
  return '';
});

// Render user messages as markdown (like Slack)
const renderedUserContent = computed(() => {
  if (props.message.type === 'user') {
    return renderMarkdown(props.message.content);
  }
  return '';
});

// Permission mode for user messages
const userPermissionMode = computed(() => {
  if (props.message.type !== 'user') return null;
  if (props.message.dangerouslySkipPermissions) return 'skip';
  return props.message.permissionMode || 'default';
});

// Model used for assistant messages (text and tool_use)
const assistantModel = computed(() => {
  if (props.message.type !== 'text' && props.message.type !== 'tool_use')
    return null;
  return props.message.model || 'sonnet'; // Default to sonnet if not specified
});

// Format model display name
const modelDisplayName = computed(() => {
  if (!assistantModel.value) return 'Sonnet'; // Always show default
  const modelMap = {
    sonnet: 'Sonnet',
    opus: 'Opus',
    haiku: 'Haiku',
  };
  return modelMap[assistantModel.value] || assistantModel.value;
});

const permissionIcon = computed(() => {
  const mode = userPermissionMode.value;
  // Return SVG path for each permission mode (matching toolbar icons)
  if (mode === 'plan') {
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`;
  }
  if (mode === 'bypassPermissions') {
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
    </svg>`;
  }
  if (mode === 'skip') {
    return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>`;
  }
  // default
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>`;
});

const renderedMarkdown = computed(() => {
  if (messageType.value === 'text') {
    return renderMarkdown(props.message.content);
  }
  return '';
});

const renderedResult = computed(() => {
  if (messageType.value === 'result' && props.message.result) {
    return renderMarkdown(props.message.result);
  }
  return '';
});

// Format tool display based on tool type
const toolDisplay = computed(() => {
  if (messageType.value !== 'tool_use') return null;
  return formatToolDisplay(props.message.tool, props.message.input);
});

// Check if this is an Edit tool use with diff info
const isEditTool = computed(() => {
  return (
    messageType.value === 'tool_use' &&
    props.message.tool === 'Edit' &&
    props.message.input?.old_string &&
    props.message.input?.new_string
  );
});

const toolResultContent = computed(() => {
  if (messageType.value !== 'tool_result') return '';
  const content = props.message.content;
  if (typeof content === 'string') {
    if (content.length > 500) {
      return `${content.substring(0, 500)}...`;
    }
    return content;
  }
  return JSON.stringify(content, null, 2);
});

function toggleResultExpand() {
  resultExpanded.value = !resultExpanded.value;
}

function toggleFinalResultExpand() {
  finalResultExpanded.value = !finalResultExpanded.value;
}

function toggleDiffExpand() {
  diffExpanded.value = !diffExpanded.value;
}
</script>

<template>
  <div class="message" :class="messageType">
    <!-- User message -->
    <div v-if="messageType === 'user'" class="user-message" :class="userPermissionMode ? 'permission-' + userPermissionMode : 'permission-default'">
      <div class="content markdown-body" v-html="renderedUserContent"></div>
      <div class="message-footer">
        <span class="timestamp" v-if="formattedTimestamp" :title="fullTimestamp">{{ formattedTimestamp }}</span>
        <span class="permission-icon" :title="'Permission mode: ' + (userPermissionMode || 'default')" v-html="permissionIcon"></span>
      </div>
    </div>

    <!-- Text message from Claude -->
    <div v-else-if="messageType === 'text'" class="text-message">
      <div class="content markdown-body" v-html="renderedMarkdown"></div>
      <div class="text-footer">
        <span class="timestamp text-timestamp" v-if="formattedTimestamp" :title="fullTimestamp">{{ formattedTimestamp }}</span>
        <span class="model-badge" :title="'Model: ' + modelDisplayName">{{ modelDisplayName }}</span>
      </div>
    </div>

    <!-- Tool use -->
    <div v-else-if="messageType === 'tool_use'" class="tool-message">
      <div class="tool-header">
        <span class="tool-icon">{{ toolDisplay.icon }}</span>
        <span class="tool-label">{{ message.tool }}</span>
        <span class="model-badge tool-model-badge" :title="'Model: ' + modelDisplayName">{{ modelDisplayName }}</span>
      </div>
      <div class="tool-content">
        <code v-if="toolDisplay.type === 'command'" class="tool-command">{{ toolDisplay.primary }}</code>
        <code v-else-if="toolDisplay.type === 'path'" class="tool-path">{{ toolDisplay.primary }}</code>
        <code v-else-if="toolDisplay.type === 'pattern'" class="tool-pattern">{{ toolDisplay.primary }}</code>
        <span v-else-if="toolDisplay.type === 'text'" class="tool-text">{{ toolDisplay.primary }}</span>
        <pre v-else-if="toolDisplay.type === 'json'" class="tool-json">{{ toolDisplay.secondary }}</pre>
        <small v-if="toolDisplay.secondary && toolDisplay.type !== 'json'" class="tool-description">{{ toolDisplay.secondary }}</small>
      </div>

      <!-- Show diff for Edit tool -->
      <div v-if="isEditTool" class="tool-diff-section">
        <div class="tool-diff-toggle" @click="toggleDiffExpand">
          <span class="diff-icon">{{ diffExpanded ? '▼' : '▶' }}</span>
          <span class="diff-label">{{ diffExpanded ? 'Hide diff' : 'Show diff' }}</span>
        </div>
        <DiffViewer
          v-if="diffExpanded"
          :old-content="message.input.old_string"
          :new-content="message.input.new_string"
          :filename="message.input.file_path"
        />
      </div>
    </div>

    <!-- Tool result -->
    <div v-else-if="messageType === 'tool_result'" class="tool-result-message">
      <div class="tool-result-header" @click="toggleResultExpand">
        <span class="tool-result-icon">✓</span>
        <span class="tool-result-label">Result</span>
        <span class="tool-toggle">{{ resultExpanded ? '▼' : '▶' }}</span>
      </div>
      <pre v-if="resultExpanded" class="tool-result-content">{{ toolResultContent }}</pre>
    </div>

    <!-- Result (final) -->
    <div v-else-if="messageType === 'result'" class="result-message">
      <div class="result-header" @click="toggleFinalResultExpand">
        <span class="result-icon">✓</span>
        <span class="result-label">{{ message.subtype }}</span>
        <span class="result-meta" v-if="message.cost">
          ${{ message.cost.toFixed(4) }} · {{ message.duration }}ms
        </span>
        <span class="result-toggle" v-if="message.result">{{ finalResultExpanded ? '▼' : '▶' }}</span>
      </div>
      <div class="result-content markdown-body" v-if="message.result && finalResultExpanded" v-html="renderedResult"></div>
    </div>

    <!-- Summary (context compaction separator) -->
    <div v-else-if="messageType === 'summary'" class="summary-message">
      <div class="summary-line"></div>
      <div class="summary-content">
        <span class="summary-icon">✂️</span>
        <span class="summary-text">Context compacted</span>
        <span class="summary-detail" v-if="message.content">{{ message.content }}</span>
      </div>
      <div class="summary-line"></div>
    </div>

    <!-- Error -->
    <div v-else-if="messageType === 'error'" class="error-message">
      <span class="error-icon">⚠</span>
      <span class="error-text">{{ displayContent }}</span>
    </div>
  </div>
</template>

<style scoped>
.message {
  max-width: 100%;
}

/* Timestamps */
.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.timestamp {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s;
}

.message:hover .timestamp,
.text-message:hover .timestamp {
  opacity: 1;
}

.text-timestamp {
  font-size: 11px;
  color: var(--text-muted);
}

/* User message */
.user-message {
  background: var(--bg-tertiary);
  padding: 12px 16px;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  margin-left: 20%;
  margin-right: 0;
  border-right: 3px solid var(--border-color);
}

/* Permission mode colors (border-right) */
.user-message.permission-default {
  border-right-color: var(--border-color); /* default gray */
}

.user-message.permission-plan {
  border-right-color: var(--success-color); /* green */
}

.user-message.permission-bypassPermissions {
  border-right-color: var(--warning-color); /* yellow */
}

.user-message.permission-skip {
  border-right-color: #f97316; /* orange */
}

.user-message .content {
  word-break: break-word;
}

.user-message .markdown-body {
  font-size: 14px;
}

.user-message .markdown-body :deep(p) {
  margin: 0 0 8px 0;
}

.user-message .markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.message-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.model-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.permission-icon {
  display: flex;
  align-items: center;
  color: var(--text-muted);
}

.permission-icon :deep(svg) {
  width: 12px;
  height: 12px;
}

/* Text message */
.text-message {
  padding: 4px 0;
}

.text-message .content {
  line-height: 1.7;
}

.text-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

/* Markdown styles */
.markdown-body :deep(p) {
  margin: 0 0 12px 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 20px 0 12px 0;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body :deep(h1) { font-size: 1.5em; }
.markdown-body :deep(h2) { font-size: 1.3em; }
.markdown-body :deep(h3) { font-size: 1.15em; }
.markdown-body :deep(h4) { font-size: 1em; }

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 12px 0;
  padding-left: 24px;
}

.markdown-body :deep(li) {
  margin: 4px 0;
}

.markdown-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
}

.markdown-body :deep(pre) {
  margin: 0;
  padding: 12px;
  background: var(--bg-secondary);
  border: none;
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
}

.markdown-body :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--border-color);
  color: var(--text-secondary);
}

.markdown-body :deep(a) {
  color: #60a5fa;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(hr) {
  margin: 20px 0;
  border: none;
  border-top: 1px solid var(--border-color);
}

.markdown-body :deep(table) {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--bg-tertiary);
  font-weight: 600;
}

.markdown-body :deep(strong) {
  font-weight: 600;
}

.markdown-body :deep(em) {
  font-style: italic;
}

/* Tool use */
.tool-message {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: 13px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.tool-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}

.tool-label {
  flex: 1;
  font-weight: 500;
  font-size: 12px;
  color: var(--text-secondary);
}

.tool-model-badge {
  margin-left: auto;
}

.tool-content {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-command {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
}

.tool-path {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}

.tool-pattern {
  font-family: var(--font-mono);
  font-size: 13px;
  color: #60a5fa;
  word-break: break-all;
}

.tool-text {
  color: var(--text-primary);
}

.tool-description {
  font-size: 12px;
  color: var(--text-muted);
  display: block;
}

.tool-json {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Tool diff section */
.tool-diff-section {
  border-top: 1px solid var(--border-color);
}

.tool-diff-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: var(--bg-tertiary);
  transition: background 0.15s;
}

.tool-diff-toggle:hover {
  background: var(--bg-hover);
}

.diff-icon {
  font-size: 10px;
  color: var(--text-secondary);
  width: 12px;
}

.diff-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* Tool result */
.tool-result-message {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: 13px;
  margin-left: 24px;
}

.tool-result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.tool-result-header:hover {
  background: var(--bg-hover);
}

.tool-result-icon {
  color: var(--success-color);
  font-size: 12px;
}

.tool-result-label {
  flex: 1;
  font-weight: 500;
  color: var(--text-secondary);
}

.tool-result-content {
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

/* Result */
.result-message {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: 13px;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}

.result-header:hover {
  background: rgba(34, 197, 94, 0.05);
}

.result-icon {
  color: var(--success-color);
  font-size: 12px;
}

.result-label {
  font-weight: 500;
  color: var(--success-color);
  text-transform: capitalize;
}

.result-meta {
  flex: 1;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11px;
  color: rgba(34, 197, 94, 0.8);
}

.result-toggle {
  color: var(--success-color);
  font-size: 10px;
  margin-left: 4px;
}

.result-content {
  padding: 12px;
  border-top: 1px solid rgba(34, 197, 94, 0.2);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}

/* Summary (context compaction separator) */
.summary-message {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}

.summary-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, transparent, var(--border-color), transparent);
}

.summary-content {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border-radius: 20px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.summary-icon {
  font-size: 12px;
}

.summary-text {
  font-weight: 500;
}

.summary-detail {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

/* Error */
.error-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-md);
  padding: 12px;
  color: var(--error-color);
}

.error-icon {
  flex-shrink: 0;
}

.error-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
