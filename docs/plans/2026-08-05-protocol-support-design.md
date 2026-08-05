# 协议支持设计：/v1/responses 与 /v1/messages（直通配对）

## 概述

网关目前仅暴露 `POST /v1/chat/completions` 与 `GET /v1/models`，无法服务 Codex CLI（走 `openai-responses` 协议）与 Claude Code CLI（走 `anthropic-messages` 协议）。

本设计引入**协议（Protocol）**作为一级概念：Provider 声明自身原生支持的协议及路径，网关按入站端点与提供商协议做**直通配对**。本期**不做协议转换**，不支持入站协议的提供商直接返回错误。

## 范围

- [x] 数据模型：`Protocol` 枚举 + `ProviderProtocol` 关联表
- [x] 协议注册表：标准默认路径，`path` 可空、空则用默认
- [x] 管理端 resolve 返回 `protocols`（含有效路径）
- [x] 网关新增 `POST /v1/responses`、`POST /v1/messages`（直通）
- [x] 认证兼容 `x-api-key`（Claude Code）
- [x] usage 解析支持 responses 格式
- [x] 管理后台协议配置 UI
- [ ] 协议转换（responses↔chat↔messages）—— 后续迭代

## 数据模型（admin/prisma/schema.prisma）

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
  path       String?  // null = 使用协议标准默认路径
  status     String   @default("ACTIVE")
  @@unique([providerId, protocol])
}
```

- 保留 `Provider.path` 列，作为 OPENAI_CHAT 协议路径的兼容来源（迁移时 seed 一行 ProviderProtocol）。
- 后续新增协议（如 Gemini native）只需扩展枚举 + 注册表 + 网关端点，无需改表结构。

## 协议注册表（默认路径，相对 baseUrl）

| 协议 | 端点 | 默认路径 |
|---|---|---|
| `OPENAI_CHAT` | `POST /v1/chat/completions` | `/chat/completions` |
| `OPENAI_RESPONSES` | `POST /v1/responses` | `/responses` |
| `ANTHROPIC_MESSAGES` | `POST /v1/messages` | `/v1/messages` |

- 默认路径注册表维护在**管理端**；resolve 时 `path` 为空则按注册表算有效路径返回。
- 网关只消费 resolve 返回的有效路径，不重复维护默认值。
- UI 表单 placeholder 显示默认路径，留空即用默认；特殊提供商可填覆盖值。

## resolve 接口变更（admin/src/routes/internal.ts）

`POST /internal/models/resolve` 响应在现有字段基础上增加：

```json
{
  "model": "...",
  "providerType": "DEEPSEEK",
  "baseUrl": "https://api.deepseek.com/v1",
  "path": "/chat/completions",
  "protocols": [
    { "protocol": "OPENAI_CHAT", "path": "/chat/completions" },
    { "protocol": "OPENAI_RESPONSES", "path": "/responses" }
  ],
  "pricing": { "inputPrice": 0, "outputPrice": 0, "cachePrice": 0 },
  "providerId": 1,
  "authType": "bearer",
  "apiKey": "..."
}
```

- 保留 `path`/`authType` 等现有字段，兼容现有 `/v1/chat/completions` 逻辑。
- `protocols` 为 provider 原生支持协议 + 有效路径；`path` 为空的行算好有效路径后返回。
- `ProviderProtocol.status` 非 ACTIVE 的协议行不返回。

## 网关路由（gateway/src/routes/）

### POST /v1/responses（responses.ts）
1. 认证（auth 中间件）
2. 限流（rateLimit）
3. 校验 `model` 必填
4. resolve provider
5. 查 `protocols` 中是否有 `OPENAI_RESPONSES`：
   - 有 → 直通：请求体原样转发到 `${baseUrl}${有效路径}`，使用协议对应的 authType
   - 无 → `400` 返回 `Provider does not support responses protocol`
6. 非流：解析上游 responses 格式 usage → 上报
7. 流：SSE 透传 + 复用 TransformStream 解析 responses 格式 usage → 上报

### POST /v1/messages（messages.ts）
1-6. 同上，协议为 `ANTHROPIC_MESSAGES`，路径默认 `/v1/messages`
7. 非流：现有 anthropic usage 解析
8. 流：SSE 透传 + 现有 anthropic 流解析

复用 `proxy.ts` 的 `proxyRequest`（已支持 bearer/anthropic/google 认证头）。

## 认证兼容（gateway/src/middleware/auth.ts）

- 现有逻辑只认 `Authorization: Bearer <key>`。
- 增加：当 `authorization` 缺失时，读取 `x-api-key` 头作为 API key（Claude Code 行为）。
- 两者都提供时以 `authorization` 为准。

## Usage 解析（gateway/src/providers/usage.ts）

新增 responses 格式分支（直通时按上游原生格式解析）：

- `input_tokens` → tokensIn
- `output_tokens` → tokensOut
- `input_tokens_details.cached_tokens` → cachedTokens
- `output_tokens_details.reasoning_tokens` → 暂不单独计价（可后续扩展）

anthropic 格式已支持；chat 格式已支持。三种格式的流式解析入口统一。

## 管理后台

- admin：`/api/providers` 相关路由支持 ProviderProtocol 的读取/创建/更新/删除（嵌套于 provider）。
- web/src/views/Providers.vue：将「路径」输入改造为「协议列表」可编辑表格（协议类型下拉 + 路径输入 + 状态开关），新增 provider 时默认生成一行 `OPENAI_CHAT`（用旧 `path` 值或默认路径）。
- 数据库迁移：新增表 + seed 现有 provider 的 OPENAI_CHAT 行。

## 错误处理

- 入站协议不被 provider 原生支持 → `400 Bad Request`，OpenAI 错误格式（`{error:{message,type,code}}`），`code: protocol_not_supported`。
- /v1/messages 的错误响应按 Anthropic 错误格式输出（`{type:"error", error:{type, message}}`），便于 Claude Code 解析。

## 测试与验证

### 单测（gateway/test/）
- usage 解析：responses 格式（非流 + 流）。
- 路由：模拟 mock provider，验证直通路径拼接、不支持协议的错误响应、x-api-key 认证。

### 手动验证
- DeepSeek provider 配置 `OPENAI_CHAT` + `OPENAI_RESPONSES`，Codex CLI 指向网关 `https://<host>/v1`，跑一次任务。
- Anthropic provider 配置 `ANTHROPIC_MESSAGES`，Claude Code 指向网关，跑一次任务。
- 配置仅有 `OPENAI_CHAT` 的 provider，访问 `/v1/responses` 确认返回 `protocol_not_supported`。

## 后续迭代（不在本期）

- 协议转换：以 openai-chat 为桥接核心，`chat↔responses`、`chat↔messages` 直写适配器，`responses↔messages` 组合复用。
- reasoning_tokens 单独计价字段。
- Gemini native 协议。
