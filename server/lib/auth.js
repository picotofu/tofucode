/**
 * Authentication library
 *
 * Handles password hashing, session management, and auth file operations.
 * Uses argon2 for secure password hashing.
 *
 * Auth file location: ~/.cc-web/.auth.json
 *
 * Structure:
 * {
 *   "passwordHash": "$argon2id$...",
 *   "sessions": [
 *     { "token": "...", "createdAt": "...", "expiresAt": "...", "userAgent": "..." }
 *   ]
 * }
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';

// Auth directory and file path (user's home directory)
const AUTH_DIR = join(homedir(), '.cc-web');
const AUTH_FILE = join(AUTH_DIR, '.auth.json');

// Ensure auth directory exists
function ensureAuthDir() {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
}

// Session duration from env or default 3 days
const SESSION_DURATION_DAYS = Number.parseInt(
  process.env.SESSION_DURATION_DAYS || '3',
  10,
);
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;

// Check if auth is disabled via env
export function isAuthDisabled() {
  return process.env.AUTH_DISABLED === 'true';
}

/**
 * Check if auth has been set up (password exists)
 */
export function isAuthSetup() {
  if (!existsSync(AUTH_FILE)) {
    return false;
  }
  try {
    const data = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
    return !!data.passwordHash;
  } catch {
    // Treat any parse error as "not set up"
    return false;
  }
}

/**
 * Load auth data from file
 */
function loadAuthData() {
  if (!existsSync(AUTH_FILE)) {
    return { passwordHash: null, sessions: [] };
  }
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    // Return empty state on any parse error
    return { passwordHash: null, sessions: [] };
  }
}

/**
 * Save auth data to file
 */
function saveAuthData(data) {
  ensureAuthDir();
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Set up initial password
 * @param {string} password - Plain text password
 * @returns {Promise<{token: string, expiresAt: string}>} Session info
 */
export async function setupPassword(password) {
  if (isAuthSetup()) {
    throw new Error('Password already set up');
  }

  const passwordHash = await argon2.hash(password);
  const session = createSession();

  saveAuthData({
    passwordHash,
    sessions: [session],
  });

  return {
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

/**
 * Check if DEBUG_TOKEN is configured
 * @returns {boolean} True if DEBUG_TOKEN is set in environment
 */
export function isDebugTokenEnabled() {
  return !!process.env.DEBUG_TOKEN;
}

/**
 * Verify password and create session
 * Accepts either:
 * - User's password (verified against hash in .auth.json)
 * - DEBUG_TOKEN (if set in environment, for Playwright/automation)
 *
 * @param {string} password - Plain text password or DEBUG_TOKEN
 * @param {string} userAgent - Browser user agent (optional)
 * @returns {Promise<{token: string, expiresAt: string} | null>} Session info or null if invalid
 */
export async function login(password, userAgent = '') {
  const data = loadAuthData();

  // Check DEBUG_TOKEN first (if configured)
  const debugToken = process.env.DEBUG_TOKEN;
  if (debugToken && password === debugToken) {
    // DEBUG_TOKEN matched - create session without password verification
    const session = createSession(userAgent);
    data.sessions.push(session);

    // Clean up expired sessions
    data.sessions = data.sessions.filter(
      (s) => new Date(s.expiresAt) > new Date(),
    );

    saveAuthData(data);

    return {
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  // Fall back to normal password verification
  if (!data.passwordHash) {
    return null;
  }

  try {
    const valid = await argon2.verify(data.passwordHash, password);
    if (!valid) {
      return null;
    }
  } catch {
    // Treat argon2 errors as invalid password
    return null;
  }

  // Create new session
  const session = createSession(userAgent);
  data.sessions.push(session);

  // Clean up expired sessions
  data.sessions = data.sessions.filter(
    (s) => new Date(s.expiresAt) > new Date(),
  );

  saveAuthData(data);

  return {
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

/**
 * Validate session token
 * @param {string} token - Session token
 * @returns {boolean} True if valid
 */
export function validateSession(token) {
  if (!token) return false;

  const data = loadAuthData();
  const session = data.sessions.find((s) => s.token === token);

  if (!session) return false;
  if (new Date(session.expiresAt) <= new Date()) return false;

  return true;
}

/**
 * Logout - remove session
 * @param {string} token - Session token to remove
 */
export function logout(token) {
  const data = loadAuthData();
  data.sessions = data.sessions.filter((s) => s.token !== token);
  saveAuthData(data);
}

/**
 * Create a new session object
 * @param {string} userAgent - Browser user agent
 * @returns {Object} Session object
 */
function createSession(userAgent = '') {
  const token = randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  return {
    token,
    createdAt,
    expiresAt,
    userAgent,
  };
}

/**
 * Get session info from token
 * @param {string} token - Session token
 * @returns {Object | null} Session info or null
 */
export function getSessionInfo(token) {
  if (!token) return null;

  const data = loadAuthData();
  const session = data.sessions.find((s) => s.token === token);

  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;

  return {
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

/**
 * Parse session token from cookie header
 * @param {string} cookieHeader - Cookie header string
 * @returns {string | null} Session token or null
 */
export function parseSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {});

  return cookies.session || null;
}
