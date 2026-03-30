import { defineStore } from 'pinia';
import api from '../api';

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem('token') || ''
  }),
  getters: {
    isAdmin: () => this.user?.role === 'ADMIN'
  },
  actions: {
    async login(email: string, password: string) {
      const { data } = await api.post('/api/auth/login', { email, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', data.token);
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