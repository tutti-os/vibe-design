# Managed Agent 路径硬编码治理规划

## 结论

应用内不应该理解或拼接 `/workspace`。

vibe-design 应用侧只需要一个外部传入的物理数据根目录：

```ts
const baseDir = env.TUTTI_APP_DATA_DIR?.trim() || join(process.cwd(), '.vibe');
```

所有应用目录都从 `baseDir` 派生：

```ts
const projectsDir = join(baseDir, 'projects');
const runsDir = join(baseDir, 'runs');
const agentRunsDir = join(baseDir, '.vibe-agent-runs');
const agentRunDir = join(agentRunsDir, `${agentId}-${runId}`);
```

managed invocation 需要的 logical cwd 由 helper 根据外部路径上下文映射得到。业务代码只创建和传递 physical cwd，不直接写 `/workspace`。

## 当前落地状态

- `server.ts` 统一从 `runtimeDir` 派生 `projectsDir`、`runsLogDir`、`agentRunsDir`。
- `startAgentRun()` 通过 `paths.appDataDir` / `paths.agentRunsDir` 消费路径，不再自己读取 app data env。
- managed run cwd 创建在 `<baseDir>/.vibe-agent-runs/<agent-run>`，不再尝试 mkdir `/workspace/...`。
- SSR / API detect context 使用 `runtimeDir` 作为 physical cwd，再交给 helper 映射 logical cwd。
- `managed-agent-invocation.ts` 已移除旧 Nextop 路径变量 fallback，仅保留 Tutti contract。
- unmappable cwd 会回退到 env credential 传递，已有单测覆盖。

## 为什么本地版以前不需要这些配置

本地版原来的路径模型很简单：

```ts
runtimeDir = TUTTI_APP_DATA_DIR ?? process.cwd()/.vibe
projectsDir = runtimeDir/projects
cwd = projectsDir/projectId
agent.run({ cwd })
```

没有 managed credential 时：

- 不需要 managed invocation。
- 不需要 scratch run dir。
- 不需要 `/workspace` logical cwd。
- cwd 就是项目目录。

因此本地版不需要 `appId`，也不需要注入一堆路径。新增复杂度只来自 TSH managed invocation 的通信验证和 logical cwd 约束。

## PR #35 硬编码清单

基于 [vibe-design PR #35](https://github.com/tutti-os/vibe-design/pull/35/changes) 当前 diff，需要处理以下硬编码。

### 1. `agent-launcher.ts` 直接拼 `/workspace`

当前位置：

```ts
const MANAGED_AGENT_RUNS_DIR = '/workspace/.vibe-agent-runs';
```

问题：

- 应用业务层直接理解了 TSH/agent-acp-kit 的 logical workspace。
- `createAgentRunDirectory()` 会尝试 mkdir `/workspace/.vibe-agent-runs/...`。
- 这会把平台协议路径变成应用自己的运行目录策略。

目标：

```ts
const agentRunDir = join(baseDir, '.vibe-agent-runs', `${agentId}-${runId}`);
await mkdir(agentRunDir, { recursive: true });
```

然后：

```ts
const managedAgentInvocation = createManagedAgentInvocation(
  credential,
  agentRunDir,
  { TUTTI_APP_DATA_DIR: baseDir },
);
```

`createManagedAgentInvocation()` 或 agent-acp-kit helper 决定这个 physical cwd 能否映射成 managed logical cwd。

### 2. `agent-launcher.ts` 再次读取 app data env

当前位置：

```ts
appDataDir: resolveAppDataDir()
```

以及：

```ts
function resolveAppDataDir(env = process.env) {
  return env.TUTTI_APP_DATA_DIR?.trim() || env.NEXTOP_APP_DATA_DIR?.trim();
}
```

问题：

- `createServer()` 已经根据 env 算出了 `runtimeDir`。
- `startAgentRun()` 再读一次 env，可能让测试、本地、云端的目录来源不一致。
- `NEXTOP_APP_DATA_DIR` 不属于当前 Tutti app package contract，不应该继续作为默认路径来源。

目标：

- `createServer()` 统一计算 `baseDir`。
- `paths` 里传入 `baseDir` 或已派生好的 `agentRunsDir`。
- `startAgentRun()` 不直接读取 `process.env`。
- 移除 `NEXTOP_APP_DATA_DIR` fallback，只保留 `TUTTI_APP_DATA_DIR` 和本地 `.vibe` fallback。

### 3. `server.ts` detect context 硬编码 `/workspace`

当前位置：

```ts
managedAgentInvocation: createManagedAgentInvocation(credential, '/workspace')
```

问题：

- agent availability detect 路径也由应用写死 logical cwd。
- 如果应用不应该理解 `/workspace`，这里也需要改。

目标：

```ts
managedAgentInvocation: createManagedAgentInvocation(
  credential,
  baseDir,
  { TUTTI_APP_DATA_DIR: baseDir },
)
```

或者让 agent-acp-kit 提供：

```ts
createManagedAgentDetectContext({ credential, cwd: detectCwd })
```

### 4. `managed-agent-invocation.ts` 内部维护 `/workspace` 和 NEXTOP 兼容名

当前位置：

```ts
const MANAGED_WORKSPACE_ALIAS = '/workspace';
```

判断：

- 这类常量可以暂时留在 helper 内部，因为它属于 managed invocation 协议映射。
- 但它不应该扩散到 `agent-launcher.ts`、`server.ts` 等业务流程。
- 当前 helper 还读取旧 Nextop workspace-root fallback、`NEXTOP_APP_DATA_DIR`、`NEXTOP_WORKSPACE_ID`。这些不属于当前 Tutti app package contract，应该作为遗留兼容清理掉，或下沉到 agent-acp-kit 的平台兼容层。

目标：

- 短期：只允许 `managed-agent-invocation.ts` 这一层理解 `/workspace`。
- 短期：移除应用仓库内的旧 Nextop 路径 fallback，统一使用 `TUTTI_*`。
- 中期：把 `resolveManagedAgentInvocationCwd()` 上移到 `@tutti-os/agent-acp-kit` 或 Tutti app SDK。
- 长期：应用只传 physical cwd，helper 返回合法 managed logical cwd。

### 5. Web 侧硬编码 credential header

当前位置：

```ts
const MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER =
  'X-TSH-Managed-Agent-Credential';
```

问题：

- header 名是 TSH/agent-acp-kit contract，不应该散在 React 组件里。
- server 侧已经通过 agent-acp-kit 读取同一个 header。

目标：

- 优先从 `@tutti-os/agent-acp-kit` 导入 `MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER`。
- 如果 web 不想依赖 agent-acp-kit，则在 workspace 内建共享常量，让 web/server 共用。

### 6. Provider home 目录直接读 env

当前位置：

- `server/src/agent-launcher.ts` 的 `resolveVibeCodexHome()`
- `server/src/local-claude-provider.ts`

问题：

- Codex home、Claude home 也是 app-local 数据目录。
- 不应该每个 provider 各自读 `TUTTI_APP_DATA_DIR`。

目标：

```ts
const codexHome = join(baseDir, 'codex-home');
const claudeHome = join(baseDir, 'claude-home');
```

通过 runtime paths 或 provider env builder 注入。

本次优先处理 Codex run env：`CODEX_HOME` 从 `paths.appDataDir` 派生，不再让 `startAgentRun()` 重新读取 `TUTTI_APP_DATA_DIR`。Claude provider 仍保留已有 `VIBE_CLAUDE_HOME` 显式覆盖和 `TUTTI_APP_DATA_DIR/claude-home` fallback，后续可以在 provider 注册层补 `claudeHome` 选项后再完全收敛。

### 7. 测试固化了 `/workspace` 实现细节

当前位置：

```ts
/workspace/.vibe-agent-runs/...
/workspace/projects/project-1/assets/Hero.tsx
```

问题：

- 测试把当前实现细节固化成行为 contract。
- 下一步改成 physical `baseDir` + helper 映射时，这些测试会误报。

目标：

测试应该断言：

- 应用创建的是 `<baseDir>/.vibe-agent-runs/...`。
- `createManagedAgentInvocation()` 收到 physical cwd。
- helper 输出的 cwd 满足 agent-acp-kit managed invocation 约束。
- `agent-launcher.test.ts` 不直接期待 `/workspace/.vibe-agent-runs/...`。

## 需要区分的 `/workspace` alias

下面这些 `/workspace` 不属于 managed run cwd，而是 agent 文件输出兼容协议：

```ts
if (trimmedPath === '/workspace') return cwd;
if (trimmedPath.startsWith('/workspace/')) ...
```

以及 system prompt 中：

```txt
Do NOT use subdirectories, `/workspace`, absolute paths, or `..`
```

判断：

- 这部分可以暂时保留，因为它是在处理 agent 输出路径 alias。
- 但建议改名成显式协议常量，例如 `AGENT_WORKSPACE_ALIAS = '/workspace'`。
- 不要和 managed logical cwd 混用同一个概念。

## 推荐改造步骤

### Step 1：统一 baseDir

在 server runtime config 中统一得到：

```ts
baseDir = TUTTI_APP_DATA_DIR || process.cwd()/.vibe
```

然后派生：

```ts
projectsDir = join(baseDir, 'projects')
runsDir = join(baseDir, 'runs')
agentRunsDir = join(baseDir, '.vibe-agent-runs')
codexHome = join(baseDir, 'codex-home')
claudeHome = join(baseDir, 'claude-home')
```

`startAgentRun()`、provider env builder、detect context 都只消费这些 paths，不再读 env。

### Step 2：run directory 只创建 physical path

把 `createAgentRunDirectory()` 改成：

```ts
createAgentRunDirectory({
  agentId,
  runId,
  managed,
  projectWorkspaceDir,
  agentRunsDir,
})
```

行为：

- 非 managed：返回 `projectWorkspaceDir`。
- managed：返回 `join(agentRunsDir, safe(agentId-runId))`。
- 不在这个函数里拼 `/workspace`。

### Step 3：managed invocation helper 判断是否可用

`startAgentRun()` 拿到 physical cwd 后：

```ts
const managedAgentInvocation = credential
  ? createManagedAgentInvocation(credential, cwd, managedPathContext)
  : undefined;
```

helper 负责：

- 判断 physical cwd 是否在可映射的 baseDir/workspaceRoot 下。
- 返回合法 managed logical cwd。
- 不能映射时返回 `undefined` 或让调用方走 env credential fallback。

### Step 4：替换 detect context

把：

```ts
createManagedAgentInvocation(credential, '/workspace')
```

改成：

```ts
createManagedAgentInvocation(
  credential,
  baseDir,
  { TUTTI_APP_DATA_DIR: baseDir },
)
```

### Step 5：收敛 header constant

把 web 侧 header 字符串改成共享常量：

```ts
MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER
```

来源优先级：

1. `@tutti-os/agent-acp-kit`
2. workspace shared constant

### Step 6：重写相关测试

需要调整的测试重点：

- managed run directory 测试：断言 physical cwd 在 `<baseDir>/.vibe-agent-runs/...`。
- managed invocation 测试：单独测 helper 映射结果。
- prompt path 测试：不要直接断言 `/workspace/projects/...`，而是断言不指向 scratch dir，且路径来自 project workspace mapping。
- detect context 测试：不再传 `'/workspace'`。

## 兼容性

### 本地版

没有 managed credential 时：

- cwd 仍是 `projectsDir/projectId`。
- 不创建 `.vibe-agent-runs`。
- 不启用 managed invocation。
- 行为与原本本地版一致。

### 云端 / TSH

有 managed credential 时：

- 应用创建 physical run dir：`<baseDir>/.vibe-agent-runs/<run>`。
- helper 映射成 managed logical cwd。
- credential 通过 managed invocation 或 env fallback 传递。

### 安全边界

- `baseDir` 只能来自 server 启动配置或受信 env。
- request body 和前端不能覆盖 `baseDir`、logical workspace root、credential env 名。
- 应用业务代码不直接拼 `/workspace`。

## 最终目标

vibe-design 的业务代码只应该表达：

```ts
agentRunDir = join(baseDir, '.vibe-agent-runs', runName)
createManagedAgentInvocation(credential, agentRunDir)
```

不应该表达：

```ts
agentRunDir = '/workspace/.vibe-agent-runs/...'
```

这样本地版和云端版都复用同一套 physical path 模型，TSH/agent-acp-kit 的 logical workspace 细节被限制在 helper 层。
