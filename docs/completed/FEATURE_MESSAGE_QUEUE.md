# Message Queue System

## Status: Completed ✅

## Requirements

- When Claude is running a task, allow users to continue typing and submitting messages
- Submitted messages are queued server-side and processed sequentially (FIFO)
- The chat prompt icon shows a badge with the number of queued messages
- Clicking the badge opens a modal to view and delete queued messages
- When a task completes, the server automatically dequeues the next message and submits it
- Queue persists server-side per session — closing the browser tab does not lose queued messages
- On page load / reconnect, the client receives the current queue state
- Queue count is broadcast to all session watchers as it changes

## Scope

### Implemented
- Server-side message queue per session (in-memory, tied to session lifetime)
- Queue events: auto-enqueue via `prompt`, delete individual item, clear all, get state
- Queue count badge on chat prompt icon (red circle, top-right of icon)
- Queue Manager modal: ordered list with position, prompt preview, model badge, timestamp, per-item delete, Clear All with confirmation
- Auto-processing: server dequeues and executes next message on task completion or error
- Queue pauses on cancel — resumes only when next task completes
- Queue state sent on `select_session` response (reconnect/session switch)
- Queue cleared on session delete
- Max 50 queued messages per session; empty/invalid prompts rejected before enqueue
- `processNextInQueue` deferred to after stream loop exits to prevent double-fire race condition

### Out of Scope (deferred)
- Persistent queue storage to disk
- Message reorder / drag-and-drop
- Edit queued message (race condition risk)
- Queue for new sessions before first session ID is assigned

## Implementation

### New Files
- `server/lib/message-queue.js` — In-memory FIFO queue, Map<sessionId, QueuedMessage[]>; exports `enqueue`, `dequeue`, `getQueue`, `getQueueSize`, `deleteMessage`, `clearQueue`
- `server/events/queue.js` — WebSocket handlers for `queue:delete`, `queue:clear`, `queue:get`
- `src/components/QueueModal.vue` — Queue management modal component

### Modified Files
- `server/events/prompt.js` — Enqueue on running task (instead of error); `processNextInQueue()` after stream loop exits; `sendAndBroadcast` null-guards for ws; `shouldProcessQueue` flag to prevent double-fire race
- `server/events/index.js` — Registered `queue:delete`, `queue:clear`, `queue:get`
- `server/events/select-session.js` — Sends `queue_state` after `session_history`
- `server/events/delete-session.js` — Calls `clearQueue(sessionId)` before `session_deleted` broadcast
- `src/composables/useWebSocket.js` — `queuedMessages`, `queueSize`, `queue_state`/`queue_updated` handlers, `deleteQueuedMessage`, `clearQueuedMessages`, queue reset on session switch / new session
- `src/views/ChatView.vue` — Removed `isRunning` gate from submit; new-session guard; queue badge on prompt icon; `QueueModal` wired up

## Key Design Decisions

- **Auto-enqueue on `prompt` event**: no separate `queue:enqueue` event needed — server decides whether to run or queue
- **processNextInQueue deferred**: called after the for-await loop fully exits (using `shouldProcessQueue` flag), not inside the `result` message handler — prevents double-fire where next task sets `task.status='running'` before the post-loop fallback check
- **ws = null pattern**: queue processing after tab close uses `ws = null`; all `send(ws, ...)` calls in `executePrompt` guard with `if (ws)`
- **Cancel pauses queue**: `processNextInQueue` not called on cancel; also handles timing race where stream drains before abort check runs (via `abortController.signal.aborted` check in post-loop fallback)
- **No edit**: dropped due to race condition risk (item could dequeue mid-edit)
- **Broadcast without excludeWs on enqueue**: sender is a session watcher, so broadcast reaches them directly
