import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../composables/useAuth';

const routes = [
  {
    path: '/auth',
    name: 'auth',
    component: () => import('../views/AuthView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'projects',
    component: () => import('../views/ProjectsView.vue'),
  },
  {
    path: '/project/:project',
    name: 'sessions',
    component: () => import('../views/SessionsView.vue'),
  },
  {
    path: '/project/:project/session/:session',
    name: 'chat',
    component: () => import('../views/ChatView.vue'),
  },
  {
    path: '/tasks/:pageId',
    name: 'task',
    component: () => import('../views/TaskView.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard for auth
router.beforeEach(async (to, _from, next) => {
  // Public routes don't need auth check
  if (to.meta.public) {
    return next();
  }

  const { authStatus, checkAuthStatus } = useAuth();

  // Check auth status if not loaded yet
  if (authStatus.value.loading) {
    await checkAuthStatus();
  }

  // If auth is disabled, allow all
  if (authStatus.value.authDisabled) {
    return next();
  }

  // If needs setup or not authenticated, redirect to auth
  if (authStatus.value.needsSetup || !authStatus.value.authenticated) {
    return next({ name: 'auth' });
  }

  next();
});

export default router;
