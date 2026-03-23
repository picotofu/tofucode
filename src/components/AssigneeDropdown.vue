<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  assignees: { type: Array, default: () => [] },
  // Static options prepended before the assignee list (e.g. Me / Anyone)
  headOptions: { type: Array, default: () => [] },
  popoverUp: { type: Boolean, default: false },
  // 'sm' = compact (12px), 'md' = default (13px)
  size: { type: String, default: 'md' },
  placeholder: { type: String, default: 'Search…' },
});

const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const search = ref('');
const inputRef = ref(null);
const dropRef = ref(null);

const filteredOptions = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = [
    ...props.headOptions,
    ...props.assignees.map((u) => ({ value: u.id, label: u.name })),
  ];
  if (!q) return all;
  return all.filter((o) => o.label.toLowerCase().includes(q));
});

const displayLabel = computed(() => {
  const head = props.headOptions.find((o) => o.value === props.modelValue);
  if (head) return head.label;
  return (
    props.assignees.find((u) => u.id === props.modelValue)?.name ||
    props.modelValue ||
    '—'
  );
});

function openDropdown() {
  search.value = '';
  open.value = true;
  nextTick(() => inputRef.value?.focus());
}

function toggle() {
  if (open.value) {
    open.value = false;
  } else {
    openDropdown();
  }
}

function select(value) {
  emit('update:modelValue', value);
  open.value = false;
  search.value = '';
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    open.value = false;
    search.value = '';
  }
}

function onDocClick(e) {
  if (open.value && dropRef.value && !dropRef.value.contains(e.target)) {
    open.value = false;
    search.value = '';
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="dropRef" class="ad-wrap" :class="`ad-size-${size}`">
    <button
      class="ad-trigger"
      type="button"
      @click="toggle"
    >
      <span class="ad-trigger-label">{{ displayLabel }}</span>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div v-if="open" class="ad-popover" :class="{ 'ad-popover-up': popoverUp }">
      <input
        ref="inputRef"
        v-model="search"
        class="ad-search"
        :placeholder="placeholder"
        @keydown="onKeydown"
      />
      <div class="ad-list">
        <button
          v-for="opt in filteredOptions"
          :key="opt.value"
          class="ad-option"
          :class="{ active: modelValue === opt.value }"
          type="button"
          @mousedown.prevent="select(opt.value)"
        >{{ opt.label }}</button>
        <div v-if="filteredOptions.length === 0" class="ad-empty">No match</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ad-wrap {
  position: relative;
  min-width: 0;
}

.ad-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  padding: 4px 6px;
  font-family: inherit;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s;
}

.ad-size-md .ad-trigger {
  font-size: 13px;
}

.ad-size-sm .ad-trigger {
  font-size: 12px;
  padding: 3px 6px;
}

.ad-trigger:focus,
.ad-trigger:hover {
  outline: none;
  border-color: var(--text-muted);
}

/* Bare variant — no border/bg (used inside create box) */
.ad-wrap.ad-bare .ad-trigger {
  background: transparent;
  border-color: transparent;
}

.ad-wrap.ad-bare .ad-trigger:focus,
.ad-wrap.ad-bare .ad-trigger:hover {
  background: var(--bg-tertiary);
  border-color: transparent;
}

.ad-trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ad-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 140px;
}

.ad-popover-up {
  top: auto;
  bottom: calc(100% + 4px);
}

.ad-search {
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  outline: none;
}

.ad-search::placeholder {
  color: var(--text-muted);
}

.ad-list {
  max-height: 160px;
  overflow-y: auto;
}

.ad-option {
  display: block;
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.ad-option:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.ad-option.active {
  color: var(--text-primary);
  font-weight: 500;
}

.ad-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
