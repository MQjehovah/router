import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue')
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('../views/Users.vue'),
        meta: { admin: true }
      },
      {
        path: 'keys',
        name: 'Keys',
        component: () => import('../views/Keys.vue')
      },
      {
        path: 'providers',
        name: 'Providers',
        component: () => import('../views/Providers.vue'),
        meta: { admin: true }
      },
      {
        path: 'usage',
        name: 'Usage',
        component: () => import('../views/Usage.vue')
      },
      {
        path: 'billing',
        name: 'Billing',
        component: () => import('../views/Billing.vue')
      }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to, from, next) => {
  const token = localStorage.getItem('token');
  if (to.path !== '/login' && !token) {
    next('/login');
  } else if (to.path === '/login' && token) {
    next('/');
  } else if (to.meta.admin && token) {
    const auth = useAuthStore();
    if (!auth.user) {
      try {
        await auth.fetchUser();
      } catch {
        auth.logout();
        next('/login');
        return;
      }
    }
    if (auth.user?.role === 'ADMIN') next();
    else next('/dashboard');
  } else {
    next();
  }
});

export default router;