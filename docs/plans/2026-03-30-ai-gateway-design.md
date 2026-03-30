# AI API Gateway 设计文档

## 概述

构建一个 AI API 代理/路由网关，聚合多个 LLM 提供商（OpenAI、Anthropic、Google AI、Hugging Face），对内暴露统一 API，并通过 API Key 进行管控。

## 技术选型

- **网关服务**: Node.js + TypeScript + Fastify
- **管理平台**: Node.js + TypeScript + Fastify + Prisma
- **管理后台**: Vue 3 + Element Plus + Vite
- **数据库**: MySQL 8.0+
- **部署**: Docker + Docker Compose

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        外部客户端                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway 服务                            │
│  - 统一入口 (端口 3000)                                          │
│  - 请求路由 (按 model 前缀分发到不同提供商)                         │
│  - Key 验证 (调用管理平台 API)                                   │
│  - 速率限制 (内存缓存)                                           │
│  - 使用量统计上报                                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 内部 API 调用
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     管理平台服务                                 │
│  - 管理 API (端口 3001)                                          │
│  - 用户、Key、配额、计费管理                                       │
│  - 使用统计与报表                                                 │
│  - Vue 3 前端托管 (静态文件)                                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MySQL                                   │
│  - 用户、API Key、配额、账单、使用记录                             │
└─────────────────────────────────────────────────────────────────┘
```

### 支持的提供商

- **OpenAI**: gpt-* 模型
- **Anthropic**: claude-* 模型
- **Google AI**: gemini-* 模型
- **Hugging Face**: hf-* 模型

## 数据模型

### ER 图

```
┌──────────────────┐     ┌──────────────────┐
│      users       │     │    api_keys      │
├──────────────────┤     ├──────────────────┤
│ id (PK)          │◄────│ id (PK)          │
│ email            │     │ user_id (FK)     │
│ password_hash    │     │ key_hash         │
│ name             │     │ name             │
│ role (admin/user)│     │ status           │
│ balance          │     │ rate_limit       │
│ created_at       │     │ daily_quota      │
│ updated_at       │     │ monthly_quota    │
└──────────────────┘     │ expires_at       │
                         │ created_at       │
                         └──────────────────┘

┌──────────────────┐     ┌──────────────────┐
│  usage_records   │     │   providers      │
├──────────────────┤     ├──────────────────┤
│ id (PK)          │     │ id (PK)          │
│ api_key_id (FK)  │     │ name             │
│ provider_id (FK) │     │ type (openai/...) │
│ model            │     │ base_url         │
│ tokens_in        │     │ api_key (加密)    │
│ tokens_out       │     │ status           │
│ cost             │     │ created_at       │
│ request_time_ms  │     └──────────────────┘
│ created_at       │
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐
│     bills        │     │   transactions    │
├──────────────────┤     ├──────────────────┤
│ id (PK)          │     │ id (PK)          │
│ user_id (FK)     │     │ user_id (FK)     │
│ period_start     │     │ type (充值/扣费)  │
│ period_end       │     │ amount           │
│ total_cost       │     │ balance          │
│ status           │     │ description      │
│ paid_at          │     │ created_at       │
│ created_at       │     └──────────────────┘
└──────────────────┘
```

## API 设计

### 网关服务 API（对外暴露）

```
POST /v1/chat/completions      # 统一聊天接口（兼容 OpenAI 格式）
POST /v1/completions           # 统一补全接口
GET  /v1/models                # 列出可用模型

路由规则（通过 model 前缀区分）：
- gpt-* → OpenAI
- claude-* → Anthropic
- gemini-* → Google AI
- hf-* → Hugging Face
```

### 管理平台 API（内部 + 管理后台）

```
# 内部调用（网关 → 管理平台）
POST /internal/keys/verify     # 验证 Key 有效性
POST /internal/usage/report    # 上报使用量

# 用户认证
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

# 用户管理（管理员）
GET    /api/users
POST   /api/users
PUT    /api/users/:id
DELETE /api/users/:id

# API Key 管理
GET    /api/keys
POST   /api/keys
PUT    /api/keys/:id
DELETE /api/keys/:id

# 配额管理
GET    /api/quotas
PUT    /api/quotas/:key_id

# 使用统计
GET    /api/usage/stats
GET    /api/usage/records

# 计费管理
GET    /api/bills
GET    /api/transactions
POST   /api/transactions/recharge

# 提供商管理（管理员）
GET    /api/providers
POST   /api/providers
PUT    /api/providers/:id
DELETE /api/providers/:id
```

## 核心流程

### 请求处理流程

```
客户端请求
    │
    ▼
┌──────────────────┐
│ 1. 提取 API Key   │ (Header: Authorization: Bearer xxx)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 2. 调用管理平台   │ POST /internal/keys/verify
│    验证 Key       │ 返回: 有效/无效、配额信息、速率限制
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 有效？   │
    └────┬────┘
         │
    ┌────┴────┐
    │ 否      ├─────────► 401 Unauthorized
    └────┬────┘
         │ 是
         ▼
┌──────────────────┐
│ 3. 速率限制检查   │ (内存滑动窗口)
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 通过？   │
    └────┬────┘
         │
    ┌────┴────┐
    │ 否      ├─────────► 429 Too Many Requests
    └────┬────┘
         │ 是
         ▼
┌──────────────────┐
│ 4. 解析 model     │ 根据前缀路由到对应提供商
│    路由转发       │ 转发请求，添加提供商 API Key
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5. 流式响应处理   │ SSE 流式返回给客户端
│    统计 Token     │ 同时统计输入/输出 Token
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 6. 上报使用量     │ POST /internal/usage/report
│    扣减配额       │ 异步上报，不阻塞响应
└────────┴─────────┘
```

### 计费流程

```
每次请求完成后：
1. 计算 Token 使用量 (input_tokens × input_price + output_tokens × output_price)
2. 上报到管理平台，扣减用户余额/配额
3. 记录到 usage_records 表
4. 每月生成账单 (bills 表)
5. 支持用户充值 (transactions 表)
```

## 项目结构

```
ai-gateway/
├── gateway/                    # 网关服务
│   ├── src/
│   │   ├── index.ts           # 入口
│   │   ├── routes/            # 路由处理
│   │   ├── providers/         # 提供商适配器
│   │   ├── middleware/        # 中间件（认证、限流）
│   │   └── utils/             # 工具函数
│   ├── package.json
│   └── Dockerfile
│
├── admin/                      # 管理平台服务
│   ├── src/
│   │   ├── index.ts           # 入口
│   │   ├── routes/            # API 路由
│   │   ├── services/          # 业务逻辑
│   │   ├── prisma/            # 数据库模型
│   │   └── utils/             # 工具函数
│   ├── package.json
│   └── Dockerfile
│
├── web/                        # 管理后台前端
│   ├── src/
│   │   ├── views/             # 页面组件
│   │   ├── components/        # 通用组件
│   │   ├── stores/            # Pinia 状态
│   │   ├── api/               # API 调用
│   │   └── router/             # 路由配置
│   ├── package.json
│   └── Dockerfile
│
├── docker-compose.yml          # 编排配置
├── .env.example               # 环境变量模板
└── README.md
```

## 安全设计

### API Key 安全

- 用户 Key 使用 bcrypt 哈希存储（不可逆）
- 提供 Key 时只显示一次，后续只显示前4位
- 提供商 API Key 使用 AES-256 加密存储

### 认证授权

- JWT Token 认证（管理后台）
- 内部服务通信使用共享密钥验证
- HTTPS 强制（生产环境）

### 请求安全

- 请求日志脱敏（隐藏敏感 Header）
- SQL 注入防护
- XSS 防护（前端）

### 速率限制

- 内存滑动窗口算法
- 支持按 Key/用户/IP 限流
- 可配置突发流量容忍

### 配额控制

- 日配额/月配额双重限制
- 余额不足时拒绝请求
- 预扣费机制（防止超支）

## 错误处理

### 统一错误响应格式

```json
{
  "error": {
    "message": "string",
    "type": "invalid_request_error | authentication_error | rate_limit_error | ...",
    "code": "string"
  }
}
```

### 错误码

- 400: 请求参数错误
- 401: API Key 无效或过期
- 402: 余额不足
- 429: 超过速率限制
- 500: 内部服务错误
- 502: 上游提供商错误
- 503: 服务暂时不可用

## 日志与监控

### 结构化日志

- 请求 ID（链路追踪）
- 用户 ID、Key ID
- 提供商、模型
- Token 统计、耗时
- 错误详情

### 健康检查

- GET /health（网关）
- GET /health（管理平台）
- 数据库连接检查
- 提供商可用性检查（可选）

### 监控指标（可选）

- Prometheus 格式
- 请求量、延迟、错误率
- Token 消耗统计

## 功能清单

### 网关服务

- [x] 统一 API 入口（兼容 OpenAI 格式）
- [x] 多提供商路由
- [x] API Key 验证
- [x] 速率限制
- [x] 流式响应支持
- [x] Token 统计
- [x] 使用量上报

### 管理平台

- [x] 用户管理（CRUD）
- [x] API Key 管理（生成、撤销、状态）
- [x] 配额管理（日/月配额设置）
- [x] 速率限制配置
- [x] 使用统计与报表
- [x] 计费系统（余额、账单、交易记录）
- [x] 提供商管理（配置上游 API）
- [x] 管理后台 UI

### 管理后台前端

- [x] 登录/登出
- [x] 用户管理页面
- [x] API Key 管理页面
- [x] 配额管理页面
- [x] 使用统计仪表盘
- [x] 账单与交易记录
- [x] 提供商配置页面