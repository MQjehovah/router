<template>
  <div class="login-wrap">
    <div class="bg-grid"></div>
    <div class="bg-orbs">
      <span class="orb orb-1"></span>
      <span class="orb orb-2"></span>
      <span class="orb orb-3"></span>
    </div>

    <main class="login-card">
      <header class="brand">
        <div class="brand-mark">AI</div>
        <div>
          <h1 class="brand-title">AI Gateway</h1>
          <p class="brand-sub">多模型 LLM 统一网关控制台</p>
        </div>
      </header>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="email" label="邮箱">
          <el-input
            v-model="form.email"
            placeholder="admin@example.com"
            size="large"
            :prefix-icon="UserIcon"
            autocomplete="email"
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item prop="password" label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            size="large"
            :prefix-icon="Lock"
            show-password
            autocomplete="current-password"
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="submit"
          :loading="loading"
          native-type="submit"
        >
          {{ loading ? '登录中…' : '进入控制台' }}
        </el-button>
      </el-form>
    </main>

    <footer class="login-foot">
      © 2026 AI Gateway · 私有部署 · 数据不出网
    </footer>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { User as UserIcon, Lock } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const formRef = ref<FormInstance>();
const form = reactive({ email: '', password: '' });
const loading = ref(false);

const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};

const handleLogin = async () => {
  if (!formRef.value) return;
  const ok = await formRef.value.validate().catch(() => false);
  if (!ok) return;

  loading.value = true;
  try {
    await authStore.login(form.email, form.password);
    ElMessage.success('登录成功');
    router.push('/');
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '登录失败，请检查账号密码');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-wrap {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(900px 500px at 70% -10%, rgba(99, 102, 241, 0.2), transparent 60%),
    radial-gradient(700px 420px at -10% 90%, rgba(34, 211, 238, 0.14), transparent 60%),
    var(--bg-page);
}

.bg-grid {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 20%, transparent 75%);
}

.bg-orbs {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.5;
  animation: drift 16s ease-in-out infinite alternate;
}
.orb-1 {
  width: 380px;
  height: 380px;
  top: -80px;
  right: -60px;
  background: #6366f1;
}
.orb-2 {
  width: 320px;
  height: 320px;
  bottom: -100px;
  left: -60px;
  background: #06b6d4;
  animation-delay: -6s;
}
.orb-3 {
  width: 220px;
  height: 220px;
  top: 55%;
  left: 60%;
  background: #22d3ee;
  opacity: 0.3;
  animation-delay: -11s;
}
@keyframes drift {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(30px, -24px) scale(1.08); }
}

.login-card {
  position: relative;
  z-index: 1;
  width: 400px;
  padding: 40px 36px 32px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(15, 22, 38, 0.92), rgba(11, 16, 29, 0.88));
  backdrop-filter: blur(14px);
  box-shadow: var(--shadow-pop), 0 0 0 1px rgba(34, 211, 238, 0.06);
  animation: cardIn 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes cardIn {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 30px;
}
.brand-mark {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: var(--brand-grad);
  color: #04222b;
  font-weight: 700;
  font-size: 17px;
  box-shadow: 0 8px 24px -8px var(--brand-glow);
}
.brand-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.brand-sub {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

.login-card :deep(.el-form-item__label) {
  color: var(--text-2);
  font-size: 13px;
  padding-bottom: 6px;
}

.submit {
  width: 100%;
  margin-top: 6px;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.login-foot {
  position: absolute;
  bottom: 22px;
  z-index: 1;
  font-size: 12px;
  color: var(--text-3);
  letter-spacing: 0.02em;
}
</style>
