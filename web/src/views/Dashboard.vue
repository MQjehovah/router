<template>
  <div class="page">
    <!-- stat cards -->
    <div class="stats-grid">
      <article v-for="s in statCards" :key="s.label" class="stat-card tech-card">
        <div class="stat-icon" :style="{ background: s.grad }">
          <component :is="s.icon" :size="20" />
        </div>
        <div class="stat-body">
          <span class="stat-label">{{ s.label }}</span>
          <span class="stat-value font-mono">{{ s.value }}</span>
          <span class="stat-hint">{{ s.hint }}</span>
        </div>
      </article>
    </div>

    <!-- charts -->
    <div class="chart-row">
      <section class="chart-card tech-card chart-trend">
        <header class="chart-head">
          <div>
            <h3 class="chart-title">请求趋势</h3>
            <p class="chart-sub">近 {{ trendDays }} 天请求量与 Token 消耗</p>
          </div>
          <div class="seg" role="tablist" aria-label="趋势区间">
            <button v-for="d in [7, 14, 30]" :key="d" :class="{ active: trendDays === d }" @click="loadTrend(d)">
              {{ d }}天
            </button>
          </div>
        </header>
        <v-chart v-if="trendReady" class="chart" :option="trendOption" autoresize />
      </section>

      <section class="chart-card tech-card">
        <header class="chart-head">
          <h3 class="chart-title">模型消耗占比</h3>
          <p class="chart-sub">本月各模型费用份额</p>
        </header>
        <v-chart v-if="statsReady" class="chart" :option="pieOption" autoresize />
      </section>
    </div>

    <section class="chart-card tech-card chart-model">
      <header class="chart-head">
        <h3 class="chart-title">模型 Token 使用</h3>
        <p class="chart-sub">按模型统计的输入/输出 Token（本月）</p>
      </header>
      <v-chart v-if="statsReady" class="chart chart-lg" :option="barOption" autoresize />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent
} from 'echarts/components';
import VChart from 'vue-echarts';
import { Promotion, Files, Coin, Odometer } from '@element-plus/icons-vue';import api from '../api';

use([CanvasRenderer, LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent]);

const stats = shallowRef<any>({ total: {}, today: {}, monthly: [] });
const trend = shallowRef<any[]>([]);
const trendDays = ref(7);
const loading = ref(true);
const trendReady = ref(false);
const statsReady = ref(false);

const statCards = computed(() => [
  {
    label: '总请求数', icon: Promotion,
    grad: 'linear-gradient(135deg, rgba(34,211,238,.16), rgba(34,211,238,.05))',
    value: stats.value.total?.requests?.toLocaleString() ?? '0',
    hint: '累计调用次数'
  },
  {
    label: '总 Token', icon: Files,
    grad: 'linear-gradient(135deg, rgba(99,102,241,.18), rgba(99,102,241,.05))',
    value: ((stats.value.total?.tokensIn ?? 0) + (stats.value.total?.tokensOut ?? 0)).toLocaleString(),
    hint: '输入 + 输出'
  },
  {
    label: '缓存命中', icon: Odometer,
    grad: 'linear-gradient(135deg, rgba(168,85,247,.18), rgba(168,85,247,.05))',
    value: (stats.value.total?.cachedTokens ?? 0).toLocaleString(),
    hint: '其中输入 Token 的缓存部分'
  },
  {
    label: '总消费', icon: Coin,
    grad: 'linear-gradient(135deg, rgba(52,211,153,.18), rgba(52,211,153,.05))',
    value: '$' + Number(stats.value.total?.cost ?? 0).toFixed(4),
    hint: '累计费用'
  },
  {
    label: '今日请求', icon: Odometer,
    grad: 'linear-gradient(135deg, rgba(251,191,36,.18), rgba(251,191,36,.05))',
    value: (stats.value.today?.requests ?? 0).toLocaleString(),
    hint: '今天到现在'
  }
]);

const AXIS = {
  axisLine: { lineStyle: { color: 'rgba(148,163,184,.16)' } },
  axisLabel: { color: '#64748b', fontSize: 11 },
  splitLine: { lineStyle: { color: 'rgba(148,163,184,.08)' } }
};

const trendOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#141d30',
    borderColor: 'rgba(148,163,184,.2)',
    textStyle: { color: '#e6edf7', fontSize: 12 },
    axisPointer: { type: 'line', lineStyle: { color: 'rgba(34,211,238,.3)' } }
  },
  legend: {
    data: ['请求数', 'Token'],
    textStyle: { color: '#94a3b8', fontSize: 11 },
    top: 0, right: 0
  },
  grid: { left: 8, right: 8, top: 34, bottom: 0, containLabel: true },
  xAxis: {
    type: 'category',
    data: trend.value.map(t => t.date.slice(5)),
    ...AXIS
  },
  yAxis: [
    { type: 'value', name: '', ...AXIS },
    { type: 'value', ...AXIS, splitLine: { show: false } }
  ],
  series: [
    {
      name: '请求数', type: 'line', smooth: true, symbol: 'none',
      data: trend.value.map(t => t.requests),
      lineStyle: { width: 2.5, color: '#22d3ee' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(34,211,238,.28)' },
            { offset: 1, color: 'rgba(34,211,238,0)' }
          ]
        }
      }
    },
    {
      name: 'Token', type: 'line', smooth: true, symbol: 'none',
      yAxisIndex: 1,
      data: trend.value.map(t => t.tokens),
      lineStyle: { width: 2, color: '#6366f1' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(99,102,241,.2)' },
            { offset: 1, color: 'rgba(99,102,241,0)' }
          ]
        }
      }
    }
  ]
}));

const pieOption = computed(() => {
  const data = (stats.value.monthly || [])
    .filter((m: any) => Number(m.cost) > 0)
    .map((m: any) => ({ name: m.model, value: Number(m.cost) }));
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#141d30',
      borderColor: 'rgba(148,163,184,.2)',
      textStyle: { color: '#e6edf7', fontSize: 12 },
      formatter: '{b}: ${c} ({d}%)'
    },
    color: ['#22d3ee', '#6366f1', '#34d399', '#fbbf24', '#fb7185', '#38bdf8', '#a78bfa'],
    series: [{
      type: 'pie',
      radius: ['52%', '78%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 8, borderColor: '#0b101d', borderWidth: 2 },
      label: { color: '#94a3b8', fontSize: 11, formatter: '{b}\n{c}' },
      labelLine: { lineStyle: { color: 'rgba(148,163,184,.35)' } },
      data: data.length ? data : [{ name: '暂无数据', value: 1, itemStyle: { color: 'rgba(148,163,184,.15)' } }]
    }]
  };
});

const barOption = computed(() => {
  const m = stats.value.monthly || [];
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#141d30',
      borderColor: 'rgba(148,163,184,.2)',
      textStyle: { color: '#e6edf7', fontSize: 12 }
    },
    legend: { data: ['输入 Token', '输出 Token'], textStyle: { color: '#94a3b8', fontSize: 11 }, top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 34, bottom: 0, containLabel: true },
    xAxis: { type: 'category', data: m.map((x: any) => x.model), ...AXIS },
    yAxis: { type: 'value', ...AXIS },
    series: [
      {
        name: '输入 Token', type: 'bar', stack: 't',
        data: m.map((x: any) => x.tokensIn),
        itemStyle: { color: '#22d3ee', borderRadius: [0, 0, 0, 0] }, barMaxWidth: 26
      },
      {
        name: '输出 Token', type: 'bar', stack: 't',
        data: m.map((x: any) => x.tokensOut),
        itemStyle: { color: '#6366f1', borderRadius: [6, 6, 0, 0] }, barMaxWidth: 26
      }
    ]
  };
});

const loadStats = async () => {
  try {
    const { data } = await api.get('/api/usage/stats');
    stats.value = data;
  } finally {
    statsReady.value = true;
  }
};

const loadTrend = async (days: number) => {
  trendDays.value = days;
  try {
    const { data } = await api.get('/api/usage/trend', { params: { days } });
    trend.value = data;
  } finally {
    trendReady.value = true;
  }
};

onMounted(async () => {
  loading.value = true;
  await Promise.all([loadStats(), loadTrend(7)]);
  loading.value = false;
});
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.22s;
}
.stat-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
}
.stat-icon {
  flex: none;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--text-1);
  border: 1px solid rgba(148, 163, 184, 0.14);
}
.stat-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.stat-label {
  font-size: 13px;
  color: var(--text-2);
}
.stat-value {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
  line-height: 1.2;
  margin-top: 2px;
}
.stat-hint {
  font-size: 12px;
  color: var(--text-3);
}

.chart-row {
  display: grid;
  grid-template-columns: 1.7fr 1fr;
  gap: 18px;
  margin-top: 18px;
}
@media (max-width: 1100px) {
  .chart-row { grid-template-columns: 1fr; }
}

.chart-card {
  padding: 20px 20px 12px;
  display: flex;
  flex-direction: column;
}
.chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.chart-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}
.chart-sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.chart {
  width: 100%;
  height: 300px;
}
.chart-lg {
  height: 320px;
}

.seg {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.seg button {
  padding: 4px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-family: var(--font-ui);
  cursor: pointer;
  transition: all 0.2s;
}
.seg button.active {
  background: var(--bg-surface-2);
  color: #a5f3fc;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.25) inset;
}
.seg button:hover:not(.active) {
  color: var(--text-1);
}

.chart-model {
  margin-top: 18px;
}
</style>
