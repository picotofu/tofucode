#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Default PID file location
const DEFAULT_PID_FILE = join(homedir(), '.cc-web', 'cc-web.pid');

// Parse command line arguments
const args = process.argv.slice(2);

// Handle --version flag early
if (args.includes('--version') || args.includes('-v')) {
  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(`cc-web v${pkg.version}`);
  process.exit(0);
}

// Handle lifecycle commands early (--stop, --restart, --status)
if (args.includes('--stop')) {
  await handleStop();
  process.exit(0);
}

if (args.includes('--restart')) {
  await handleRestart();
  process.exit(0);
}

if (args.includes('--status')) {
  await handleStatus();
  process.exit(0);
}

const options = {
  port: 3000,
  host: '0.0.0.0',
  auth: true,
  daemon: false,
  debug: false,
  quiet: false,
  logFile: null,
  pidFile: DEFAULT_PID_FILE,
  config: null,
  bypassToken: null,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    options.port = parseInt(args[++i], 10);
  } else if (arg === '--host' || arg === '-h') {
    options.host = args[++i];
  } else if (arg === '--no-auth') {
    options.auth = false;
  } else if (arg === '--daemon' || arg === '-d') {
    options.daemon = true;
  } else if (arg === '--debug') {
    options.debug = true;
  } else if (arg === '--quiet' || arg === '-q') {
    options.quiet = true;
  } else if (arg === '--log-file') {
    options.logFile = args[++i];
  } else if (arg === '--pid-file') {
    options.pidFile = args[++i];
  } else if (arg === '--config' || arg === '-c') {
    options.config = args[++i];
  } else if (arg === '--bypass-token') {
    options.bypassToken = args[++i];
  } else if (arg === '--help') {
    console.log(`
cc-web - Web UI for Claude Code

Usage:
  cc-web [options]
  cc-web --stop              Stop running daemon
  cc-web --restart           Restart running daemon
  cc-web --status            Check daemon status

Options:
  -p, --port <port>          Port to listen on (default: 3000)
  -h, --host <host>          Host to bind to (default: 0.0.0.0)
  --no-auth                  Disable password authentication
  -d, --daemon               Run as background daemon
  --debug                    Enable debug logging
  -q, --quiet                Suppress output (except errors)
  --log-file <path>          Custom log file path (default: cc-web.log)
  --pid-file <path>          Custom PID file path (default: ~/.cc-web/cc-web.pid)
  -c, --config <path>        Load configuration from JSON file
  --bypass-token <token>     Set bypass token for auth-free access (automation/testing)
  -v, --version              Show version number
  --help                     Show this help message

Daemon Management:
  --stop                     Stop running daemon (uses PID file)
  --restart                  Restart running daemon
  --status                   Check if daemon is running

Environment Variables:
  PORT                       Alternative way to set port
  HOST                       Alternative way to set host
  AUTH_DISABLED              Set to 'true' to disable auth
  DEBUG                      Set to 'true' to enable debug mode
  LOG_FILE                   Custom log file path
  PID_FILE                   Custom PID file path
  DEBUG_TOKEN                Bypass token for auth-free access (automation/testing)

Configuration File:
  Use --config to load settings from a JSON file. CLI args override config.

  Example config.json:
  {
    "port": 8080,
    "host": "127.0.0.1",
    "auth": false,
    "debug": true,
    "bypassToken": "your-secret-token"
  }

Examples:
  cc-web                           # Start on http://0.0.0.0:3000
  cc-web -p 8080                   # Start on port 8080
  cc-web --no-auth                 # Disable authentication
  cc-web -d                        # Run as background daemon
  cc-web -d --debug                # Daemon with debug logging
  cc-web --config prod.json -d     # Use config file + daemon mode
  cc-web --stop                    # Stop running daemon
  cc-web --status                  # Check daemon status
`);
    process.exit(0);
  }
}

// Load config file if specified
if (options.config) {
  await loadConfig(options);
}

// Check if dist folder exists
const distPath = join(rootDir, 'dist');
if (!existsSync(distPath)) {
  console.error('Error: Frontend build not found.');
  console.error('This usually means the package was not built correctly.');
  console.error('');
  console.error('If you installed from npm, please report this issue.');
  console.error('If running from source, run: npm run build');
  process.exit(1);
}

// Set environment variables
const env = {
  ...process.env,
  PORT: options.port.toString(),
  HOST: options.host,
};

if (!options.auth) {
  env.AUTH_DISABLED = 'true';
}

if (options.debug) {
  env.DEBUG = 'true';
}

if (options.logFile) {
  env.LOG_FILE = resolve(options.logFile);
}

if (options.bypassToken) {
  env.DEBUG_TOKEN = options.bypassToken;
}

// Start the server
if (!options.quiet) {
  console.log(`Starting cc-web on http://${options.host}:${options.port}`);
  if (!options.auth) {
    console.log('Authentication disabled');
  }
  if (options.debug) {
    console.log('Debug mode enabled');
  }
  console.log('');
}

const serverPath = join(rootDir, 'server', 'index.js');

if (options.daemon) {
  // Daemon mode: detached process
  const logPath = options.logFile ? resolve(options.logFile) : join(process.cwd(), 'cc-web.log');
  const { openSync, closeSync, mkdirSync } = await import('fs');

  // Ensure PID file directory exists
  const pidDir = dirname(options.pidFile);
  if (!existsSync(pidDir)) {
    mkdirSync(pidDir, { recursive: true });
  }

  const out = openSync(logPath, 'a');
  const err = openSync(logPath, 'a');

  const server = spawn('node', [serverPath], {
    cwd: rootDir,
    env,
    detached: true,
    stdio: ['ignore', out, err],
  });

  server.unref();
  closeSync(out);
  closeSync(err);

  // Write PID file
  try {
    writeFileSync(options.pidFile, server.pid.toString(), 'utf8');
  } catch (err) {
    console.error(`Warning: Failed to write PID file: ${err.message}`);
  }

  if (!options.quiet) {
    console.log(`cc-web started as daemon (PID: ${server.pid})`);
    console.log(`Logs: ${logPath}`);
    console.log(`PID file: ${options.pidFile}`);
    console.log(`\nTo manage:`);
    console.log(`  cc-web --status    # Check status`);
    console.log(`  cc-web --stop      # Stop daemon`);
    console.log(`  cc-web --restart   # Restart daemon`);
  }
  process.exit(0);
} else {
  // Foreground mode: inherit stdio
  const server = spawn('node', [serverPath], {
    cwd: rootDir,
    env,
    stdio: options.quiet ? 'ignore' : 'inherit',
  });

  server.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  server.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Handle termination signals
  process.on('SIGINT', () => {
    server.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    server.kill('SIGTERM');
  });
}

// Helper functions

async function loadConfig(options) {
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const configContent = readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);

    // Apply config values if not overridden by CLI args
    // CLI args have priority over config file
    const argSet = new Set(args);

    if (config.port !== undefined && !argSet.has('--port') && !argSet.has('-p')) {
      options.port = config.port;
    }
    if (config.host !== undefined && !argSet.has('--host') && !argSet.has('-h')) {
      options.host = config.host;
    }
    if (config.auth !== undefined && !argSet.has('--no-auth')) {
      options.auth = config.auth;
    }
    if (config.debug !== undefined && !argSet.has('--debug')) {
      options.debug = config.debug;
    }
    if (config.daemon !== undefined && !argSet.has('--daemon') && !argSet.has('-d')) {
      options.daemon = config.daemon;
    }
    if (config.logFile !== undefined && !argSet.has('--log-file')) {
      options.logFile = config.logFile;
    }
    if (config.pidFile !== undefined && !argSet.has('--pid-file')) {
      options.pidFile = config.pidFile;
    }
    if (config.quiet !== undefined && !argSet.has('--quiet') && !argSet.has('-q')) {
      options.quiet = config.quiet;
    }
    if (config.bypassToken !== undefined && !argSet.has('--bypass-token')) {
      options.bypassToken = config.bypassToken;
    }

    if (!options.quiet) {
      console.log(`Loaded config from: ${configPath}`);
    }
  } catch (err) {
    console.error(`Error: Failed to parse config file: ${err.message}`);
    process.exit(1);
  }
}

async function handleStop() {
  const pidFile = getPidFile();

  if (!existsSync(pidFile)) {
    console.error('Error: PID file not found. Is cc-web running as daemon?');
    console.error(`Expected: ${pidFile}`);
    process.exit(1);
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);

    // Check if process exists
    try {
      process.kill(pid, 0);
    } catch (err) {
      console.error(`Error: Process ${pid} not found (stale PID file)`);
      unlinkSync(pidFile);
      process.exit(1);
    }

    // Send SIGTERM
    console.log(`Stopping cc-web (PID: ${pid})...`);
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit (max 10 seconds)
    let attempts = 0;
    while (attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        process.kill(pid, 0);
        attempts++;
      } catch (err) {
        // Process no longer exists
        console.log('cc-web stopped successfully');
        unlinkSync(pidFile);
        return;
      }
    }

    // Force kill if still running
    console.log('Process did not stop gracefully, forcing...');
    process.kill(pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 1000));
    unlinkSync(pidFile);
    console.log('cc-web stopped (forced)');
  } catch (err) {
    console.error(`Error: Failed to stop cc-web: ${err.message}`);
    process.exit(1);
  }
}

async function handleRestart() {
  const pidFile = getPidFile();

  if (existsSync(pidFile)) {
    console.log('Stopping existing daemon...');
    await handleStop();
    console.log('');
  } else {
    console.log('No running daemon found');
  }

  console.log('Starting cc-web...');

  // Re-parse args without --restart and add --daemon
  const newArgs = args.filter(arg => arg !== '--restart');
  if (!newArgs.includes('--daemon') && !newArgs.includes('-d')) {
    newArgs.push('--daemon');
  }

  // Spawn new instance
  const cliPath = fileURLToPath(import.meta.url);
  spawn('node', [cliPath, ...newArgs], {
    detached: true,
    stdio: 'inherit',
  }).unref();
}

async function handleStatus() {
  const pidFile = getPidFile();

  if (!existsSync(pidFile)) {
    console.log('Status: Not running (no PID file found)');
    console.log(`PID file: ${pidFile}`);
    process.exit(1);
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);

    // Check if process exists
    try {
      process.kill(pid, 0);
      console.log('Status: Running');
      console.log(`PID: ${pid}`);
      console.log(`PID file: ${pidFile}`);
      process.exit(0);
    } catch (err) {
      console.log('Status: Not running (stale PID file)');
      console.log(`PID file: ${pidFile} (stale, cleaning up...)`);
      unlinkSync(pidFile);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: Failed to read PID file: ${err.message}`);
    process.exit(1);
  }
}

function getPidFile() {
  // Check if --pid-file was specified
  const pidIndex = args.indexOf('--pid-file');
  if (pidIndex !== -1 && args[pidIndex + 1]) {
    return resolve(args[pidIndex + 1]);
  }

  // Check environment variable
  if (process.env.PID_FILE) {
    return resolve(process.env.PID_FILE);
  }

  return DEFAULT_PID_FILE;
}
