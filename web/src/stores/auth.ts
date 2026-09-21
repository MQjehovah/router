import { defineStore } from 'pinia';
import api from '../api';

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  balance?: number;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem('token') || ''
  }),
  getters: {
    isAdmin: (state) => state.user?.role === 'ADMIN'
  },
  actions: {
    async login(email: string, password: string) {
      const { data } = await api.post('/api/auth/login', { email, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', data.token);
    },
    /** SSO 登录：跳统一认证授权页（回调会带 token 回到登录页） */
    loginWithSso() {
      window.location.href = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/api/auth/sso/start';
    },
    /** SSO 回调带回来的控制台 token：落盘并拉取用户信息 */
    async adoptSsoToken(token: string) {
      this.token = token;
      localStorage.setItem('token', token);
      await this.fetchUser();
    },
    async fetchUser() {
      if (!this.token) return;
      const { data } = await api.get('/api/auth/me');
      this.user = data;
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
    }
  }
});