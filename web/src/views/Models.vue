<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h2 class="page-title">模型</h2>
        <p class="page-sub">配置可用模型及其归属的上游提供商，网关按此路由</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">添加模型</el-button>
    </header>

    <section class="tech-card toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索模型名称"
        :prefix-icon="Search"
        clearable
        class="search"
        @input="loadModels()"
      />
      <el-select v-model="providerFilter" placeholder="提供商" clearable class="filter" @change="loadModels()">
        <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-button :icon="Refresh" circle @click="loadModels" />
    </section>

    <section class="tech-card table-card">
      <el-table v-loading="loading" :data="filtered" style="width: 100%">
        <template #empty>
          <el-empty description="暂无模型，先添加提供商再配置模型" :image-size="80" />
        </template>
        <el-table-column prop="id" label="ID" width="64" class-name="font-mono" />
        <el-table-column label="模型名称" min-width="200">
          <template #default="{ row }">
            <code class="model-name font-mono">{{ row.name }}</code>
          </template>
        </el-table-column>
        <el-table-column label="提供商" min-width="180">
          <template #default="{ row }">
            <div class="p-cell">
              <span class="p-badge" :class="row.provider?.type?.toLowerCase()">{{ pAbbr(row.provider?.type) }}</span>
              <div>
                <div class="p-name">{{ row.provider?.name || '—' }}</div>
                <div class="p-type font-mono">{{ row.provider?.baseUrl }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" effect="dark" disable-transitions>
              {{ row.status === 'ACTIVE' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="right">
          <template #default="{ row }">
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

    <el-dialog v-model="dialogOpen" :title="editingId ? '编辑模型' : '添加模型'" width="440px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="模型名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：deepseek-v4-flash" />
        </el-form-item>
        <el-form-item label="提供商" prop="providerId">
          <el-select v-model="form.providerId" placeholder="选择上游提供商" style="width: 100%">
            <el-option v-for="p in activeProviders" :key="p.id" :label="`${p.name} (${typeLabel(p.type)})`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="ACTIVE">启用</el-radio-button>
            <el-radio-button value="INACTIVE">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Search, Refresh, Edit, Delete } from '@element-plus/icons-vue';
import api from '../api';

const models = ref<any[]>([]);
const providers = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const keyword = ref('');
const providerFilter = ref<number | ''>('');

const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = ref({ name: '', providerId: undefined as number | undefined, status: 'ACTIVE' });

const rules: FormRules = {
  name: [{ required: true, message: '请输入模型名称', trigger: 'blur' }],
  providerId: [{ required: true, message: '请选择提供商', trigger: 'change' }]
};

const activeProviders = computed(() => providers.value.filter(p => p.status === 'ACTIVE'));
const filtered = computed(() => models.value.filter(m =>
  (!providerFilter.value || m.providerId === providerFilter.value) &&
  (!keyword.value || m.name?.includes(keyword.value))
));

const typeLabel = (t: string) => ({ OPENAI: 'OpenAI', ANTHROPIC: 'Anthropic', GOOGLE: 'Google', HUGGINGFACE: 'Hugging Face', DEEPSEEK: 'DeepSeek' })[t] || t;
const pAbbr = (t: string) => ({ OPENAI: 'OA', ANTHROPIC: 'AN', GOOGLE: 'GO', HUGGINGFACE: 'HF', DEEPSEEK: 'DS' })[t] || '?';

const loadModels = async () => {
  loading.value = true;
  try {
    const [m, p] = await Promise.all([api.get('/api/models'), api.get('/api/providers')]);
    models.value = m.data;
    providers.value = p.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载失败');
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  editingId.value = null;
  form.value = { name: '', providerId: undefined, status: 'ACTIVE' };
  dialogOpen.value = true;
};

const openEdit = (row: any) => {
  editingId.value = row.id;
  form.value = { name: row.name, providerId: row.providerId, status: row.status };
  dialogOpen.value = true;
};

const handleSave = async () => {
  if (!formRef.value) return;
  const ok = await formRef.value.validate().catch(() => false);
  if (!ok) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      await api.put(`/api/models/${editingId.value}`, form.value);
      ElMessage.success('已保存');
    } else {
      await api.post('/api/models', form.value);
      ElMessage.success('已添加');
    }
    dialogOpen.value = false;
    loadModels();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '保存失败');
  } finally {
    submitting.value = false;
  }
};

const handleDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确定删除模型「${row.name}」吗？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    });
    await api.delete(`/api/models/${row.id}`);
    ElMessage.success('已删除');
    loadModels();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '删除失败');
  }
};

onMounted(loadModels);
</script>

<style scoped>
.page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; }
.page-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-sub { margin: 4px 0 0; font-size: 13px; color: var(--text-3); }
.toolbar { display: flex; gap: 12px; align-items: center; padding: 14px 16px; margin-bottom: 16px; }
.search { max-width: 280px; }
.filter { width: 180px; }
.table-card { padding: 6px 8px; }

.model-name {
  font-size: 13px;
  font-weight: 600;
  color: #a5f3fc;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.2);
  padding: 3px 10px;
  border-radius: 7px;
}
.p-cell { display: flex; align-items: center; gap: 12px; }
.p-badge {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-2);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
}
.p-badge.deepseek { color: #67e8f9; border-color: rgba(34,211,238,.3); background: rgba(34,211,238,.08); }
.p-badge.openai { color: #5eead4; border-color: rgba(45,212,191,.3); background: rgba(45,212,191,.08); }
.p-badge.anthropic { color: #fda4af; border-color: rgba(251,113,133,.3); background: rgba(251,113,133,.08); }
.p-badge.google { color: #fde68a; border-color: rgba(251,191,36,.3); background: rgba(251,191,36,.08); }
.p-badge.huggingface { color: #a5b4fc; border-color: rgba(129,140,248,.3); background: rgba(129,140,248,.08); }
.p-name { font-weight: 500; color: var(--text-1); }
.p-type { font-size: 11px; color: var(--text-3); }
.row-btn { padding: 6px; }
</style>
