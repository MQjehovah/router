<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h2 class="page-title">使用统计</h2>
        <p class="page-sub">每一次请求的 Token、费用与延迟明细</p>
      </div>
      <el-button :icon="Refresh" @click="loadRecords">刷新</el-button>
    </header>

    <section class="tech-card toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索模型 / Key"
        :prefix-icon="Search"
        clearable
        class="search"
        @input="page = 1; loadRecords()"
      />
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        class="range"
        @change="page = 1; loadRecords()"
      />
      <el-button :icon="Refresh" circle @click="loadRecords" />
    </section>

    <section class="tech-card table-card">
      <el-table v-loading="loading" :data="filtered" style="width: 100%">
        <template #empty>
          <el-empty description="还没有使用记录，通过网关发起请求后这里会实时出现" :image-size="80" />
        </template>
        <el-table-column prop="id" label="ID" width="64" class-name="font-mono" />
        <el-table-column label="模型" min-width="170">
          <template #default="{ row }">
            <span class="model-tag">{{ row.model }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Key" min-width="120">
          <template #default="{ row }">{{ row.apiKey?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="提供商" width="120">
          <template #default="{ row }">{{ row.provider?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="输入 Token" width="110" align="right" class-name="font-mono">
          <template #default="{ row }">{{ (row.tokensIn || 0).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="输出 Token" width="110" align="right" class-name="font-mono">
          <template #default="{ row }">{{ (row.tokensOut || 0).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="费用" width="110" align="right">
          <template #default="{ row }"><span class="cost font-mono">${{ Number(row.cost).toFixed(6) }}</span></template>
        </el-table-column>
        <el-table-column label="延迟" width="100" align="right" class-name="font-mono">
          <template #default="{ row }">{{ row.latencyMs }} ms</template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">
            <span class="date font-mono">{{ fmtDate(row.createdAt) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, jumper"
          background
          @current-change="loadRecords"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh } from '@element-plus/icons-vue';
import api from '../api';

const records = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const keyword = ref('');
const dateRange = ref<[string, string] | null>(null);

const filtered = computed(() => records.value.filter(r =>
  !keyword.value ||
  r.model?.includes(keyword.value) ||
  r.apiKey?.name?.includes(keyword.value)
));

const fmtDate = (s: string) => new Date(s).toLocaleString('zh-CN', { hour12: false });

const loadRecords = async () => {
  loading.value = true;
  try {
    const params: any = { limit: pageSize, offset: (page.value - 1) * pageSize };
    if (dateRange.value) {
      params.start = dateRange.value[0];
      params.end = dateRange.value[1];
    }
    const { data } = await api.get('/api/usage/records', { params });
    records.value = data.records;
    total.value = data.total;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '加载失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadRecords);
</script>

<style scoped>
.page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; }
.page-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-sub { margin: 4px 0 0; font-size: 13px; color: var(--text-3); }
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 14px 16px; margin-bottom: 16px; }
.search { max-width: 280px; }
.range { max-width: 300px; }
.table-card { padding: 6px 8px; }

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
.date { font-size: 12px; color: var(--text-2); }
.pager { display: flex; justify-content: flex-end; padding: 14px 6px 8px; }
</style>
