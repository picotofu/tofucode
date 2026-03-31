/**
 * Login rate limiter
 *
 * Global (not per-IP) bucket — single-user app, so all login attempts share one counter.
 * Lock is cleared on successful login or on server restart (SSH restart is the owner's escape hatch).
 *
 * Config via env:
 *   MAX_LOGIN_ATTEMPTS  — max failed attempts before lockout (default: 3)
 *   LOGIN_WINDOW_MS     — lockout duration in ms (default: 900000 = 15 min)
 */

const MAX_ATTEMPTS = Number.parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '3', 10);
const WINDOW_MS = Number.parseInt(process.env.LOGIN_WINDOW_MS ?? '900000', 10);

/** @type {{ count: number, lockedUntil: number | null }} */
const state = {
  count: 0,
  lockedUntil: null,
};

/**
 * Check whether login is currently locked out.
 * @returns {{ locked: boolean, retryAfter: number, attemptsRemaining: number }}
 *   retryAfter in seconds (0 if not locked), attemptsRemaining (0 if locked)
 */
export function isLoginLocked() {
  if (state.lockedUntil === null) {
    return {
      locked: false,
      retryAfter: 0,
      attemptsRemaining: MAX_ATTEMPTS - state.count,
    };
  }

  const remaining = state.lockedUntil - Date.now();
  if (remaining <= 0) {
    // Lock expired — reset automatically
    state.count = 0;
    state.lockedUntil = null;
    return { locked: false, retryAfter: 0, attemptsRemaining: MAX_ATTEMPTS };
  }

  return {
    locked: true,
    retryAfter: Math.ceil(remaining / 1000),
    attemptsRemaining: 0,
  };
}

/**
 * Record a failed login attempt. Triggers lockout if max attempts reached.
 * @returns {{ attemptsRemaining: number }}
 */
export function recordFailedAttempt() {
  state.count += 1;
  if (state.count >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + WINDOW_MS;
  }
  return { attemptsRemaining: Math.max(0, MAX_ATTEMPTS - state.count) };
}

/**
 * Reset the rate limit counter. Call on successful login.
 */
export function resetLoginAttempts() {
  state.count = 0;
  state.lockedUntil = null;
}
