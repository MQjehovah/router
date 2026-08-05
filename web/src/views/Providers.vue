<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h2 class="page-title">提供商</h2>
        <p class="page-sub">配置上游 LLM 服务的接入信息（密钥加密存储）</p>
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
      <el-table v-loading="loading" :data="filtered" style="width: 100%">
        <template #empty>
          <el-empty description="暂无提供商配置" :image-size="80" />
        </template>
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
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="https://api.openai.com/v1" />
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

const providers = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const testingId = ref<number | null>(null);
const keyword = ref('');
const typeFilter = ref('');

const createOpen = ref(false);
const editingId = ref<number | null>(null);
const createRef = ref<FormInstance>();
const form = ref({ name: '', type: 'OPENAI', baseUrl: '', apiKey: '', status: 'ACTIVE' });

const rules: FormRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  baseUrl: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }]
};

const filtered = computed(() => providers.value.filter(p =>
  (!typeFilter.value || p.type === typeFilter.value) &&
  (!keyword.value || p.name?.includes(keyword.value) || p.type?.includes(keyword.value))
));

const typeLabel = (t: string) => ({ OPENAI: 'OpenAI', ANTHROPIC: 'Anthropic', GOOGLE: 'Google', HUGGINGFACE: 'Hugging Face' })[t] || t;
const pAbbr = (t: string) => ({ OPENAI: 'OA', ANTHROPIC: 'AN', GOOGLE: 'GO', HUGGINGFACE: 'HF' })[t] || '?';

const loadProviders = async () => {
  loading.value = true;
  try {
    const { data } = await api.get('/api/providers');
    providers.value = data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载失败');
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  editingId.value = null;
  form.value = { name: '', type: 'OPENAI', baseUrl: '', apiKey: '', status: 'ACTIVE' };
  createOpen.value = true;
};

const openEdit = (row: any) => {
  editingId.value = row.id;
  form.value = { name: row.name, type: row.type, baseUrl: row.baseUrl, apiKey: '', status: row.status };
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
</style>
