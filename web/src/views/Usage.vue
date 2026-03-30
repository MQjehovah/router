<template>
  <div>
    <h2>使用统计</h2>
    <el-table :data="records" stripe>
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="model" label="模型" />
      <el-table-column prop="apiKey.name" label="API Key" />
      <el-table-column prop="provider.name" label="提供商" />
      <el-table-column prop="tokensIn" label="输入 Token" />
      <el-table-column prop="tokensOut" label="输出 Token" />
      <el-table-column prop="cost" label="费用">
        <template #default="{ row }">${{ row.cost?.toFixed(6) }}</template>
      </el-table-column>
      <el-table-column prop="latencyMs" label="延迟(ms)" />
      <el-table-column prop="createdAt" label="时间">
        <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      style="margin-top: 20px"
      v-model:current-page="page"
      :page-size="50"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="loadRecords"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../api';

const records = ref<any[]>([]);
const total = ref(0);
const page = ref(1);

const loadRecords = async () => {
  try {
    const { data } = await api.get('/api/usage/records', { params: { limit: 50, offset: (page.value - 1) * 50 } });
    records.value = data.records;
    total.value = data.total;
  } catch (e) {
    console.error(e);
  }
};

onMounted(loadRecords);
</script>