<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h2 class="page-title">提供商</h2>
        <p class="page-sub">配置上游 LLM 服务的接入信息与可用模型（密钥加密存储）</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">添加提供商</el-button>
    </header>

    <section class="tech-card toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索名称 / 类型"
        :prefix-icon="Search"
        clearable
        class="search"
        @input="loadProviders()"
      />
      <el-select v-model="typeFilter" placeholder="类型" clearable class="filter" @change="loadProviders()">
        <el-option label="OpenAI" value="OPENAI" />
        <el-option label="Anthropic" value="ANTHROPIC" />
        <el-option label="Google" value="GOOGLE" />
        <el-option label="Hugging Face" value="HUGGINGFACE" />
      </el-select>
      <el-button :icon="Refresh" circle @click="loadProviders" />
    </section>

    <section class="tech-card table-card">
      <el-table v-loading="loading" :data="filtered" style="width: 100%" :row-key="rowKey" :expand-row-keys="expandedIds" @expand-change="onExpandChange">
        <template #empty>
          <el-empty description="暂无提供商配置" :image-size="80" />
        </template>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="model-panel">
              <div class="proto-panel">
                <div class="proto-head">
                  <span class="proto-title">支持的协议（直通端点）</span>
                </div>
                <el-table v-if="(row.protocols || []).length" :data="row.protocols" size="small" class="proto-table">
                  <el-table-column label="协议" width="200">
                    <template #default="{ row: p }">
                      <span class="proto-name font-mono">{{ protocolLabel(p.protocol) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="路径（空=协议默认）" min-width="220">
                    <template #default="{ row: p }">
                      <el-input
                        :model-value="p.path || defaultPath(p.protocol)"
                        :placeholder="defaultPath(p.protocol)"
                        size="small"
                        @change="(v: string) => saveProtocolPath(row, p, v)"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="状态" width="90">
                    <template #default="{ row: p }">
                      <el-switch :model-value="p.status === 'ACTIVE'" size="small" @change="(v: string | number | boolean) => toggleProtocol(row, p, v)" />
                    </template>
                  </el-table-column>
                  <el-table-column label="删除" width="70" align="right">
                    <template #default="{ row: p }">
                      <el-button text type="danger" :icon="Delete" size="small" @click="deleteProtocol(row, p)" />
                    </template>
                  </el-table-column>
                </el-table>
                <div class="proto-add">
                  <el-select v-model="row._newProtocol" placeholder="选择协议" clearable size="small">
                    <el-option v-for="opt in availableProtocols(row)" :key="opt" :label="protocolLabel(opt)" :value="opt" />
                  </el-select>
                  <el-button type="primary" :icon="Plus" size="small" @click="addProtocol(row)">添加协议</el-button>
                </div>
                <div v-if="!(row.protocols || []).length" class="proto-empty">未配置协议，默认按 OPENAI_CHAT 直通</div>
              </div>
              <div class="model-add">
                <el-input
                  v-model="newModelName"
                  placeholder="添加可用模型，如 deepseek-chat，回车确认"
                  clearable
                  class="model-input"
                  @keyup.enter="addModel(row)"
                />
                <el-button type="primary" :icon="Plus" :loading="addingId === row.id" @click="addModel(row)">
                  添加模型
                </el-button>
              </div>
              <el-table v-if="modelsByProvider(row.id).length" :data="modelsByProvider(row.id)" size="small" class="model-table">
                <el-table-column label="模型名称" min-width="150">
                  <template #default="{ row: m }">
                    <code class="model-name font-mono">{{ m.name }}</code>
                  </template>
                </el-table-column>
                <el-table-column label="输入 $/M" width="150">
                  <template #default="{ row: m }">
                    <el-input-number v-model="m.inputPrice" :precision="4" :step="0.1" :min="0" size="small" controls-position="right" style="width: 110px" @change="() => saveModelPrice(m)" />
                  </template>
                </el-table-column>
                <el-table-column label="输出 $/M" width="150">
                  <template #default="{ row: m }">
                    <el-input-number v-model="m.outputPrice" :precision="4" :step="0.1" :min="0" size="small" controls-position="right" style="width: 110px" @change="() => saveModelPrice(m)" />
                  </template>
                </el-table-column>
                <el-table-column label="缓存 $/M" width="150">
                  <template #default="{ row: m }">
                    <el-input-number v-model="m.cachePrice" :precision="4" :step="0.1" :min="0" size="small" controls-position="right" style="width: 110px" @change="() => saveModelPrice(m)" />
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="90">
                  <template #default="{ row: m }">
                    <el-switch :model-value="m.status === 'ACTIVE'" size="small" @change="(v: string | number | boolean) => toggleModel(m, v)" />
                  </template>
                </el-table-column>
                <el-table-column width="56" align="right">
                  <template #default="{ row: m }">
                    <el-tooltip content="删除模型">
                      <el-button text type="danger" :icon="Delete" size="small" @click="deleteModel(m)" />
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="model-empty">该提供商暂无模型，在上方输入名称添加第一个</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="64" class-name="font-mono" />
        <el-table-column label="提供商" min-width="180">
          <template #default="{ row }">
            <div class="p-cell">
              <span class="p-badge" :class="row.type.toLowerCase()">{{ pAbbr(row.type) }}</span>
              <div>
                <div class="p-name">{{ row.name }}</div>
                <div class="p-type">{{ typeLabel(row.type) }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Base URL" min-width="220">
          <template #default="{ row }">
            <code class="url font-mono">{{ row.baseUrl }}</code>
          </template>
        </el-table-column>
        <el-table-column label="API Key" width="150">
          <template #default="{ row }">
            <code class="key font-mono">{{ row.apiKey }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" effect="dark" disable-transitions>
              {{ row.status === 'ACTIVE' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="right">
          <template #default="{ row }">
            <el-tooltip content="测试连接">
              <el-button
                text
                :loading="testingId === row.id"
                :icon="Aim"
                class="row-btn"
                @click="handleTest(row)"
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

    <el-dialog v-model="createOpen" :title="editingId ? '编辑提供商' : '添加提供商'" width="460px" destroy-on-close>
      <el-form ref="createRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：OpenAI 官方" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="OpenAI" value="OPENAI" />
            <el-option label="Anthropic" value="ANTHROPIC" />
            <el-option label="Google" value="GOOGLE" />
            <el-option label="Hugging Face" value="HUGGINGFACE" />
            <el-option label="DeepSeek" value="DEEPSEEK" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="https://api.deepseek.com" />
        </el-form-item>
        <el-form-item label="路径" prop="path">
          <el-input v-model="form.path" placeholder="/chat/completions" />
          <div class="field-hint">转发路径，支持 {model} 占位（Google 用 /models/{model}:generateContent）</div>
        </el-form-item>
        <el-form-item label="API Key" prop="apiKey">
          <el-input v-model="form.apiKey" type="password" show-password :placeholder="editingId ? '留空表示不修改' : 'sk-…'" />
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="ACTIVE">启用</el-radio-button>
            <el-radio-button value="INACTIVE">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Search, Refresh, Edit, Delete, Aim } from '@element-plus/icons-vue';
import api from '../api';

const PROTOCOL_DEFAULTS: Record<string, string> = {
  OPENAI_CHAT: '/chat/completions',
  OPENAI_RESPONSES: '/responses',
  ANTHROPIC_MESSAGES: '/v1/messages'
};
const PROTOCOL_LABELS: Record<string, string> = {
  OPENAI_CHAT: 'OpenAI Chat',
  OPENAI_RESPONSES: 'OpenAI Responses',
  ANTHROPIC_MESSAGES: 'Anthropic Messages'
};
const protocolLabel = (p: string) => PROTOCOL_LABELS[p] || p;
const defaultPath = (p: string) => PROTOCOL_DEFAULTS[p] || '';
const availableProtocols = (row: any) =>
  Object.keys(PROTOCOL_DEFAULTS).filter(p => !(row.protocols || []).some((rp: any) => rp.protocol === p));

const addProtocol = async (row: any) => {
  const protocol = row._newProtocol;
  if (!protocol) { ElMessage.warning('请选择协议'); return; }
  try {
    await api.post(`/api/providers/${row.id}/protocols`, { protocol });
    ElMessage.success('协议已添加');
    row._newProtocol = '';
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '添加失败');
  }
};

const saveProtocolPath = async (row: any, p: any, path: string) => {
  const normalized = path.trim() === defaultPath(p.protocol) ? '' : path.trim();
  try {
    await api.put(`/api/providers/${row.id}/protocols/${p.id}`, { path: normalized });
    ElMessage.success(normalized ? '路径已保存' : '已恢复默认路径');
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '保存失败');
    await loadProviders();
  }
};

const toggleProtocol = async (row: any, p: any, active: string | number | boolean) => {
  try {
    await api.put(`/api/providers/${row.id}/protocols/${p.id}`, { status: active ? 'ACTIVE' : 'INACTIVE' });
    ElMessage.success(active ? '已启用' : '已停用');
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '操作失败');
    await loadProviders();
  }
};

const deleteProtocol = async (row: any, p: any) => {
  try {
    await ElMessageBox.confirm(`确定删除协议「${protocolLabel(p.protocol)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    await api.delete(`/api/providers/${row.id}/protocols/${p.id}`);
    ElMessage.success('已删除');
    await loadProviders();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '删除失败');
  }
};

const providers = ref<any[]>([]);
const models = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const testingId = ref<number | null>(null);
const addingId = ref<number | null>(null);
const newModelName = ref('');
const keyword = ref('');
const typeFilter = ref('');

const expandedIds = ref<number[]>([]);
const rowKey = (row: any) => row.id;
const onExpandChange = (row: any, expanded: boolean) => {
  expandedIds.value = expanded
    ? [...expandedIds.value, row.id]
    : expandedIds.value.filter(id => id !== row.id);
};

const createOpen = ref(false);
const editingId = ref<number | null>(null);
const createRef = ref<FormInstance>();
const form = ref({ name: '', type: 'OPENAI', baseUrl: '', path: '/chat/completions', apiKey: '', status: 'ACTIVE' });

const rules: FormRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  baseUrl: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }]
};

const filtered = computed(() => providers.value.filter(p =>
  (!typeFilter.value || p.type === typeFilter.value) &&
  (!keyword.value || p.name?.includes(keyword.value) || p.type?.includes(keyword.value))
));

const modelsByProvider = (providerId: number) => models.value.filter(m => m.providerId === providerId);

const typeLabel = (t: string) => ({ OPENAI: 'OpenAI', ANTHROPIC: 'Anthropic', GOOGLE: 'Google', HUGGINGFACE: 'Hugging Face', DEEPSEEK: 'DeepSeek' })[t] || t;
const pAbbr = (t: string) => ({ OPENAI: 'OA', ANTHROPIC: 'AN', GOOGLE: 'GO', HUGGINGFACE: 'HF', DEEPSEEK: 'DS' })[t] || '?';

const loadProviders = async () => {
  loading.value = true;
  try {
    const [pRes, mRes] = await Promise.all([api.get('/api/providers'), api.get('/api/models')]);
    providers.value = pRes.data;
    models.value = mRes.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载失败');
  } finally {
    loading.value = false;
  }
};

const addModel = async (row: any) => {
  const name = newModelName.value.trim();
  if (!name) {
    ElMessage.warning('请输入模型名称');
    return;
  }
  addingId.value = row.id;
  try {
    await api.post('/api/models', { name, providerId: row.id });
    ElMessage.success('模型已添加');
    newModelName.value = '';
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '添加失败');
  } finally {
    addingId.value = null;
  }
};

const priceTimers = new Map<number, ReturnType<typeof setTimeout>>();

const saveModelPrice = (m: any) => {
  if (priceTimers.has(m.id)) clearTimeout(priceTimers.get(m.id));
  priceTimers.set(m.id, setTimeout(async () => {
    priceTimers.delete(m.id);
    try {
      await api.put(`/api/models/${m.id}`, {
        inputPrice: m.inputPrice ?? 0,
        outputPrice: m.outputPrice ?? 0,
        cachePrice: m.cachePrice ?? 0
      });
    } catch (e: any) {
      ElMessage.error(e.response?.data?.error || '价格保存失败');
      await loadProviders();
    }
  }, 400));
};

const toggleModel = async (m: any, active: string | number | boolean) => {
  try {
    await api.put(`/api/models/${m.id}`, { status: active ? 'ACTIVE' : 'INACTIVE' });
    ElMessage.success(active ? '已启用' : '已停用');
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '操作失败');
    await loadProviders();
  }
};

const deleteModel = async (m: any) => {
  try {
    await ElMessageBox.confirm(`确定删除模型「${m.name}」吗？关联的 Key 授权会被清理。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    });
    await api.delete(`/api/models/${m.id}`);
    ElMessage.success('已删除');
    await loadProviders();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '删除失败');
  }
};

const openCreate = () => {
  editingId.value = null;
  form.value = { name: '', type: 'OPENAI', baseUrl: '', path: '/chat/completions', apiKey: '', status: 'ACTIVE' };
  createOpen.value = true;
};

const openEdit = (row: any) => {
  editingId.value = row.id;
  form.value = { name: row.name, type: row.type, baseUrl: row.baseUrl, path: row.path || '/chat/completions', apiKey: '', status: row.status };
  createOpen.value = true;
};

const handleSave = async () => {
  if (!createRef.value) return;
  const ok = await createRef.value.validate().catch(() => false);
  if (!ok) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      await api.put(`/api/providers/${editingId.value}`, form.value);
      ElMessage.success('已保存');
    } else {
      await api.post('/api/providers', form.value);
      ElMessage.success('已添加');
    }
    createOpen.value = false;
    loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '保存失败');
  } finally {
    submitting.value = false;
  }
};

const handleTest = async (row: any) => {
  testingId.value = row.id;
  try {
    const { data } = await api.post(`/api/providers/${row.id}/test`, {});
    ElMessageBox.alert(
      `上游返回 ${data.status}：${data.detail}`,
      '连接测试成功',
      { type: 'success', confirmButtonText: '知道了' }
    );
  } catch (e: any) {
    const detail = e.response?.data?.detail || e.response?.data?.error || '测试失败';
    ElMessageBox.alert(
      detail,
      '连接测试失败',
      { type: 'error', confirmButtonText: '知道了' }
    );
  } finally {
    testingId.value = null;
  }
};

const handleDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确定删除提供商「${row.name}」吗？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    });
    await api.delete(`/api/providers/${row.id}`);
    ElMessage.success('已删除');
    loadProviders();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '删除失败');
  }
};

onMounted(loadProviders);
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 18px;
}
.page-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-sub { margin: 4px 0 0; font-size: 13px; color: var(--text-3); }
.toolbar { display: flex; gap: 12px; align-items: center; padding: 14px 16px; margin-bottom: 16px; }
.search { max-width: 280px; }
.filter { width: 130px; }
.table-card { padding: 6px 8px; }

.p-cell { display: flex; align-items: center; gap: 12px; }
.p-badge {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-2);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
}
.p-badge.openai { color: #5eead4; border-color: rgba(45,212,191,.3); background: rgba(45,212,191,.08); }
.p-badge.anthropic { color: #fda4af; border-color: rgba(251,113,133,.3); background: rgba(251,113,133,.08); }
.p-badge.google { color: #fde68a; border-color: rgba(251,191,36,.3); background: rgba(251,191,36,.08); }
.p-badge.huggingface { color: #a5b4fc; border-color: rgba(129,140,248,.3); background: rgba(129,140,248,.08); }
.p-name { font-weight: 500; color: var(--text-1); }
.p-type { font-size: 12px; color: var(--text-3); }

.url, .key { font-size: 12px; color: var(--text-2); background: var(--bg-deep); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); }
.row-btn { padding: 6px; }
.field-hint { font-size: 12px; color: var(--text-3); margin-top: 4px; line-height: 1.4; }

.proto-panel { padding: 4px 12px 12px; margin-top: 10px; }
.proto-head { margin-bottom: 8px; }
.proto-title { font-size: 13px; font-weight: 600; color: var(--text-1); }
.proto-add { display: flex; gap: 10px; max-width: 360px; margin-top: 10px; }
.proto-table { margin-top: 2px; }
.proto-name { font-size: 12px; font-weight: 600; color: #fcd34d; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); padding: 2px 8px; border-radius: 6px; }
.proto-empty { font-size: 12px; color: var(--text-3); padding: 6px 2px; }

.model-panel { padding: 4px 12px 12px; }
.model-add { display: flex; gap: 10px; max-width: 520px; margin-bottom: 12px; }
.model-input { flex: 1; }
.model-table { margin-top: 2px; }
.model-name {
  font-size: 12px;
  font-weight: 600;
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.2);
  padding: 2px 8px;
  border-radius: 6px;
}
.model-empty {
  font-size: 12px;
  color: var(--text-3);
  padding: 6px 2px;
}
</style>
