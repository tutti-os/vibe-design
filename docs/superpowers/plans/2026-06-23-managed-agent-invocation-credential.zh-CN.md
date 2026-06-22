# Managed Agent Invocation Credential 中文方案

> **给 agentic workers：**如果要实现本方案，建议按任务拆分执行，并优先使用 `superpowers:subagent-driven-development` 做逐任务实现和 review。

**目标：**让运行在 TSH Website WebView 中的 vibe-design，在 SSR 阶段能拿到当前 room 的 managed agent credential，并把它安全透传给 `@tutti-os/agent-acp-kit` 的 detect 调用；hydrate 之后的 API 调用则由 vibe-design 自己通过 JSB 按需显式携带 credential。

**核心架构：**SSR 不能调用 JSB，因为 SSR 运行在 Node 进程里，没有 `window.tutti`。首屏 SSR 要在 TSH 打开 Website WebView 页面时，把 credential 作为 navigation request header 带给 vibe-design server：`X-Tutti-Agent-Credential`。vibe-design server 读取该 header 后，将 credential 转成 `agent-acp-kit` detect/run 所需的 transient context/env，并确保 credential 不进入 HTML、initial data、响应、日志或持久化数据。

**涉及技术栈：**TSH Electron Website WebView、vibe-design Express SSR/API、`@tutti-os/agent-acp-kit`。

---

## 结论

不要依赖 JSB 给 SSR 使用。

`window.tutti.agent.getManagedAgentInvocationCredential()` 只能在浏览器 hydrate 之后调用，因此它不能覆盖：

- `GET /project/:projectId` SSR 阶段的 agent availability detection
- 任何发生在 hydrate 之前、由 server 自发执行的 model detection

主方案应该是：

1. TSH 打开 `GET /project/:projectId` 页面时，在 `loadURL(..., { extraHeaders })` 上注入 `X-Tutti-Agent-Credential`
2. vibe-design server 在 SSR request header 中读取 credential
3. SSR agent availability detect 时把 credential 传给 `agent-acp-kit`
4. hydrate 后的 API 阶段不由 TSH 猜白名单；vibe-design 自己通过 JSB 按需拿 credential 并显式传给自己的 API
5. credential 全程不暴露给 HTML、initial data、日志或持久化数据

## Header 名称

使用：

```http
X-Tutti-Agent-Credential: <credential>
```

不使用更长的：

```http
X-Tutti-Managed-Agent-Invocation-Credential
```

原因：

- `X-Tutti-Agent-Credential` 已经足够表达这是 Tutti 注入的 agent credential
- 名称短，便于调试和阅读
- 不把 managed/invocation 等实现细节塞进协议名
- 代码内部仍可用完整常量名表达语义，例如 `MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER`

## TSH 侧方案

首屏 SSR 的 credential 注入点应该放在“打开页面”这一步，而不是依赖页面加载后的 JSB。

TSH 当前 Website WebView 打开页面的核心链路是：

```text
WebsiteGuestManager.activate/navigate/registerGuest
  -> loadWebsiteWindowRuntimeDesiredUrl(...)
  -> requestWebsiteGuestLoad(...)
  -> contents.loadURL(desiredUrl)
```

这里的 `contents.loadURL(desiredUrl)` 应改成在目标 URL 命中 vibe-design 项目页时携带 `extraHeaders`：

```ts
await contents.loadURL(desiredUrl, {
  extraHeaders: `X-Tutti-Agent-Credential: ${credential}`,
});
```

这个 header 会进入浏览器发给 vibe-design server 的首个 navigation request，也就是 server 执行 `GET /project/:projectId` SSR 的那个请求。SSR 不是浏览器里的 JS 执行阶段，所以不能等 hydrate 后再调用 JSB。

首屏 navigation header 只对这个请求注入：

- `GET /project/:projectId`

后续 API 是另一个问题，不能假设 `loadURL` 的 `extraHeaders` 会自动覆盖后续 fetch/XHR。

TSH 不应该继续用 `webRequest.onBeforeSendHeaders` 去给后续 API 做白名单注入，原因是 TSH 很难稳定知道 vibe-design 哪些业务 API 需要 credential。这个白名单属于 vibe-design 的应用协议，不应该固化在 TSH WebView 层。

hydrate 之后如果某个 API 需要 credential，应该由 vibe-design 自己在调用点显式处理：

- `POST /api/runs`：继续使用已有的 body 字段 `managedAgentInvocationCredential`
- `GET /api/agents/models`：如果 hydrate 后仍需要重新做 managed detect，改成由前端先调用 JSB，再用 vibe-design 自己定义的请求方式携带 credential，例如自定义 header 或调整为 POST body
- 其它 API：只有 vibe-design 明确知道需要时才携带

因此推荐拆成：

- SSR availability：必须走 `loadURL(..., { extraHeaders })`
- 后续 API：不走 TSH request interception，由 vibe-design 通过 JSB 按需显式传递
- JSB：只用于 hydrate 后 API，不用于 SSR

必须同时满足：

- 请求目标是可信 vibe-design host
- production 只允许 `https`
- localhost 开发环境允许 `http`
- 首屏打开页面时能够通过 `runtime.nodeId` / room registry 解析到 room
- 找不到 room 时不注入

对首屏 navigation 来说，不要按 Electron session/profile 全局注入，而是在本次 `loadURL` 调用上携带 `extraHeaders`。

TSH 获取 credential 使用现有主进程服务：

```ts
const { credential } = await desktopShellService.getManagedAgentInvocationCredential(roomId);
```

该服务已经会走：

```text
desktopShellService
  -> desktopd GET /v1/rooms/{roomId}/managed-agent/invocation-credential
  -> guest-agent
  -> room-scoped managed credential
```

### TSH 需要改的文件

- `apps/tsh-desktop/src/app/main/websiteWindow/managedAgentInvocationCredentialHeader.ts`
  - 新增文件
  - 负责 trusted host、scheme、method、path 匹配
  - 导出 header 名：`X-Tutti-Agent-Credential`
  - 提供构建 `loadURL` navigation `extraHeaders` 的 helper
  - 负责按需调用 `desktopShellService.getManagedAgentInvocationCredential(roomId)`

- `apps/tsh-desktop/src/app/main/websiteWindow/managedAgentInvocationCredentialHeader.spec.ts`
  - 新增测试
  - 覆盖允许/拒绝注入的 navigation URL
  - 覆盖 missing room 不注入
  - 覆盖不会注入到静态资源、SSE、第三方请求、无关 API

- `apps/tsh-desktop/src/app/main/websiteWindow/websiteWindowNavigationOps.ts`
  - `requestWebsiteGuestLoad(...)` 支持可选 `extraHeaders`
  - 对 `GET /project/:projectId` 命中的 `desiredUrl`，调用 credential helper 构造 `extraHeaders`
  - 最终调用 `contents.loadURL(desiredUrl, { extraHeaders })`

- `apps/tsh-desktop/src/app/main/websiteWindow/WebsiteGuestManager.ts`
  - 在 `activate/navigate/registerGuest` 触发打开页面前，确保能为 runtime 解析 room id
  - 将构造 navigation header 所需依赖传给 `loadWebsiteWindowRuntimeDesiredUrl(...)`

- `apps/tsh-desktop/src/app/main/websiteWindow/resolveWebsiteGuestManager.ts`
  - 支持把 navigation header injection 所需依赖传入 `WebsiteGuestManager`

- `apps/tsh-desktop/src/app/main/ipc/registerWebsiteWindowIpcHandlers.ts`
  - 接收 `desktopShellService`
  - 接收 `resolveRoomIdForWebContentsId`
  - 传给 `resolveWebsiteGuestManager(...)`

- `apps/tsh-desktop/src/app/main/ipc/registerIpcHandlers.ts`
  - 把 `desktopShellService` 和 `deps.resolveRoomIdForWebContentsId` 传给 `registerWebsiteWindowIpcHandlers(...)`
  - 不要只传给 website bridge handler

## vibe-design 侧方案

vibe-design server 读取：

```ts
const MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER = 'x-tutti-agent-credential';
```

读取边界：

1. SSR `GET /project/:projectId`：只从 request header `X-Tutti-Agent-Credential` 读取
2. hydrate 后 `POST /api/runs`：只从 request body `managedAgentInvocationCredential` 读取
3. hydrate 后其它 API：如果需要 credential，由 vibe-design 自己定义显式协议，不依赖 TSH 自动注入

### SSR agent availability

`GET /project/:projectId` 现在会在 SSR 阶段调用 agent availability detection。

需要把 request header 中的 credential 传给：

```ts
localAgentRuntime.detect(context)
```

推荐构造 env-based detect context：

```ts
function createManagedAgentDetectContext(credential: string | null): DetectContext | undefined {
  if (!credential) return undefined;
  return {
    env: {
      ...process.env,
      [MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV]: credential,
    },
  };
}
```

注意：只有 cwd 是 `/workspace` 或 `/workspace/*` 时，才使用：

```ts
managedAgentInvocation: { credential, cwd }
```

否则使用 env 方式，因为 `agent-acp-kit` 会拒绝非 `/workspace` 下的 managed invocation cwd。

### Model catalog

`GET /api/agents/models` 也会服务端调用 `agentModelRuntime.detect()`。

如果 model catalog 只在 SSR 初始化链路里需要 managed credential，可以复用首屏 SSR request header。

如果 hydrate 后还要重新请求 `/api/agents/models` 并希望带 managed credential，不要依赖 TSH request interception。应由 vibe-design 前端调用 JSB 拿 credential，再用 vibe-design 自己定义的请求方式携带 credential，例如：

- 对现有 GET 请求设置 `X-Tutti-Agent-Credential`
- 或将需要 credential 的 model detect 改成 POST body

这件事由 vibe-design 自己维护，因为只有 vibe-design 知道哪些 API 需要 managed credential。

### Run creation

`POST /api/runs` 创建 run 时：

- body 中有 `managedAgentInvocationCredential` 时用 body
- body 没有时不由 TSH 自动补 header；前端需要在创建 run 前通过 JSB 显式拿 credential
- 写入 transient run meta
- 启动 agent 后清空
- 不进入 status/SSE/日志/持久化数据

### vibe-design 需要改的文件

- `server/src/server.ts`
  - 在 `GET /project/:projectId` 读取 `X-Tutti-Agent-Credential`
  - `GET /project/:projectId` 传给 availability detect
  - `GET /api/agents/models` 只接受 vibe-design 前端显式携带的 `X-Tutti-Agent-Credential`
  - `POST /api/runs` 从 body 的 `managedAgentInvocationCredential` 写入 transient run meta
  - 不为后续 API 实现 TSH header fallback

- `server/src/agent-availability.ts`
  - `DetectAgentAvailability` 支持可选 `DetectContext`
  - `detectLocalAgentAvailability(context?)`
  - 调用 `localAgentRuntime.detect(context)`

- `server/src/agent-model-catalog.ts`
  - `DetectAgentModelCatalog` 支持可选 `DetectContext`
  - `detectLocalAgentModelCatalog(context?)`
  - 调用 `agentModelRuntime.detect(context)`

- `server/src/local-claude-provider.ts`
  - 当前自定义 Claude provider 的 `detect()` 没吃 context
  - 需要支持 `context.env` / `context.cwd`
  - 与 package 内 Codex provider 的 detect 行为保持一致

- `server/src/main.test.ts`
  - 增加 SSR header credential 测试
  - 增加 model catalog header credential 测试
  - 增加 `/api/runs` body credential 和不泄漏测试

- `server/src/agent-launcher.test.ts`
  - 保持已有 credential 透传与清空测试

## 不允许泄漏 credential 的位置

credential 不能出现在：

- SSR HTML
- `window.__VIBE_DESIGN_INITIAL__`
- response header
- `/api/agents/models` JSON
- `/api/runs/:id` status response
- SSE event
- logs
- diagnostics
- renderer events
- project files
- conversation files
- run persisted logs
- localStorage/sessionStorage/IndexedDB
- React state

## JSB 的定位

JSB 不是 SSR 主路径。

`window.tutti.agent.getManagedAgentInvocationCredential()` 只能用于 hydrate 后的浏览器环境，因此它不是 SSR 主路径。

它是 hydrate 后 API 的主路径：

- `POST /api/runs` 创建 run 前，前端调用 JSB，把 credential 放进 body 的 `managedAgentInvocationCredential`
- 如果 hydrate 后的 model catalog 也需要 managed detect，前端调用 JSB 后显式带给对应 API
- 只在调用前临时读取，不写入 React state、localStorage、sessionStorage 或持久化数据

但 JSB 不能解决：

- SSR `GET /project/:projectId` agent availability detection
- hydrate 之前由 server 自发执行的 model detection

更准确地说：JSB 只能发生在页面已经打开、前端已经 hydrate 之后。首屏 SSR 的 `GET /project/:projectId` 必须在打开页面的 navigation request 上带 header。

## 验证方案

### TSH 侧

验证打开页面时 `X-Tutti-Agent-Credential` 只会注入到：

- `GET /project/:projectId`

验证不会注入到：

- 静态资源
- `/api/runs/:id/events`
- 第三方请求
- 无关 API
- 没有 room 绑定的请求
- telemetry

运行：

```bash
pnpm --dir apps/tsh-desktop exec vitest run src/app/main/websiteWindow/managedAgentInvocationCredentialHeader.spec.ts src/app/main/websiteWindow/websiteWindowNavigationOps.spec.ts
pnpm --dir apps/tsh-desktop check
```

### vibe-design 侧

验证：

- SSR route 能收到 header 并传给 detect context
- SSR HTML 不包含 credential
- `window.__VIBE_DESIGN_INITIAL__` 不包含 credential
- hydrate 后需要 credential 的 API 由前端通过 JSB 显式携带
- `/api/agents/models` 如果支持 credential，能收到前端显式携带的 credential 并传给 detect context
- model catalog JSON 不包含 credential
- `/api/runs` body 能写入 transient run meta
- status/SSE/starter request 不包含 credential

运行：

```bash
pnpm --filter @vibe-design/server test src/main.test.ts src/agent-launcher.test.ts
pnpm --filter @vibe-design/server type-check
```

## 最终链路

```text
TSH Website WebView 打开项目页
  -> WebsiteGuestManager.activate/navigate/registerGuest
  -> loadWebsiteWindowRuntimeDesiredUrl(...)
  -> 校验 host / scheme / path
  -> 解析 Website runtime / room
  -> desktopShellService.getManagedAgentInvocationCredential(roomId)
  -> contents.loadURL(desiredUrl, { extraHeaders: "X-Tutti-Agent-Credential: ..." })
  -> vibe-design GET /project/:projectId SSR 读取 header
  -> 转成 agent-acp-kit detect context/env
  -> agent-acp-kit detect
  -> credential 不返回给浏览器可见数据
```
