<template>
  <div>
    <h2>仪表盘</h2>
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ stats.total.requests }}</div>
            <div class="stat-label">总请求数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ (stats.total.tokensIn || 0) + (stats.total.tokensOut || 0) }}</div>
            <div class="stat-label">总 Token 数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">${{ stats.total.cost?.toFixed(4) || '0.0000' }}</div>
            <div class="stat-label">总消费</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ stats.today.requests }}</div>
            <div class="stat-label">今日请求</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-card style="margin-top: 20px">
      <h3>按模型使用量</h3>
      <el-table :data="stats.monthly" stripe>
        <el-table-column prop="model" label="模型" />
        <el-table-column prop="tokensIn" label="输入 Token" />
        <el-table-column prop="tokensOut" label="输出 Token" />
        <el-table-column prop="cost" label="费用">
          <template #default="{ row }">
            ${{ row.cost?.toFixed(6) || '0.000000' }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../api';

const stats = ref<any>({
  total: {},
  today: {},
  monthly: []
});

onMounted(async () => {
  try {
    const { data } = await api.get('/api/usage/stats');
    stats.value = data;
  } catch (e) {
    console.error(e);
  }
});
</script>

<style scoped>
.stat-card {
  text-align: center;
  padding: 20px 0;
}
.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #409eff;
}
.stat-label {
  margin-top: 10px;
  color: #666;
}
</style>