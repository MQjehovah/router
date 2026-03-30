<template>
  <div>
    <div class="header">
      <h2>用户管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">创建用户</el-button>
    </div>
    <el-table :data="users" stripe>
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="email" label="邮箱" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="role" label="角色">
        <template #default="{ row }">
          <el-tag :type="row.role === 'ADMIN' ? 'danger' : 'success'">{{ row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="balance" label="余额">
        <template #default="{ row }">${{ row.balance }}</template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间">
        <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="创建用户" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role">
            <el-option label="用户" value="USER" />
            <el-option label="管理员" value="ADMIN" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDialog" title="编辑用户" width="500px">
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role">
            <el-option label="用户" value="USER" />
            <el-option label="管理员" value="ADMIN" />
          </el-select>
        </el-form-item>
        <el-form-item label="余额">
          <el-input-number v-model="editForm.balance" :min="0" />
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

const users = ref<any[]>([]);
const showCreateDialog = ref(false);
const showEditDialog = ref(false);
const form = ref({ email: '', password: '', name: '', role: 'USER' });
const editForm = ref<any>({});

const loadUsers = async () => {
  try {
    const { data } = await api.get('/api/users');
    users.value = data;
  } catch (e) {
    console.error(e);
  }
};

const handleCreate = async () => {
  try {
    await api.post('/api/users', form.value);
    ElMessage.success('创建成功');
    showCreateDialog.value = false;
    loadUsers();
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
    await api.put(`/api/users/${editForm.value.id}`, editForm.value);
    ElMessage.success('更新成功');
    showEditDialog.value = false;
    loadUsers();
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '更新失败');
  }
};

const handleDelete = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除这个用户吗?', '警告', { type: 'warning' });
    await api.delete(`/api/users/${id}`);
    ElMessage.success('删除成功');
    loadUsers();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '删除失败');
    }
  }
};

onMounted(loadUsers);
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
</style>