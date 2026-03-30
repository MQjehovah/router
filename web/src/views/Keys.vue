<template>
  <div>
    <div class="header">
      <h2>API Key 管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">创建 Key</el-button>
    </div>
    <el-table :data="keys" stripe>
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="keyHash" label="Key" />
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'danger'">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="rateLimit" label="速率限制" />
      <el-table-column prop="dailyQuota" label="日配额" />
      <el-table-column prop="monthlyQuota" label="月配额" />
      <el-table-column prop="createdAt" label="创建时间">
        <template #default="{ row }">
          {{ new Date(row.createdAt).toLocaleString() }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="创建 API Key" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="日配额">
          <el-input-number v-model="form.dailyQuota" :min="0" />
        </el-form-item>
        <el-form-item label="月配额">
          <el-input-number v-model="form.monthlyQuota" :min="0" />
        </el-form-item>
        <el-form-item label="速率限制">
          <el-input-number v-model="form.rateLimit" :min="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDialog" title="编辑 API Key" width="500px">
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editForm.status">
            <el-option label="Active" value="ACTIVE" />
            <el-option label="Inactive" value="INACTIVE" />
          </el-select>
        </el-form-item>
        <el-form-item label="日配额">
          <el-input-number v-model="editForm.dailyQuota" :min="0" />
        </el-form-item>
        <el-form-item label="月配额">
          <el-input-number v-model="editForm.monthlyQuota" :min="0" />
        </el-form-item>
        <el-form-item label="速率限制">
          <el-input-number v-model="editForm.rateLimit" :min="1" />
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

const keys = ref<any[]>([]);
const showCreateDialog = ref(false);
const showEditDialog = ref(false);
const form = ref({ name: '', dailyQuota: 100000, monthlyQuota: 3000000, rateLimit: 60 });
const editForm = ref<any>({});

const loadKeys = async () => {
  try {
    const { data } = await api.get('/api/keys');
    keys.value = data;
  } catch (e) {
    console.error(e);
  }
};

const handleCreate = async () => {
  try {
    const { data } = await api.post('/api/keys', form.value);
    ElMessage.success(`Key 创建成功: ${data.key}`);
    ElMessageBox.alert(`请保存您的 API Key: ${data.key}`, 'API Key', { confirmButtonText: '确定' });
    showCreateDialog.value = false;
    loadKeys();
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
    await api.put(`/api/keys/${editForm.value.id}`, editForm.value);
    ElMessage.success('更新成功');
    showEditDialog.value = false;
    loadKeys();
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '更新失败');
  }
};

const handleDelete = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这个 API Key 吗?', '警告', { type: 'warning' });
    await api.delete(`/api/keys/${id}`);
    ElMessage.success('删除成功');
    loadKeys();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '删除失败');
    }
  }
};

onMounted(loadKeys);
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
</style>