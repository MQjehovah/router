<template>
  <div>
    <el-row :gutter="20" style="margin-bottom: 20px">
      <el-col :span="12">
        <el-card>
          <h3>交易记录</h3>
          <el-table :data="transactions" stripe max-height="400">
            <el-table-column prop="id" label="ID" width="60" />
            <el-table-column prop="type" label="类型">
              <template #default="{ row }">
                <el-tag :type="row.type === 'RECHARGE' ? 'success' : row.type === 'REFUND' ? 'warning' : 'info'">
                  {{ row.type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="amount" label="金额">
              <template #default="{ row }">${{ row.amount }}</template>
            </el-table-column>
            <el-table-column prop="balance" label="余额">
              <template #default="{ row }">${{ row.balance }}</template>
            </el-table-column>
            <el-table-column prop="description" label="描述" />
            <el-table-column prop="createdAt" label="时间">
              <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <h3>账单</h3>
          <el-table :data="bills" stripe max-height="400">
            <el-table-column prop="id" label="ID" width="60" />
            <el-table-column prop="user.name" label="用户" />
            <el-table-column prop="totalCost" label="总费用">
              <template #default="{ row }">${{ row.totalCost }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态">
              <template #default="{ row }">
                <el-tag :type="row.status === 'PAID' ? 'success' : row.status === 'PENDING' ? 'warning' : 'danger'">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间">
              <template #default="{ row }">{{ new Date(row.createdAt).toLocaleDateString() }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
    <el-card>
      <h3>充值</h3>
      <el-form :inline="true" :model="rechargeForm">
        <el-form-item label="金额">
          <el-input-number v-model="rechargeForm.amount" :min="1" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="rechargeForm.description" placeholder="可选" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleRecharge">充值</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const transactions = ref<any[]>([]);
const bills = ref<any[]>([]);
const rechargeForm = ref({ amount: 100, description: '' });

const loadData = async () => {
  try {
    const [transRes, billsRes] = await Promise.all([
      api.get('/api/transactions'),
      api.get('/api/bills')
    ]);
    transactions.value = transRes.data;
    bills.value = billsRes.data;
  } catch (e) {
    console.error(e);
  }
};

const handleRecharge = async () => {
  try {
    await api.post('/api/transactions/recharge', rechargeForm.value);
    ElMessage.success('充值成功');
    loadData();
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || '充值失败');
  }
};

onMounted(loadData);
</script>