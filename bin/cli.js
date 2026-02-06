#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);

// Handle --version flag early
if (args.includes('--version') || args.includes('-v')) {
  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(`cc-web v${pkg.version}`);
  process.exit(0);
}
const options = {
  port: 3000,
  host: '0.0.0.0',
  auth: true,
  daemon: false,
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
  } else if (arg === '--help') {
    console.log(`
cc-web - Web UI for Claude Code

Usage:
  cc-web [options]

Options:
  -p, --port <port>   Port to listen on (default: 3000)
  -h, --host <host>   Host to bind to (default: 0.0.0.0)
  --no-auth           Disable password authentication
  -d, --daemon        Run as background daemon
  -v, --version       Show version number
  --help              Show this help message

Environment Variables:
  PORT                Alternative way to set port
  HOST                Alternative way to set host
  AUTH_DISABLED       Set to 'true' to disable auth

Examples:
  cc-web                    # Start on http://0.0.0.0:3000
  cc-web -p 8080            # Start on port 8080
  cc-web --no-auth          # Disable authentication
  cc-web -d                 # Run as background daemon
`);
    process.exit(0);
  }
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

// Start the server
console.log(`Starting cc-web on http://${options.host}:${options.port}`);
if (!options.auth) {
  console.log('Authentication disabled');
}
console.log('');

const serverPath = join(rootDir, 'server', 'index.js');

if (options.daemon) {
  // Daemon mode: detached process
  const logPath = join(process.cwd(), 'cc-web.log');
  const { openSync, closeSync } = await import('fs');
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

  console.log(`cc-web started as daemon (PID: ${server.pid})`);
  console.log(`Logs: ${logPath}`);
  console.log(`To stop: kill ${server.pid}`);
  process.exit(0);
} else {
  // Foreground mode: inherit stdio
  const server = spawn('node', [serverPath], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
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
