/**
 * Process Manager
 *
 * Manages spawned processes per project.
 * Persists completed process history to a temp file.
 * Running processes are killed on server restart (keeps things simple, no zombies).
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PROCESS_FILE = '/tmp/cc-web-processes.json';
const MAX_OUTPUT_FOR_FILE = 100; // Limit output saved to file per process
const MAX_HISTORY_PER_PROJECT = 50; // Max completed processes to keep per project
const PROCESS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Auto-cleanup processes older than 24 hours

class ProcessManager {
  // Map<projectSlug, Map<processId, ProcessEntry>>
  projects = new Map();

  // Max output chunks to keep per process (ring buffer)
  maxOutputChunks = 1000;

  // Cleanup interval reference
  cleanupInterval = null;

  // Debounce file saves
  saveTimeout = null;
  saveDelay = 1000; // Save at most once per second

  constructor() {
    // Load persisted history on startup
    this.loadFromFile();
    // Start periodic cleanup (every hour)
    this.cleanupInterval = setInterval(
      () => this.cleanupOldProcesses(),
      60 * 60 * 1000,
    );
  }

  /**
   * Load process history from file on startup
   * Running processes from previous session are marked as killed
   */
  loadFromFile() {
    if (!existsSync(PROCESS_FILE)) {
      return;
    }

    try {
      const data = JSON.parse(readFileSync(PROCESS_FILE, 'utf-8'));

      for (const [projectSlug, processes] of Object.entries(data)) {
        const projectMap = this.getProject(projectSlug);

        for (const entry of processes) {
          // Mark any "running" processes as killed (server restarted)
          if (entry.status === 'running') {
            entry.status = 'killed';
            entry.endedAt = Date.now();
            entry.output.push({
              stream: 'stderr',
              text: '\n[Process killed - server restarted]\n',
              ts: Date.now(),
            });
          }

          entry.proc = null; // No proc reference for restored entries
          projectMap.set(entry.id, entry);
        }
      }

      console.log(`Restored process history from ${PROCESS_FILE}`);
      // Save updated state (with running processes marked as killed)
      this.saveToFileNow();
    } catch (err) {
      console.error('Failed to load process history:', err.message);
    }
  }

  /**
   * Save process state to file (debounced)
   */
  saveToFile() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveToFileNow();
    }, this.saveDelay);
  }

  /**
   * Save process state to file immediately
   */
  saveToFileNow() {
    try {
      const data = {};

      for (const [projectSlug, processMap] of this.projects) {
        const processes = [];
        for (const entry of processMap.values()) {
          // Serialize with limited output for file storage
          processes.push({
            id: entry.id,
            command: entry.command,
            cwd: entry.cwd,
            pid: entry.pid,
            status: entry.status,
            exitCode: entry.exitCode,
            signal: entry.signal,
            output: entry.output.slice(-MAX_OUTPUT_FOR_FILE),
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
          });
        }
        if (processes.length > 0) {
          data[projectSlug] = processes;
        }
      }

      // Ensure directory exists
      mkdirSync(dirname(PROCESS_FILE), { recursive: true });
      writeFileSync(PROCESS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Failed to save process state:', err.message);
    }
  }

  /**
   * Get or create process map for a project
   */
  getProject(slug) {
    if (!this.projects.has(slug)) {
      this.projects.set(slug, new Map());
    }
    return this.projects.get(slug);
  }

  /**
   * Spawn a new process
   * Uses the user's default shell with interactive mode to load rc files
   * @returns {ProcessEntry}
   */
  spawn(projectSlug, { command, cwd }) {
    const id = randomUUID();
    const projectProcesses = this.getProject(projectSlug);

    // Use user's default shell (from $SHELL) with interactive mode
    // -i: interactive (loads .zshrc, .bashrc, etc.)
    // -c: execute command string
    const userShell = process.env.SHELL || '/bin/sh';
    const proc = spawn(userShell, ['-i', '-c', command], {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    });

    const entry = {
      id,
      command,
      cwd,
      proc,
      pid: proc.pid,
      status: 'running', // running | completed | error | killed
      exitCode: null,
      signal: null,
      output: [], // Array of { stream, text, ts }
      startedAt: Date.now(),
      endedAt: null,
    };

    projectProcesses.set(id, entry);
    this.saveToFile();

    // Handle process exit
    proc.on('exit', (code, signal) => {
      entry.status = signal ? 'killed' : code === 0 ? 'completed' : 'error';
      entry.exitCode = code;
      entry.signal = signal;
      entry.endedAt = Date.now();
      entry.proc = null; // Release process reference
      this.saveToFile();
    });

    proc.on('error', (err) => {
      entry.status = 'error';
      entry.endedAt = Date.now();
      this.addOutput(entry, 'stderr', `Error: ${err.message}\n`);
      this.saveToFile();
    });

    return entry;
  }

  /**
   * Add output to a process entry (with ring buffer limit)
   */
  addOutput(entry, stream, text) {
    entry.output.push({
      stream,
      text,
      ts: Date.now(),
    });

    // Trim to max size
    if (entry.output.length > this.maxOutputChunks) {
      entry.output = entry.output.slice(-this.maxOutputChunks);
    }

    // Debounced save (output can be frequent)
    this.saveToFile();
  }

  /**
   * Get a specific process
   */
  getProcess(projectSlug, processId) {
    return this.getProject(projectSlug).get(processId);
  }

  /**
   * List all processes for a project
   */
  listProcesses(projectSlug) {
    const projectProcesses = this.getProject(projectSlug);
    return Array.from(projectProcesses.values());
  }

  /**
   * List only running processes
   */
  listRunning(projectSlug) {
    return this.listProcesses(projectSlug).filter(
      (p) => p.status === 'running',
    );
  }

  /**
   * List only completed/killed processes (history)
   */
  listHistory(projectSlug) {
    return this.listProcesses(projectSlug).filter(
      (p) => p.status !== 'running',
    );
  }

  /**
   * Kill a process
   */
  kill(projectSlug, processId, signal = 'SIGTERM') {
    const entry = this.getProcess(projectSlug, processId);
    if (entry?.proc && entry.status === 'running') {
      entry.proc.kill(signal);
      return true;
    }
    return false;
  }

  /**
   * Remove a specific process from tracking
   */
  remove(projectSlug, processId) {
    const entry = this.getProcess(projectSlug, processId);
    if (entry) {
      // Kill if still running
      if (entry.proc && entry.status === 'running') {
        entry.proc.kill('SIGKILL');
      }
      this.getProject(projectSlug).delete(processId);
      this.saveToFile();
      return true;
    }
    return false;
  }

  /**
   * Clear all completed processes (keep running ones)
   */
  clearHistory(projectSlug) {
    const projectProcesses = this.getProject(projectSlug);
    const toRemove = [];

    for (const [id, entry] of projectProcesses) {
      if (entry.status !== 'running') {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      projectProcesses.delete(id);
    }
    this.saveToFile();
    return toRemove.length;
  }

  /**
   * Cleanup old processes to prevent memory growth
   * - Removes processes older than PROCESS_MAX_AGE_MS
   * - Keeps only MAX_HISTORY_PER_PROJECT most recent completed processes per project
   */
  cleanupOldProcesses() {
    const now = Date.now();
    let totalRemoved = 0;

    for (const [_projectSlug, processMap] of this.projects) {
      const toRemove = [];
      const completed = [];

      for (const [id, entry] of processMap) {
        // Skip running processes
        if (entry.status === 'running') continue;

        // Remove processes older than max age
        if (entry.endedAt && now - entry.endedAt > PROCESS_MAX_AGE_MS) {
          toRemove.push(id);
        } else {
          completed.push({ id, endedAt: entry.endedAt || 0 });
        }
      }

      // If still over limit, remove oldest
      if (completed.length > MAX_HISTORY_PER_PROJECT) {
        completed.sort((a, b) => a.endedAt - b.endedAt);
        const excess = completed.slice(
          0,
          completed.length - MAX_HISTORY_PER_PROJECT,
        );
        for (const { id } of excess) {
          toRemove.push(id);
        }
      }

      for (const id of toRemove) {
        processMap.delete(id);
      }
      totalRemoved += toRemove.length;
    }

    if (totalRemoved > 0) {
      this.saveToFile();
    }

    return totalRemoved;
  }

  /**
   * Serialize a process entry for sending over WebSocket
   * (excludes proc reference)
   */
  serialize(entry) {
    return {
      id: entry.id,
      command: entry.command,
      cwd: entry.cwd,
      pid: entry.pid,
      status: entry.status,
      exitCode: entry.exitCode,
      signal: entry.signal,
      output: entry.output,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    };
  }

  /**
   * Serialize all processes for a project
   */
  serializeAll(projectSlug) {
    return this.listProcesses(projectSlug).map((entry) =>
      this.serialize(entry),
    );
  }
}

// Singleton instance
export default new ProcessManager();
