# 模型定价 + 精确用量统计 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 每模型配置输入/输出/缓存三档价格，网关按厂商格式解析真实 token 用量（含缓存命中），流式与非流式都正确计费并从余额扣除。

**Architecture:** Model 表加三档价格（$/百万token）、UsageRecord 加 cachedTokens；/internal/models/resolve 返回 providerType+pricing；网关新增 usage 解析模块（非流式 extractUsage + 流式 SSE 解析器）并按公式计算 cost；Admin UI 在提供商页内联改价，Usage/Dashboard 展示缓存命中。

**Tech Stack:** Prisma + PostgreSQL（admin）、Fastify + undici（gateway）、Vue3 + Element Plus（web）、Node 内置 `node:test` + tsx（gateway 测试）。

---

### Task 1: Prisma schema — 价格与缓存字段

**Files:**
- Modify: `admin/prisma/schema.prisma`

**Step 1: 修改 schema**

`Model` 块加三字段（放在 `status` 后面）：
```prisma
  inputPrice  Decimal @default(0)
  outputPrice Decimal @default(0)
  cachePrice  Decimal @default(0)
```

`UsageRecord` 块加：
```prisma
  cachedTokens Int     @default(0)
```

**Step 2: 重新生成客户端**

Run: `cd admin && npx prisma generate`
Expected: `Generated Prisma Client` 成功，无报错。

**Step 3: 推送数据库**

Run: `cd admin && npx prisma db push`
Expected: 新增列写入。若本机无数据库连接，记录此命令必须在能连 DB 的环境执行（部署时），并继续后续任务（代码可先改完）。

**Step 4: Commit**

```bash
git add admin/prisma/schema.prisma
git commit -m "feat(admin): add model pricing columns and cachedTokens to usage"
```

---

### Task 2: admin routes/models.ts — 读写价格

**Files:**
- Modify: `admin/src/routes/models.ts`

**Step 1: GET 返回价格**

`/api/models` 的 map 中，`provider` 字段前加三行：
```ts
      inputPrice: m.inputPrice.toNumber(),
      outputPrice: m.outputPrice.toNumber(),
      cachePrice: m.cachePrice.toNumber(),
```

**Step 2: 接口类型加价格**

`CreateModelBody` 加 `inputPrice?: number; outputPrice?: number; cachePrice?: number;`
`UpdateModelBody` 加 `inputPrice?: number; outputPrice?: number; cachePrice?: number;`

**Step 3: POST 落库**

`prisma.model.create` 的 `data` 加：
```ts
      inputPrice: req.body.inputPrice ?? 0,
      outputPrice: req.body.outputPrice ?? 0,
      cachePrice: req.body.cachePrice ?? 0,
```

**Step 4: PUT 落库**

update 前 `const data: any = {};` 后加：
```ts
    if (typeof req.body.inputPrice === 'number') data.inputPrice = req.body.inputPrice;
    if (typeof req.body.outputPrice === 'number') data.outputPrice = req.body.outputPrice;
    if (typeof req.body.cachePrice === 'number') data.cachePrice = req.body.cachePrice;
```

**Step 5: 类型检查**

Run: `cd admin && npx tsc --noEmit`
Expected: 无新增错误。

**Step 6: Commit**

```bash
git add admin/src/routes/models.ts
git commit -m "feat(admin): persist and return model pricing"
```

---

### Task 3: admin routes/internal.ts — resolve 返回定价、report 接收 cachedTokens

**Files:**
- Modify: `admin/src/routes/internal.ts`

**Step 1: ReportBody 加字段**

```ts
interface ReportBody {
  apiKey: string;
  providerId: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  cost: number;
  latencyMs: number;
}
```

**Step 2: report 落库 cachedTokens**

`/internal/usage/report` 的 create `data` 中 `model,` 后加：
```ts
        cachedTokens: req.body.cachedTokens ?? 0,
```

**Step 3: resolve 返回 providerType + pricing**

`/internal/models/resolve` 的返回对象 `model: model.name,` 后加：
```ts
      providerType: model.provider.type,
      pricing: {
        inputPrice: model.inputPrice.toNumber(),
        outputPrice: model.outputPrice.toNumber(),
        cachePrice: model.cachePrice.toNumber()
      },
```

**Step 4: 类型检查**

Run: `cd admin && npx tsc --noEmit`
Expected: 无新增错误。

**Step 5: Commit**

```bash
git add admin/src/routes/internal.ts
git commit -m "feat(admin): expose pricing via resolve, record cached tokens"
```

---

### Task 4: admin routes/usage.ts — 统计含缓存命中

**Files:**
- Modify: `admin/src/routes/usage.ts`

**Step 1: 三个 aggregate 的 `_sum` 加 cachedTokens**

`/api/usage/stats` 中 `totalUsage`、`todayUsage`、`topModels` 三处 `_sum: { tokensIn, tokensOut, cost }` 改为 `_sum: { tokensIn, tokensOut, cachedTokens, cost }`。

**Step 2: 输出加 cachedTokens**

`total` 与 `today` 对象各加 `cachedTokens: totalUsage._sum.cachedTokens || 0` / `todayUsage._sum.cachedTokens || 0`；`monthly` map 加 `cachedTokens: m._sum.cachedTokens || 0`。

**Step 3: 类型检查**

Run: `cd admin && npx tsc --noEmit`
Expected: 无错误。

**Step 4: Commit**

```bash
git add admin/src/routes/usage.ts
git commit -m "feat(admin): include cached tokens in usage stats"
```

---

### Task 5: gateway usage 模块 + 单测

**Files:**
- Create: `gateway/src/providers/usage.ts`
- Create: `gateway/test/usage.test.ts`
- Modify: `gateway/package.json`

**Step 1: 加测试脚本**

`gateway/package.json` scripts 加 `"test": "tsx --test test/*.test.ts"`。

**Step 2: 写 failing 测试**

`gateway/test/usage.test.ts`：
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUsage, calculateCost, createUsageStream } from '../src/providers/usage.js';

test('extractUsage: OpenAI cached via prompt_tokens_details', () => {
  const u = extractUsage('OPENAI', { usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 30 } } });
  assert.deepEqual(u, { tokensIn: 100, tokensOut: 50, cachedTokens: 30 });
});

test('extractUsage: DeepSeek cached via prompt_cache_hit_tokens', () => {
  const u = extractUsage('DEEPSEEK', { usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 40 } });
  assert.deepEqual(u, { tokensIn: 100, tokensOut: 50, cachedTokens: 40 });
});

test('extractUsage: Anthropic', () => {
  const u = extractUsage('ANTHROPIC', { usage: { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 80 } });
  assert.deepEqual(u, { tokensIn: 120, tokensOut: 60, cachedTokens: 80 });
});

test('extractUsage: Google', () => {
  const u = extractUsage('GOOGLE', { usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 90, cachedContentTokenCount: 150 } });
  assert.deepEqual(u, { tokensIn: 200, tokensOut: 90, cachedTokens: 150 });
});

test('extractUsage: empty body -> zeros', () => {
  assert.deepEqual(extractUsage('OPENAI', {}), { tokensIn: 0, tokensOut: 0, cachedTokens: 0 });
});

test('calculateCost: cache price applies to cached input only', () => {
  const cost = calculateCost({ tokensIn: 1000, tokensOut: 500, cachedTokens: 400 }, { inputPrice: 2, outputPrice: 8, cachePrice: 0.5 });
  assert.equal(cost, (600 * 2 + 400 * 0.5 + 500 * 8) / 1_000_000);
});

test('createUsageStream: preserves bytes and extracts usage across chunk boundaries', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"a"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_cache_hit_tokens":7}}\n\n',
    'data: [DONE]\n\n'
  ];
  const input = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      // 把第一个 data 行拆成两段，模拟碎包
      const first = enc.encode(sse[0]);
      c.enqueue(first.slice(0, 20));
      c.enqueue(first.slice(20));
      c.enqueue(enc.encode(sse[1]));
      c.close();
    }
  });

  let reported: any = null;
  const out = input.pipeThrough(createUsageStream('DEEPSEEK', async (u) => { reported = u; }));

  const chunks: Uint8Array[] = [];
  const reader = out.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  const text = new TextDecoder().decode(bytes);
  assert.equal(text, sse[0] + sse[1]);
  assert.deepEqual(reported, { tokensIn: 10, tokensOut: 5, cachedTokens: 7 });
});
```

**Step 3: 运行确认失败**

Run: `cd gateway && npm test`
Expected: FAIL（`Cannot find module .../usage.js`）。

**Step 4: 实现 usage.ts**

`gateway/src/providers/usage.ts`：
```ts
export interface Pricing {
  inputPrice: number;
  outputPrice: number;
  cachePrice: number;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
}

export function extractUsage(providerType: string, body: any): Usage {
  switch (providerType) {
    case 'ANTHROPIC': {
      const u = body?.usage || {};
      return {
        tokensIn: u.input_tokens || 0,
        tokensOut: u.output_tokens || 0,
        cachedTokens: u.cache_read_input_tokens || 0
      };
    }
    case 'GOOGLE': {
      const u = body?.usageMetadata || {};
      return {
        tokensIn: u.promptTokenCount || 0,
        tokensOut: u.candidatesTokenCount || 0,
        cachedTokens: u.cachedContentTokenCount || 0
      };
    }
    default: {
      const u = body?.usage || {};
      return {
        tokensIn: u.prompt_tokens || 0,
        tokensOut: u.completion_tokens || 0,
        cachedTokens: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0
      };
    }
  }
}

export function calculateCost(usage: Usage, pricing: Pricing): number {
  const per = (v: number) => v / 1_000_000;
  const missInput = Math.max(0, usage.tokensIn - usage.cachedTokens);
  return (
    missInput * per(pricing.inputPrice || 0)
    + usage.cachedTokens * per(pricing.cachePrice || 0)
    + usage.tokensOut * per(pricing.outputPrice || 0)
  );
}

export function createUsageStream(
  providerType: string,
  onDone: (usage: Usage) => Promise<void> | void
): TransformStream<Uint8Array, Uint8Array> {
  const tokens = { in: 0, out: 0, cached: 0 };
  const decoder = new TextDecoder();
  let buffer = '';

  const feed = (json: any) => {
    if (providerType === 'ANTHROPIC') {
      if (json?.type === 'message_start') {
        const u = json?.message?.usage || {};
        tokens.in = u.input_tokens || 0;
        tokens.cached = u.cache_read_input_tokens || 0;
      } else if (json?.type === 'message_delta') {
        tokens.out = json?.usage?.output_tokens || 0;
      }
      return;
    }
    if (providerType === 'GOOGLE') {
      const u = json?.usageMetadata;
      if (u) {
        tokens.in = u.promptTokenCount || 0;
        tokens.out = u.candidatesTokenCount || 0;
        tokens.cached = u.cachedContentTokenCount || 0;
      }
      return;
    }
    const u = json?.usage;
    if (u) {
      tokens.in = u.prompt_tokens || 0;
      tokens.out = u.completion_tokens || 0;
      tokens.cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
    }
  };

  const parseLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try { feed(JSON.parse(payload)); } catch { /* ignore */ }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        parseLine(line);
      }
      controller.enqueue(chunk);
    },
    async flush() {
      if (buffer.trim()) parseLine(buffer);
      await onDone({ tokensIn: tokens.in, tokensOut: tokens.out, cachedTokens: tokens.cached });
    }
  });
}
```

**Step 5: 运行确认通过**

Run: `cd gateway && npm test`
Expected: 6 个测试全部 PASS。

**Step 6: Commit**

```bash
git add gateway/package.json gateway/src/providers/usage.ts gateway/test/usage.test.ts
git commit -m "feat(gateway): usage parsing per provider + cost calc + SSE stream parser"
```

---

### Task 6: gateway chat.ts — 非流式精确计费

**Files:**
- Modify: `gateway/src/routes/chat.ts`

**Step 1: 引入模块与类型**

顶部 `import { proxyRequest } from '../providers/proxy.js';` 后加：
```ts
import { extractUsage, calculateCost, createUsageStream } from '../providers/usage.js';
```

`ResolvedProvider` 接口加：
```ts
  providerType: string;
  pricing: { inputPrice: number; outputPrice: number; cachePrice: number };
```

**Step 2: 抽公共上报函数**

在 `chatRoutes` 函数体外加 helper（放 `resolveProvider` 之后）：
```ts
async function reportUsage(fastify: FastifyInstance, payload: any) {
  try {
    await fetch(`${process.env.ADMIN_API_URL}/internal/usage/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    fastify.log.error(err, 'Failed to report usage');
  }
}
```
（`FastifyInstance` 从 fastify import。）

**Step 3: 替换非流式上报**

把现有 `if (stream) { ... }` 之后非流式的 `setTimeout(async () => { await fetch(...); }, 100);` 整段替换为：
```ts
      const usage = extractUsage(config.providerType, data);
      const cost = calculateCost(usage, config.pricing);
      reportUsage(fastify, {
        apiKey,
        providerId: config.providerId,
        model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cachedTokens: usage.cachedTokens,
        cost,
        latencyMs
      });

      return data;
```

**Step 4: 类型检查**

Run: `cd gateway && npx tsc --noEmit`
Expected: 无错误。

**Step 5: Commit**

```bash
git add gateway/src/routes/chat.ts
git commit -m "feat(gateway): precise usage and cost for non-streaming"
```

---

### Task 7: gateway chat.ts — 流式解析并上报

**Files:**
- Modify: `gateway/src/routes/chat.ts`

**Step 1: 流式上游 body 注入 include_usage**

`proxyRequest` 调用前（`const response = await proxyRequest(...)` 处）改为先构造流式 body：
```ts
      const upstreamBody: any = requestBody;
      if (stream && (config.providerType === 'OPENAI' || config.providerType === 'DEEPSEEK')) {
        upstreamBody.stream_options = { include_usage: true };
      }
      const response = await proxyRequest(
        config.baseUrl,
        config.path,
        config.authType,
        config.apiKey,
        upstreamBody,
        model,
        stream
      );
```

**Step 2: 替换流式透传段**

`if (stream) { ... }` 块内的读取/包装逻辑整体替换为：
```ts
      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send({
            error: { message: 'Failed to read response stream', type: 'internal_error' }
          });
        }

        const latencyMs = Date.now() - startTime;
        const usageStream = createUsageStream(config.providerType, async (usage) => {
          const cost = calculateCost(usage, config.pricing);
          await reportUsage(fastify, {
            apiKey,
            providerId: config.providerId,
            model,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            cachedTokens: usage.cachedTokens,
            cost,
            latencyMs
          });
        });

        return reply.send(response.body.pipeThrough(usageStream));
      }
```

**Step 3: 类型检查**

Run: `cd gateway && npx tsc --noEmit`
Expected: 无错误。

**Step 4: Commit**

```bash
git add gateway/src/routes/chat.ts
git commit -m "feat(gateway): parse usage and report cost for streaming requests"
```

---

### Task 8: web Providers.vue — 内联编辑模型价格

**Files:**
- Modify: `web/src/views/Providers.vue`

**Step 1: 展开行模型列表改为小表格**

将 `.model-panel` 内 `v-if="modelsByProvider(row.id).length"` 的 `.model-list` 整块替换为小表格：
```vue
              <el-table v-if="modelsByProvider(row.id).length" :data="modelsByProvider(row.id)" size="small" class="model-table">
                <el-table-column label="模型名称" min-width="150">
                  <template #default="{ row: m }">
                    <code class="model-name font-mono">{{ m.name }}</code>
                  </template>
                </el-table-column>
                <el-table-column label="输入 $/M" width="150">
                  <template #default="{ row: m }">
                    <el-input-number v-model="m.inputPrice" :precision="4" :step="0.1" :min="0" size="small" controls-position="right" style="width: 110px" @change="() => saveModelPrice(m)" />
                  </template>
                </el-table-column>
                <el-table-column label="输出 $/M" width="150">
                  <template #default="{ row: m }">
                    <el-input-number v-model="m.outputPrice" :precision="4" :step="0.1" :min="0" size="small" controls-position="right" style="width: 110px" @change="() => saveModelPrice(m)" />
                  </template>
                </el-table-column>
                <el-table-column label="缓存 $/M" width="150">
                  <template #default="{ row: m }">
                    <el-input-number v-model="m.cachePrice" :precision="4" :step="0.1" :min="0" size="small" controls-position="right" style="width: 110px" @change="() => saveModelPrice(m)" />
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="100">
                  <template #default="{ row: m }">
                    <el-switch :model-value="m.status === 'ACTIVE'" size="small" @change="(v: string | number | boolean) => toggleModel(m, v)" />
                  </template>
                </el-table-column>
                <el-table-column width="56" align="right">
                  <template #default="{ row: m }">
                    <el-tooltip content="删除模型">
                      <el-button text type="danger" :icon="Delete" size="small" @click="deleteModel(m)" />
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
```
（`:data` 绑定 computed 函数返回值每次都会重新计算，Element Plus 表格可正常渲染。删除旧的 `.model-list` 相关元素与 CSS。）

**Step 2: 加 saveModelPrice**

`toggleModel` 前加：
```ts
const saveModelPrice = async (m: any) => {
  try {
    await api.put(`/api/models/${m.id}`, {
      inputPrice: m.inputPrice ?? 0,
      outputPrice: m.outputPrice ?? 0,
      cachePrice: m.cachePrice ?? 0
    });
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '价格保存失败');
    await loadProviders();
  }
};
```

**Step 3: 样式**

新增 `.model-table` 与移除不再用的 `.model-item/.model-list` 相关 CSS（保留 `.model-panel/.model-add/.model-input/.model-name/.model-empty`）。

**Step 4: 构建**

Run: `cd web && npm run build`
Expected: 成功，无类型错误。

**Step 5: Commit**

```bash
git add web/src/views/Providers.vue
git commit -m "feat(web): inline per-model pricing in provider expand row"
```

---

### Task 9: web Usage.vue + Dashboard.vue — 展示缓存命中

**Files:**
- Modify: `web/src/views/Usage.vue`
- Modify: `web/src/views/Dashboard.vue`

**Step 1: Usage 明细加列**

`el-table-column label="输出 Token"` 之后加：
```vue
        <el-table-column label="缓存 Token" width="110" align="right" class-name="font-mono">
          <template #default="{ row }">{{ (row.cachedTokens || 0).toLocaleString() }}</template>
        </el-table-column>
```

**Step 2: Dashboard 加统计卡**

`statCards` 数组 `总 Token` 卡片后加：
```ts
  {
    label: '缓存命中', icon: Odometer,
    grad: 'linear-gradient(135deg, rgba(168,85,247,.18), rgba(168,85,247,.05))',
    value: (stats.value.total?.cachedTokens ?? 0).toLocaleString(),
    hint: '累计缓存命中 token'
  },
```

**Step 3: 构建**

Run: `cd web && npm run build`
Expected: 成功。

**Step 4: Commit**

```bash
git add web/src/views/Usage.vue web/src/views/Dashboard.vue
git commit -m "feat(web): show cached tokens in usage list and dashboard"
```

---

### Task 10: 全量验证

**Files:** 无

**Step 1: gateway 测试**

Run: `cd gateway && npm test`
Expected: 全部 PASS。

**Step 2: 三个项目构建**

Run: `cd admin && npm run build`；`cd web && npm run build`；`cd gateway && npm run build`
Expected: 全部成功、无 TS 错误。

**Step 3: 手工验证（需要运行环境）**

- 配一个 DeepSeek 提供商与模型，设置 input/output/cache 三档价。
- 非流式请求 → Usage 记录出现真实 tokensIn/tokensOut/cachedTokens，费用=公式结果。
- 流式请求（含二次相同 prompt 命中缓存）→ 记录同样正确，缓存命中按 cachePrice 计价。
- 使用统计与仪表盘能看到缓存命中数字。

**Step 4: Commit（如手工验证有修正）**

```bash
git add -A
git commit -m "fix: verification adjustments"
```

## 注意

- `prisma db push` 若本机无数据库，务必在部署环境执行，否则新列缺失导致 admin 启动报错。
- 老模型价格默认 0，需在界面设置价格后才开始计费。
- 智谱不在 ProviderType 枚举内，按 OPENAI 类型配置即可（usage 走 OpenAI 兼容分支）。
