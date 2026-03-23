<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  assignees: { type: Array, default: () => [] },
  // Head options prepended before the assignees list (e.g. Me, Anyone)
  headOptions: { type: Array, default: () => [] },
  // Pop upward instead of downward
  popoverUp: { type: Boolean, default: false },
  // 'sm' for compact footer variant
  size: { type: String, default: 'md' },
  // Bare variant: no border on trigger (for use inside bordered containers)
  bare: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const search = ref('');
const triggerRef = ref(null);
const popoverRef = ref(null);
const inputRef = ref(null);
const popoverStyle = ref({});

const filteredOptions = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = [
    ...props.headOptions,
    ...props.assignees.map((u) => ({ value: u.id, label: u.name })),
  ];
  return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
});

const displayLabel = computed(() => {
  const v = props.modelValue;
  const head = props.headOptions.find((o) => o.value === v);
  if (head) return head.label;
  return props.assignees.find((u) => u.id === v)?.name || v || '—';
});

function updatePosition() {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const goUp = props.popoverUp || window.innerHeight - rect.bottom < 220;
  if (goUp) {
    popoverStyle.value = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: 9999,
    };
  } else {
    popoverStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: 9999,
    };
  }
}

function openDropdown() {
  search.value = '';
  open.value = true;
  nextTick(() => {
    updatePosition();
    inputRef.value?.focus();
  });
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
  if (!open.value) return;
  if (
    !triggerRef.value?.contains(e.target) &&
    !popoverRef.value?.contains(e.target)
  ) {
    open.value = false;
    search.value = '';
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div class="ad-wrap">
    <button
      ref="triggerRef"
      class="ad-trigger"
      :class="[size === 'sm' ? 'ad-trigger-sm' : '', bare ? 'ad-trigger-bare' : '']"
      type="button"
      @click="open ? (open = false) : openDropdown()"
    >
      <span class="ad-label">{{ displayLabel }}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="popoverRef" class="ad-popover" :style="popoverStyle">
        <input
          ref="inputRef"
          v-model="search"
          class="ad-search"
          placeholder="Search…"
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
    </Teleport>
  </div>
</template>

<style scoped>
.ad-wrap {
  position: relative;
}

.ad-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  padding: 4px 6px;
  font-size: 13px;
  font-family: inherit;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s;
}

.ad-trigger:hover,
.ad-trigger:focus {
  outline: none;
  border-color: var(--text-muted);
}

.ad-trigger-sm {
  padding: 3px 6px;
  font-size: 12px;
}

.ad-trigger-bare {
  background: transparent;
  border-color: transparent;
}

.ad-trigger-bare:hover,
.ad-trigger-bare:focus {
  background: var(--bg-tertiary);
  border-color: transparent;
}

.ad-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<!-- Teleported popover — must be unscoped since it renders outside the component root -->
<style>
.ad-popover {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 120px;
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
