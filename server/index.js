import { logger } from './lib/logger.js';

// Catch unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err.message);
  logger.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise);
  logger.error('Reason:', reason);
});

// Graceful shutdown handler - defined after server is created
let isShuttingDown = false;
let httpServer = null; // Will be set after server creation

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.log('Force shutdown...');
    process.exit(1);
  }

  isShuttingDown = true;
  logger.log(`\n${signal} received, shutting down gracefully...`);

  try {
    // Clear task cleanup interval
    if (global.taskCleanupInterval) {
      clearInterval(global.taskCleanupInterval);
      logger.log('Stopped task cleanup interval');
    }

    // Cancel all running tasks
    const { tasks } = await import('./lib/tasks.js');
    for (const [sessionId, task] of tasks) {
      if (task.status === 'running' && task.abortController) {
        logger.log(`Cancelling task for session ${sessionId}`);
        task.abortController.abort();
      }
    }

    // Stop version checker
    const { stopVersionChecker } = await import('./lib/version-checker.js');
    stopVersionChecker();
    logger.log('Stopped version checker');

    // Clean up process manager
    const processManager = (await import('./lib/processManager.js')).default;
    if (processManager.destroy) {
      processManager.destroy();
      logger.log('Cleaned up process manager');
    }

    // Close HTTP server
    if (httpServer) {
      httpServer.close(() => {
        logger.log('HTTP server closed');
      });
    }

    // Give a moment for cleanup then exit
    setTimeout(() => {
      logger.log('Shutdown complete');
      process.exit(0);
    }, 500);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import compress from 'compression';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import {
  isAuthDisabled,
  isAuthSetup,
  login,
  logout,
  parseSessionCookie,
  setupPassword,
  validateSession,
} from './lib/auth.js';
import {
  getCurrentVersion,
  initVersionChecker,
} from './lib/version-checker.js';
import { handleWebSocket } from './websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Load package.json for version
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));

// Initialize version checker
initVersionChecker(pkg.version);

// Initialize periodic task cleanup (every hour)
const { clearOldTasks } = await import('./lib/tasks.js');
global.taskCleanupInterval = setInterval(
  () => {
    const cleared = clearOldTasks();
    if (cleared > 0) {
      logger.log(`Cleared ${cleared} old tasks`);
    }
  },
  60 * 60 * 1000,
); // Every hour

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 3 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    threshold: 1024, // Only compress messages > 1KB
  },
});

// Set reference for graceful shutdown
httpServer = server;

// Parse JSON and cookies
app.use(express.json());

// Compress all responses (API and static files)
// Threshold: 512 bytes - compress files larger than 0.5KB
app.use(compress({ threshold: 512 }));

// Session duration for cookie (from env or default 3 days)
const SESSION_DURATION_DAYS = Number.parseInt(
  process.env.SESSION_DURATION_DAYS || '3',
  10,
);
// Secure cookie flag (requires HTTPS - enable if behind nginx/caddy with SSL)
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';

// ============================================
// Auth API Routes (unauthenticated)
// ============================================

// Health check with version
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: getCurrentVersion(),
    timestamp: new Date().toISOString(),
  });
});

// Auth status - check if setup is needed
app.get('/api/auth/status', (req, res) => {
  if (isAuthDisabled()) {
    return res.json({ authDisabled: true, authenticated: true });
  }

  const token = parseSessionCookie(req.headers.cookie);
  const authenticated = validateSession(token);
  const needsSetup = !isAuthSetup();

  res.json({ needsSetup, authenticated, authDisabled: false });
});

// Setup password (first time only)
app.post('/api/auth/setup', async (req, res) => {
  if (isAuthDisabled()) {
    return res.status(400).json({ error: 'Auth is disabled' });
  }

  if (isAuthSetup()) {
    return res.status(400).json({ error: 'Password already set up' });
  }

  const { password } = req.body;
  if (!password || password.length < 4) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 4 characters' });
  }

  try {
    const { token, expiresAt } = await setupPassword(password);

    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: SECURE_COOKIE,
      maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  if (isAuthDisabled()) {
    return res.status(400).json({ error: 'Auth is disabled' });
  }

  const { password } = req.body;
  const userAgent = req.headers['user-agent'] || '';

  const result = await login(password, userAgent);
  if (!result) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.cookie('session', result.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: SECURE_COOKIE,
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true, expiresAt: result.expiresAt });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = parseSessionCookie(req.headers.cookie);
  if (token) {
    logout(token);
  }
  res.clearCookie('session');
  res.json({ success: true });
});

// ============================================
// Serve docs folder (no auth required)
// ============================================
const docsPath = join(rootDir, 'docs');
if (existsSync(docsPath)) {
  app.use('/docs', express.static(docsPath));
}

// ============================================
// Serve Vue build with auth protection
// ============================================
const distPath = join(rootDir, 'dist');
if (existsSync(distPath)) {
  // Service Worker files - MUST NOT be cached to ensure updates work
  app.use((req, res, next) => {
    if (req.path === '/sw.js' || req.path.startsWith('/workbox-')) {
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
    }
    next();
  });

  // Serve static files with caching for assets
  app.use(
    express.static(distPath, {
      maxAge: '1y',
      immutable: true,
      index: false, // Don't auto-serve index.html
    }),
  );

  // SPA fallback - serve index.html for non-API routes
  // NOTE: During development (with vite build --watch), index.html changes
  // frequently as asset hashes update. We read it fresh each time rather than
  // caching to avoid serving stale asset references.
  const indexHtmlPath = join(distPath, 'index.html');

  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/ws') &&
      !req.path.startsWith('/docs') &&
      !req.path.startsWith('/assets')
    ) {
      // Read fresh to get latest asset hashes from vite build --watch
      const indexHtml = readFileSync(indexHtmlPath, 'utf8');
      const indexHtmlStats = statSync(indexHtmlPath);

      // Set cache headers: always revalidate index.html
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Last-Modified': indexHtmlStats.mtime.toUTCString(),
      });
      // Send through compression middleware
      res.send(indexHtml);
    } else {
      next();
    }
  });
}

// ============================================
// WebSocket upgrade handler with auth
// ============================================
server.on('upgrade', (request, socket, head) => {
  // Check if this is a WebSocket upgrade to /ws
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  // Check auth (skip if disabled)
  if (!isAuthDisabled()) {
    const token = parseSessionCookie(request.headers.cookie);
    if (!validateSession(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  // Complete the upgrade
  wss.handleUpgrade(request, socket, head, (ws) => {
    // Debug: log compression status
    if (process.env.DEBUG === 'true') {
      logger.log(
        'WebSocket connected with extensions:',
        ws.extensions || 'none',
      );
    }
    wss.emit('connection', ws, request);
  });
});

// WebSocket connection handler
wss.on('connection', handleWebSocket);

// POC: Retry binding logic for upgrade/restart scenarios
// This enables inverted spawn strategy for self-updating
// See: docs/FEATURE_UPDATE_VERSION.md Section 8.1 and 8.3
const isUpgradeRetry = process.env.UPGRADE_RETRY_BIND === 'true';
const maxRetries = Number.parseInt(process.env.UPGRADE_MAX_RETRIES || '20', 10);
const retryInterval = Number.parseInt(
  process.env.UPGRADE_RETRY_INTERVAL || '1000',
  10,
);

if (isUpgradeRetry) {
  logger.log(
    `Debug: UPGRADE_RETRY_INTERVAL from env: ${process.env.UPGRADE_RETRY_INTERVAL || '(not set)'}`,
  );
  logger.log(`Debug: Using retryInterval: ${retryInterval}ms`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  if (isUpgradeRetry) {
    logger.log(
      `🔄 Upgrade mode: Will retry port binding up to ${maxRetries} times`,
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(config.port, () => {
            server.removeListener('error', reject);
            resolve();
          });
        });

        logger.log(`✅ Bound to port ${config.port} on attempt ${attempt}`);
        onServerReady();
        return;
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          logger.log(
            `⏳ Port ${config.port} in use, retry ${attempt}/${maxRetries}...`,
          );
          await sleep(retryInterval);
        } else {
          throw err;
        }
      }
    }

    logger.error(
      `❌ Failed to bind to port ${config.port} after ${maxRetries} attempts`,
    );
    process.exit(1);
  } else {
    // Normal startup - fail fast if port is already in use
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(
          `❌ Port ${config.port} is already in use. Stop the existing process first.`,
        );
        logger.error(`   Check with: lsof -i :${config.port}`);
        logger.error('   Or try: tofucode stop');
        process.exit(1);
      } else {
        logger.error(`❌ Server error: ${err.message}`);
        process.exit(1);
      }
    });
    server.listen(config.port, onServerReady);
  }
}

function onServerReady() {
  logger.log(
    `tofucode v${getCurrentVersion()} running on http://localhost:${config.port}`,
  );
  logger.log(`WebSocket available at ws://localhost:${config.port}/ws`);
  if (isAuthDisabled()) {
    logger.log('⚠️  Authentication is DISABLED');
  } else if (!isAuthSetup()) {
    logger.log(
      '🔐 First time setup required - visit the web UI to set password',
    );
  }
  if (isUpgradeRetry) {
    logger.log('🎉 Upgrade restart complete!');
  }
  if (process.env.DEBUG === 'true') {
    logger.log('🐛 DEBUG mode enabled - logging to tofucode.log');
  }
}

// Start the server
startServer();
