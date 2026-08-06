<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h2 class="page-title">审计日志</h2>
        <p class="page-sub">谁在什么时间改了什么（提供商 / Key / 用户 / 模型 / 协议）</p>
      </div>
      <el-button :icon="Refresh" @click="loadAudit">刷新</el-button>
    </header>

    <section class="tech-card toolbar">
      <el-select v-model="typeFilter" placeholder="类型" clearable class="filter" @change="page = 1; loadAudit()">
        <el-option label="用户" value="user" />
        <el-option label="Key" value="key" />
        <el-option label="模型" value="model" />
        <el-option label="提供商" value="provider" />
        <el-option label="协议" value="protocol" />
        <el-option label="认证" value="auth" />
        <el-option label="交易" value="transaction" />
      </el-select>
      <el-button :icon="Refresh" circle @click="loadAudit" />
    </section>

    <section class="tech-card table-card">
      <el-table v-loading="loading" :data="rows" style="width: 100%">
        <template #empty>
          <el-empty description="暂无审计记录" :image-size="80" />
        </template>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">
            <span class="date font-mono">{{ fmtDate(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作者" min-width="160">
          <template #default="{ row }">
            <span v-if="row.actor" class="actor">{{ row.actor.name }} <span class="dim">{{ row.actor.email }}</span></span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-tag :type="actionTag(row.action)" effect="dark" disable-transitions size="small">{{ actionLabel(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" width="100">
          <template #default="{ row }">
            <span class="type-tag">{{ typeLabel(row.targetType) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="目标 ID" width="110" class-name="font-mono">
          <template #default="{ row }">{{ row.targetId || '—' }}</template>
        </el-table-column>
        <el-table-column label="详情" min-width="220">
          <template #default="{ row }">
            <code v-if="row.detail" class="detail font-mono">{{ fmtDetail(row.detail) }}</code>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, jumper"
          background
          @current-change="loadAudit"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import api from '../api';

const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const typeFilter = ref('');

const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  regenerate: '重新生成',
  login: '登录',
  login_failed: '登录失败',
  change_password: '修改密码',
  recharge: '充值'
};
const TYPE_LABELS: Record<string, string> = {
  user: '用户',
  key: 'Key',
  model: '模型',
  provider: '提供商',
  protocol: '协议',
  auth: '认证',
  transaction: '交易'
};

const actionLabel = (a: string) => ACTION_LABELS[a] || a;
const actionTag = (a: string) =>
  ({ create: 'success', delete: 'danger', login_failed: 'danger', login: 'success', recharge: 'warning', change_password: 'warning' })[a] || 'info';
const typeLabel = (t: string) => TYPE_LABELS[t] || t;

const fmtDate = (s: string) => new Date(s).toLocaleString('zh-CN', { hour12: false });
const fmtDetail = (d: any) => (typeof d === 'string' ? d : JSON.stringify(d));

const loadAudit = async () => {
  loading.value = true;
  try {
    const params: any = { page: page.value, pageSize };
    if (typeFilter.value) params.targetType = typeFilter.value;
    const { data } = await api.get('/api/audit', { params });
    rows.value = data.rows;
    total.value = data.total;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadAudit);
</script>

<style scoped>
.page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; }
.page-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-sub { margin: 4px 0 0; font-size: 13px; color: var(--text-3); }
.toolbar { display: flex; gap: 12px; align-items: center; padding: 14px 16px; margin-bottom: 16px; }
.filter { width: 150px; }
.table-card { padding: 6px 8px; }
.actor { color: var(--text-1); font-weight: 500; }
.dim { color: var(--text-3); font-size: 12px; }
.type-tag {
  font-size: 12px;
  font-weight: 600;
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.25);
  padding: 2px 8px;
  border-radius: 6px;
}
.detail {
  font-size: 12px;
  color: var(--text-2);
  background: var(--bg-deep);
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  display: inline-block;
}
.date { font-size: 12px; color: var(--text-2); }
.pager { display: flex; justify-content: flex-end; padding: 14px 6px 8px; }
</style>
