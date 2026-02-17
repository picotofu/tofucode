#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Default PID file location
const DEFAULT_PID_FILE = join(homedir(), '.tofucode', 'tofucode.pid');

// Parse command line arguments
const args = process.argv.slice(2);

// Handle --version flag early
if (args.includes('--version') || args.includes('-v')) {
  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(`tofucode v${pkg.version}`);
  process.exit(0);
}

// Parse command (new subcommand syntax: tofucode start|stop|restart|status)
// Default to 'start' if first arg starts with '-' or no args provided
let command = 'start';
let commandArgs = args;

if (args.length > 0 && !args[0].startsWith('-')) {
  const possibleCommand = args[0].toLowerCase();
  if (['start', 'stop', 'restart', 'status'].includes(possibleCommand)) {
    command = possibleCommand;
    commandArgs = args.slice(1); // Remove command from args
  }
}

// Handle lifecycle commands (subcommands or legacy flags)
if (command === 'stop' || args.includes('--stop')) {
  await handleStop();
  process.exit(0);
}

if (command === 'restart' || args.includes('--restart')) {
  await handleRestart();
  process.exit(0);
}

if (command === 'status' || args.includes('--status')) {
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
  root: null,
  discord: false,
  discordToken: null,
  discordGuildId: null,
  discordStatus: null,
};

// Parse options from commandArgs (after removing subcommand if present)
for (let i = 0; i < commandArgs.length; i++) {
  const arg = commandArgs[i];
  if (arg === '--port' || arg === '-p') {
    options.port = parseInt(commandArgs[++i], 10);
  } else if (arg === '--host' || arg === '-h') {
    options.host = commandArgs[++i];
  } else if (arg === '--no-auth') {
    options.auth = false;
  } else if (arg === '--daemon' || arg === '-d') {
    options.daemon = true;
  } else if (arg === '--debug') {
    options.debug = true;
  } else if (arg === '--quiet' || arg === '-q') {
    options.quiet = true;
  } else if (arg === '--log-file') {
    options.logFile = commandArgs[++i];
  } else if (arg === '--pid-file') {
    options.pidFile = commandArgs[++i];
  } else if (arg === '--config' || arg === '-c') {
    options.config = commandArgs[++i];
  } else if (arg === '--bypass-token') {
    options.bypassToken = commandArgs[++i];
  } else if (arg === '--root') {
    options.root = resolve(commandArgs[++i]);
  } else if (arg === '--discord') {
    options.discord = true;
  } else if (arg === '--help') {
    console.log(`
tofucode - Web UI for Claude Code

Usage:
  tofucode [start] [options]   Start server (default command)
  tofucode stop                Stop running daemon
  tofucode restart             Restart running daemon
  tofucode status              Check daemon status

Options (for start command):
  -p, --port <port>          Port to listen on (default: 3000)
  -h, --host <host>          Host to bind to (default: 0.0.0.0)
  --no-auth                  Disable password authentication
  -d, --daemon               Run as background daemon
  --debug                    Enable debug logging
  -q, --quiet                Suppress output (except errors)
  --log-file <path>          Custom log file path (default: ~/.tofucode/tofucode.log)
  --pid-file <path>          Custom PID file path (default: ~/.tofucode/tofucode.pid)
  -c, --config <path>        Load configuration from JSON file
  --bypass-token <token>     Set bypass token for auth-free access (automation/testing)
  --root <path>              Restrict access to specified directory (best effort)
  --discord                  Enable Discord bot integration
  -v, --version              Show version number
  --help                     Show this help message

Lifecycle Commands:
  start                      Start server (default)
  stop                       Stop running daemon
  restart                    Restart running daemon
  status                     Check daemon status

  Legacy flags (deprecated):
  --stop, --restart, --status   Old flag syntax (still supported)

Environment Variables:
  PORT                       Alternative way to set port
  HOST                       Alternative way to set host
  AUTH_DISABLED              Set to 'true' to disable auth
  DEBUG                      Set to 'true' to enable debug mode
  LOG_FILE                   Custom log file path
  PID_FILE                   Custom PID file path
  DEBUG_TOKEN                Bypass token for auth-free access (automation/testing)
  MODEL_HAIKU_SLUG           Claude Haiku model ID (default: claude-haiku-4-5)
  MODEL_SONNET_SLUG          Claude Sonnet model ID (default: claude-sonnet-4-6)
  MODEL_OPUS_SLUG            Claude Opus model ID (default: claude-opus-4-6)

Configuration File:
  Use --config to load settings from a JSON file. CLI args override config.

  Example config.json:
  {
    "port": 8080,
    "host": "127.0.0.1",
    "auth": false,
    "debug": true,
    "bypassToken": "your-secret-token",
    "root": "/path/to/project",
    "discord": true,
    "discordToken": "your-discord-bot-token",
    "discordGuildId": "your-guild-id"
  }

Examples:
  tofucode                           # Start on http://0.0.0.0:3000
  tofucode start -p 8080             # Start on port 8080
  tofucode start --no-auth           # Disable authentication
  tofucode start -d                  # Run as background daemon
  tofucode start -d --debug          # Daemon with debug logging
  tofucode start --config prod.json -d   # Use config file + daemon mode
  tofucode start --root /path/to/project # Restrict to specific directory
  tofucode stop                      # Stop running daemon
  tofucode restart                   # Restart running daemon
  tofucode status                    # Check daemon status

Security:
  --root restricts file and terminal access to the specified directory on a
  best-effort basis. For full isolation, use Docker with bind mounts.
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

// Guard: Check if port is already in use (unless upgrade mode)
if (!process.env.IS_RESTART || process.env.UPGRADE_RETRY_BIND !== 'true') {
  const { createServer } = await import('net');
  const testServer = createServer();

  try {
    await new Promise((resolve, reject) => {
      testServer.once('error', reject);
      testServer.once('listening', () => {
        testServer.close();
        resolve();
      });
      testServer.listen(options.port);
    });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${options.port} is already in use.`);
      console.error('');
      console.error('Solutions:');
      console.error(`  1. Stop the existing process: tofucode stop`);
      console.error(`  2. Use a different port: tofucode start -p <other-port>`);
      console.error(`  3. Find what's using it: lsof -i :${options.port}`);
      process.exit(1);
    }
    // Other errors are fine, let the server handle them
  }
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

if (options.root) {
  env.ROOT_PATH = options.root;
}

// Model configuration from config file
if (options.models) {
  if (options.models.haiku) {
    env.MODEL_HAIKU_SLUG = options.models.haiku;
  }
  if (options.models.sonnet) {
    env.MODEL_SONNET_SLUG = options.models.sonnet;
  }
  if (options.models.opus) {
    env.MODEL_OPUS_SLUG = options.models.opus;
  }
}

if (options.discord) {
  env.DISCORD_ENABLED = 'true';
}

if (options.discordToken) {
  env.DISCORD_BOT_TOKEN = options.discordToken;
}

if (options.discordGuildId) {
  env.DISCORD_GUILD_ID = options.discordGuildId;
}

if (options.discordStatus) {
  env.DISCORD_STATUS = options.discordStatus;
}

// Pass PID file path to server (for restart to update it)
if (options.pidFile) {
  env.PID_FILE = resolve(options.pidFile);
}

// Start the server
if (!options.quiet) {
  console.log(`Starting tofucode on http://${options.host}:${options.port}`);
  if (!options.auth) {
    console.log('Authentication disabled');
  }
  if (options.debug) {
    console.log('Debug mode enabled');
  }
  if (options.root) {
    console.log(`Restricted mode: ${options.root} (best effort)`);
  }
  if (options.discord) {
    console.log('Discord bot integration enabled');
  }
  console.log('');
}

const serverPath = join(rootDir, 'server', 'index.js');

if (options.daemon) {
  // Daemon mode: detached process
  const defaultLogPath = join(homedir(), '.tofucode', 'tofucode.log');
  const logPath = options.logFile ? resolve(options.logFile) : defaultLogPath;
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
    console.log(`tofucode started as daemon (PID: ${server.pid})`);
    console.log(`Logs: ${logPath}`);
    console.log(`PID file: ${options.pidFile}`);
    console.log(`\nTo manage:`);
    console.log(`  tofucode --status    # Check status`);
    console.log(`  tofucode --stop      # Stop daemon`);
    console.log(`  tofucode --restart   # Restart daemon`);
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
    if (config.root !== undefined && !argSet.has('--root')) {
      options.root = resolve(config.root);
    }
    if (config.discord !== undefined && !argSet.has('--discord')) {
      options.discord = config.discord;
    }
    if (config.discordToken !== undefined) {
      options.discordToken = config.discordToken;
    }
    if (config.discordGuildId !== undefined) {
      options.discordGuildId = config.discordGuildId;
    }
    if (config.discordStatus !== undefined) {
      options.discordStatus = config.discordStatus;
    }

    // Model configuration (store for later env setup)
    if (config.models) {
      options.models = config.models;
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
    console.error('Error: PID file not found. Is tofucode running as daemon?');
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
    console.log(`Stopping tofucode (PID: ${pid})...`);
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
        console.log('tofucode stopped successfully');
        unlinkSync(pidFile);
        return;
      }
    }

    // Force kill if still running
    console.log('Process did not stop gracefully, forcing...');
    process.kill(pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 1000));
    unlinkSync(pidFile);
    console.log('tofucode stopped (forced)');
  } catch (err) {
    console.error(`Error: Failed to stop tofucode: ${err.message}`);
    process.exit(1);
  }
}

async function handleRestart() {
  const pidFile = getPidFile();
  const restartLockFile = join(dirname(pidFile), 'tofucode.restart.lock');

  // Guard: Check if restart is already in progress
  if (existsSync(restartLockFile)) {
    const lockAge = Date.now() - statSync(restartLockFile).mtimeMs;
    if (lockAge < 30000) {
      // Lock less than 30 seconds old
      console.error('Error: Restart already in progress (lock file exists)');
      console.error(`Lock file: ${restartLockFile}`);
      console.error('If stuck, remove lock file manually or wait 30 seconds');
      process.exit(1);
    } else {
      // Stale lock, remove it
      console.log('Removing stale restart lock...');
      unlinkSync(restartLockFile);
    }
  }

  // Create restart lock
  try {
    writeFileSync(restartLockFile, Date.now().toString(), 'utf8');
  } catch (err) {
    console.error(`Error: Failed to create restart lock: ${err.message}`);
    process.exit(1);
  }

  try {
    if (existsSync(pidFile)) {
      console.log('Stopping existing daemon...');
      await handleStop();
      console.log('');
    } else {
      console.log('No running daemon found');
    }

    console.log('Starting tofucode...');

    // Re-parse args without --restart and add --daemon
    const newArgs = args.filter(arg => arg !== '--restart' && arg !== 'restart');
    if (!newArgs.includes('--daemon') && !newArgs.includes('-d')) {
      newArgs.push('--daemon');
    }

    // Spawn new CLI instance (not detached) so we can see startup errors
    // The new CLI will handle daemon spawning with proper detachment
    const cliPath = fileURLToPath(import.meta.url);
    const child = spawn('node', [cliPath, 'start', ...newArgs], {
      stdio: 'inherit',
    });

    // Wait for new CLI to exit (it will exit after spawning daemon)
    child.on('exit', (code) => {
      // Remove restart lock
      try {
        if (existsSync(restartLockFile)) {
          unlinkSync(restartLockFile);
        }
      } catch (err) {
        console.error(`Warning: Failed to remove restart lock: ${err.message}`);
      }

      if (code === 0) {
        console.log('Restart completed successfully');
      } else {
        console.error(`Restart failed with exit code ${code}`);
      }
      process.exit(code || 0);
    });
  } catch (err) {
    // Remove restart lock on error
    try {
      if (existsSync(restartLockFile)) {
        unlinkSync(restartLockFile);
      }
    } catch (_err) {
      // Ignore cleanup errors
    }
    throw err;
  }
}

async function handleStatus() {
  const pidFile = getPidFile();

  if (!existsSync(pidFile)) {
    console.log('Status: Not running (no PID file found)');
    console.log(`Expected PID file: ${pidFile}`);
    console.log(`Default log file: ${join(homedir(), '.tofucode', 'tofucode.log')}`);
    process.exit(1);
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);

    // Check if process exists
    try {
      process.kill(pid, 0);
      console.log('Status: Running ✓');
      console.log('');
      console.log('Process Information:');
      console.log(`  PID: ${pid}`);
      console.log(`  PID file: ${pidFile}`);

      // Try to read process environment (Linux only)
      const envPath = `/proc/${pid}/environ`;
      if (existsSync(envPath)) {
        try {
          const environ = readFileSync(envPath, 'utf8');
          const env = {};
          environ.split('\0').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key) env[key] = valueParts.join('=');
          });

          console.log('');
          console.log('Configuration:');
          console.log(`  Port: ${env.PORT || '3000'}`);
          console.log(`  Host: ${env.HOST || '0.0.0.0'}`);
          console.log(`  Auth: ${env.AUTH_DISABLED === 'true' ? 'Disabled' : 'Enabled'}`);
          console.log(`  Debug: ${env.DEBUG === 'true' ? 'Enabled' : 'Disabled'}`);

          if (env.ROOT_PATH) {
            console.log(`  Root path: ${env.ROOT_PATH}`);
          }

          const logFile = env.LOG_FILE || join(homedir(), '.tofucode', 'tofucode.log');
          console.log(`  Log file: ${logFile}`);

          if (env.DEBUG_TOKEN) {
            console.log(`  Bypass token: ${env.DEBUG_TOKEN.slice(0, 8)}...`);
          }
        } catch (err) {
          // Permission denied or other error reading environ
          console.log('');
          console.log('Configuration: (unable to read process environment)');
          console.log(`  Default port: 3000`);
          console.log(`  Default log file: ${join(homedir(), '.tofucode', 'tofucode.log')}`);
        }
      } else {
        // Not Linux or /proc not available
        console.log('');
        console.log('Configuration: (platform-specific details unavailable)');
        console.log(`  Default port: 3000`);
        console.log(`  Default log file: ${join(homedir(), '.tofucode', 'tofucode.log')}`);
      }

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
