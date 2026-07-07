# 纳百川 (Nabai)

部署在 Cloudflare Workers 上的多模型 API 聚合网关。通过 Durable Objects + SQLite 存储配置，支持 Gemini、OpenAI 兼容、Anthropic 三种 Provider，提供 OpenAI 和 Anthropic 双协议入口，自动在密钥池中随机选取实现负载均衡。

## 功能

- **多 Provider 支持**：Gemini（原生）、OpenAI 兼容（OpenAI / DeepSeek / 任意兼容端点）、Anthropic
- **双协议入口**：同时兼容 OpenAI 和 Anthropic 格式的请求，自动转换为 Provider 对应的格式
- **密钥池负载均衡**：多个 API 密钥随机选取，健康检查自动恢复
- **端点映射**：通过 `/e/:endpointId/` 前缀将不同路径绑定不同模型集合（密钥和 Provider 根据模型自动选取）
- **管理面板**：Web UI 管理 Provider、密钥、端点，支持批量操作、健康检查、导入导出备份
- **Durable Objects 持久化**：所有配置存储在 Cloudflare DO 的 SQLite 中

## 部署

```bash
git clone https://github.com/yCENzh/nabai.git
cd nabai
pnpm install
npx wrangler login
pnpm run deploy
```

部署后修改环境变量（在 Cloudflare Dashboard 或 `wrangler.jsonc` 中）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTH_KEY` | API 请求认证密钥 | `nabai` |
| `HOME_ACCESS_KEY` | 管理面板登录密码 | 内置默认值（首次登录后请修改） |

**建议部署后立即修改这两个值。**

## 使用

### 配置 Provider

1. 访问 Worker URL，输入 `HOME_ACCESS_KEY` 登录管理面板
2. 在「Provider」页添加 Provider（填写 ID、类型、Base URL）
3. 在「密钥」页添加该 Provider 的 API 密钥
4. 在「端点」页配置路径映射（可选）

### API 调用

在 AI 客户端中配置：

- **Base URL**：`https://<your-worker>.workers.dev`
- **API Key**：填 `AUTH_KEY` 的值

支持的端点：

| 路径 | 说明 |
|------|------|
| `/v1/chat/completions` | OpenAI 格式对话补全 |
| `/v1/embeddings` | OpenAI 格式文本嵌入 |
| `/v1/models` | 模型列表 |
| `/v1/messages` | Anthropic 格式对话 |

通过端点映射访问特定 Provider：

```
https://<your-worker>.workers.dev/e/<endpointId>/v1/chat/completions
```

## 管理 API

所有管理 API 需在请求头携带 `Authorization: Bearer <HOME_ACCESS_KEY>` 或 cookie `auth-key`。

### Provider

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | 获取所有 Provider |
| POST | `/api/providers` | 创建/更新 Provider |
| DELETE | `/api/providers` | 删除 Provider（同时删除关联密钥） |

### 密钥

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/keys?page=1&pageSize=50` | 分页获取密钥列表 |
| POST | `/api/keys` | 批量添加密钥 |
| PUT | `/api/keys` | 更新单个密钥 |
| PATCH | `/api/keys` | 批量启用/禁用密钥 |
| DELETE | `/api/keys` | 批量删除密钥 |
| POST | `/api/keys/check` | 检查指定密钥有效性 |

### 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/endpoints` | 获取所有端点 |
| POST | `/api/endpoints` | 创建/更新端点 |
| DELETE | `/api/endpoints` | 删除端点 |

### 备份/恢复

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/backup` | 导出所有 Provider、密钥、端点为 JSON |
| POST | `/api/backup/restore` | 从 JSON 恢复（覆盖现有数据） |

## 架构

```
请求 → Worker(index.ts) → Durable Object(handler.ts)
  ├── /api/*          → Admin API (routes/admin.ts)
  ├── /v1/messages    → Anthropic 协议入口 (routes/anthropic.ts)
  ├── /v1/chat/*      → OpenAI 协议入口 (routes/proxy.ts)
  └── /v1beta/*       → Gemini 原生代理 (routes/proxy.ts)

协议转换：
  入站协议(OpenAI/Anthropic) → CanonicalRequest → Provider → CanonicalResponse → 入站协议格式
```

- **Provider**：`providers/gemini.ts`、`providers/openai-compat.ts`、`providers/anthropic.ts`
- **协议适配器**：`protocols/openai.ts`、`protocols/anthropic.ts`
- **密钥池**：`pool/key-pool.ts`（随机选取 + 429 降级 + 定时健康检查）

## 开发

```bash
pnpm install
pnpm run dev     # 本地开发
pnpm run deploy  # 部署到 Cloudflare
```
