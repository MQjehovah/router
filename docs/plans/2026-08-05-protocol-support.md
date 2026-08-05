# 协议支持（/v1/responses + /v1/messages 直通配对）实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让网关通过「端点 ↔ 提供商协议」直通配对，支持 Codex CLI（/v1/responses）与 Claude Code CLI（/v1/messages），本迭代不做协议转换。

**Architecture:** Provider 通过新增的 `ProviderProtocol` 表声明原生支持的协议及路径（空则用协议默认路径）。网关新增 `/v1/responses` 与 `/v1/messages` 两个直通端点：resolve 拿到 protocols 后，若提供商声明该协议则原样转发（含流式），否则返回 `protocol_not_supported` 错误。usage 按上游原生协议格式解析上报，认证中间件兼容 `x-api-key`。

**Tech Stack:** Fastify 4（gateway + admin）、Prisma/PostgreSQL、Vue 3 + Element Plus、TypeScript、node:test。

**前置阅读：**
- 设计文档 `docs/plans/2026-08-05-protocol-support-design.md`
- 网关现有 chat 路由 `gateway/src/routes/chat.ts`（新路由的结构模板）
- usage 解析 `gateway/src/providers/usage.ts`（responses 格式分支挂载点）
- admin resolve `admin/src/routes/internal.ts`（resolve 返回 protocols）

**验证命令：**
- gateway 测试：`npm test`（在 `gateway/` 下运行，即 `tsx --test test/*.test.ts`）
- gateway 构建：`npm run build`（tsc）
- admin 构建：`npm run build`（tsc）
- web 构建：`npm run build`（vue-tsc && vite build）
- admin 数据库同步：`npm run db:push`（Prisma schema 变更后执行）

---

### Task 1: Prisma schema — Protocol 枚举 + ProviderProtocol 表

**Files:**
- Modify: `admin/prisma/schema.prisma`
- Create: `admin/scripts/seed-protocols.ts`
- Modify: `admin/package.json`

**Step 1: 修改 schema**

在 `admin/prisma/schema.prisma` 中：

1. 在 `Provider` model 的关联字段区加一行（`models Model[]` 之后）：
```prisma
  protocols  ProviderProtocol[]
```

2. 在文件末尾（`TransactionType` enum 之后）追加：
```prisma
enum Protocol {
  OPENAI_CHAT
  OPENAI_RESPONSES
  ANTHROPIC_MESSAGES
}

model ProviderProtocol {
  id         Int      @id @default(autoincrement())
  providerId Int
  provider   Provider @relation(fields: [providerId], references: [id])
  protocol   Protocol
  path       String?
  status     String   @default("ACTIVE")
  createdAt  DateTime @default(now())

  @@unique([providerId, protocol])
}
```

**Step 2: 同步数据库**

在 `admin/` 下运行：
```bash
npm run db:push
npm run db:generate
```
Expected: 输出成功，生成新的 Prisma client 类型。

**Step 3: 编写 seed 脚本**

创建 `admin/scripts/seed-protocols.ts`：
```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.provider.findMany({ include: { protocols: true } });
  let created = 0;
  for (const p of providers) {
    const has = p.protocols.some(r => r.protocol === 'OPENAI_CHAT');
    if (!has) {
      await prisma.providerProtocol.create({
        data: { providerId: p.id, protocol: 'OPENAI_CHAT', path: p.path || null }
      });
      created++;
    }
  }
  console.log(`Seeded ${created} OPENAI_CHAT protocol rows`);
}

main().finally(() => prisma.$disconnect());
```

**Step 4: 添加 npm script**

在 `admin/package.json` 的 `scripts` 中加一行：
```json
"db:seed-protocols": "tsx scripts/seed-protocols.ts"
```

**Step 5: 运行 seed**

在 `admin/` 下运行：
```bash
npm run db:seed-protocols
```
Expected: `Seeded N OPENAI_CHAT protocol rows`（N = 现有 provider 数）。

**Step 6: 构建验证**

在 `admin/` 下运行：
```bash
npm run build
```
Expected: 编译通过，无 TS 错误。

**Step 7: Commit**

```bash
git add admin/prisma/schema.prisma admin/scripts/seed-protocols.ts admin/package.json
git commit -m "feat(admin): protocol enum and ProviderProtocol table"
```

---

### Task 2: Admin — resolve 返回 protocols（含默认路径注册表）

**Files:**
- Create: `admin/src/protocols.ts`
- Modify: `admin/src/routes/internal.ts:116-165`
- Test: `admin/test/protocols.test.ts`（可选，纯函数测试）

**Step 1: 创建协议注册表**

创建 `admin/src/protocols.ts`：
```ts
export const PROTOCOLS = ['OPENAI_CHAT', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES'] as const;
export type Protocol = typeof PROTOCOLS[number];

export const DEFAULT_PROTOCOL_PATHS: Record<Protocol, string> = {
  OPENAI_CHAT: '/chat/completions',
  OPENAI_RESPONSES: '/responses',
  ANTHROPIC_MESSAGES: '/v1/messages'
};

export function effectiveProtocolPath(protocol: string, path: string | null | undefined): string {
  return path || DEFAULT_PROTOCOL_PATHS[protocol as Protocol] || '';
}
```

**Step 2: 修改 resolve 返回 protocols**

在 `admin/src/routes/internal.ts` 顶部 import：
```ts
import { effectiveProtocolPath, DEFAULT_PROTOCOL_PATHS, Protocol } from '../protocols.js';
```

在 `/internal/models/resolve` handler 中，`const providerKey = decrypt(...)` 之前插入 protocols 查询，并在 return 对象中增加 `protocols` 字段：

```ts
const protoRows = await prisma.providerProtocol.findMany({
  where: { providerId: model.providerId, status: 'ACTIVE' }
});

let protocols = protoRows.map(r => ({
  protocol: r.protocol,
  path: effectiveProtocolPath(r.protocol, r.path)
}));

if (!protocols.length) {
  protocols = [{
    protocol: 'OPENAI_CHAT',
    path: effectiveProtocolPath('OPENAI_CHAT', model.provider.path)
  }];
}
```

return 对象在 `path` 之后加：
```ts
      path: model.provider.path || DEFAULT_PROTOCOL_PATHS.OPENAI_CHAT,
      protocols,
```

**Step 3: 构建验证**

在 `admin/` 下运行：
```bash
npm run build
```
Expected: 编译通过。

**Step 4: Commit**

```bash
git add admin/src/protocols.ts admin/src/routes/internal.ts
git commit -m "feat(admin): return provider protocols with effective paths from resolve"
```

---

### Task 3: Admin — providers API 协议 CRUD + GET 返回 protocols

**Files:**
- Modify: `admin/src/routes/providers.ts`
- Test: 无（手工 curl 验证）

**Step 1: GET /api/providers 返回 protocols**

`admin/src/routes/providers.ts` 的 GET handler 改为：
```ts
    const providers = await prisma.provider.findMany({
      orderBy: { createdAt: 'desc' },
      include: { protocols: true }
    });

    return providers.map(p => ({
      ...p,
      protocols: p.protocols,
      apiKey: p.apiKey.substring(0, 8) + '****',
      createdAt: p.createdAt.toISOString()
    }));
```

**Step 2: 新增协议 CRUD 端点**

在 `admin/src/routes/providers.ts` 的 DELETE handler 之后追加：

```ts
  fastify.get<{ Params: { id: string } }>('/api/providers/:id/protocols', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const rows = await prisma.providerProtocol.findMany({
      where: { providerId: parseInt(req.params.id) },
      orderBy: { id: 'asc' }
    });
    return rows;
  });

  fastify.post<{ Params: { id: string }, Body: { protocol: string; path?: string } }>('/api/providers/:id/protocols', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const providerId = parseInt(req.params.id);
    const { protocol, path } = req.body;
    if (!protocol) return reply.status(400).send({ error: 'protocol is required' });
    const row = await prisma.providerProtocol.upsert({
      where: { providerId_protocol: { providerId, protocol: protocol as any } },
      create: { providerId, protocol: protocol as any, path: path || null },
      update: { path: path || null }
    });
    return row;
  });

  fastify.put<{ Params: { id: string; protocolId: string }, Body: { path?: string; status?: string } }>('/api/providers/:id/protocols/:protocolId', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    const data: any = {};
    if (req.body.path !== undefined) data.path = req.body.path || null;
    if (req.body.status) data.status = req.body.status;
    const row = await prisma.providerProtocol.update({
      where: { id: parseInt(req.params.protocolId) },
      data
    });
    return row;
  });

  fastify.delete<{ Params: { id: string; protocolId: string } }>('/api/providers/:id/protocols/:protocolId', {
    preHandler: [fastify.authenticate]
  }, async (req, reply) => {
    if (req.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Forbidden' });
    await prisma.providerProtocol.delete({ where: { id: parseInt(req.params.protocolId) } });
    return { success: true };
  });
```

注：`providerId_protocol` 是 Prisma 对 `@@unique([providerId, protocol])` 自动生成的复合 where key。

**Step 3: 创建/编辑 provider 时自动维护 OPENAI_CHAT 行**

`POST /api/providers` 的 create 之后追加 upsert OPENAI_CHAT 行：
```ts
    await prisma.providerProtocol.upsert({
      where: { providerId_protocol: { providerId: provider.id, protocol: 'OPENAI_CHAT' } },
      create: { providerId: provider.id, protocol: 'OPENAI_CHAT', path: req.body.path || null },
      update: {}
    });
```

**Step 4: 构建验证**

```bash
npm run build
```
Expected: 编译通过。

**Step 5: Commit**

```bash
git add admin/src/routes/providers.ts
git commit -m "feat(admin): provider protocol CRUD endpoints"
```

---

### Task 4: Gateway — usage.ts 支持 responses 格式（TDD）

**Files:**
- Modify: `gateway/src/providers/usage.ts`
- Test: `gateway/test/usage.test.ts`

**Step 1: 写失败测试**

在 `gateway/test/usage.test.ts` 末尾追加：

```ts
test('extractUsageByFormat: responses non-stream', () => {
  const u = extractUsageByFormat('responses', {
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 30 } }
  });
  assert.deepEqual(u, { tokensIn: 100, tokensOut: 50, cachedTokens: 30 });
});

test('extractUsageByFormat: responses missing cached -> 0', () => {
  const u = extractUsageByFormat('responses', { usage: { input_tokens: 10, output_tokens: 5 } });
  assert.deepEqual(u, { tokensIn: 10, tokensOut: 5, cachedTokens: 0 });
});

test('createUsageStream: responses response.completed usage', async () => {
  const reported = await collectStream('responses', [
    'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":200,"output_tokens":90,"input_tokens_details":{"cached_tokens":150}}}}\n\n',
    'data: [DONE]\n\n'
  ]);
  assert.deepEqual(reported, { tokensIn: 200, tokensOut: 90, cachedTokens: 150 });
});
```

**Step 2: 运行测试确认失败**

在 `gateway/` 下运行：
```bash
npm test
```
Expected: 3 个新测试 FAIL（`extractUsageByFormat is not defined` / 流式 0 token），旧测试 PASS。

**Step 3: 实现 responses 格式**

重构 `gateway/src/providers/usage.ts`：

1. 新增类型与归一化：
```ts
export type UsageFormat = 'chat' | 'responses' | 'anthropic' | 'google';

function formatFor(providerType: string): UsageFormat {
  switch (providerType) {
    case 'ANTHROPIC': return 'anthropic';
    case 'GOOGLE': return 'google';
    default: return 'chat';
  }
}
```

2. 将 `readUsage(providerType, raw)` 改为按 format 分发：
```ts
function readUsageByFormat(format: UsageFormat, raw: any): Usage {
  if (format === 'anthropic') {
    const u = raw?.usage || {};
    return {
      tokensIn: u.input_tokens || 0,
      tokensOut: u.output_tokens || 0,
      cachedTokens: u.cache_read_input_tokens || 0
    };
  }
  if (format === 'google') {
    const u = raw?.usageMetadata || {};
    return {
      tokensIn: u.promptTokenCount || 0,
      tokensOut: u.candidatesTokenCount || 0,
      cachedTokens: u.cachedContentTokenCount || 0
    };
  }
  if (format === 'responses') {
    const u = raw?.usage || {};
    return {
      tokensIn: u.input_tokens || 0,
      tokensOut: u.output_tokens || 0,
      cachedTokens: u.input_tokens_details?.cached_tokens || 0
    };
  }
  const u = raw?.usage || {};
  return {
    tokensIn: u.prompt_tokens || 0,
    tokensOut: u.completion_tokens || 0,
    cachedTokens: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0
  };
}
```

3. 保留旧公开函数并新增按 format 版本：
```ts
export function extractUsage(providerType: string, body: any): Usage {
  return readUsageByFormat(formatFor(providerType), body);
}

export function extractUsageByFormat(format: UsageFormat, body: any): Usage {
  return readUsageByFormat(format, body);
}
```

4. `createUsageStream` 改签名：首参从 `providerType: string` 改为 `formatOrType: UsageFormat | string`，顶部归一化：
```ts
export function createUsageStream(
  formatOrType: UsageFormat | string,
  onDone: (usage: Usage) => Promise<void> | void
): TransformStream<Uint8Array, Uint8Array> {
  const format: UsageFormat = ['chat', 'responses', 'anthropic', 'google'].includes(formatOrType)
    ? formatOrType as UsageFormat
    : formatFor(formatOrType);
  const tokens = { in: 0, out: 0, cached: 0 };
  const decoder = new TextDecoder();
  let buffer = '';

  const feed = (json: any) => {
    if (format === 'anthropic') {
      // ...原 ANTHROPIC 逻辑不变...
    }
    if (format === 'google') {
      // ...原 GOOGLE 逻辑不变...
    }
    if (format === 'responses') {
      if (json?.type === 'response.completed') {
        const u = readUsageByFormat('responses', json.response);
        tokens.in = u.tokensIn;
        tokens.out = u.tokensOut;
        tokens.cached = u.cachedTokens;
      }
      return;
    }
    if (json?.usage) {
      // ...原 chat 逻辑不变，readUsage 改 readUsageByFormat(format, json)...
    }
  };
  // parseLine / TransformStream 主体不变
}
```

注意：feed 内 `readUsage(providerType, json)` 调用改为 `readUsageByFormat(format, json)`。

**Step 4: 运行测试确认通过**

```bash
npm test
```
Expected: 全部 PASS（旧测试 + 3 个新测试）。

**Step 5: 构建验证**

```bash
npm run build
```

**Step 6: Commit**

```bash
git add gateway/src/providers/usage.ts gateway/test/usage.test.ts
git commit -m "feat(gateway): parse responses-format usage"
```

---

### Task 5: Gateway — 认证支持 x-api-key（TDD）

**Files:**
- Modify: `gateway/src/middleware/auth.ts`
- Test: `gateway/test/auth.test.ts`

**Step 1: 写失败测试**

创建 `gateway/test/auth.test.ts`：
```ts
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { authenticate } from '../src/middleware/auth.js';

const app = Fastify();
app.decorateRequest('authData', null);
app.post('/probe', { preHandler: [authenticate] }, async (req) => {
  return { keyId: (req as any).authData.keyId };
});

const admin = Fastify();
admin.post('/internal/keys/verify', async (req, reply) => {
  const { apiKey } = req.body as any;
  if (apiKey === 'valid-key') {
    return { keyId: 1, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 100 };
  }
  return reply.status(401).send({ error: 'Invalid key' });
});

before(async () => {
  process.env.ADMIN_API_URL = 'http://127.0.0.1:3999';
  await admin.listen({ port: 3999, host: '127.0.0.1' });
});
after(async () => {
  await admin.close();
  await app.close();
});

test('auth: accepts x-api-key header (claude code style)', async () => {
  const res = await app.inject({ method: 'POST', url: '/probe', headers: { 'x-api-key': 'valid-key' }, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().keyId, 1);
});

test('auth: rejects missing both headers', async () => {
  const res = await app.inject({ method: 'POST', url: '/probe', payload: {} });
  assert.equal(res.statusCode, 401);
});
```

**Step 2: 运行测试确认失败**

```bash
npm test
```
Expected: 新测试 FAIL（401：x-api-key 未被识别）。

**Step 3: 实现**

`gateway/src/middleware/auth.ts` 顶部逻辑改为：
```ts
  const authHeader = req.headers.authorization;
  let apiKey = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  } else if (req.headers['x-api-key']) {
    apiKey = String(req.headers['x-api-key']);
  }

  if (!apiKey) {
    return reply.status(401).send({
      error: {
        message: 'Missing or invalid authorization header',
        type: 'authentication_error',
        code: 'missing_authorization'
      }
    });
  }
```
其余不变（`apiKey` 变量继续使用）。

**Step 4: 运行测试确认通过**

```bash
npm test
```

**Step 5: Commit**

```bash
git add gateway/src/middleware/auth.ts gateway/test/auth.test.ts
git commit -m "feat(gateway): accept x-api-key auth header"
```

---

### Task 6: Gateway — 抽离 buildApp 与共享路由助手

**Files:**
- Create: `gateway/src/app.ts`
- Create: `gateway/src/routes/helpers.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/routes/chat.ts`

**Step 1: 创建共享助手 `gateway/src/routes/helpers.ts`**

把 chat.ts 里的 `ResolvedProvider`、`resolveProvider`、`reportUsage` 抽出并扩展 protocols：

```ts
import { FastifyInstance, FastifyRequest } from 'fastify';

export interface ProtocolPath {
  protocol: string;
  path: string;
}

export interface ResolvedProvider {
  model: string;
  providerId: number;
  baseUrl: string;
  path: string;
  protocols?: ProtocolPath[];
  authType: string;
  apiKey: string;
  providerType: string;
  pricing: { inputPrice: number; outputPrice: number; cachePrice: number };
}

export async function resolveProvider(req: FastifyRequest, model: string): Promise<{ ok: true; config: ResolvedProvider } | { ok: false; status: number; body: any }> {
  // 内容与 chat.ts 原 resolveProvider 完全一致（复制）
}

export async function reportUsage(fastify: FastifyInstance, payload: any) {
  // 内容与 chat.ts 原 reportUsage 完全一致（复制）
}

export function findProtocol(config: ResolvedProvider, protocol: string): ProtocolPath | undefined {
  return config.protocols?.find(p => p.protocol === protocol);
}

export function openAiError(message: string, type: string, code?: string) {
  return { error: { message, type, ...(code ? { code } : {}) } };
}

export function anthropicError(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}
```

**Step 2: 创建 `gateway/src/app.ts`**

```ts
import Fastify, { FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';

import { authenticate } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { chatRoutes } from './routes/chat.js';
import { responsesRoutes } from './routes/responses.js';
import { messagesRoutes } from './routes/messages.js';

export async function buildApp(opts: FastifyServerOptions = {}) {
  const fastify = Fastify(opts);

  await fastify.register(cors, { origin: true, credentials: true });

  fastify.decorate('authenticate', authenticate);
  fastify.decorate('rateLimit', rateLimit);

  await fastify.register(chatRoutes);
  await fastify.register(responsesRoutes);
  await fastify.register(messagesRoutes);

  fastify.get('/health', async () => ({ status: 'ok' }));

  return fastify;
}
```

注：`responsesRoutes`/`messagesRoutes` 在 Task 7 创建，此处先创建文件避免 TS 报错（Task 7 之前 `npm run build` 会失败属预期）。

**Step 3: 改写 `gateway/src/index.ts`**

```ts
import dotenv from 'dotenv';
import { buildApp } from './app.js';

dotenv.config();

const fastify = await buildApp({ logger: true });

const start = async () => {
  try {
    await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
```

**Step 4: 改写 `gateway/src/routes/chat.ts` 使用共享助手**

- 删除文件内 `ResolvedProvider` 接口、`resolveProvider`、`reportUsage` 定义。
- 顶部 import 改为：
```ts
import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsage, calculateCost, createUsageStream } from '../providers/usage.js';
import { resolveProvider, reportUsage } from './helpers.js';
```
- 其余逻辑不变。

**Step 5: Commit**

```bash
git add gateway/src/app.ts gateway/src/routes/helpers.ts gateway/src/index.ts gateway/src/routes/chat.ts
git commit -m "refactor(gateway): extract buildApp and shared route helpers"
```

---

### Task 7: Gateway — /v1/responses 与 /v1/messages 直通路由（含集成测试）

**Files:**
- Create: `gateway/src/routes/responses.ts`
- Create: `gateway/src/routes/messages.ts`
- Create: `gateway/test/routes.test.ts`

**Step 1: 创建 `gateway/src/routes/responses.ts`**

```ts
import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsageByFormat, calculateCost, createUsageStream } from '../providers/usage.js';
import { resolveProvider, reportUsage, findProtocol, openAiError } from './helpers.js';

interface ResponsesBody {
  model: string;
  stream?: boolean;
  [key: string]: any;
}

export async function responsesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ResponsesBody }>('/v1/responses', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, stream } = req.body;
    if (!model) {
      return reply.status(400).send(openAiError('model is required', 'invalid_request_error', 'invalid_body'));
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) return reply.status(resolved.status).send(resolved.body);
    const config = resolved.config;

    const proto = findProtocol(config, 'OPENAI_RESPONSES');
    if (!proto) {
      return reply.status(400).send(openAiError('Provider does not support responses protocol', 'invalid_request_error', 'protocol_not_supported'));
    }

    const startTime = Date.now();
    const apiKey = req.headers.authorization?.substring(7) || String(req.headers['x-api-key'] || '');

    try {
      const response = await proxyRequest(config.baseUrl, proto.path, config.authType, config.apiKey, req.body, model, stream);

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error({ providerId: config.providerId, error }, 'Provider error');
        return reply.status(502).send(openAiError(`Provider error: ${response.status}`, 'provider_error', 'provider_error'));
      }

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send(openAiError('Failed to read response stream', 'internal_error'));
        }

        const latencyMs = Date.now() - startTime;
        const usageStream = createUsageStream('responses', (usage) => {
          const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
          reportUsage(fastify, {
            apiKey, providerId: config.providerId, model,
            tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
            cost, latencyMs
          });
        });

        return reply.send(response.body.pipeThrough(usageStream as any));
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      const usage = extractUsageByFormat('responses', data);
      const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
      reportUsage(fastify, {
        apiKey, providerId: config.providerId, model,
        tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
        cost, latencyMs
      });
      return data;
    } catch (err) {
      fastify.log.error(err, 'Proxy request failed');
      return reply.status(500).send(openAiError('Failed to proxy request', 'internal_error', 'proxy_failed'));
    }
  });
}
```

**Step 2: 创建 `gateway/src/routes/messages.ts`**

结构同 responses.ts，差异：
- 协议查找：`findProtocol(config, 'ANTHROPIC_MESSAGES')`
- 错误格式用 `anthropicError(type, message)`（返回 `{type:'error', error:{type,message}}`）
- usage format 用 `'anthropic'`，`extractUsageByFormat('anthropic', data)`
- 不支持协议错误：`anthropicError('invalid_request_error', 'Provider does not support anthropic messages protocol')`

```ts
import { FastifyInstance } from 'fastify';
import { proxyRequest } from '../providers/proxy.js';
import { extractUsageByFormat, calculateCost, createUsageStream } from '../providers/usage.js';
import { resolveProvider, reportUsage, findProtocol, anthropicError } from './helpers.js';

interface MessagesBody {
  model: string;
  stream?: boolean;
  [key: string]: any;
}

export async function messagesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: MessagesBody }>('/v1/messages', {
    preHandler: [fastify.authenticate, fastify.rateLimit]
  }, async (req, reply) => {
    const { model, stream } = req.body;
    if (!model) {
      return reply.status(400).send(anthropicError('invalid_request_error', 'model is required'));
    }

    const resolved = await resolveProvider(req, model);
    if (!resolved.ok) return reply.status(resolved.status).send(resolved.body);
    const config = resolved.config;

    const proto = findProtocol(config, 'ANTHROPIC_MESSAGES');
    if (!proto) {
      return reply.status(400).send(anthropicError('invalid_request_error', 'Provider does not support anthropic messages protocol'));
    }

    const startTime = Date.now();
    const apiKey = req.headers.authorization?.substring(7) || String(req.headers['x-api-key'] || '');

    try {
      const response = await proxyRequest(config.baseUrl, proto.path, config.authType, config.apiKey, req.body, model, stream);

      if (!response.ok) {
        const error = await response.text();
        fastify.log.error({ providerId: config.providerId, error }, 'Provider error');
        return reply.status(502).send(anthropicError('api_error', `Provider error: ${response.status}`));
      }

      if (stream) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        if (!response.body) {
          return reply.status(500).send(anthropicError('api_error', 'Failed to read response stream'));
        }

        const latencyMs = Date.now() - startTime;
        const usageStream = createUsageStream('anthropic', (usage) => {
          const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
          reportUsage(fastify, {
            apiKey, providerId: config.providerId, model,
            tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
            cost, latencyMs
          });
        });

        return reply.send(response.body.pipeThrough(usageStream as any));
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      const usage = extractUsageByFormat('anthropic', data);
      const cost = calculateCost(usage, config.pricing || { inputPrice: 0, outputPrice: 0, cachePrice: 0 });
      reportUsage(fastify, {
        apiKey, providerId: config.providerId, model,
        tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, cachedTokens: usage.cachedTokens,
        cost, latencyMs
      });
      return data;
    } catch (err) {
      fastify.log.error(err, 'Proxy request failed');
      return reply.status(500).send(anthropicError('api_error', 'Failed to proxy request'));
    }
  });
}
```

**Step 3: 创建集成测试 `gateway/test/routes.test.ts`**

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';

const reported: any[] = [];
let admin: Fastify.FastifyInstance;
let gateway: Fastify.FastifyInstance;
let upstream: Fastify.FastifyInstance;

const RESPONSES_CONFIG = {
  model: 'deepseek-chat', providerType: 'DEEPSEEK',
  baseUrl: 'http://127.0.0.1:3997', path: '/chat/completions',
  protocols: [
    { protocol: 'OPENAI_CHAT', path: '/chat/completions' },
    { protocol: 'OPENAI_RESPONSES', path: '/responses' }
  ],
  pricing: { inputPrice: 0.1, outputPrice: 0.3, cachePrice: 0.05 },
  providerId: 1, authType: 'bearer', apiKey: 'sk-upstream'
};
const CHAT_ONLY_CONFIG = { ...RESPONSES_CONFIG, model: 'chat-only', protocols: [{ protocol: 'OPENAI_CHAT', path: '/chat/completions' }] };
const MESSAGES_CONFIG = {
  model: 'claude-model', providerType: 'ANTHROPIC',
  baseUrl: 'http://127.0.0.1:3997', path: '/chat/completions',
  protocols: [
    { protocol: 'OPENAI_CHAT', path: '/chat/completions' },
    { protocol: 'ANTHROPIC_MESSAGES', path: '/v1/messages' }
  ],
  pricing: { inputPrice: 3, outputPrice: 15, cachePrice: 0.3 },
  providerId: 2, authType: 'anthropic', apiKey: 'sk-anthropic'
};

before(async () => {
  process.env.INTERNAL_SECRET = 'test-secret';
  process.env.ADMIN_API_URL = 'http://127.0.0.1:3998';

  admin = Fastify();
  admin.post('/internal/keys/verify', async (_req, reply) => reply.send({ keyId: 1, userId: 1, rateLimit: 60, dailyQuota: 100000, monthlyQuota: 3000000, userBalance: 100 }));
  admin.post('/internal/models/resolve', async (req, reply) => {
    const { model } = req.body as any;
    if (model === 'deepseek-chat') return RESPONSES_CONFIG;
    if (model === 'chat-only') return CHAT_ONLY_CONFIG;
    if (model === 'claude-model') return MESSAGES_CONFIG;
    return reply.status(404).send({ error: 'Model not found' });
  });
  admin.post('/internal/usage/report', async (req, reply) => { reported.push(req.body); return { success: true }; });
  await admin.listen({ port: 3998, host: '127.0.0.1' });

  upstream = Fastify();
  upstream.post('/responses', async (_req, reply) => {
    return {
      id: 'resp_test', object: 'response', status: 'completed', model: 'deepseek-chat', created_at: 1,
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'hi', annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 30 } }
    };
  });
  upstream.post('/v1/messages', async (_req, reply) => {
    return { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hi' }], model: 'claude-model', stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 5 } };
  });
  await upstream.listen({ port: 3997, host: '127.0.0.1' });

  gateway = await buildApp();
});

after(async () => {
  await gateway.close();
  await admin.close();
  await upstream.close();
});

test('POST /v1/responses: passthrough and reports usage', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'deepseek-chat', input: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.object, 'response');
  assert.equal(body.output[0].content[0].text, 'hi');
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.find(r => r.model === 'deepseek-chat');
  assert.ok(usage, 'usage should be reported');
  assert.equal(usage.tokensIn, 100);
  assert.equal(usage.tokensOut, 50);
  assert.equal(usage.cachedTokens, 30);
});

test('POST /v1/responses: protocol not supported', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/responses',
    headers: { authorization: 'Bearer test-key' },
    payload: { model: 'chat-only', input: [] }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'protocol_not_supported');
});

test('POST /v1/messages: passthrough via x-api-key and reports usage', async () => {
  const res = await gateway.inject({
    method: 'POST', url: '/v1/messages',
    headers: { 'x-api-key': 'test-key' },
    payload: { model: 'claude-model', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.type, 'message');
  assert.equal(body.content[0].text, 'hi');
  await new Promise(r => setTimeout(r, 50));
  const usage = reported.find(r => r.model === 'claude-model');
  assert.ok(usage);
  assert.equal(usage.tokensIn, 20);
  assert.equal(usage.tokensOut, 10);
  assert.equal(usage.cachedTokens, 5);
});
```

**Step 4: 运行测试**

```bash
npm test
```
Expected: 全部 PASS（含 Task 4/5 的测试）。

**Step 5: 构建验证**

```bash
npm run build
```
Expected: 编译通过（此前 Task 6 中缺失的新路由文件现已补齐）。

**Step 6: Commit**

```bash
git add gateway/src/routes/responses.ts gateway/src/routes/messages.ts gateway/test/routes.test.ts
git commit -m "feat(gateway): passthrough routes for /v1/responses and /v1/messages"
```

---

### Task 8: Web — Providers.vue 协议管理

**Files:**
- Modify: `web/src/views/Providers.vue`

**Step 1: 展开面板加「协议」区块**

在 `web/src/views/Providers.vue` 的 expand 模板中，`model-add` 区块之前插入协议表格：

```html
<div class="proto-panel">
  <div class="proto-head">
    <span class="proto-title">支持的协议（直通端点）</span>
  </div>
  <el-table v-if="(row.protocols || []).length" :data="row.protocols" size="small" class="proto-table">
    <el-table-column label="协议" width="200">
      <template #default="{ row: p }">
        <span class="proto-name font-mono">{{ protocolLabel(p.protocol) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="路径（空=协议默认）" min-width="220">
      <template #default="{ row: p }">
        <el-input
          :model-value="p.path || ''"
          :placeholder="defaultPath(p.protocol)"
          size="small"
          @change="(v: string) => saveProtocolPath(row, p, v)"
        />
      </template>
    </el-table-column>
    <el-table-column label="状态" width="90">
      <template #default="{ row: p }">
        <el-switch :model-value="p.status === 'ACTIVE'" size="small" @change="(v: string | number | boolean) => toggleProtocol(row, p, v)" />
      </template>
    </el-table-column>
    <el-table-column label="操作" width="150">
      <template #default="{ row: p }">
        <el-select v-model="row._newProtocol" placeholder="协议" size="small" style="width: 150px">
          <el-option v-for="opt in availableProtocols(row)" :key="opt" :label="protocolLabel(opt)" :value="opt" />
        </el-select>
        <el-button text type="danger" :icon="Delete" size="small" @click="deleteProtocol(row, p)" />
      </template>
    </el-table-column>
  </el-table>
  <div class="proto-add">
    <el-select v-model="row._newProtocol" placeholder="选择协议" clearable size="small">
      <el-option v-for="opt in availableProtocols(row)" :key="opt" :label="protocolLabel(opt)" :value="opt" />
    </el-select>
    <el-button type="primary" :icon="Plus" size="small" @click="addProtocol(row)">添加协议</el-button>
  </div>
  <div v-if="!(row.protocols || []).length" class="proto-empty">未配置协议，默认按 OPENAI_CHAT 直通</div>
</div>
```

**Step 2: script 增加协议逻辑**

在 `web/src/views/Providers.vue` 的 `<script setup>` 中加：

```ts
const PROTOCOL_DEFAULTS: Record<string, string> = {
  OPENAI_CHAT: '/chat/completions',
  OPENAI_RESPONSES: '/responses',
  ANTHROPIC_MESSAGES: '/v1/messages'
};
const PROTOCOL_LABELS: Record<string, string> = {
  OPENAI_CHAT: 'OpenAI Chat',
  OPENAI_RESPONSES: 'OpenAI Responses',
  ANTHROPIC_MESSAGES: 'Anthropic Messages'
};
const protocolLabel = (p: string) => PROTOCOL_LABELS[p] || p;
const defaultPath = (p: string) => PROTOCOL_DEFAULTS[p] || '';
const availableProtocols = (row: any) =>
  Object.keys(PROTOCOL_DEFAULTS).filter(p => !(row.protocols || []).some((rp: any) => rp.protocol === p));

const addProtocol = async (row: any) => {
  const protocol = row._newProtocol;
  if (!protocol) { ElMessage.warning('请选择协议'); return; }
  try {
    await api.post(`/api/providers/${row.id}/protocols`, { protocol });
    ElMessage.success('协议已添加');
    row._newProtocol = '';
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '添加失败');
  }
};

const saveProtocolPath = async (row: any, p: any, path: string) => {
  try {
    await api.put(`/api/providers/${row.id}/protocols/${p.id}`, { path });
    ElMessage.success('路径已保存');
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '保存失败');
    await loadProviders();
  }
};

const toggleProtocol = async (row: any, p: any, active: string | number | boolean) => {
  try {
    await api.put(`/api/providers/${row.id}/protocols/${p.id}`, { status: active ? 'ACTIVE' : 'INACTIVE' });
    ElMessage.success(active ? '已启用' : '已停用');
    await loadProviders();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '操作失败');
    await loadProviders();
  }
};

const deleteProtocol = async (row: any, p: any) => {
  try {
    await ElMessageBox.confirm(`确定删除协议「${protocolLabel(p.protocol)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    await api.delete(`/api/providers/${row.id}/protocols/${p.id}`);
    ElMessage.success('已删除');
    await loadProviders();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.error || '删除失败');
  }
};
```

**Step 3: 样式**

在 `<style scoped>` 中追加：
```css
.proto-panel { padding: 4px 12px 12px; margin-top: 10px; }
.proto-head { margin-bottom: 8px; }
.proto-title { font-size: 13px; font-weight: 600; color: var(--text-1); }
.proto-add { display: flex; gap: 10px; max-width: 360px; margin-top: 10px; }
.proto-table { margin-top: 2px; }
.proto-name { font-size: 12px; font-weight: 600; color: #fcd34d; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); padding: 2px 8px; border-radius: 6px; }
.proto-empty { font-size: 12px; color: var(--text-3); padding: 6px 2px; }
```

**Step 4: 构建验证**

在 `web/` 下运行：
```bash
npm run build
```
Expected: vue-tsc + vite 构建通过。

**Step 5: Commit**

```bash
git add web/src/views/Providers.vue
git commit -m "feat(web): provider protocol management UI"
```

---

### Task 9: 全量验证

**Step 1: 全量构建**

分别在 `gateway/`、`admin/`、`web/` 下运行：
```bash
npm run build
```
Expected: 三处全部通过。

**Step 2: 全量测试**

在 `gateway/` 下运行：
```bash
npm test
```
Expected: 全部 PASS。

**Step 3: 手动验证（可选，需真实 provider）**

1. DeepSeek provider 添加协议 `OPENAI_RESPONSES`（路径留空 = `/responses`），Codex CLI 配置指向网关 `https://<host>/v1`，运行一个任务确认流式输出与工具调用正常、用量上报正确。
2. Anthropic provider 添加协议 `ANTHROPIC_MESSAGES`（路径留空 = `/v1/messages`），Claude Code 指向网关，确认 `x-api-key` 认证、非流/流输出正常。
3. 只有 `OPENAI_CHAT` 的 provider，访问 `POST /v1/responses` 应返回 400 `protocol_not_supported`；访问 `POST /v1/messages` 应返回 400 anthropic 格式错误。

**Step 4: Commit 收尾（如需）**

```bash
git log --oneline -10
```

---

## 关键约定

- **协议默认路径注册表**只在 admin 侧维护（`admin/src/protocols.ts`），网关只消费 resolve 返回的有效路径。
- **usage 解析**统一走 `usage.ts` 的 `UsageFormat`：`chat`/`responses`/`anthropic`/`google`。chat 路由继续传 providerType（内部归一化），新路由显式传 format。
- **错误格式**：`/v1/responses` 用 OpenAI 格式，`/v1/messages` 用 Anthropic 格式（`{type:'error',error:{type,message}}`）。
- 本期**不做**协议转换；不支持即报错。GET `/v1/responses/:id` 等检索端点不在本期范围。
