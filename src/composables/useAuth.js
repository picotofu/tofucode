import { ref } from 'vue';

const authStatus = ref({
  loading: true,
  authenticated: false,
  needsSetup: false,
  authDisabled: false,
});

const authError = ref(null);

/** How many attempts remain before lockout (null = unknown / not yet attempted) */
const attemptsRemaining = ref(null);

/** Seconds until lockout clears (null = not locked) */
const retryAfter = ref(null);

/**
 * Check auth status from server
 */
export async function checkAuthStatus() {
  authStatus.value.loading = true;
  authError.value = null;

  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();

    authStatus.value = {
      loading: false,
      authenticated: data.authenticated,
      needsSetup: data.needsSetup,
      authDisabled: data.authDisabled,
    };
  } catch (_err) {
    authError.value = 'Failed to check auth status';
    authStatus.value.loading = false;
  }
}

/**
 * Setup password (first time)
 */
export async function setupPassword(password) {
  authError.value = null;

  try {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok) {
      authError.value = data.error || 'Setup failed';
      if (data.attemptsRemaining !== undefined) {
        attemptsRemaining.value = data.attemptsRemaining;
      }
      if (data.retryAfter !== undefined) {
        retryAfter.value = data.retryAfter;
      }
      return false;
    }

    attemptsRemaining.value = null;
    retryAfter.value = null;
    authStatus.value.authenticated = true;
    authStatus.value.needsSetup = false;
    return true;
  } catch (_err) {
    authError.value = 'Network error';
    return false;
  }
}

/**
 * Login with password
 */
export async function login(password) {
  authError.value = null;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok) {
      authError.value = data.error || 'Login failed';
      if (data.attemptsRemaining !== undefined) {
        attemptsRemaining.value = data.attemptsRemaining;
      }
      if (data.retryAfter !== undefined) {
        retryAfter.value = data.retryAfter;
      }
      return false;
    }

    attemptsRemaining.value = null;
    retryAfter.value = null;
    authStatus.value.authenticated = true;
    return true;
  } catch (_err) {
    authError.value = 'Network error';
    return false;
  }
}

/**
 * Logout
 */
export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Ignore network errors - we clear local state anyway
  }

  authStatus.value.authenticated = false;
}

export function useAuth() {
  return {
    authStatus,
    authError,
    attemptsRemaining,
    retryAfter,
    checkAuthStatus,
    setupPassword,
    login,
    logout,
  };
}
