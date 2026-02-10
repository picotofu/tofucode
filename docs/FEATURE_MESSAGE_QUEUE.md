# Message Queue System

## Requirements

- When Claude is running a task, allow users to continue typing and submitting messages
- Submitted messages are queued server-side and processed sequentially (FIFO)
- The chat prompt icon (top-left) shows a badge with the number of queued messages
- Clicking the chat prompt icon opens a modal to view, edit, reorder, and delete queued messages
- When a task completes, the server automatically dequeues the next message and submits it
- Queue persists server-side per session - closing the browser tab does not lose queued messages
- On page load / reconnect, the client receives the current queue count
- Queue count is broadcast to all session watchers as it changes
- Multiple messages can be queued in succession

## Context

### Current Behavior
- `prompt.js:59-68` blocks new messages when `task.status === 'running'`, returning an error
- Frontend `ChatView.vue` disables the send button when `isRunning` is true
- Tasks are tracked per-session in a `Map<sessionId, Task>` in `server/lib/tasks.js`
- The `prompt` event handler calls `executePrompt()` which is a long-running async function that streams results
- When `executePrompt()` finishes, it sets `task.status = 'completed'` and broadcasts `task_status`

### Architecture Constraints
- Each session can only have one active Claude SDK `query()` call at a time (SDK limitation)
- The server is single-process Node.js - queue processing must be non-blocking
- Multiple browser tabs can watch the same session via `sessionWatchers`
- The per-connection `context` object in `websocket.js` tracks `currentProjectPath` and `currentSessionId`
- Queue processing must survive WebSocket disconnects since it's server-side

### Key Integration Points
- **Entry point**: `prompt` event handler (`server/events/prompt.js`)
- **Task lifecycle**: `server/lib/tasks.js` - `getOrCreateTask()`, `addTaskResult()`, `cancelTask()`
- **Broadcasting**: `server/lib/ws.js` - `send()`, `broadcast()`, `broadcastToSession()`
- **Session selection**: `server/events/select-session.js` - sends initial state on session load
- **Task completion**: `prompt.js:359-365` - where task status transitions to `completed`

## Scope

### In Scope
- Server-side message queue per session (in-memory, tied to session lifetime)
- Queue manipulation events: enqueue, dequeue (auto), edit, delete, reorder
- Queue count indicator on chat prompt icon (badge)
- Queue management modal (view, edit, delete, reorder messages)
- Auto-processing: server dequeues and executes next message on task completion
- Queue state sync on connect/reconnect
- Broadcasting queue changes to all session watchers
- Queue state included in `select_session` response
- Cancellation behavior: cancelling a task should still trigger dequeue of next message (configurable?)

### Out of Scope
- Persistent queue storage to disk (queue lives in memory, lost on server restart)
- Cross-session queue (each session has its own independent queue)
- Priority queue / message reordering beyond manual drag
- Queue size limits (defer to future iteration if needed)

## Plan

### Phase 1: Server-Side Queue Infrastructure

#### 1.1 New File: `server/lib/message-queue.js`

Message queue manager - one queue per session, stored in memory.

**Data Structure:**
```
sessionQueues: Map<sessionId, QueuedMessage[]>

QueuedMessage {
  id: string           // unique ID (nanoid or Date.now + counter)
  prompt: string       // the message text
  options: object      // { model, permissionMode, dangerouslySkipPermissions }
  queuedAt: string     // ISO timestamp
  queuedBy: string     // connection identifier (for attribution)
}
```

**Exports:**
- `enqueue(sessionId, prompt, options)` - Add message to end of queue, returns QueuedMessage
- `dequeue(sessionId)` - Remove and return first message, or null if empty
- `getQueue(sessionId)` - Return current queue (array copy)
- `getQueueSize(sessionId)` - Return count
- `editMessage(sessionId, messageId, newPrompt)` - Edit queued message text, returns boolean
- `deleteMessage(sessionId, messageId)` - Remove specific message, returns boolean
- `reorderQueue(sessionId, messageIds)` - Reorder queue by array of IDs, returns boolean
- `clearQueue(sessionId)` - Clear all queued messages

#### 1.2 Modify: `server/events/prompt.js`

**Current flow:**
1. Check if task is running → reject with error
2. Call `executePrompt()` → streams results → sets status to `completed`

**New flow:**
1. Check if task is running → if yes, **enqueue** instead of rejecting
2. On enqueue: broadcast `queue_updated` to session watchers
3. After `executePrompt()` completes (status becomes `completed`, `error`, or `cancelled`):
   - Check if queue has messages via `dequeue(sessionId)`
   - If yes: auto-execute the dequeued message
   - Broadcast updated `queue_updated`
4. The auto-execute loop continues until queue is empty
5. Need to handle the "no WebSocket" case: when processing queued messages after tab close, there's no originating `ws` - messages still stream to session watchers

**Key change - `executePrompt()` gets a completion callback / post-processing hook:**

After task finishes (in the `finally`-like section after the stream loop), call a new function `processNextInQueue(sessionId)` that:
1. Calls `dequeue(sessionId)`
2. If message exists, calls `executePrompt()` with the dequeued message
3. Uses `null` for `ws` (no specific client) - all messages go via `broadcastToSession()`
4. Broadcasts `queue_updated` with new count

**Handling `ws = null` (no originating client):**
- Modify `sendAndBroadcast()` to handle null ws gracefully - just broadcast to session
- The user message and streamed responses go to all session watchers equally
- This is the key behavior that allows queue processing to continue after tab close

#### 1.3 Modify: `server/lib/tasks.js`

No structural changes needed. The existing task lifecycle (`running` → `completed`/`error`/`cancelled`) remains the same. The queue sits *outside* the task and feeds into it.

### Phase 2: WebSocket Events

#### 2.1 New Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `queue:enqueue` | `{ prompt, model?, permissionMode? }` | Explicitly enqueue (alternative to auto-enqueue via `prompt` during running) |
| `queue:edit` | `{ messageId, prompt }` | Edit a queued message's text |
| `queue:delete` | `{ messageId }` | Remove a message from queue |
| `queue:reorder` | `{ messageIds: string[] }` | Reorder queue by providing full ordered list of IDs |
| `queue:clear` | `{}` | Clear all queued messages |
| `queue:get` | `{}` | Request current queue state |

#### 2.2 New Events (Server → Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `queue_updated` | `{ sessionId, queue: QueuedMessage[], size: number }` | Broadcast when queue changes (enqueue, dequeue, edit, delete, reorder, clear) |
| `queue_state` | `{ sessionId, queue: QueuedMessage[], size: number }` | Response to `queue:get`, also sent on session select |

#### 2.3 New Event Handler: `server/events/queue.js`

Single file handling all `queue:*` events. Registered in `server/events/index.js` as:
```
'queue:enqueue': queueEnqueue,
'queue:edit': queueEdit,
'queue:delete': queueDelete,
'queue:reorder': queueReorder,
'queue:clear': queueClear,
'queue:get': queueGet,
```

Each handler:
1. Validates `context.currentSessionId` exists
2. Calls corresponding `message-queue.js` function
3. Broadcasts `queue_updated` to all session watchers (for mutation events)
4. Sends `queue_state` to requesting client only (for `queue:get`)

#### 2.4 Modify: `server/events/select-session.js`

After sending `session_selected`, `task_status`, and `session_history`, also send:
```
{ type: 'queue_state', sessionId, queue: [...], size: N }
```

This ensures clients get queue state on session load/reconnect.

#### 2.5 Modify: `server/events/prompt.js` (Event Routing)

Change the "task already running" block:
- Instead of returning an error, call `enqueue()` and broadcast `queue_updated`
- Send confirmation to client: `{ type: 'queue_enqueued', message: QueuedMessage }`

### Phase 3: Frontend - Queue Indicator

#### 3.1 Modify: `src/composables/useWebSocket.js` (Scoped Chat WebSocket)

**New reactive state:**
- `queuedMessages: ref([])` - array of QueuedMessage objects
- `queueSize: computed(() => queuedMessages.value.length)`

**New message handlers:**
- `queue_updated`: Update `queuedMessages` from payload
- `queue_state`: Set `queuedMessages` from payload (initial load)
- `queue_enqueued`: Could trigger a toast/notification

**New send functions:**
- `enqueueMessage(prompt, options)` - sends `queue:enqueue`
- `editQueuedMessage(messageId, prompt)` - sends `queue:edit`
- `deleteQueuedMessage(messageId)` - sends `queue:delete`
- `reorderQueue(messageIds)` - sends `queue:reorder`
- `clearQueue()` - sends `queue:clear`

#### 3.2 Modify: `src/views/ChatView.vue` - Submit Logic

**Current:** `handleSubmit()` checks `isRunning` → blocks if true
**New:** `handleSubmit()` always sends `{ type: 'prompt', ... }` regardless of `isRunning`
- Server decides whether to execute immediately or enqueue
- Input is always cleared after send
- If enqueued, server responds with `queue_enqueued` confirmation

#### 3.3 Modify: `src/views/ChatView.vue` - Chat Prompt Icon Badge

Add a small numeric badge to the chat prompt icon (top-left `>_` icon):
- Shown only when `queueSize > 0`
- Positioned as a superscript badge (top-right of the icon)
- Small font, contrasting background (e.g., accent color circle)
- Animates in/out with CSS transition

#### 3.4 Modify: `src/views/ChatView.vue` - Icon Click Handler

The chat prompt icon currently has no click handler. Add:
- `@click="openQueueModal"` when `queueSize > 0`
- No action when queue is empty (or could show "queue empty" tooltip)

### Phase 4: Frontend - Queue Management Modal

#### 4.1 New Component: `src/components/QueueModal.vue`

A modal overlay showing queued messages with management controls.

**Props:**
- `visible: boolean`
- `messages: QueuedMessage[]`

**Events:**
- `@close`
- `@edit(messageId, newPrompt)`
- `@delete(messageId)`
- `@reorder(messageIds)`
- `@clear`

**UI Layout:**
- Modal header: "Message Queue (N)" + close button
- List of queued messages in order:
  - Each item shows: queue position number, truncated prompt preview, timestamp, model badge
  - Action buttons per item: Edit (pencil icon), Delete (trash icon)
  - Drag handle for reordering (optional - could defer to later)
- Footer: "Clear All" button (with confirmation)
- Empty state: "No messages in queue"

**Edit behavior:**
- Clicking edit on a message opens an inline textarea for editing
- Save/cancel buttons appear
- On save: emits `@edit` with messageId and new prompt

**Delete behavior:**
- Clicking delete removes immediately (with brief undo option, or confirm dialog)

**Reorder behavior (optional/deferred):**
- Drag and drop to reorder
- On drop: emits `@reorder` with new ordered array of messageIds
- Could use a simple move up/down button pair instead of full drag-and-drop

### Phase 5: Edge Cases and Error Handling

#### 5.1 Queue Processing After Tab Close
- Server processes queue independently of any WebSocket connection
- `executePrompt()` called with `ws = null`
- All output goes via `broadcastToSession()` only
- If no watchers exist, messages still process (results stored in task.results)
- When user reconnects and selects session: gets latest `session_history` from JSONL + `queue_state`

#### 5.2 Queue Processing After Error
- If a queued message's execution results in an error:
  - Error is broadcast as usual
  - **Continue processing queue** - don't stop on errors
  - The error message appears in chat history, then next queued message auto-starts
- If a queued message's execution results in cancellation:
  - `cancel_task` cancels the currently running (dequeued) message
  - **Do not auto-dequeue next** on explicit cancel - user intended to stop
  - Queue remains intact for manual resume or clearing
  - Broadcast `queue_updated` so clients know queue is paused

#### 5.3 Session Deletion
- When a session is deleted (`delete-session.js`), also clear its queue:
  - Call `clearQueue(sessionId)` in the delete handler

#### 5.4 New Session Queue
- For new sessions (no `sessionId` yet), queue is tricky:
  - First message creates the session via SDK
  - Subsequent queued messages need the new `sessionId` which is only known after `system:init`
  - Solution: Allow enqueue with `sessionId = null` using a temporary connection-scoped queue
  - Once `sessionId` is assigned (from `system:init` in prompt.js), migrate the temp queue to the session queue
  - OR simpler: don't allow queueing until session is created (first message must complete before queueing)
  - **Recommended approach**: Only allow queueing on existing sessions. For new sessions, the first prompt creates the session normally. Once `session_info` is received, subsequent messages can be queued.

#### 5.5 Concurrent Queue Modifications
- Since Node.js is single-threaded, no race conditions on queue operations
- However, multiple clients watching same session can both enqueue - this is fine, messages are ordered by arrival time
- Edit/delete by one client is broadcast to all watchers via `queue_updated`

#### 5.6 Server Restart
- Queue is in-memory only - lost on server restart
- This is acceptable for MVP; persistent queue could be a future enhancement
- On reconnect after server restart, clients receive empty `queue_state`

## New Files Summary

| File | Type | Purpose |
|------|------|---------|
| `server/lib/message-queue.js` | Utility | Queue data structure and operations |
| `server/events/queue.js` | Event handlers | All `queue:*` WebSocket event handlers |
| `src/components/QueueModal.vue` | Component | Queue management modal UI |

## Modified Files Summary

| File | Change |
|------|--------|
| `server/events/prompt.js` | Enqueue on running, auto-dequeue on complete, handle `ws = null` |
| `server/events/index.js` | Register `queue:*` event handlers |
| `server/events/select-session.js` | Send `queue_state` on session select |
| `server/events/delete-session.js` | Clear queue on session delete |
| `server/lib/ws.js` | No changes needed (existing broadcast handles null exclusion) |
| `server/lib/tasks.js` | No changes needed |
| `src/composables/useWebSocket.js` | Add queue state, handlers, and send functions |
| `src/views/ChatView.vue` | Remove isRunning gate on submit, add badge to prompt icon, add queue modal |

## Event Flow Diagrams

### Enqueue Flow (Claude is running)
```
Client                          Server
  |                               |
  |-- prompt {prompt, model} ---->|
  |                               |-- task.status === 'running'
  |                               |-- enqueue(sessionId, prompt, options)
  |<-- queue_enqueued {message} --|
  |<-- queue_updated {queue} -----|-- broadcast to all session watchers
  |                               |
```

### Auto-Dequeue Flow (Task completes)
```
Server (internal)
  |
  |-- executePrompt() finishes
  |-- task.status = 'completed'
  |-- broadcast task_status
  |-- processNextInQueue(sessionId)
  |   |-- dequeue(sessionId) → message
  |   |-- if message exists:
  |   |   |-- broadcast queue_updated (size - 1)
  |   |   |-- executePrompt(null, projectSlug, sessionId, message.prompt, message.options)
  |   |   |-- (streams to all session watchers)
  |   |-- if queue empty:
  |       |-- done, session goes idle
  |
```

### Reconnect Flow
```
Client                          Server
  |                               |
  |-- (WebSocket connects) ------>|
  |<-- connected {version} -------|
  |-- select_project ------------>|
  |<-- project_selected ----------|
  |-- select_session ------------->|
  |<-- session_selected ----------|
  |<-- task_status ---------------|
  |<-- session_history -----------|
  |<-- queue_state {queue, size} -|  ← NEW: queue state on session load
  |                               |
```

### Cancel During Queue Processing
```
Client                          Server
  |                               |
  |-- cancel_task --------------->|
  |                               |-- abortController.abort()
  |                               |-- task.status = 'cancelled'
  |<-- task_cancelled ------------|
  |<-- task_status {cancelled} ---|
  |                               |-- (queue NOT auto-dequeued)
  |                               |-- queue remains intact
  |                               |
  |   User can then:              |
  |   - Send new prompt → dequeues next from queue first? Or executes new prompt?
  |   - Clear queue               |
  |   - Manually manage queue     |
  |                               |
```

## Open Questions

1. **Cancel behavior**: When user cancels a running task that was dequeued, should the queue pause (recommended) or continue to next message?
2. **New prompt after cancel with existing queue**: If queue has messages and user sends a new prompt after cancel, should it: (a) execute immediately and resume queue after, (b) add to front of queue, or (c) add to end of queue?
3. **Queue size limit**: Should there be a max queue size? (e.g., 20 messages) - defer for now
4. **Queue message options**: Should queued messages inherit the model/permission mode from when they were queued, or use the session's current settings at execution time? (Recommended: use settings from queue time, since user explicitly chose them)
5. **Visual indicator for dequeued message**: Should there be a visual distinction in chat when a message was auto-submitted from queue vs manually sent?
