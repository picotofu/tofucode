/**
 * WebSocket Event Handlers: Ports
 *
 * Lists listening TCP ports and allows killing processes by PID.
 */

import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { logger } from '../lib/logger.js';
import { send } from '../lib/ws.js';

/**
 * Parse `ss -tlnpH` output into structured port entries.
 * Rows sharing the same PID+port (dual-stack bindings) are merged into one entry
 * with combined addresses, since killing targets the process not the socket.
 *
 * Example lines:
 *   LISTEN 0  511  0.0.0.0:9000  0.0.0.0:*  users:(("node",pid=1234,fd=22))
 *   LISTEN 0  128  0.0.0.0:22    0.0.0.0:*
 *   LISTEN 0  511  [::1]:5173    [::]:*     users:(("vite",pid=4567,fd=25))
 *
 * @param {string} stdout
 * @returns {{ port: number, pid: number | null, process: string, addresses: string[] }[]}
 */
function parseSsOutput(stdout) {
  // Map of groupKey -> { port, pid, process, addresses: Set }
  const groups = new Map();

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ss -H omits the header; columns: State Recv-Q Send-Q Local Peer [Process]
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const local = parts[3]; // e.g. "0.0.0.0:3000" or "[::1]:5173" or "*:8080"

    let address;
    let port;

    if (local.startsWith('[')) {
      // IPv6: [::1]:5173
      const bracketClose = local.indexOf(']');
      if (bracketClose === -1) continue;
      address = local.slice(0, bracketClose + 1);
      port = Number.parseInt(local.slice(bracketClose + 2), 10);
    } else {
      // IPv4 or wildcard: 0.0.0.0:3000, *:8080
      const colonIdx = local.lastIndexOf(':');
      if (colonIdx === -1) continue;
      address = local.slice(0, colonIdx);
      port = Number.parseInt(local.slice(colonIdx + 1), 10);
    }

    if (Number.isNaN(port)) continue;

    // Extract process info from users:(("name",pid=X,fd=Y)) if present
    // Remaining parts after index 4 may span multiple tokens
    const rest = parts.slice(5).join(' ');
    const usersMatch = rest.match(/users:\(\("([^"]+)",pid=(\d+)/);

    const pid = usersMatch ? Number.parseInt(usersMatch[2], 10) : null;
    const processName = usersMatch ? usersMatch[1] : '—';

    // Group key: same PID+port = same process with dual-stack bindings
    // For unknown PIDs, treat each address as its own row
    const key = pid !== null ? `${pid}:${port}` : `addr:${address}:${port}`;

    if (groups.has(key)) {
      groups.get(key).addresses.add(address);
    } else {
      groups.set(key, {
        port,
        pid,
        process: processName,
        addresses: new Set([address]),
      });
    }
  }

  // Flatten groups and sort by port ascending
  return [...groups.values()]
    .map(({ addresses, ...rest }) => ({ ...rest, addresses: [...addresses] }))
    .sort((a, b) => a.port - b.port);
}

/**
 * Read the full command line for a PID from /proc/<pid>/cmdline.
 * Returns null if unreadable (root-owned or already exited).
 * @param {number} pid
 * @returns {Promise<string | null>}
 */
async function readCmdline(pid) {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    // null bytes separate argv entries — replace with spaces
    return raw.replace(/\0+$/, '').replace(/\0/g, ' ').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read the current working directory for a PID from /proc/<pid>/cwd.
 * Returns null if unreadable (root-owned or already exited).
 * @param {number} pid
 * @returns {Promise<string | null>}
 */
async function readCwd(pid) {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/**
 * Scan listening TCP ports using ss, enriched with /proc cmdline details.
 * @returns {Promise<{ port: number, pid: number | null, process: string, cmd: string | null, cwd: string | null, addresses: string[] }[]>}
 */
async function scanPorts() {
  const stdout = await new Promise((resolve, reject) => {
    execFile('ss', ['-tlnpH'], { timeout: 5000 }, (err, out, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(out || '');
    });
  });

  const entries = parseSsOutput(stdout);

  // Enrich with cmdline + cwd in parallel — one read per unique PID
  const uniquePids = [
    ...new Set(entries.map((e) => e.pid).filter((p) => p !== null)),
  ];
  const [cmdlineMap, cwdMap] = await Promise.all([
    Promise.all(
      uniquePids.map(async (pid) => [pid, await readCmdline(pid)]),
    ).then((r) => new Map(r)),
    Promise.all(uniquePids.map(async (pid) => [pid, await readCwd(pid)])).then(
      (r) => new Map(r),
    ),
  ]);

  return entries.map((entry) => ({
    ...entry,
    cmd: entry.pid !== null ? (cmdlineMap.get(entry.pid) ?? null) : null,
    cwd: entry.pid !== null ? (cwdMap.get(entry.pid) ?? null) : null,
  }));
}

/**
 * Event: ports:list
 * Lists all TCP ports currently in LISTEN state with their owning process.
 *
 * Sends:
 * - ports:list:result { ports: Array<{ port, pid, process, cmd, cwd, addresses }> }
 * - ports:list:error { error: string }
 */
export async function handlePortsList(ws) {
  try {
    const ports = await scanPorts();
    send(ws, { type: 'ports:list:result', ports });
  } catch (err) {
    logger.error('ports:list failed:', err.message);
    send(ws, { type: 'ports:list:error', error: 'Failed to scan ports' });
  }
}

/**
 * Event: ports:kill
 * Kills a process by PID using SIGTERM.
 *
 * Payload: { pid: number }
 *
 * Sends:
 * - ports:kill:result { pid: number }
 * - ports:kill:error { pid: number, error: string }
 */
export function handlePortsKill(ws, payload) {
  const { pid } = payload ?? {};

  if (typeof pid !== 'number' || Number.isNaN(pid)) {
    send(ws, { type: 'ports:kill:error', pid, error: 'Invalid PID' });
    return;
  }

  // Guard: never kill init/kernel processes
  if (pid <= 1) {
    send(ws, {
      type: 'ports:kill:error',
      pid,
      error: 'Cannot kill system process',
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    logger.info(`ports:kill pid=${pid} SIGTERM sent`);
    send(ws, { type: 'ports:kill:result', pid });
  } catch (err) {
    const error = err.code === 'ESRCH' ? 'Process not found' : 'Kill failed';
    logger.error(`ports:kill pid=${pid} failed:`, err.message);
    send(ws, { type: 'ports:kill:error', pid, error });
  }
}
