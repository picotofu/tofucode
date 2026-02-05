<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth';

const router = useRouter();
const { authStatus, authError, checkAuthStatus, setupPassword, login } =
  useAuth();

const password = ref('');
const confirmPassword = ref('');
const isSubmitting = ref(false);

const isSetupMode = computed(() => authStatus.value.needsSetup);

const localError = ref('');

const displayError = computed(() => localError.value || authError.value);

async function handleSubmit() {
  localError.value = '';

  if (isSetupMode.value) {
    // Setup mode - validate confirm password
    if (password.value !== confirmPassword.value) {
      localError.value = 'Passwords do not match';
      return;
    }
    if (password.value.length < 4) {
      localError.value = 'Password must be at least 4 characters';
      return;
    }

    isSubmitting.value = true;
    const success = await setupPassword(password.value);
    isSubmitting.value = false;

    if (success) {
      router.push('/');
    }
  } else {
    // Login mode
    if (!password.value) {
      localError.value = 'Password is required';
      return;
    }

    isSubmitting.value = true;
    const success = await login(password.value);
    isSubmitting.value = false;

    if (success) {
      router.push('/');
    }
  }
}

onMounted(async () => {
  await checkAuthStatus();

  // If already authenticated, redirect to home
  if (authStatus.value.authenticated) {
    router.push('/');
  }
});
</script>

<template>
  <div class="auth-page">
    <AppHeader />
    <div class="auth-view">
      <div class="auth-card">
      <div class="auth-header">
        <h1 class="auth-title">cc-web</h1>
        <p class="auth-subtitle" v-if="isSetupMode">Create a password to secure your instance</p>
        <p class="auth-subtitle" v-else>Enter your password to continue</p>
      </div>

      <form class="auth-form" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="password">Password</label>
          <input
            type="password"
            id="password"
            v-model="password"
            :placeholder="isSetupMode ? 'Choose a password' : 'Enter password'"
            autocomplete="current-password"
            autofocus
          />
        </div>

        <div class="form-group" v-if="isSetupMode">
          <label for="confirmPassword">Confirm Password</label>
          <input
            type="password"
            id="confirmPassword"
            v-model="confirmPassword"
            placeholder="Confirm password"
            autocomplete="new-password"
          />
        </div>

        <div class="error-message" v-if="displayError">
          {{ displayError }}
        </div>

        <button type="submit" class="submit-btn" :disabled="isSubmitting">
          <span v-if="isSubmitting">Please wait...</span>
          <span v-else-if="isSetupMode">Create Password</span>
          <span v-else>Login</span>
        </button>
      </form>

      <p class="auth-hint" v-if="!isSetupMode">
        Forgot password? Delete <code>.auth.json</code> from the server and refresh.
      </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.auth-view {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 20px;
}

.auth-card {
  width: 100%;
  max-width: 360px;
  padding: 32px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.auth-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}

.auth-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input {
  padding: 12px 14px;
  font-size: 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: border-color 0.15s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--text-muted);
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.error-message {
  padding: 10px 12px;
  font-size: 13px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-md);
  color: var(--error-color);
}

.submit-btn {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  background: var(--text-primary);
  color: var(--bg-primary);
  border-radius: var(--radius-md);
  transition: opacity 0.15s;
}

.submit-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.auth-hint {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.auth-hint code {
  font-family: var(--font-mono);
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}
</style>
