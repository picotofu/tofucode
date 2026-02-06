<script setup>
import * as Diff from 'diff';
import { computed } from 'vue';

const props = defineProps({
  oldContent: {
    type: String,
    required: true,
  },
  newContent: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: '',
  },
});

const diffLines = computed(() => {
  const changes = Diff.diffLines(props.oldContent, props.newContent);
  const lines = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const content = change.value;
    // Split once and filter out trailing empty string from final newline
    const splitLines = content.split('\n');
    // If content ends with \n, the last element will be empty string - remove it
    if (splitLines.length > 1 && splitLines[splitLines.length - 1] === '') {
      splitLines.pop();
    }

    if (change.added) {
      for (const line of splitLines) {
        lines.push({
          type: 'added',
          oldLineNum: null,
          newLineNum: newLineNum++,
          content: line,
        });
      }
    } else if (change.removed) {
      for (const line of splitLines) {
        lines.push({
          type: 'removed',
          oldLineNum: oldLineNum++,
          newLineNum: null,
          content: line,
        });
      }
    } else {
      // Unchanged lines
      for (const line of splitLines) {
        lines.push({
          type: 'unchanged',
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++,
          content: line,
        });
      }
    }
  }

  return lines;
});

const stats = computed(() => {
  const added = diffLines.value.filter((l) => l.type === 'added').length;
  const removed = diffLines.value.filter((l) => l.type === 'removed').length;
  return { added, removed };
});
</script>

<template>
  <div class="diff-viewer">
    <div class="diff-header" v-if="filename">
      <span class="filename">{{ filename }}</span>
      <span class="stats">
        <span class="added">+{{ stats.added }}</span>
        <span class="removed">-{{ stats.removed }}</span>
      </span>
    </div>
    <div class="diff-content">
      <div
        v-for="(line, index) in diffLines"
        :key="index"
        :class="['diff-line', line.type]"
      >
        <span class="line-num old">{{ line.oldLineNum || '' }}</span>
        <span class="line-num new">{{ line.newLineNum || '' }}</span>
        <span class="line-indicator">{{
          line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
        }}</span>
        <span class="line-content">{{ line.content }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  margin: 8px 0;
}

.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
}

.filename {
  font-weight: 500;
  color: var(--text-primary);
}

.stats {
  display: flex;
  gap: 12px;
  font-weight: 500;
}

.stats .added {
  color: #22c55e;
}

.stats .removed {
  color: #ef4444;
}

.diff-content {
  overflow-x: auto;
  background: var(--bg-secondary);
}

.diff-line {
  display: flex;
  align-items: flex-start;
  line-height: 1.5;
  min-height: 21px;
}

.diff-line.added {
  background: rgba(34, 197, 94, 0.1);
}

.diff-line.removed {
  background: rgba(239, 68, 68, 0.1);
}

.diff-line.unchanged {
  background: transparent;
}

.line-num {
  display: inline-block;
  width: 40px;
  text-align: right;
  padding: 0 8px;
  color: var(--text-tertiary);
  user-select: none;
  flex-shrink: 0;
}

.line-num.old {
  border-right: 1px solid var(--border-color);
}

.line-num.new {
  border-right: 1px solid var(--border-color);
}

.line-indicator {
  display: inline-block;
  width: 20px;
  text-align: center;
  color: var(--text-tertiary);
  user-select: none;
  flex-shrink: 0;
}

.diff-line.added .line-indicator {
  color: #22c55e;
  font-weight: 600;
}

.diff-line.removed .line-indicator {
  color: #ef4444;
  font-weight: 600;
}

.line-content {
  flex: 1;
  padding: 0 8px;
  white-space: pre;
  overflow-x: auto;
}
</style>
