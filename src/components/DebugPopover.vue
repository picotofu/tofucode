<script setup>
import { computed } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Object,
    default: () => ({ x: 0, y: 0 }),
  },
  data: {
    type: Object,
    default: () => ({ id: '', classes: [] }),
  },
});

const hasData = computed(() => props.data.id || props.data.classes.length > 0);

const displayText = computed(() => {
  const parts = [];
  if (props.data.id) {
    parts.push(`#${props.data.id}`);
  }
  if (props.data.classes.length > 0) {
    parts.push(`.${props.data.classes.join(' .')}`);
  }
  return parts.join(' ');
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && hasData"
      class="debug-popover"
      :style="{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }"
    >
      {{ displayText }}
    </div>
  </Teleport>
</template>

<style scoped>
.debug-popover {
  position: fixed;
  background: rgba(0, 0, 0, 0.95);
  border: 1px solid #60a5fa;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 11px;
  font-family: 'Monaco', 'Courier New', monospace;
  color: #fbbf24;
  pointer-events: none;
  z-index: 100000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  max-width: 400px;
  word-break: break-all;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
