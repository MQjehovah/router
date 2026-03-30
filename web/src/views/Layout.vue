<template>
  <el-container class="layout">
    <el-aside width="200px">
      <div class="logo">AI Gateway</div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/dashboard">
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/users">
          <span>用户管理</span>
        </el-menu-item>
        <el-menu-item index="/keys">
          <span>API Key</span>
        </el-menu-item>
        <el-menu-item index="/providers">
          <span>提供商</span>
        </el-menu-item>
        <el-menu-item index="/usage">
          <span>使用统计</span>
        </el-menu-item>
        <el-menu-item index="/billing">
          <span>账单管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header>
        <div class="header-right">
          <span>{{ authStore.user?.name }}</span>
          <el-button type="danger" size="small" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const handleLogout = () => {
  authStore.logout();
  router.push('/login');
};
</script>

<style scoped>
.layout {
  min-height: 100vh;
}
.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  color: #fff;
  background: #409eff;
}
.el-aside {
  background: #304156;
}
.el-header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 20px;
  box-shadow: 0 1px 4px rgba(0,21,41,.08);
}
.header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}
.el-menu {
  border: none;
  background: #304156;
}
.el-menu-item {
  color: #bfcbd9;
}
.el-menu-item:hover, .el-menu-item.is-active {
  background: #263445 !important;
  color: #409eff !important;
}
</style>