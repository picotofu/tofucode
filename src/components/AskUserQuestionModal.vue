<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  questions: { type: Array, default: () => [] },
  toolUseId: { type: String, default: null },
});

const emit = defineEmits(['close', 'submit']);

// Detect platform for keyboard shortcut hint
const isMac = computed(() => {
  return (
    typeof window !== 'undefined' && window.navigator.platform?.includes('Mac')
  );
});

// Answers keyed by question header
const answers = ref({});

// Custom text input per question (for "Other" option)
const customAnswers = ref({});

// Initialize answers when questions change
watch(
  () => props.questions,
  (qs) => {
    if (qs?.length > 0) {
      const newAnswers = {};
      const newCustom = {};
      for (const q of qs) {
        newAnswers[q.header] = q.multiSelect ? [] : null;
        newCustom[q.header] = '';
      }
      answers.value = newAnswers;
      customAnswers.value = newCustom;
    }
  },
  { immediate: true },
);

function selectOption(header, optionLabel, multiSelect) {
  if (multiSelect) {
    const current = answers.value[header] || [];
    if (current.includes(optionLabel)) {
      answers.value[header] = current.filter((o) => o !== optionLabel);
    } else {
      answers.value[header] = [...current, optionLabel];
    }
    // Clear custom when selecting predefined
    customAnswers.value[header] = '';
  } else {
    answers.value[header] = optionLabel;
    // Clear custom when selecting predefined
    customAnswers.value[header] = '';
  }
}

function handleCustomInput(header, text) {
  customAnswers.value[header] = text;
  // Clear predefined selection when typing custom
  if (text.trim()) {
    answers.value[header] = null;
  }
}

function isSelected(header, optionLabel) {
  const answer = answers.value[header];
  if (Array.isArray(answer)) return answer.includes(optionLabel);
  return answer === optionLabel;
}

const canSubmit = computed(() => {
  return props.questions.every((q) => {
    const answer = answers.value[q.header];
    const custom = customAnswers.value[q.header]?.trim();
    if (custom) return true;
    if (Array.isArray(answer)) return answer.length > 0;
    return answer !== null && answer !== undefined;
  });
});

function handleSubmit() {
  if (!canSubmit.value) return;
  // Build final answers: use custom text if provided, else selected option
  const finalAnswers = {};
  for (const q of props.questions) {
    const custom = customAnswers.value[q.header]?.trim();
    if (custom) {
      finalAnswers[q.header] = custom;
    } else {
      finalAnswers[q.header] = answers.value[q.header];
    }
  }
  emit('submit', props.toolUseId, finalAnswers);
}

function closeModal() {
  emit('close');
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal();
  }
  // Cmd/Ctrl+Enter to submit
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit.value) {
    e.preventDefault();
    handleSubmit();
  }
}

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      document.addEventListener('keydown', handleKeydown);
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  },
);

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="closeModal">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>Answer Questions</h2>
        <button class="close-btn" @click="closeModal" title="Close (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div
          v-for="(q, qIdx) in questions"
          :key="qIdx"
          class="question-block"
          :class="{ 'has-border': qIdx > 0 }"
        >
          <div class="question-label">
            <span class="question-chip">{{ q.header }}</span>
            <span class="question-select-hint">{{ q.multiSelect ? 'Select all that apply' : 'Select one' }}</span>
          </div>
          <p class="question-text">{{ q.question }}</p>

          <!-- Option cards -->
          <div class="option-list">
            <button
              v-for="(opt, optIdx) in q.options"
              :key="optIdx"
              class="option-card"
              :class="{ selected: isSelected(q.header, opt.label) }"
              @click="selectOption(q.header, opt.label, q.multiSelect)"
            >
              <div class="option-radio">
                <div v-if="q.multiSelect" class="checkbox" :class="{ checked: isSelected(q.header, opt.label) }">
                  <svg v-if="isSelected(q.header, opt.label)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div v-else class="radio" :class="{ checked: isSelected(q.header, opt.label) }">
                  <div v-if="isSelected(q.header, opt.label)" class="radio-dot"></div>
                </div>
              </div>
              <div class="option-content">
                <span class="option-label">{{ opt.label }}</span>
                <span v-if="opt.description" class="option-desc">{{ opt.description }}</span>
              </div>
            </button>
          </div>

          <!-- Custom answer (Other) -->
          <div class="custom-answer">
            <textarea
              class="custom-textarea"
              :placeholder="'Other: type a custom answer...'"
              :value="customAnswers[q.header]"
              @input="handleCustomInput(q.header, $event.target.value)"
              rows="2"
            ></textarea>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" @click="closeModal">Cancel</button>
        <button class="btn-submit" :disabled="!canSubmit" @click="handleSubmit">
          Submit Answers
          <span class="submit-hint">{{ isMac ? '⌘' : 'Ctrl' }}+↵</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease-out;
  backdrop-filter: blur(4px);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  width: 90%;
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.question-block {
  padding-bottom: 20px;
}

.question-block.has-border {
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
}

.question-label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.question-chip {
  display: inline-block;
  padding: 3px 10px;
  background: rgba(59, 130, 246, 0.15);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #60a5fa;
}

.question-select-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.question-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.option-card:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
}

.option-card.selected {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}

.option-radio {
  flex-shrink: 0;
  margin-top: 2px;
}

.radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s;
}

.radio.checked {
  border-color: #3b82f6;
}

.radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3b82f6;
}

.checkbox {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 2px solid var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
}

.checkbox.checked {
  border-color: #3b82f6;
  background: #3b82f6;
  color: white;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.option-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.custom-answer {
  margin-top: 8px;
}

.custom-textarea {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  resize: vertical;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.custom-textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

.custom-textarea::placeholder {
  color: var(--text-muted);
}

.modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.btn-cancel {
  padding: 8px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-cancel:hover {
  background: var(--bg-hover);
}

.btn-submit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: #3b82f6;
  border: none;
  border-radius: var(--radius-sm);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-submit:hover:not(:disabled) {
  background: #2563eb;
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-hint {
  font-size: 11px;
  opacity: 0.7;
}
</style>
