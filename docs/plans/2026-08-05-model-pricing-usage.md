# 模型定价 + 精确用量统计

日期：2026-08-05

## 背景

网关当前所有请求按统一硬编码费率计费（`chat.ts:175`：`prompt*0.00001 + completion*0.00003`），流式请求直接上报 0 token、0 费用；token 解析只认 OpenAI 格式的 `usage.prompt_tokens/completion_tokens`，Anthropic/Google/DeepSeek 均读不到；完全未处理缓存命中计费；价格无任何本地配置入口。

## 目标

1. 每模型配置输入/输出/缓存三档价格（$/百万 token），网关按模型计价并从用户余额扣除。
2. 正确解析各厂商 token 用量：OpenAI 系（OPENAI/DEEPSEEK/智谱 GLM）、Anthropic、Google。
3. 流式请求也能统计 token 与费用（当前恒为 0）。
4. 识别并区分缓存命中的输入 token，按缓存价单独计价，并在使用明细中展示。
5. 不做缓存写入计费（Anthropic cache_creation 暂不支持）。

## 数据模型（admin/prisma/schema.prisma）

- `Model` 新增：
  - `inputPrice Decimal @default(0)`：输入价格 $/百万 token
  - `outputPrice Decimal @default(0)`：输出价格 $/百万 token
  - `cachePrice Decimal @default(0)`：缓存命中输入价格 $/百万 token
- `UsageRecord` 新增：
  - `cachedTokens Int @default(0)`：本次请求缓存命中的输入 token
- `ProviderType` 枚举不加智谱；智谱模型按 OPENAI 类型 + 自定义 baseUrl 配置，走 OpenAI 兼容解析分支。DeepSeek 已是独立枚举值。

## 计费公式

```
missInput = tokensIn - cachedTokens
cost = missInput * inputPrice/1e6
     + cachedTokens * cachePrice/1e6
     + tokensOut * outputPrice/1e6
```

## 用量解析（新增 gateway/src/providers/usage.ts）

`extractUsage(providerType, body)`（非流式）与 SSE 分块解析器（流式）按 providerType 适配：

| providerType | 输入 token | 输出 token | 缓存命中 token |
|---|---|---|---|
| ANTHROPIC | `usage.input_tokens` | `usage.output_tokens` | `usage.cache_read_input_tokens` |
| GOOGLE | `usageMetadata.promptTokenCount` | `usageMetadata.candidatesTokenCount` | `usageMetadata.cachedContentTokenCount` |
| OPENAI / DEEPSEEK / 其他 | `usage.prompt_tokens` | `usage.completion_tokens` | `usage.prompt_cache_hit_tokens` 或 `usage.prompt_tokens_details.cached_tokens` |

### 流式

- 用 TransformStream 包裹上游响应体，透传字节的同时解析 SSE `data:` 行，自动拼接跨 chunk 碎包。
- OpenAI 系（OPENAI/DEEPSEEK）流式请求自动注入 `stream_options: { include_usage: true }`，使末尾返回 usage chunk。
- Anthropic 流式：`message_start` 带 input_tokens，`message_delta` 带 output_tokens；Google 流式：末尾 chunk 带 usageMetadata。
- 流结束后（flush）才上报用量与费用，修复现有 `setTimeout(100ms)` 未等流完即上报的缺陷。

## 后端接口变更（admin）

- `routes/models.ts`：GET/POST/PUT 读写三档价格。
- `routes/internal.ts`：
  - `/internal/models/resolve` 增加返回 `providerType` 与 `pricing { inputPrice, outputPrice, cachePrice }`。
  - `/internal/usage/report` 增加接收 `cachedTokens` 并写入。
- `routes/usage.ts`：stats/records/trend 汇总新增 cachedTokens。

## 网关接口变更（gateway）

- `routes/chat.ts`：非流式用 `extractUsage` + `calculateCost`；流式用 TransformStream 解析并在 flush 上报。
- `providers/proxy.ts`：不需要改解析逻辑（透传），流式 body 注入在 chat.ts 完成。
- `providers/usage.ts`（新增）：`extractUsage` / SSE 解析器 / `calculateCost`。

## 前端（web）

- `views/Providers.vue`：展开行的模型管理升级为小表格，模型行内联展示并可修改三档价格（$/百万），change 即保存；保留添加/启停/删除。
- `views/Usage.vue`：明细表加“缓存 Token”列。
- 提供商表单/筛选不加智谱类型（维持现状，DeepSeek 已在）。

## 迁移与数据

- 数据库：`prisma db push` 新增列。
- 老模型价格默认 0：管理员在界面逐模型设置价格后开始计费；未设置前相关费用为 0，不再产生旧的统一假费率。

## 测试

- gateway 单测：各厂商格式的 `extractUsage`（非流式 + SSE 分块）与 `calculateCost` 快照/断言。
- 手动验证：DeepSeek / OpenAI 流式与非流式上报正确 token 与缓存命中。

## 验收标准

- 流式与非流式请求的 token 均正确统计，缓存命中按 cachePrice 计价。
- 使用明细与统计可见 cachedTokens。
- 模型价格可在提供商页面内联配置，保存后立即生效。
