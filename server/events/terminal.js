/**
 * Terminal WebSocket Event Handlers
 *
 * Provides command execution and process management capabilities.
 */

import path from 'node:path';
import { config, slugToPath } from '../config.js';
import processManager from '../lib/processManager.js';
import { getTerminalCounts } from '../lib/terminalUtils.js';
import { broadcast, send } from '../lib/ws.js';

// Debounce timer for terminal count broadcasts
let broadcastTimer = null;
const BROADCAST_DEBOUNCE_MS = 100; // 100ms debounce to prevent spam during high process churn

/**
 * Broadcast terminal count update to all clients (debounced)
 */
function broadcastTerminalCounts() {
  // Clear existing timer
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
  }

  // Schedule broadcast
  broadcastTimer = setTimeout(() => {
    const terminalCounts = getTerminalCounts();
    broadcast({ type: 'terminal_counts', terminalCounts });
    broadcastTimer = null;
  }, BROADCAST_DEBOUNCE_MS);
}

/**
 * Event: terminal:exec
 *
 * Execute a shell command in the project directory.
 *
 * @event terminal:exec
 * @param {Object} message - { command: string, cwd?: string }
 * @returns {void} Sends: terminal:started, terminal:output (streamed), terminal:exit
 */
// Max command length to prevent abuse
const MAX_COMMAND_LENGTH = 10000;

export function execHandler(ws, message, context) {
  const { command, cwd } = message;
  const projectSlug = context.currentProjectPath;

  if (!projectSlug) {
    send(ws, { type: 'terminal:error', error: 'No project selected' });
    return;
  }

  if (!command || typeof command !== 'string') {
    send(ws, { type: 'terminal:error', error: 'Command is required' });
    return;
  }

  if (command.length > MAX_COMMAND_LENGTH) {
    send(ws, {
      type: 'terminal:error',
      error: `Command too long (max ${MAX_COMMAND_LENGTH} chars)`,
    });
    return;
  }

  // Resolve working directory
  const projectPath = slugToPath(projectSlug);
  const workingDir = cwd || projectPath;

  // Best effort: validate CWD is within root (if --root is set)
  if (config.rootPath) {
    const resolvedCwd = path.resolve(workingDir);
    const resolvedRoot = path.resolve(config.rootPath);
    const relativePath = path.relative(resolvedRoot, resolvedCwd);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      send(ws, {
        type: 'terminal:error',
        error: `Access denied: working directory outside root (${config.rootPath})`,
      });
      return;
    }

    // Warning: Commands can still access files outside root using absolute paths
    // This is best-effort protection. Use Docker for full isolation.
  }

  // Spawn the process
  const entry = processManager.spawn(projectSlug, {
    command: command.trim(),
    cwd: workingDir,
  });

  // Notify client that process started
  send(ws, {
    type: 'terminal:started',
    process: processManager.serialize(entry),
  });

  // Broadcast terminal count update to all clients
  broadcastTerminalCounts();

  // Stream stdout
  entry.proc.stdout.on('data', (data) => {
    const text = data.toString();
    processManager.addOutput(entry, 'stdout', text);

    send(ws, {
      type: 'terminal:output',
      processId: entry.id,
      stream: 'stdout',
      data: text,
    });
  });

  // Stream stderr
  entry.proc.stderr.on('data', (data) => {
    const text = data.toString();
    processManager.addOutput(entry, 'stderr', text);

    send(ws, {
      type: 'terminal:output',
      processId: entry.id,
      stream: 'stderr',
      data: text,
    });
  });

  // Notify on exit
  entry.proc.on('exit', (code, signal) => {
    send(ws, {
      type: 'terminal:exit',
      processId: entry.id,
      code,
      signal,
      status: entry.status,
    });

    // Broadcast terminal count update to all clients
    broadcastTerminalCounts();
  });
}

/**
 * Event: terminal:kill
 *
 * Kill a running process.
 *
 * @event terminal:kill
 * @param {Object} message - { processId: string, signal?: string }
 * @returns {void} Sends: terminal:killed
 */
export function killHandler(ws, message, context) {
  const { processId, signal } = message;
  const projectSlug = context.currentProjectPath;

  if (!projectSlug) {
    send(ws, { type: 'terminal:error', error: 'No project selected' });
    return;
  }

  if (!processId) {
    send(ws, { type: 'terminal:error', error: 'Process ID is required' });
    return;
  }

  const killed = processManager.kill(
    projectSlug,
    processId,
    signal || 'SIGTERM',
  );

  send(ws, {
    type: 'terminal:killed',
    processId,
    success: killed,
  });
}

/**
 * Event: terminal:list
 *
 * List all processes for the current project.
 *
 * @event terminal:list
 * @param {Object} message - {}
 * @returns {void} Sends: terminal:processes
 */
export function listHandler(ws, _message, context) {
  const projectSlug = context.currentProjectPath;

  if (!projectSlug) {
    send(ws, { type: 'terminal:error', error: 'No project selected' });
    return;
  }

  const processes = processManager.serializeAll(projectSlug);

  send(ws, {
    type: 'terminal:processes',
    processes,
  });
}

/**
 * Event: terminal:clear
 *
 * Clear completed processes from history.
 *
 * @event terminal:clear
 * @param {Object} message - { processId?: string } - if provided, clears specific process
 * @returns {void} Sends: terminal:cleared, terminal:processes
 */
export function clearHandler(ws, message, context) {
  const { processId } = message;
  const projectSlug = context.currentProjectPath;

  if (!projectSlug) {
    send(ws, { type: 'terminal:error', error: 'No project selected' });
    return;
  }

  if (processId) {
    // Remove specific process
    const removed = processManager.remove(projectSlug, processId);
    send(ws, {
      type: 'terminal:cleared',
      processId,
      success: removed,
    });
  } else {
    // Clear all completed
    const count = processManager.clearHistory(projectSlug);
    send(ws, {
      type: 'terminal:cleared',
      count,
    });
  }

  // Send updated process list
  send(ws, {
    type: 'terminal:processes',
    processes: processManager.serializeAll(projectSlug),
  });
}
