<template>
  <el-container class="layout">
    <el-aside :width="collapsed ? '72px' : '232px'" class="sidebar">
      <div class="brand" :class="{ collapsed }">
        <div class="brand-mark">AI</div>
        <span v-show="!collapsed" class="brand-name">AI Gateway</span>
      </div>
      <el-menu
        class="side-menu"
        :default-active="route.path"
        router
        :collapse="collapsed"
        :collapse-transition="false"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/keys">
          <el-icon><Key /></el-icon>
          <span>API Key</span>
        </el-menu-item>
        <el-menu-item index="/usage">
          <el-icon><TrendCharts /></el-icon>
          <span>使用统计</span>
        </el-menu-item>
        <el-menu-item index="/billing">
          <el-icon><Wallet /></el-icon>
          <span>账单充值</span>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><User /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
        <el-menu-item index="/providers">
          <el-icon><Connection /></el-icon>
          <span>提供商</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container class="body">
      <el-header class="topbar">
        <div class="topbar-left">
          <button class="collapse-btn" @click="collapsed = !collapsed" aria-label="折叠导航">
            <el-icon :size="18"><Expand v-if="collapsed" /><Fold v-else /></el-icon>
          </button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-for="item in breadcrumbs" :key="item.path">
              {{ item.label }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="topbar-right">
          <div class="balance-chip">
            <span class="label">余额</span>
            <span class="value font-mono">${{ balance }}</span>
          </div>
          <el-dropdown trigger="click" @command="handleCommand">
            <button class="user-chip">
              <span class="avatar">{{ avatarText }}</span>
              <span class="user-name">{{ authStore.user?.name }}</span>
              <el-icon :size="14"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main id="app-main" class="main">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Odometer, Key, TrendCharts, Wallet, User, Connection,
  Expand, Fold, ArrowDown, SwitchButton
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import api from '../api';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const collapsed = ref(false);
const balance = ref('0.0000');

const TITLES: Record<string, string> = {
  dashboard: '仪表盘',
  keys: 'API Key',
  usage: '使用统计',
  billing: '账单充值',
  users: '用户管理',
  providers: '提供商'
};

const breadcrumbs = computed(() => {
  const seg = route.path.split('/').filter(Boolean)[0];
  return [{ path: '/', label: TITLES[seg] || '控制台' }];
});

const avatarText = computed(() => (authStore.user?.name || 'A').slice(0, 1).toUpperCase());

const handleCommand = async (cmd: string) => {
  if (cmd === 'logout') {
    authStore.logout();
    router.push('/login');
  }
};

onMounted(async () => {
  if (!authStore.user) {
    try {
      await authStore.fetchUser();
    } catch { /* token invalid, api interceptor redirects */ }
  }
  try {
    const { data } = await api.get('/api/auth/me');
    balance.value = Number(data.balance ?? 0).toFixed(4);
  } catch { /* ignore */ }
});
</script>

<style scoped>
.layout {
  min-height: 100vh;
}

.sidebar {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-page) 100%);
  border-right: 1px solid var(--border);
  transition: width 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 64px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  white-space: nowrap;
}
.brand-mark {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--brand-grad);
  color: #04222b;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.02em;
  box-shadow: 0 6px 16px -6px var(--brand-glow);
}
.brand-name {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.01em;
  color: var(--text-1);
}

.side-menu {
  flex: 1;
  border: none;
  background: transparent;
  padding: 10px 8px;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: var(--text-2);
  --el-menu-hover-bg-color: var(--bg-hover);
  --el-menu-active-color: #7dd3fc;
  --el-menu-item-height: 44px;
}
.side-menu :deep(.el-menu-item) {
  border-radius: 10px;
  margin-bottom: 2px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.side-menu :deep(.el-menu-item:hover) {
  color: var(--text-1);
}
.side-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, rgba(34, 211, 238, 0.16), rgba(99, 102, 241, 0.12));
  color: #a5f3fc;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.22) inset;
}
.side-menu:not(.el-menu--collapse) :deep(.el-menu-item.is-active)::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 22px;
  border-radius: 3px;
  background: var(--brand-grad);
}

.body {
  min-width: 0;
}

.topbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: rgba(11, 16, 29, 0.72);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.collapse-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.2s;
}
.collapse-btn:hover {
  color: var(--text-1);
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.topbar :deep(.el-breadcrumb__inner) {
  color: var(--text-2);
  font-weight: 500;
}
.topbar :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--text-1);
  font-weight: 600;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.balance-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.25;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
}
.balance-chip .label {
  font-size: 11px;
  color: var(--text-3);
  letter-spacing: 0.08em;
}
.balance-chip .value {
  color: #a5f3fc;
  font-size: 13px;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px 4px 4px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  transition: all 0.2s;
}
.user-chip:hover {
  background: var(--bg-surface);
  border-color: var(--border);
}
.avatar {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--brand-grad);
  color: #04222b;
  font-weight: 700;
  font-size: 14px;
}
.user-name {
  font-size: 14px;
  font-weight: 500;
}

.main {
  position: relative;
  z-index: 1;
  padding: 24px;
  overflow: auto;
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
