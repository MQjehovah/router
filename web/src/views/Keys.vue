<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h2 class="page-title">API Key</h2>
        <p class="page-sub">为各用户签发访问网关的密钥，配置配额与限流</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">创建 Key</el-button>
    </header>

    <section class="tech-card toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索名称 / Key"
        :prefix-icon="Search"
        clearable
        class="search"
        @input="loadKeys()"
      />
      <el-select v-model="statusFilter" placeholder="状态" clearable class="filter" @change="loadKeys()">
        <el-option label="启用" value="ACTIVE" />
        <el-option label="停用" value="INACTIVE" />
        <el-option label="已过期" value="EXPIRED" />
      </el-select>
      <el-button :icon="Refresh" circle @click="loadKeys" />
    </section>

    <section class="tech-card table-card">
      <el-table v-loading="loading" :data="filtered" style="width: 100%">
        <template #empty>
          <el-empty description="暂无 API Key，点击右上角创建第一个" :image-size="80" />
        </template>
        <el-table-column prop="id" label="ID" width="64" class-name="font-mono" />
        <el-table-column label="名称" min-width="150">
          <template #default="{ row }">
            <span class="cell-name">{{ row.name || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="keyHash" label="Key" min-width="150">
          <template #default="{ row }">
            <code class="key-hash font-mono">{{ row.keyHash }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" effect="dark" disable-transitions>{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="限流" width="110" class-name="font-mono">
          <template #default="{ row }">{{ row.rateLimit }}/分</template>
        </el-table-column>
        <el-table-column label="配额" min-width="150">
          <template #default="{ row }">
            <div class="quota">
              <span class="font-mono">{{ fmt(row.dailyQuota) }} / 日</span>
              <span class="font-mono dim">{{ fmt(row.monthlyQuota) }} / 月</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">
            <span class="date font-mono">{{ fmtDate(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="215" align="right">
          <template #default="{ row }">
            <el-tooltip content="统计数据">
              <el-button
                text
                :icon="DataAnalysis"
                class="row-btn"
                @click="openStats(row)"
              />
            </el-tooltip>
            <el-tooltip content="重新生成">
              <el-button
                text
                :loading="regeneratingId === row.id"
                :icon="RefreshRight"
                class="row-btn"
                @click="handleRegenerate(row)"
              />
            </el-tooltip>
            <el-tooltip content="编辑">
              <el-button text :icon="Edit" class="row-btn" @click="openEdit(row)" />
            </el-tooltip>
            <el-tooltip content="删除">
              <el-button text type="danger" :icon="Delete" class="row-btn" @click="handleDelete(row)" />
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- create -->
    <el-dialog v-model="createOpen" title="创建 API Key" width="460px" destroy-on-close>
      <el-form ref="createRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：生产环境" maxlength="40" show-word-limit />
        </el-form-item>
        <el-form-item label="日配额" prop="dailyQuota">
          <el-input-number v-model="form.dailyQuota" :min="0" :step="1000" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="月配额" prop="monthlyQuota">
          <el-input-number v-model="form.monthlyQuota" :min="0" :step="10000" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="速率限制" prop="rateLimit">
          <el-input-number v-model="form.rateLimit" :min="1" :max="10000" controls-position="right" style="width: 100%" />
          <div class="field-hint">每分钟最多请求次数</div>
        </el-form-item>
        <el-form-item label="可用模型">
          <el-select v-model="form.modelIds" multiple collapse-tags collapse-tags-tooltip placeholder="不选则默认全部启用模型" style="width: 100%">
            <el-option v-for="m in models" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
          <div class="field-hint">留空 = 允许该 Key 使用所有启用中的模型</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- edit -->
    <el-dialog v-model="editOpen" title="编辑 API Key" width="460px" destroy-on-close>
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="名称">
          <el-input v-model="editForm.name" maxlength="40" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editForm.status">
            <el-radio-button value="ACTIVE">启用</el-radio-button>
            <el-radio-button value="INACTIVE">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="日配额">
          <el-input-number v-model="editForm.dailyQuota" :min="0" :step="1000" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="月配额">
          <el-input-number v-model="editForm.monthlyQuota" :min="0" :step="10000" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="速率限制">
          <el-input-number v-model="editForm.rateLimit" :min="1" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="可用模型">
          <el-select v-model="editForm.modelIds" multiple collapse-tags collapse-tags-tooltip placeholder="不选则默认全部启用模型" style="width: 100%">
            <el-option v-for="m in models" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleUpdate">保存</el-button>
      </template>
    </el-dialog>

    <!-- stats -->
    <el-dialog v-model="statsOpen" :title="statsTitle" width="620px" destroy-on-close>
      <div v-loading="statsLoading">
        <template v-if="statsData">
          <div class="stats-groups">
            <div v-for="g in ['total', 'today']" :key="g" class="stats-group">
              <div class="stats-group-title">{{ g === 'total' ? '累计' : '今日' }}</div>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">请求数</span>
                  <span class="stat-value font-mono">{{ (statsData[g].requests || 0).toLocaleString() }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">输入 Token</span>
                  <span class="stat-value font-mono">{{ (statsData[g].tokensIn || 0).toLocaleString() }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">输出 Token</span>
                  <span class="stat-value font-mono">{{ (statsData[g].tokensOut || 0).toLocaleString() }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">缓存 Token</span>
                  <span class="stat-value font-mono">{{ (statsData[g].cachedTokens || 0).toLocaleString() }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">费用</span>
                  <span class="stat-value cost font-mono">${{ Number(statsData[g].cost || 0).toFixed(4) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="stats-models">
            <div class="stats-group-title">本月模型分布</div>
            <el-table v-if="statsData.monthlyModels.length" :data="statsData.monthlyModels" size="small">
              <el-table-column prop="model" label="模型" min-width="160">
                <template #default="{ row }">
                  <span class="model-tag">{{ row.model }}</span>
                </template>
              </el-table-column>
              <el-table-column label="输入" width="120" align="right" class-name="font-mono">
                <template #default="{ row }">{{ (row.tokensIn || 0).toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="输出" width="120" align="right" class-name="font-mono">
                <template #default="{ row }">{{ (row.tokensOut || 0).toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="缓存" width="120" align="right" class-name="font-mono">
                <template #default="{ row }">{{ (row.cachedTokens || 0).toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="费用" width="120" align="right">
                <template #default="{ row }"><span class="cost font-mono">${{ Number(row.cost || 0).toFixed(4) }}</span></template>
              </el-table-column>
            </el-table>
            <div v-else class="stats-empty">本月暂无使用记录</div>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="statsOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- one-time reveal -->
    <el-dialog v-model="revealOpen" :title="revealTitle" width="460px">
      <p class="reveal-tip">此密钥仅显示一次，请立即复制保存。关闭后无法再次查看。</p>
      <div class="reveal-box">
        <code class="reveal-key font-mono">{{ revealedKey }}</code>
        <el-button :icon="CopyDocument" circle @click="copyKey" />
      </div>
      <template #footer>
        <el-button type="primary" @click="revealOpen = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Search, Refresh, Edit, Delete, CopyDocument, RefreshRight, DataAnalysis } from '@element-plus/icons-vue';
import api from '../api';

const keys = ref<any[]>([]);
const models = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const regeneratingId = ref<number | null>(null);
const keyword = ref('');
const statusFilter = ref('');

const createOpen = ref(false);
const editOpen = ref(false);
const revealOpen = ref(false);
const revealTitle = ref('API Key 创建成功');
const revealedKey = ref('');

const statsOpen = ref(false);
const statsLoading = ref(false);
const statsTitle = ref('');
const statsData = ref<any>(null);

const createRef = ref<FormInstance>();
const form = ref({ name: '', dailyQuota: 100000, monthlyQuota: 3000000, rateLimit: 60, modelIds: [] as number[] });
const editForm = ref<any>({});

const rules: FormRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }]
};

const filtered = computed(() => keys.value.filter(k =>
  (!statusFilter.value || k.status === statusFilter.value) &&
  (!keyword.value || k.name?.includes(keyword.value) || k.keyHash?.includes(keyword.value))
));

const fmt = (n: number) => (n ?? 0).toLocaleString();
const fmtDate = (s: string) => new Date(s).toLocaleString('zh-CN', { hour12: false });
const statusLabel = (s: string) => ({ ACTIVE: '启用', INACTIVE: '停用', EXPIRED: '已过期' })[s] || s;
const statusTag = (s: string) => ({ ACTIVE: 'success', INACTIVE: 'info', EXPIRED: 'danger' })[s] || 'info';

const loadKeys = async () => {
  loading.value = true;
  try {
    const [keysRes, modelsRes] = await Promise.all([api.get('/api/keys'), api.get('/api/models')]);
    keys.value = keysRes.data;
    models.value = modelsRes.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载失败');
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = { name: '', dailyQuota: 100000, monthlyQuota: 3000000, rateLimit: 60, modelIds: [] };
  createOpen.value = true;
};

const handleCreate = async () => {
  if (!createRef.value) return;
  const ok = await createRef.value.validate().catch(() => false);
  if (!ok) return;
  submitting.value = true;
  try {
    const { data } = await api.post('/api/keys', form.value);
    revealedKey.value = data.key;
    revealTitle.value = 'API Key 创建成功';
    createOpen.value = false;
    revealOpen.value = true;
    loadKeys();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '创建失败');
  } finally {
    submitting.value = false;
  }
};

const openEdit = (row: any) => {
  editForm.value = {
    ...row,
    modelIds: (row.allowedModels || []).map((m: any) => m.id)
  };
  editOpen.value = true;
};

const handleUpdate = async () => {
  submitting.value = true;
  try {
    await api.put(`/api/keys/${editForm.value.id}`, editForm.value);
    ElMessage.success('已保存');
    editOpen.value = false;
    loadKeys();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '保存失败');
  } finally {
    submitting.value = false;
  }
};

const handleRegenerate = async (row: any) => {
  try {
    await ElMessageBox.confirm(
      `重新生成后，Key「${row.name || row.keyHash}」的旧值将立即失效且无法找回。确定继续吗？`,
      '重新生成 Key',
      { type: 'warning', confirmButtonText: '重新生成', cancelButtonText: '取消' }
    );
    regeneratingId.value = row.id;
    const { data } = await api.post(`/api/keys/${row.id}/regenerate`);
    revealTitle.value = 'Key 已重新生成';
    revealedKey.value = data.key;
    revealOpen.value = true;
    loadKeys();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '重新生成失败');
  } finally {
    regeneratingId.value = null;
  }
};

const handleDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确定删除 Key「${row.name || row.keyHash}」吗？关联的使用记录会保留。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    });
    await api.delete(`/api/keys/${row.id}`);
    ElMessage.success('已删除');
    loadKeys();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '删除失败');
  }
};

const openStats = async (row: any) => {
  statsTitle.value = `统计数据 — ${row.name || row.keyHash}`;
  statsData.value = null;
  statsOpen.value = true;
  statsLoading.value = true;
  try {
    const { data } = await api.get(`/api/keys/${row.id}/stats`);
    statsData.value = data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载统计失败');
    statsOpen.value = false;
  } finally {
    statsLoading.value = false;
  }
};

const copyKey = async () => {
  try {
    await navigator.clipboard.writeText(revealedKey.value);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.warning('复制失败，请手动选择复制');
  }
};

onMounted(loadKeys);
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 18px;
}
.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.page-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.search {
  max-width: 280px;
}
.filter {
  width: 130px;
}

.table-card {
  padding: 6px 8px;
}
.cell-name {
  font-weight: 500;
}
.key-hash {
  font-size: 12px;
  color: var(--text-2);
  background: var(--bg-deep);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.quota {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--text-2);
}
.quota .dim {
  color: var(--text-3);
}
.date {
  font-size: 12px;
  color: var(--text-2);
}
.row-btn {
  padding: 6px;
}

.field-hint {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 4px;
  line-height: 1.4;
}

.reveal-tip {
  margin: 0 0 12px;
  color: var(--text-2);
  font-size: 13px;
}
.reveal-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-deep);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 10px;
}
.reveal-key {
  flex: 1;
  font-size: 13px;
  color: #a5f3fc;
  word-break: break-all;
}

.stats-groups {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.stats-group {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: var(--bg-surface);
}
.stats-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}
.stats-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-label {
  font-size: 12px;
  color: var(--text-3);
}
.stat-value {
  font-size: 13px;
  color: var(--text-1);
}
.stat-value.cost {
  color: #6ee7b7;
  font-weight: 600;
}
.stats-models {
  margin-top: 16px;
}
.model-tag {
  font-size: 12px;
  font-weight: 600;
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.2);
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
}
.cost { color: #6ee7b7; font-weight: 600; }
.stats-empty {
  font-size: 12px;
  color: var(--text-3);
  padding: 8px 2px;
}
</style>
