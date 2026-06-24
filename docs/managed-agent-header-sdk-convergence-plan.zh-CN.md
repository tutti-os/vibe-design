# Managed Agent Header 与 agent-acp-kit 收敛规划

## 当前落地状态

已按 header-only 方案落地：

- `@tutti-os/agent-acp-kit@0.2.3-beta.2` 已发布到 npm beta tag。
- SDK 新增 `createManagedAgentDetectContextFromHeaders(headers, options?)`。
- SDK 新增 `createManagedAgentRunContextFromHeaders(headers, { providerId, runId, ...options })`。
- SDK 不再把 managed cwd 限定到 `/workspace`，只做 credential/cwd 基础合法性校验，并要求 cwd 是绝对路径。
- SDK 默认把 managed run cwd 放在 `TUTTI_APP_DATA_DIR/.agent-runs/<providerHash>-<runIdHash>`，目录名保留可读前缀并追加 hash，避免 runId 清洗碰撞。
- `vibe-design` web 侧不再调用 JSB 获取 credential，不再把 credential 写入 request body。
- `vibe-design` server 侧只从 TSH 注入的 request header 创建 detect/run context。
- `managedAgentRunContext` 只在 server request 到 agent 启动之间短暂透传，不进入 `ChatRun`、SSE、status response、SSR initial data 或日志。
- 旧的 body 字段 `managedAgentInvocationCredential` 会被忽略，并在传给 starter 前清洗掉。

## 目标

把 managed agent credential 的传递收敛到一个稳定边界：

- TSH 负责在可信 host/proxy 层给应用请求注入 credential header。
- 应用 server 只从 request headers 读取 credential；不再支持 Web JSB fallback，也不再通过 body 传 credential。
- `@tutti-os/agent-acp-kit` 负责把 header credential、cwd、env、`managedAgentInvocation` 组装成 runtime 能直接消费的上下文。
- `vibe-design` 和后续应用不再重复实现“读 header -> 拼 env -> 拼 managedAgentInvocation -> 处理 cwd”的样板逻辑。

## 当前结论

TSH `main` 已经具备对已路由的 HTTP loopback runtime preview 请求注入 managed credential header 的能力，header 名统一为：

```http
X-TSH-Managed-Agent-Credential: <credential>
```

因此，目标链路不再依赖 Web 端每次调用 JSB 后手动把 credential 塞进 body 或 header。JSB credential fallback 不再保留；如果 host 没有 header projection，managed agent 能力就应该不可用，而不是由应用 Web 端补救。

需要注意：这不是“所有请求都会被注入”。TSH 当前覆盖的是能解析到 preview route / room 的 HTTP loopback 请求；不覆盖 OPTIONS / TRACE、route miss 后 fallback 到 host loopback、非 preview 请求、WebSocket / CONNECT 等路径。

`req` 本身不是通用抽象，不同框架可能是 Express `Request`、Fetch `Request`、Hono context、Next route handler 或 Node `IncomingMessage`。SDK 公共能力应接受 `Headers`/headers-like，而不是强绑定某个 `req` 类型。

## TSH 侧现状

`tsh/tsh` 主线已有两套能力。

### Preview proxy header projection

核心文件：

- `apps/tsh-desktop/src/app/main/websiteWindow/websiteWindowRuntimePreviewProxy.ts`
- `apps/tsh-desktop/src/app/main/websiteWindow/websiteWindowManagedAgentCredentialProjection.ts`
- `apps/tsh-desktop/src/shared/contracts/managedAgent.ts`

行为：

1. Electron session 配置到 Website runtime preview proxy。
2. proxy 解析 loopback preview request 对应的 runtime route / room。
3. `WebsiteManagedAgentCredentialProjector` 根据 `roomId` 调用 `getManagedAgentInvocationCredential(roomId)`。
4. proxy 转发前先剥离页面伪造的 `X-TSH-Managed-Agent-Credential`。
5. 再由 host 可信层写入真实 `X-TSH-Managed-Agent-Credential`。
6. GET / HEAD / POST / PUT / PATCH / DELETE 都会投影；OPTIONS / TRACE 不注入。
7. credential 有 5s cache 和 1s resolve timeout；获取失败时请求继续转发，只是不带 credential。

这说明应用 API 不需要维护“哪些 URL 要注入”的白名单。只要请求是已路由的 HTTP loopback runtime preview 请求，且能解析到 room，TSH 会在 host 层投影 header。

### JSB 能力

TSH 仍保留：

```ts
window.tutti.agent.getManagedAgentInvocationCredential()
```

对应实现：

- `apps/tsh-desktop/src/app/main/websiteGuestBridge/methods/agent/getManagedAgentInvocationCredential.ts`
- `apps/tsh-desktop/src/contexts/tshDesktop/presentation/main-ipc/service.ts`

但 `vibe-design` 新方案不再使用它作为 managed agent credential 来源。原因是 SSR 发生在应用 server 进程，没有 `window`，无法调用 JSB；如果 hydrate 后再走 JSB，会形成 SSR/header 与 CSR/body 两套 credential 链路，容易出现优先级、缓存、过期和安全边界不一致。

## vibe-design 当前接入

当前 `vibe-design` 已经收敛到 header-only：

- `server/src/server.ts`
  - SSR `GET /project/:projectId` 使用 `createManagedAgentDetectContextFromHeaders(req.headers, ...)`。
  - `GET /api/agents/models` 使用 `createManagedAgentDetectContextFromHeaders(req.headers, ...)`。
  - `POST /api/runs` / `POST /api/chat` 使用 `createManagedAgentRunContextFromHeaders(req.headers, ...)` 创建 transient run context。
  - `POST /api/agents/claude/install` 使用 header 创建 detect context。
  - managed request 不复用 availability / model catalog cache，避免跨 credential/header 复用检测结果。
- `server/src/agent-launcher.ts`
  - 只消费 `managedAgentRunContext.cwd` 作为 agent process cwd。
  - prompt、文件物化、`start` event 继续使用项目 workspace 路径，不把 managed run cwd 写入 SSE、SSR initial data 或持久化 conversation。
- `web/src/ProjectEditorPage.tsx`
  - `fetchAgentModelCatalog()` 不再调用 JSB，也不再手动塞 credential。
- `web/src/services/run/internal/run-service.ts`
  - `createRun()` 不再调用 JSB，也不再通过 body 传 credential。

旧 body 字段 `managedAgentInvocationCredential` 会被忽略，并在传给 starter 前清洗掉。

## agent-acp-kit 当前能力与缺口

当前 `agent-acp-kit` 已有能力：

- 导出 `MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER`。
- 导出 `MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV`。
- 提供 `getManagedAgentInvocationCredentialFromHeaders(headers)`，可读取 `Headers`、Node headers object、iterable headers。
- runtime 层已有 `managedAgentInvocation`，并能把 credential 注入 provider env。

但仍有几个缺口：

### 1. 缺少 header 到 runtime context 的组合 helper

应用现在要自己写：

```ts
const credential = getManagedAgentInvocationCredentialFromHeaders(req.headers);
const env = {
  ...process.env,
  TUTTI_APP_DATA_DIR: appDataDir,
  TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL: credential,
};
const managedAgentInvocation = credential ? { credential, cwd } : undefined;
```

这段不应该每个 app 复制。

建议 SDK 增加两个面向业务生命周期的 helper，而不是让业务层直接拼底层 `ManagedAgentInvocation`：

```ts
createManagedAgentDetectContextFromHeaders(headers)
```

```ts
createManagedAgentRunContextFromHeaders(headers, {
  providerId,
  runId,
})
```

公共入参只接受 `headers-like`，不接受 Express `req`，这样 Next/Hono/Express/Fetch 都能复用。

`createManagedAgentDetectContextFromHeaders()` 用于 detect/model discovery。它默认从 `process.env.TUTTI_APP_DATA_DIR` 推导 detect cwd，并复用当前 `process.env`。业务层不需要再手动传：

```ts
{
  cwd: runtimeDir,
  env: {
    ...process.env,
    TUTTI_APP_DATA_DIR: runtimeDir,
  },
}
```

`createManagedAgentRunContextFromHeaders()` 用于真正发起 run。它从 `TUTTI_APP_DATA_DIR` 派生 run cwd，并返回 run 需要的 transient context。

默认得到：

```text
$TUTTI_APP_DATA_DIR/.agent-runs/<providerPrefix>-<providerHash>-<runPrefix>-<runHash>
```

`TUTTI_APP_DATA_DIR` 已经由 app runner 按 workspace/app/installation 维度隔离。应用不需要再用 `.vibe-agent-runs` 这类品牌化目录名做隔离；统一使用 SDK 默认 `.agent-runs` 更利于后续在 `vibe-design`、`ai-media-canvas` 和其他 app 之间复用。

这个写法可以落到 `vibe-design`，但 run 侧要注意当前异步边界：

- detect / model catalog / install API 仍在 HTTP handler 里，可以直接用 `req.headers` 调 SDK。
- run 启动在 `runs.start(... startRunFromRequest ...)` 之后进入 `agent-launcher.ts`，这时已经没有 `req.headers`。
- 所以 `/api/runs` / `/api/chat` handler 应在创建 run 后、调用 `runs.start()` 前创建 transient run context，再传给 `startAgentRun()`。

推荐形态：

```ts
const detectContext = createManagedAgentDetectContextFromHeaders(req.headers);

const availability = await localAgentRuntime.detect(detectContext);
```

run 侧：

```ts
const run = runs.create(createRunMeta(persistentBody));
const providerId = readString(persistentBody.agentId) ?? run.agentId;
const managedAgentRunContext = await createManagedAgentRunContextFromHeaders(req.headers, {
  providerId,
  runId: run.id,
});

runs.start(run, (startedRun) => (
  startRunFromRequest(startedRun, {
    request: persistentBody,
    managedAgentRunContext,
  })
));
```

`agent-launcher.ts` 只消费传入的 transient context：

```ts
const agentCwd = input.managedAgentRunContext?.cwd ?? projectWorkspaceDir;

await localAgentRuntime.run({
  runId: run.id,
  provider: agentId,
  cwd: agentCwd,
  prompt,
  ...(input.managedAgentRunContext?.managedAgentInvocation
    ? { managedAgentInvocation: input.managedAgentRunContext.managedAgentInvocation }
    : {}),
});
```

这个 `managedAgentRunContext` 不进入持久化 run body，也不写入 `ChatRun` 存储字段、SSE、status response 或 SSR initial data。它只在一次 HTTP request 创建 run 到 agent process 启动之间短暂存在。

### 2. 不再校验 managed cwd

当前 `agent-acp-kit` 源码里 `isManagedAgentInvocationCwd()` 仍要求：

```ts
cwd === '/workspace' || cwd.startsWith('/workspace/')
```

这类校验不应该留在 `agent-acp-kit`。应用侧的物理数据根来自：

```text
TUTTI_APP_DATA_DIR
```

`vibe-design` 当前已经按这个方向创建 app-local run 目录，但目录名仍是应用私有的旧实现：

```text
TUTTI_APP_DATA_DIR/.vibe-agent-runs/<run>
```

目标方案里不需要保留这个品牌化目录名，应迁移到 SDK 默认：

```text
TUTTI_APP_DATA_DIR/.agent-runs/<providerPrefix>-<providerHash>-<runPrefix>-<runHash>
```

SDK 不应该判断 cwd 是否属于 `/workspace`，也不应该尝试在业务层做 `/workspace` remap。新的 SDK 语义应该是：

1. `cwd` 是 host/app 决定的 provider 工作目录。
2. `agent-acp-kit` 只负责把 `cwd` 透传到 detect/run/launch plan。
3. `agent-acp-kit` 可以做基础字符串校验，例如非空、绝对路径、无 NUL，但不能绑定 `/workspace`。
4. 如果 TSH 底层需要做路径映射，应由 TSH managed shim / host adapter 自己处理，不能要求应用或通用 SDK 理解宿主内部路径。
5. 当业务层没有显式传 `cwd` 时，SDK 使用 `process.env.TUTTI_APP_DATA_DIR` 派生默认 cwd。

因此，`agent-acp-kit` 需要移除或废弃 `isManagedAgentInvocationCwd()` 的 `/workspace` 语义，并同步更新测试和 README。

### 3. run cwd 创建策略应由 SDK 统一

SDK 可以在内部提供默认 cwd builder，但 app-facing API 不需要优先暴露它：

```ts
createManagedAgentRunCwd({
  runId,
  providerId,
})
```

它默认从 `process.env.TUTTI_APP_DATA_DIR` 派生：

```text
$TUTTI_APP_DATA_DIR/.agent-runs/<providerPrefix>-<providerHash>-<runPrefix>-<runHash>
```

`TUTTI_APP_DATA_DIR` 本身就是宿主注入的应用数据根目录：

- Tutti 服务侧已按 `workspaceID + appID` 生成 app state root，再把其中的 `data` 目录传成 `TUTTI_APP_DATA_DIR`。
- TSH app-runner 侧按 `installationId` 生成 `DataPath`，并同时注入 `NEXTOP_APP_DATA_DIR` / `TUTTI_APP_DATA_DIR`。

因此，应用侧不需要再用 app 名称参与 run cwd 隔离。`vibe-design` 可以迁移到 SDK 默认 `.agent-runs`；只有确实需要兼容历史数据或诊断路径时，才考虑临时支持旧 `.vibe-agent-runs`。

SDK 可以允许高级调用显式传 `cwd`，也可以导出低层 `createManagedAgentInvocationFromHeaders(headers, { cwd })` 作为 escape hatch。但这不应出现在 Tutti app 的默认接入文档里，否则每个 app 又会重新开始理解 cwd 和 env 细节。

### 4. credential 不应通过 window 长期暴露

SDK 不需要提供 Web JSB reader，`vibe-design` 也不再使用 Web JSB reader。credential 来源只允许是 server-side header reader。

## 建议的长期链路

```text
TSH desktop/runtime preview proxy
  -> 根据 preview route 解析 roomId
  -> 获取 managed-agent invocation credential
  -> 剥离页面伪造 header
  -> 注入 X-TSH-Managed-Agent-Credential
  -> 转发到应用 server

应用 server
  -> sdk.createManagedAgentDetectContextFromHeaders(req.headers)
  -> runtime.detect(context)

应用 server
  -> sdk.createManagedAgentRunContextFromHeaders(req.headers, { providerId, runId })
  -> runtime.run({ cwd: context.cwd, managedAgentInvocation: context.managedAgentInvocation })
```

## vibe-design 后续改造建议

### 阶段 1：删除 Web JSB credential 链路

直接删除或停止使用：

- `web/src/services/managed-agent/managed-agent-credential.ts`
- `web/src/services/managed-agent/managed-agent-credential.test.ts`
- `web/src/services/managed-agent/managed-agent-constants.ts`
- `web/src/ProjectEditorPage.tsx` 中主动读取 JSB credential 并设置 header 的逻辑。
- `web/src/services/run/internal/run-service.ts` 中主动读取 JSB credential 并写入 body 的逻辑。

前端只发普通 API 请求，不再关心 credential。

### 阶段 2：server 只从 header 读取 credential

调整 server 行为：

- SSR `GET /project/:projectId` 从 header 读 credential。
- `GET /api/agents/models` 从 header 读 credential。
- `POST /api/runs` / `POST /api/chat` 从 header 读 credential。
- 删除 request body 里的 `managedAgentInvocationCredential` 字段处理。
- 删除 persistent run meta 中的 `managedAgentInvocationCredential` 暴露面，或改为 server 内部 transient 字段，来源只允许 header。

文档和测试要明确：

- credential 不写入 HTML、initial data、日志、持久化 run request、SSE/status response。
- body 传入 `managedAgentInvocationCredential` 不再生效；可选择直接忽略，或作为 bad request 拒绝。建议忽略并不持久化，避免破坏普通请求。

### 阶段 3：agent-acp-kit 补齐 helper

在 `agent-acp-kit` 增加 helper 后，替换：

- `server/src/managed-agent-invocation.ts`
- `server/src/server.ts` 内的 `createManagedAgentDetectContext()`
- `withManagedAgentInvocationCredentialFallback()` 中重复拼装 credential 的逻辑

替换后，`vibe-design` 不需要决定 managed agent run cwd，也不需要手写 env/key/header 细节。run cwd 由 SDK 根据 `TUTTI_APP_DATA_DIR`、`providerId`、`runId` 统一生成。

其中 `app data dir` 不应该由业务层每次调用 helper 时传入。它来自 app runner 注入的 `TUTTI_APP_DATA_DIR`，server 启动时可以用它初始化应用目录，但 managed agent helper 默认直接读取当前 env。

### 阶段 4：检测缓存策略

移除 Web JSB fallback 后，SSR/model detect 更依赖 header 是否稳定注入。需要避免第一次无 header 的 detect 结果污染后续请求：

- header 存在时，可以绕过长期全局缓存或使用更短 TTL。
- 如果 TSH 能提供非敏感 room/app instance identity header，可按该 identity 缓存。
- 不用 credential 本身作为缓存 key，避免 secret 泄漏到缓存/日志/诊断里。

## 对 ai-media-canvas 的启发

`ai-media-canvas` 当前更多依赖 `@tutti-os/agent-acp-kit` 做 local agent runtime、provider detection 和 run orchestration。它的方向是正确的：业务层不应 hand-roll provider 检测、ACP stream、runtime provider。

但 managed credential 这块也应遵循同一原则：

- app server 读 host 注入的 header。
- app 不理解 `/workspace`。
- app 不自己复制 env/invocation 拼装逻辑。
- `agent-acp-kit` 补齐 helper 后，AIMC 和 vibe-design 都迁移到同一套 helper。
- 不再引入 Web JSB credential fallback。

## 风险与待确认

1. `agent-acp-kit` 当前 main 仍限制 managed cwd 必须在 `/workspace` 下。新方案要求删除这个判断，否则 `TUTTI_APP_DATA_DIR` 下的 cwd 会在真实 runtime 中失败。
2. TSH preview proxy 的注入范围是“已路由 preview 请求”，不是任意外部请求。应用必须确保 SSR/API 走 preview proxy。
3. credential 有 live connection 语义，不应缓存到应用持久层，也不应写进 SSR initial state。
4. 如果 host 没有 header projection，managed agent 不可用。新方案不再由 `vibe-design` Web JSB fallback 补救。
5. `vibe-design` availability / model catalog 现在有全局检测缓存。如果第一次 detect 没有 header，或者不同 room / credential 共用同一个 app server，缓存可能掩盖后续 header-first 请求。需要定义 managed detect cache 策略，例如 header 存在时跳过长期全局缓存，或按非敏感 room/app 实例维度缓存。
6. 第三点待补充：用户上一条列了 `3.` 但还没有给具体要求。

## 推荐落地顺序

1. 在 `agent-acp-kit` 删除 managed cwd `/workspace` 判断，只保留 credential/cwd 基础合法性。
2. 在 `agent-acp-kit` 增加 header-like -> managed invocation / detect context helper。
3. 更新 `agent-acp-kit` README，把主示例改为从 request headers 读取 credential，并使用 app 自己传入的 cwd。
4. `vibe-design` 升级 SDK，server 统一调用 SDK helper。
5. `vibe-design` 删除 Web JSB credential 获取和 body credential 传递。
6. `vibe-design` 删除 `/api/runs` / `/api/chat` body credential fallback，改为只读 header。
7. `vibe-design` 定义 managed availability / model catalog cache 策略，避免首个无 header detect 结果长期污染。
8. 确认 TSH 对首屏 SSR 和 app API 都稳定注入 header。
