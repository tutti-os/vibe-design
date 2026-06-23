# Managed Agent Invocation Credential 中文方案

## 最新结论

TSH 侧不需要再合入单独的 `loadURL(..., { extraHeaders })` 方案。

`tutti-lab/tsh#1077` 已经合入 `origin/main`，主线实现通过 Website runtime preview proxy 给预览请求投影 managed agent credential header。vibe-design 应该直接消费这条主线协议：

```http
X-TSH-Managed-Agent-Credential: <credential>
```

vibe-design 不再维护自定义的 `X-Tutti-Agent-Credential` header 名，而是使用 `@tutti-os/agent-acp-kit@0.2.3-beta.0` 导出的：

- `MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER`
- `getManagedAgentInvocationCredentialFromHeaders(headers)`

这样 TSH、vibe-design、agent-acp-kit 三边使用同一个协议常量。

## 为什么不是 JSB 解决 SSR

SSR 运行在 vibe-design server 的 Node 进程中，没有 `window.tutti`，因此 SSR 阶段无法调用：

```ts
window.tutti.agent.getManagedAgentInvocationCredential()
```

首屏 `GET /project/:projectId` 的 agent availability detection 在 SSR 期间发生，所以它只能从 server 能看到的 HTTP request header 读取 credential。

hydrate 之后，浏览器端可以通过 JSB 动态获取 credential，再由 vibe-design 自己在需要的 API 调用里显式携带。

## TSH 主线行为

TSH `origin/main` 已有行为来自 `tutti-lab/tsh#1077`：

1. Website app launch URL 会通过 `resolveWebsiteRuntimePreviewProxyUrl(...)` 转成本地 preview proxy URL。
2. Electron session 由 `WebsiteRuntimePreviewProxy.configureSession(...)` 配置代理。
3. proxy 根据 route 解析 room/workspace。
4. `WebsiteManagedAgentCredentialProjector` 调用 `getManagedAgentInvocationCredential(roomId)` 获取 credential。
5. proxy 先移除页面请求里伪造的同名 header，再写入 `X-TSH-Managed-Agent-Credential`。
6. credential 有 5s cache、1s resolve timeout；失败时不注入，继续放行请求。

这意味着首屏 SSR 请求、以及经由 Website runtime preview proxy 的后续请求，都可以在 server 侧读到同一个 header。vibe-design 仍然不应该依赖 TSH 维护应用 API 白名单；hydrate 后哪些 API 需要 credential，仍由 vibe-design 自己决定。

## vibe-design 侧实现

### SSR agent availability

`GET /project/:projectId` SSR route 读取 request header：

```ts
getManagedAgentInvocationCredentialFromHeaders(req.headers)
```

如果 credential 存在，构造 detect context：

```ts
{
  env: {
    ...process.env,
    [MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV]: credential,
  },
}
```

然后传给 agent availability detection：

```ts
detectAgentAvailability(context)
```

credential 不写入 HTML、`window.__VIBE_DESIGN_INITIAL__`、响应 JSON、日志或持久化数据。

### Model catalog

`GET /api/agents/models` 同样读取 request header 并传给 model detection。

hydrate 后如果浏览器端想主动刷新 model catalog，可以先调用 JSB 获取 credential，再显式带上同一个 header：

```http
X-TSH-Managed-Agent-Credential: <credential>
```

这里的 header 是 vibe-design 前端在明确调用点设置的，不要求 TSH 维护额外 API 白名单。

### Run creation

`POST /api/runs` 保持已有 body 协议：

```json
{
  "managedAgentInvocationCredential": "<credential>"
}
```

浏览器端在创建 run 前通过 JSB 动态获取 credential，放入 body。server 只把它放进 transient run meta，启动 agent 后清空，不进入 status、SSE、starter request、日志或持久化数据。

## agent-acp-kit 版本

使用：

```json
"@tutti-os/agent-acp-kit": "0.2.3-beta.0"
```

原因：

- 该版本提供 managed invocation header 常量。
- 该版本提供从 `Headers` / Node request headers 中读取 credential 的 helper。
- helper 对 header 大小写不敏感，适合 SSR/Express/Electron proxy 链路。

## 验证点

vibe-design 需要覆盖：

- SSR `GET /project/:projectId` 能从 `X-TSH-Managed-Agent-Credential` 读取 credential。
- SSR detect context 能收到 `MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV`。
- SSR HTML 和 `window.__VIBE_DESIGN_INITIAL__` 不包含 credential。
- `GET /api/agents/models` 能读取显式 header，响应 JSON 不包含 credential。
- `POST /api/runs` 能从 body 接收 JSB credential，并且 status/SSE/starter request 不泄漏。
- server/web type-check 通过。

推荐命令：

```bash
pnpm --dir server exec vitest run src/main.test.ts src/local-claude-provider.test.ts src/agent-launcher.test.ts
pnpm --dir web exec vitest run src/services/managed-agent/managed-agent-credential.test.ts src/services/run/internal/run-service.test.ts
pnpm --filter @vibe-design/server type-check
pnpm --filter @vibe-design/web type-check
```

## 最终链路

```text
TSH Website runtime preview proxy
  -> 解析 preview route / room
  -> getManagedAgentInvocationCredential(roomId)
  -> 注入 X-TSH-Managed-Agent-Credential
  -> vibe-design SSR/model API 读取 header helper
  -> 转成 agent-acp-kit detect env
  -> agent-acp-kit detect 使用 credential

hydrate 后创建 run
  -> vibe-design web 通过 JSB 获取 credential
  -> POST /api/runs body.managedAgentInvocationCredential
  -> agent-acp-kit run 使用 credential
  -> credential 不返回给浏览器可见数据
```
