# Feature Plan: Runtime Permission Requests

## Overview

Implement runtime interactive support for Claude Code to handle **Permission Requests** - allowing users to approve/deny operations at runtime.

This enables Claude Code to request permission for sensitive operations during execution, rather than relying solely on pre-configured permission modes.

**Note:** AskUserQuestion support is ✅ **completed** in v1.0.4. Plan Mode display is ✅ **completed** in v1.0.4. See:
- `docs/completed/FEATURE_ASK_USER_QUESTION.md`
- `docs/completed/FEATURE_PLAN_MODE.md`

---

## Current State

### What Works
- Pre-configured permission modes (`default`, `acceptEdits`, `bypassPermissions`, `plan`, `skip`)
- Permission mode selection UI in chat toolbar
- Permission mode persistence per session
- ✅ AskUserQuestion interactive modal (completed in v1.0.4)
- ✅ Plan Mode with plan display (completed in v1.0.4)

### What Doesn't Work
- **No runtime permission prompts** - SDK sends `control_request` messages but server ignores them
- **Chat hangs** - SDK waits indefinitely for permission responses that never come
- **No visual indication** - Users don't know Claude is waiting for permission

### Technical Gaps
1. Server doesn't process `control_request` messages from SDK stream
2. No WebSocket message types for permission requests/responses
3. No UI components to display permission prompts and collect decisions
4. No mechanism to send `control_response` back to SDK

---

## Permission Request Handling

### SDK Control Request Structure

When Claude Code needs permission, the SDK emits:

```typescript
{
  type: 'control_request',
  subtype: 'can_use_tool',
  tool_name: string,              // e.g., "Edit", "Bash"
  input: Record<string, unknown>, // Tool input (file_path, command, etc.)
  tool_use_id: string,            // Unique ID for this tool use
  decision_reason?: string,       // e.g., "File write outside allowed directories"
  permission_suggestions?: PermissionUpdate[],
  blocked_path?: string,
  agent_id?: string
}
```

**Expected Response:**
```typescript
{
  type: 'control_response',
  request_id: string,
  decision: 'approve' | 'deny',
  permission_updates?: PermissionUpdate[]
}
```

### Implementation

#### 1.1 Server-Side Request Detection

**File:** `server/events/prompt.js`

Add control request handling in the stream processing loop:

```javascript
// In the stream processing loop (around line 242)
for await (const message of stream) {
  // ... existing handlers ...

  // NEW: Handle permission requests
  if (message.type === 'control_request' && message.subtype === 'can_use_tool') {
    console.log('Permission request:', message.tool_name, message.decision_reason);

    // Create a unique request ID
    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Store the request for later response
    const pendingRequest = {
      id: requestId,
      type: 'permission',
      toolName: message.tool_name,
      toolInput: message.input,
      toolUseId: message.tool_use_id,
      reason: message.decision_reason,
      blockedPath: message.blocked_path,
      timestamp: Date.now(),
      resolve: null,  // Will be set by response handler
      reject: null,
    };

    // Send to frontend
    sendAndBroadcast(ws, taskSessionId, {
      type: 'permission_request',
      requestId,
      toolName: message.tool_name,
      toolInput: message.input,
      reason: message.decision_reason,
      blockedPath: message.blocked_path,
      sessionId: taskSessionId,
    });

    // Wait for user decision
    const decision = await waitForUserDecision(ws, taskSessionId, requestId);

    // Send control response back to SDK
    // Note: SDK query() doesn't expose a direct response method
    // Need to investigate SDK API for sending control_response
    // This might require using a different SDK method or stream.write()

    console.log('User decision:', decision);
  }
}
```

**Challenge:** The SDK's `query()` function returns an async iterable (read-only stream). We need to investigate if there's a way to write control responses back. This may require:
- Using a different SDK API method
- Using `stream.write()` if the stream is bidirectional
- Using a callback/hook system
- **TODO: Research SDK documentation for control response mechanism**

#### 1.2 WebSocket Message Handler

**File:** `server/events/permission-response.js` (NEW)

```javascript
/**
 * Event: permission_response
 *
 * User's decision on a permission request
 *
 * @event permission_response
 * @param {Object} message - { requestId: string, decision: 'approve' | 'deny' }
 */

import { send } from '../lib/ws.js';

// Store pending requests (in-memory)
// TODO: Move to a proper request manager
export const pendingPermissionRequests = new Map();

export function handler(ws, message, context) {
  const { requestId, decision } = message;

  if (!requestId || !decision) {
    send(ws, { type: 'error', message: 'Invalid permission response' });
    return;
  }

  const pending = pendingPermissionRequests.get(requestId);
  if (!pending) {
    send(ws, { type: 'error', message: 'Permission request not found or expired' });
    return;
  }

  // Resolve the waiting promise
  if (pending.resolve) {
    pending.resolve(decision);
  }

  pendingPermissionRequests.delete(requestId);

  console.log(`Permission ${decision} for request ${requestId}`);
}

// Helper to wait for user decision
export function waitForUserDecision(ws, sessionId, requestId, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingPermissionRequests.delete(requestId);
      reject(new Error('Permission request timed out'));
    }, timeout);

    pendingPermissionRequests.set(requestId, {
      resolve: (decision) => {
        clearTimeout(timeoutId);
        resolve(decision);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });
  });
}
```

**Update:** `server/events/index.js`
```javascript
export { handler as permission_response } from './permission-response.js';
```

#### 1.3 Frontend WebSocket Handling

**File:** `src/composables/useWebSocket.js`

Add permission request state:

```javascript
// Add to scoped state
const permissionRequest = ref(null); // { requestId, toolName, toolInput, reason, blockedPath }

// Add case in handleMessage
case 'permission_request':
  permissionRequest.value = {
    requestId: msg.requestId,
    toolName: msg.toolName,
    toolInput: msg.toolInput,
    reason: msg.reason,
    blockedPath: msg.blocked_path,
  };
  break;

// Add action function
function respondToPermission(requestId, decision) {
  send({ type: 'permission_response', requestId, decision });
  permissionRequest.value = null;
}

// Export in return
return {
  // ... existing
  permissionRequest,
  respondToPermission,
};
```

#### 1.4 Permission Prompt Component

**New File:** `src/components/PermissionPrompt.vue`

```vue
<script setup>
import { computed } from 'vue';

const props = defineProps({
  request: { type: Object, default: null }, // { requestId, toolName, toolInput, reason, blockedPath }
});

const emit = defineEmits(['approve', 'deny']);

const toolDisplay = computed(() => {
  if (!props.request) return null;

  const { toolName, toolInput } = props.request;

  switch (toolName) {
    case 'Edit':
      return {
        icon: '📝',
        action: 'Edit file',
        target: toolInput.file_path,
        details: `Change "${truncate(toolInput.old_string, 50)}" to "${truncate(toolInput.new_string, 50)}"`,
      };
    case 'Write':
      return {
        icon: '💾',
        action: 'Write file',
        target: toolInput.file_path,
        details: `${(toolInput.content || '').split('\n').length} lines`,
      };
    case 'Bash':
      return {
        icon: '⚡',
        action: 'Execute command',
        target: toolInput.command,
        details: toolInput.description || null,
      };
    default:
      return {
        icon: '🔧',
        action: `Use ${toolName}`,
        target: JSON.stringify(toolInput),
        details: null,
      };
  }
});

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}
</script>

<template>
  <div v-if="request" class="permission-overlay">
    <div class="permission-prompt">
      <div class="prompt-header">
        <span class="prompt-icon">{{ toolDisplay.icon }}</span>
        <h3>Permission Required</h3>
      </div>

      <div class="prompt-body">
        <div class="prompt-action">
          <strong>{{ toolDisplay.action }}</strong>
        </div>
        <div class="prompt-target">
          <code>{{ toolDisplay.target }}</code>
        </div>
        <div v-if="toolDisplay.details" class="prompt-details">
          {{ toolDisplay.details }}
        </div>
        <div v-if="request.reason" class="prompt-reason">
          <strong>Reason:</strong> {{ request.reason }}
        </div>
      </div>

      <div class="prompt-actions">
        <button class="btn-deny" @click="$emit('deny', request.requestId)">
          Deny
        </button>
        <button class="btn-approve" @click="$emit('approve', request.requestId)">
          Approve
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.permission-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.permission-prompt {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 500px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.prompt-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.prompt-icon {
  font-size: 24px;
}

.prompt-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.prompt-body {
  padding: 20px;
}

.prompt-action {
  margin-bottom: 12px;
  font-size: 14px;
}

.prompt-target {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

.prompt-target code {
  font-size: 12px;
  font-family: var(--font-mono);
  word-break: break-all;
}

.prompt-details {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.prompt-reason {
  padding: 12px;
  background: rgba(234, 179, 8, 0.1);
  border-left: 3px solid #eab308;
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.prompt-reason strong {
  color: #eab308;
}

.prompt-actions {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.btn-deny,
.btn-approve {
  flex: 1;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-deny {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-deny:hover {
  background: var(--bg-hover);
}

.btn-approve {
  background: #3b82f6;
  border: 1px solid #3b82f6;
  color: white;
}

.btn-approve:hover {
  background: #2563eb;
}
</style>
```

#### 1.5 Integrate into ChatView

**File:** `src/views/ChatView.vue`

```vue
<script setup>
import PermissionPrompt from '../components/PermissionPrompt.vue';

const { permissionRequest, respondToPermission } = useChatWebSocket();

function handleApprove(requestId) {
  respondToPermission(requestId, 'approve');
}

function handleDeny(requestId) {
  respondToPermission(requestId, 'deny');
}
</script>

<template>
  <!-- Existing chat content -->

  <!-- Permission prompt overlay -->
  <PermissionPrompt
    :request="permissionRequest"
    @approve="handleApprove"
    @deny="handleDeny"
  />
</template>
```

---

## Critical SDK Integration Challenge

### The Core Problem

The current implementation uses `query()` which returns an **async iterable** (read-only stream):

```javascript
const stream = query({ prompt, options: queryOptions });
for await (const message of stream) {
  // Can only READ messages
  // Cannot WRITE responses back
}
```

### Potential Solutions

#### Option A: Research SDK Documentation
- Check if `query()` returns a bidirectional stream with `.write()` method
- Look for `stream.sendControlResponse()` or similar API
- Check SDK examples for interactive scenarios

#### Option B: Use Lower-Level SDK API
- Instead of `query()`, use the underlying API that allows bidirectional communication
- May need to manually construct request/response messages
- Trade simplicity for control

#### Option C: Restart Query with Answers
- When user provides permission/answers, cancel current stream
- Restart `query()` with additional context (permission grants, question answers)
- Inefficient but may be only option if SDK doesn't support mid-stream responses

#### Option D: SDK Feature Request
- If SDK doesn't support control responses, file feature request with Anthropic
- Current implementation may be designed for non-interactive CLI use only

### Next Steps

1. **Research Phase:**
   - Deep dive into `@anthropic-ai/claude-agent-sdk` documentation
   - Check source code for `query()` return type
   - Look for examples of interactive permission/question handling
   - Search for control response APIs

2. **Prototype Phase:**
   - Test if stream has write capabilities
   - Try sending control_response messages
   - Validate tool_result injection

3. **Fallback Plan:**
   - If SDK doesn't support, document limitation
   - Recommend pre-configured permission modes for now
   - File enhancement request with SDK team

---

## 4. File Structure

```
server/
├── events/
│   ├── prompt.js                    # MODIFY - Add control_request handling
│   ├── permission-response.js       # NEW - Handle permission decisions
│   ├── question-response.js         # NEW - Handle question answers
│   └── index.js                     # MODIFY - Register new handlers

src/
├── components/
│   ├── PermissionPrompt.vue         # NEW - Permission request UI
│   └── QuestionPrompt.vue           # NEW - Question form UI
├── composables/
│   └── useWebSocket.js              # MODIFY - Add permission/question state
└── views/
    └── ChatView.vue                 # MODIFY - Integrate prompts
```

---

## 5. Implementation Order

### Phase 1: Research & Validation
1. ✅ Investigate SDK API for control responses
2. ✅ Test bidirectional stream capabilities
3. ✅ Validate tool_result injection method
4. ✅ Document findings and approach

### Phase 2: Permission Request (if SDK supports)
1. ✅ Add control_request detection in prompt.js
2. ✅ Create permission-response.js handler
3. ✅ Update WebSocket composable
4. ✅ Create PermissionPrompt.vue component
5. ✅ Integrate into ChatView
6. ✅ Test with Edit/Bash operations

### Phase 3: User Questions (if SDK supports)
1. ✅ Add AskUserQuestion detection
2. ✅ Create question-response.js handler
3. ✅ Update WebSocket composable
4. ✅ Create QuestionPrompt.vue component
5. ✅ Integrate into ChatView
6. ✅ Test with multi-question scenarios

### Phase 4: Polish
1. ✅ Add timeout handling (auto-deny after 5 minutes)
2. ✅ Add "waiting for response" indicators
3. ✅ Add notification sounds/visual cues
4. ✅ Test cross-tab behavior (one response closes all prompts)
5. ✅ Add keyboard shortcuts (Enter = approve, Escape = deny)

---

## 6. Testing Plan

1. **Permission Requests**
   - Set permission mode to `default` (not bypass)
   - Ask Claude to edit sensitive files
   - Verify permission prompt appears
   - Test approve/deny flows
   - Test timeout behavior

2. **User Questions**
   - Ask Claude to gather preferences ("ask me which framework")
   - Verify questions display correctly
   - Test single-select vs multi-select
   - Test 1, 2, 3, 4 question scenarios
   - Verify answers are sent back correctly

3. **Edge Cases**
   - Multiple pending requests (queue or block?)
   - Timeout during user decision
   - WebSocket disconnect during prompt
   - Browser refresh with pending prompt
   - Multiple tabs open (only one should respond)

---

## 7. Alternative: Pre-configured Fallback

If SDK doesn't support bidirectional control:

**Workaround Option:**
- Use `bypassPermissions` mode for now
- Add prominent warning: "⚠️ Interactive permissions not yet supported"
- Document limitation in UI
- Recommend users review session history after execution
- Add "undo" capability for dangerous operations

---

## Success Criteria

- [ ] Permission requests display in modal overlay
- [ ] Users can approve/deny operations at runtime
- [ ] Questions display with all options clearly shown
- [ ] Answers are collected and sent back to Claude Code
- [ ] Chat no longer hangs when Claude asks questions
- [ ] Timeout after 5 minutes with clear error message
- [ ] Cross-tab synchronization (one response applies to all)
- [ ] Visual indicator when waiting for user input
