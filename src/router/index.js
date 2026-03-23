import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../composables/useAuth';
import AuthView from '../views/AuthView.vue';
import ChatView from '../views/ChatView.vue';
import ProjectsView from '../views/ProjectsView.vue';
import SessionsView from '../views/SessionsView.vue';
import TaskView from '../views/TaskView.vue';

const routes = [
  {
    path: '/auth',
    name: 'auth',
    component: AuthView,
    meta: { public: true },
  },
  {
    path: '/',
    name: 'projects',
    component: ProjectsView,
  },
  {
    path: '/project/:project',
    name: 'sessions',
    component: SessionsView,
  },
  {
    path: '/project/:project/session/:session',
    name: 'chat',
    component: ChatView,
  },
  {
    path: '/tasks/:pageId',
    name: 'task',
    component: TaskView,
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
