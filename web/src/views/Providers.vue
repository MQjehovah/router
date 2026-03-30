<template>
  <div>
    <div class="header">
      <h2>提供商管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">添加提供商</el-button>
    </div>
    <el-table :data="providers" stripe>
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="type" label="类型" />
      <el-table-column prop="baseUrl" label="Base URL" />
      <el-table-column prop="apiKey" label="API Key" />
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'danger'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="添加提供商" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type">
            <el-option label="OpenAI" value="OPENAI" />
            <el-option label="Anthropic" value="ANTHROPIC" />
            <el-option label="Google" value="GOOGLE" />
            <el-option label="HuggingFace" value="HUGGINGFACE" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="form.baseUrl" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDialog" title="编辑提供商" width="500px">
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="editForm.baseUrl" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editForm.status">
            <el-option label="Active" value="ACTIVE" />
            <el-option label="Inactive" value="INACTIVE" />
          </el-select>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="editForm.apiKey" type="password" placeholder="留空表示不修改" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpdate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const providers = ref<any[]>([]);
const showCreateDialog = ref(false);
const showEditDialog = ref(false);
const form = ref({ name: '', type: 'OPENAI', baseUrl: '', apiKey: '' });
const editForm = ref<any>({});

const loadProviders = async () => {
  try {
    const { data } = await api.get('/api/providers');
    providers.value = data;
  } catch (e) {
    console.error(e);
  }
};

const handleCreate = async () => {
  try {
    await api.post('/api/providers', form.value);
    ElMessage.success('创建成功');
    showCreateDialog.value = false;
    loadProviders();
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '创建失败');
  }
};

const handleEdit = (row: any) => {
  editForm.value = { ...row };
  showEditDialog.value = true;
};

const handleUpdate = async () => {
  try {
    await api.put(`/api/providers/${editForm.value.id}`, editForm.value);
    ElMessage.success('更新成功');
    showEditDialog.value = false;
    loadProviders();
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '更新失败');
  }
};

const handleDelete = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这个提供商吗?', '警告', { type: 'warning' });
    await api.delete(`/api/providers/${id}`);
    ElMessage.success('删除成功');
    loadProviders();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '删除失败');
    }
  }
};

onMounted(loadProviders);
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
</style>