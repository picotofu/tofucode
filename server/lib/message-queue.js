/**
 * Message queue - per-session FIFO queue for prompts submitted while Claude is running.
 * In-memory only; queue is lost on server restart (acceptable for MVP).
 */

const MAX_QUEUE_SIZE = 50;

// Map<sessionId, QueuedMessage[]>
const sessionQueues = new Map();

let _idCounter = 0;
function generateId() {
  return `q-${Date.now()}-${++_idCounter}`;
}

/**
 * Add a message to the end of the session queue.
 * @param {string} sessionId
 * @param {string} prompt
 * @param {object} options - { model, permissionMode, dangerouslySkipPermissions }
 * @returns {{ ok: true, msg: object } | { ok: false, error: string }}
 */
export function enqueue(sessionId, prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return { ok: false, error: 'Prompt must be a non-empty string' };
  }
  if (!sessionQueues.has(sessionId)) {
    sessionQueues.set(sessionId, []);
  }
  const queue = sessionQueues.get(sessionId);
  if (queue.length >= MAX_QUEUE_SIZE) {
    return {
      ok: false,
      error: `Queue is full (max ${MAX_QUEUE_SIZE} messages)`,
    };
  }
  const msg = {
    id: generateId(),
    prompt,
    options,
    queuedAt: new Date().toISOString(),
  };
  queue.push(msg);
  return { ok: true, msg };
}

/**
 * Remove and return the first message in the queue, or null if empty.
 * @param {string} sessionId
 * @returns {object|null}
 */
export function dequeue(sessionId) {
  const queue = sessionQueues.get(sessionId);
  if (!queue || queue.length === 0) return null;
  return queue.shift();
}

/**
 * Return a shallow copy of the current queue (non-destructive).
 * @param {string} sessionId
 * @returns {object[]}
 */
export function getQueue(sessionId) {
  return [...(sessionQueues.get(sessionId) || [])];
}

/**
 * Return the number of queued messages.
 * @param {string} sessionId
 * @returns {number}
 */
export function getQueueSize(sessionId) {
  return (sessionQueues.get(sessionId) || []).length;
}

/**
 * Remove a specific message by ID.
 * @param {string} sessionId
 * @param {string} messageId
 * @returns {boolean} Whether a message was removed
 */
export function deleteMessage(sessionId, messageId) {
  const queue = sessionQueues.get(sessionId);
  if (!queue) return false;
  const before = queue.length;
  const filtered = queue.filter((m) => m.id !== messageId);
  sessionQueues.set(sessionId, filtered);
  return filtered.length < before;
}

/**
 * Clear all queued messages for a session.
 * @param {string} sessionId
 */
export function clearQueue(sessionId) {
  sessionQueues.delete(sessionId);
}
