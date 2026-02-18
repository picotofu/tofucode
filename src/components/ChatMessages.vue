<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import MessageItem from './MessageItem.vue';
import ToolGroup from './ToolGroup.vue';

const props = defineProps({
  messages: {
    type: Array,
    required: true,
  },
  isRunning: {
    type: Boolean,
    default: false,
  },
  isNewSession: {
    type: Boolean,
    default: false,
  },
  contextReady: {
    type: Boolean,
    default: false,
  },
  hasOlderMessages: {
    type: Boolean,
    default: false,
  },
  summaryCount: {
    type: Number,
    default: 0,
  },
  loadingOlderMessages: {
    type: Boolean,
    default: false,
  },
  totalTurns: {
    type: Number,
    default: 0,
  },
  loadedTurns: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  'load-full-history',
  'load-older-messages',
  'answer-question',
]);

const messagesEl = ref(null);
const userScrolledUp = ref(false);
const turnRefs = ref([]); // Array of refs for each conversation turn
const currentTurnIndex = ref(-1); // Currently visible turn (for navigation)
// 'top' = jump to first newly loaded turn after load, 'stay' = stay in place (up btn)
const pendingOlderMessagesJump = ref(null);

// Plan mode tools should render standalone (not grouped) so their special
// content (plan markdown, enter indicator) is visible in MessageItem
const STANDALONE_TOOLS = new Set([
  'ExitPlanMode',
  'EnterPlanMode',
  'AskUserQuestion',
]);

// Group consecutive tool_use and tool_result messages together
function groupToolMessages(messages) {
  const result = [];
  let currentToolGroup = null;

  for (const msg of messages) {
    if (msg.type === 'tool_use') {
      if (STANDALONE_TOOLS.has(msg.tool)) {
        // Flush any pending tool group before standalone tool
        if (currentToolGroup) {
          result.push(currentToolGroup);
          currentToolGroup = null;
        }
        result.push(msg);
      } else {
        // Start or continue a tool group
        if (!currentToolGroup) {
          currentToolGroup = { type: 'tool_group', items: [] };
        }
        currentToolGroup.items.push(msg);
      }
    } else if (msg.type === 'tool_result') {
      // Add to existing tool group
      if (currentToolGroup) {
        currentToolGroup.items.push(msg);
      } else {
        // Orphan tool_result (or result after standalone tool), show as-is
        result.push(msg);
      }
    } else {
      // Non-tool message: flush any pending tool group
      if (currentToolGroup) {
        result.push(currentToolGroup);
        currentToolGroup = null;
      }
      result.push(msg);
    }
  }

  // Flush any remaining tool group
  if (currentToolGroup) {
    result.push(currentToolGroup);
  }

  return result;
}

// Group messages into conversation turns (user message + all responses until next user message)
const conversationTurns = computed(() => {
  const turns = [];
  let currentTurn = null;

  for (const msg of props.messages) {
    if (msg.type === 'user') {
      // Start a new turn
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = { userMessage: msg, responses: [] };
    } else if (currentTurn) {
      // Add to current turn's responses
      currentTurn.responses.push(msg);
    } else {
      // Response without a user message (e.g., loaded history starting mid-conversation)
      // Create an implicit turn with no user message
      currentTurn = { userMessage: null, responses: [msg] };
    }
  }

  // Push the last turn
  if (currentTurn) {
    turns.push(currentTurn);
  }

  // Group tool messages within each turn's responses
  return turns.map((turn) => ({
    ...turn,
    groupedResponses: groupToolMessages(turn.responses),
  }));
});

// For backwards compatibility - flat list of grouped messages
const groupedMessages = computed(() => {
  return groupToolMessages(props.messages);
});

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}

function checkScrollPosition() {
  if (!messagesEl.value) return;

  const { scrollTop, scrollHeight, clientHeight } = messagesEl.value;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  // Consider "scrolled up" if more than 100px from bottom
  if (distanceFromBottom > 100) {
    userScrolledUp.value = true;
  } else {
    userScrolledUp.value = false;
  }

  // Update current turn index based on scroll position
  updateCurrentTurnIndex();
}

function handleScroll() {
  checkScrollPosition();
}

// Update which turn is currently in view
function updateCurrentTurnIndex() {
  if (!messagesEl.value || turnRefs.value.length === 0) return;

  const containerTop = messagesEl.value.scrollTop;
  const containerHeight = messagesEl.value.clientHeight;
  const viewportMiddle = containerTop + containerHeight / 3; // Upper third of viewport

  // Find the turn whose top is closest to (but not below) the viewport middle
  let closestIndex = 0;
  for (let i = 0; i < turnRefs.value.length; i++) {
    const el = turnRefs.value[i];
    if (el) {
      const turnTop = el.offsetTop;
      if (turnTop <= viewportMiddle) {
        closestIndex = i;
      }
    }
  }
  currentTurnIndex.value = closestIndex;
}

// Navigate to previous turn (scroll up)
function goToPreviousTurn() {
  const lastIndex = conversationTurns.value.length - 1;

  // If currently at last turn, scroll to top of last turn first
  if (currentTurnIndex.value === lastIndex) {
    // Check if we're already scrolled to the top of the last turn
    const lastTurnEl = turnRefs.value[lastIndex];
    if (lastTurnEl && messagesEl.value) {
      const scrollTop = messagesEl.value.scrollTop;
      const turnTop = lastTurnEl.offsetTop - 16;

      // If not yet at the top of last turn, scroll there first
      if (Math.abs(scrollTop - turnTop) > 10) {
        scrollToTurn(lastIndex);
        return;
      }
    }
  }

  // If at first turn and there are older messages, load them (stay at current position)
  if (
    currentTurnIndex.value === 0 &&
    props.hasOlderMessages &&
    !props.loadingOlderMessages
  ) {
    loadOlderStay();
    return;
  }

  // Otherwise, go to previous turn
  const targetIndex = Math.max(0, currentTurnIndex.value - 1);
  scrollToTurn(targetIndex);
}

// Navigate to next turn (scroll down)
function goToNextTurn() {
  const targetIndex = Math.min(
    conversationTurns.value.length - 1,
    currentTurnIndex.value + 1,
  );
  scrollToTurn(targetIndex);
}

// Scroll to a specific turn
function scrollToTurn(index) {
  const el = turnRefs.value[index];
  if (el && messagesEl.value) {
    // Scroll so the turn is near the top with some padding
    messagesEl.value.scrollTo({
      top: el.offsetTop - 16,
      behavior: 'smooth',
    });
    currentTurnIndex.value = index;
  }
}

// Set ref for a turn element
function setTurnRef(index, el) {
  turnRefs.value[index] = el;
}

// Track state before loading older messages for scroll restoration
let prevTurnCountBeforeLoad = 0;
let anchorScrollOffset = 0; // px from top of anchor element to scroll container top

function loadOlderWithJump() {
  // 'top' mode: after load, jump to first newly prepended turn (turn index 0)
  prevTurnCountBeforeLoad = conversationTurns.value.length;
  pendingOlderMessagesJump.value = 'top';
  emit('load-older-messages');
}

function loadOlderStay() {
  // 'stay' mode: capture current scroll anchor so we can restore it after prepend,
  // then advance one turn back naturally without visual jump
  prevTurnCountBeforeLoad = conversationTurns.value.length;
  // Anchor to the current first turn element to restore scroll position after prepend
  const anchorEl = turnRefs.value[0];
  if (anchorEl && messagesEl.value) {
    anchorScrollOffset = anchorEl.offsetTop - messagesEl.value.scrollTop;
  }
  pendingOlderMessagesJump.value = 'stay';
  emit('load-older-messages');
}

// After older messages finish loading, handle scroll behavior
watch(
  () => props.loadingOlderMessages,
  (loading, wasLoading) => {
    if (wasLoading && !loading && pendingOlderMessagesJump.value) {
      const jumpMode = pendingOlderMessagesJump.value;
      pendingOlderMessagesJump.value = null;
      nextTick(() => {
        if (jumpMode === 'top') {
          // Jump to the first of the newly prepended turns
          scrollToTurn(0);
        } else if (jumpMode === 'stay') {
          // Restore scroll so the previously-first turn stays at the same visual position,
          // then immediately advance one turn back (no animation fighting prepend reflow)
          const newTurns =
            conversationTurns.value.length - prevTurnCountBeforeLoad;
          const restoredAnchorIndex = newTurns; // previously-first turn is now at newTurns
          const anchorEl = turnRefs.value[restoredAnchorIndex];
          if (anchorEl && messagesEl.value) {
            // Restore position instantly (no smooth) to eliminate the visual jump from prepend
            messagesEl.value.scrollTo({
              top: anchorEl.offsetTop - anchorScrollOffset,
              behavior: 'instant',
            });
          }
          // Now navigate one turn back from the restored anchor
          const targetIndex = Math.max(0, restoredAnchorIndex - 1);
          scrollToTurn(targetIndex);
        }
      });
    }
  },
);

// Auto-scroll on new messages
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    // If messages just loaded (0 to N), always scroll to bottom
    if (oldLength === 0 && newLength > 0) {
      userScrolledUp.value = false;
      nextTick(() => {
        scrollToBottom();
        // Set turn index to last turn explicitly — scroll detection can miss short last turns
        currentTurnIndex.value = conversationTurns.value.length - 1;
        // Double-check after a short delay to ensure DOM is fully rendered
        setTimeout(() => {
          scrollToBottom();
          currentTurnIndex.value = conversationTurns.value.length - 1;
        }, 100);
      });
    }
    // Otherwise only scroll if user hasn't scrolled up
    else if (!userScrolledUp.value) {
      nextTick(scrollToBottom);
    }
  },
);

// Auto-scroll when task starts running (typing indicator appears)
watch(
  () => props.isRunning,
  (running) => {
    if (running && !userScrolledUp.value) {
      // Wait for typing indicator to render, then scroll
      nextTick(() => {
        setTimeout(scrollToBottom, 50);
      });
    }
  },
);

// Expose scrollToBottom and navigation functions for parent to call
defineExpose({ scrollToBottom, goToPreviousTurn, goToNextTurn });
</script>

<template>
  <div class="messages-container">
    <main class="messages" ref="messagesEl" @scroll="handleScroll">
      <div class="messages-inner" v-if="messages.length > 0">
        <!-- Load older messages button -->
        <div class="older-messages" v-if="hasOlderMessages">
          <button
            class="load-older-btn"
            :disabled="loadingOlderMessages"
            @click="loadOlderWithJump"
          >
            <svg v-if="!loadingOlderMessages" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19V5M5 12l7-7 7 7"/>
            </svg>
            <span v-if="loadingOlderMessages" class="loading-spinner"></span>
            {{ loadingOlderMessages ? 'Loading...' : 'Load 5 more turns' }}
            <span class="summary-badge" v-if="summaryCount > 0 && !loadingOlderMessages">{{ summaryCount }} compaction{{ summaryCount > 1 ? 's' : '' }}</span>
          </button>
        </div>
        <!-- Render conversation turns -->
        <div
          v-for="(turn, turnIndex) in conversationTurns"
          :key="turnIndex"
          :ref="(el) => setTurnRef(turnIndex, el)"
          class="conversation-turn"
        >
          <!-- User message -->
          <MessageItem v-if="turn.userMessage" :message="turn.userMessage" />
          <!-- Grouped responses (text, tool groups, results, errors) -->
          <template v-for="(msg, msgIndex) in turn.groupedResponses" :key="`${turnIndex}-${msgIndex}`">
            <ToolGroup v-if="msg.type === 'tool_group'" :items="msg.items" />
            <MessageItem v-else :message="msg" @answer-question="emit('answer-question', $event)" />
          </template>
        </div>
      </div>
      <div class="empty" v-else-if="!isRunning && (isNewSession || contextReady)">
        <p>Start a conversation</p>
        <p class="empty-hint">Type a message below to begin.</p>
      </div>
      <div class="loading-skeleton" v-else-if="!isRunning && !contextReady">
        <div class="skeleton-message">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
        <div class="skeleton-message">
          <div class="skeleton-avatar assistant"></div>
          <div class="skeleton-content">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
        <div class="skeleton-message">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line"></div>
          </div>
        </div>
      </div>
      <div class="typing" v-if="isRunning">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </main>

    <!-- Turn navigation buttons (bottom-right) -->
    <div class="turn-navigation" v-if="conversationTurns.length > 1">
      <button
        class="turn-nav-btn"
        :disabled="currentTurnIndex <= 0 && !hasOlderMessages"
        @click="goToPreviousTurn"
        title="Previous message (scroll up)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </button>
      <span class="turn-counter">{{ totalTurns > 0 ? Math.max(1, Math.min(totalTurns, totalTurns - loadedTurns + currentTurnIndex + 1)) : (currentTurnIndex + 1) }}/{{ totalTurns > 0 ? totalTurns : conversationTurns.length }}</span>
      <button
        class="turn-nav-btn"
        :disabled="currentTurnIndex >= conversationTurns.length - 1"
        @click="goToNextTurn"
        title="Next message (scroll down)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
    </div>

    <!-- Jump to bottom button (floats within chat area) -->
    <button
      v-if="userScrolledUp"
      class="jump-to-bottom"
      @click="scrollToBottom"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12l7 7 7-7"/>
      </svg>
      Jump to bottom
    </button>
  </div>
</template>

<style scoped>
.messages-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.messages {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}

.messages-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 100%;
  overflow-x: hidden;
  padding-bottom: 16px;
}

.older-messages {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
  border-bottom: 1px dashed var(--border-color);
  margin-bottom: 8px;
}

.load-older-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  transition: background 0.15s, color 0.15s;
}

.load-older-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.load-older-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--text-muted);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.summary-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-secondary);
  border-radius: 10px;
  color: var(--text-muted);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
}

.empty-hint {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 16px 0;
}

.skeleton-message {
  display: flex;
  gap: 12px;
}

.skeleton-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  flex-shrink: 0;
}

.skeleton-avatar.assistant {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.1) 25%, rgba(59, 130, 246, 0.2) 50%, rgba(59, 130, 246, 0.1) 75%);
  background-size: 200% 100%;
}

.skeleton-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-line.short {
  width: 60%;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.typing {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-lg);
  width: fit-content;
  margin: 16px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: typing 1.4s infinite ease-in-out;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.jump-to-bottom {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  z-index: 10;
  box-shadow: var(--shadow-md);
  transition: background 0.15s, color 0.15s;
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.jump-to-bottom:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Conversation turn grouping */
.conversation-turn {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Turn navigation */
.turn-navigation {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 4px;
  z-index: 10;
  box-shadow: var(--shadow-md);
}

.turn-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--text-secondary);
  background: transparent;
  transition: background 0.15s, color 0.15s;
}

.turn-nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.turn-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.turn-counter {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 0 4px;
  min-width: 36px;
  text-align: center;
}
</style>
