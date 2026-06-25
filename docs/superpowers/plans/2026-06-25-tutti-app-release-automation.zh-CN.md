# Tutti 应用发布自动化方案

## 背景

现在 `vibe-design`、`ai-media-canvas` 这类 Tutti workspace app 的发布链路是：

1. 应用仓库里手动构建 zip 包。
2. 打开 `admin.nextop.sh` 的应用管理页面。
3. 手动选择应用，新增版本，上传 zip。
4. 手动发布版本或设为 latest。

这条链路能保证人工确认，但每次 MR 合入后都要手动上传，成本高，也容易出现版本号、zip、Git SHA、release notes 对不上的问题。

从现有代码看，管理后台前端已经不是纯 UI 逻辑：

- `tsh-admin-web/src/services/applicationApi.ts` 已有应用、版本、发布、latest、归档 API 客户端。
- `tsh-admin-web/src/services/appArtifactUploadApi.ts` 已有 artifact upload session、zip SHA256、对象存储直传逻辑。
- `tsh-admin-web/src/types/application.ts` 已有 `artifactUrl`、`artifactSha256`、`artifactSizeBytes`、`gitSha`、`manifestDigest`、`runtimeBootstrap`、`runtimeHealthcheckPath`、`releaseNotes` 等版本字段。
- `vibe-design/scripts/package-cloud-zip.mjs` 已能从 `tutti.app.json` 读取 version，并生成 `dist/tutti-app/<appId>-<version>.zip`。

所以推荐方向不是重新设计一套发布系统，而是把现有 UI 背后的发布能力抽成可机器调用的发布入口。

## 产品策略

### Vision

让 Tutti app 的发布从“手动上传 zip”变成“可验证、可审计、可回滚的一键发布/自动发布”。

### 目标用户

1. 应用开发者  
   希望 MR 合入或打包后快速发布，不想反复进后台手动传 zip。

2. 平台维护者  
   希望所有应用发布都走统一权限、统一审计、统一 artifact 校验。

3. 管理后台运营者  
   希望能看到版本来源、构建结果、发布人、Git SHA、release notes，并能回滚 latest。

### Trade-offs

- 不建议一开始就让 GitHub merge 直接无条件发布到 production latest。
- 不建议把“上传对象存储 + 创建版本 + publish + set latest”散落在每个 app 仓库脚本里。
- 不建议只做 Codex skill。skill 可以提效，但底层必须有稳定 CLI/API，否则仍然不适合 CI 和审计。

## 可选方案

### 方案 A：发布 CLI

做一个内部 CLI，例如：

```bash
tutti-app-release publish \
  --admin-url https://admin.nextop.sh \
  --brand nextop \
  --app-id vibe-design \
  --zip dist/tutti-app/vibe-design-0.1.47.zip \
  --git-sha "$(git rev-parse HEAD)" \
  --state draft \
  --promote-latest
```

CLI 做这些事：

1. 读取 zip 内的 `tutti.app.json`，校验 `appId/version/runtime.bootstrap/runtime.healthcheckPath`。
2. 计算 zip SHA256 和 size。
3. 调用后台创建 artifact upload session。
4. 上传 zip 到对象存储。
5. 创建 app version。
6. 按参数选择只创建 draft、publish、或 publish 并设 latest。

优点：

- 最快能落地。
- 本地和 CI 都能用。
- 可以复用现有后台版本模型。
- 后续 GitHub Actions、Codex skill 都可以调用它。

缺点：

- 需要后台支持机器 token 或 scoped API token。
- 如果现有 app-center API 只对浏览器 session 友好，需要补一个服务账号认证方式。

### 方案 B：GitHub Actions 自动发布

每个应用仓库增加 workflow：

```yaml
on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: nextop-app-release
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:package
      - run: pnpm package:cloud
      - run: npx @tutti-os/app-release publish --config .tutti-release.json --promote-latest
        env:
          TUTTI_ADMIN_TOKEN: ${{ secrets.TUTTI_ADMIN_TOKEN }}
```

推荐策略：

- PR：只跑 package/test，上传 CI artifact，不发布到后台。
- main merge：创建后台 draft 或 published 版本，但不一定自动 latest。
- tag/release：发布并 promote latest。
- production latest 可使用 GitHub Environment approval 做最后确认。

优点：

- 合入后自动生成版本。
- Git SHA、workflow run、release notes 天然可追溯。
- 不需要后台主动访问 GitHub。

缺点：

- 每个 app repo 都要配 workflow 和 secrets。
- 权限分散在 GitHub repo/environment 里。

### 方案 C：后台配置 GitHub 地址并监听自动发布

在 `tsh-admin-web` 的应用管理里给每个 app 增加“发布来源”配置：

- GitHub owner/repo。
- 允许发布的 branch/tag pattern。
- 构建 workflow 名称。
- artifact 名称或 release asset pattern。
- 是否自动发布 latest。

`zk-admin-server` 或对应 app-center 后端通过 GitHub App / webhook 监听：

1. 收到 workflow_run / release 事件。
2. 校验 repo、branch、tag、commit、workflow conclusion。
3. 下载 artifact 或 release asset。
4. 校验 zip manifest。
5. 创建版本。
6. 根据策略 publish/latest。

优点：

- 发布策略集中在后台管理。
- app repo 不需要持有后台 token。
- 更适合多应用长期治理。

缺点：

- 实现重，需要 GitHub App、webhook 安全、artifact 下载、重试、幂等等能力。
- 排障成本比 CLI + Actions 高。

### 方案 D：Codex / Tutti release skill

做一个内部 skill，例如 `tutti-app-release`：

1. 检查当前 app 的 `tutti.app.json`。
2. 运行 package/test。
3. 调用发布 CLI。
4. 输出后台版本链接和 latest 状态。

优点：

- 对人最顺手，可以一句话“帮我打包并发到 nextop draft”。
- 可以把常见排障步骤固化下来。

缺点：

- 不应该作为唯一发布通道。
- skill 本质上应该封装 CLI，而不是自己实现上传协议。

## 推荐路线

### Phase 1：先做 CLI，把手动上传变成一条命令

目标：解决当前最痛的重复手动上传。

后台需要确认/补齐：

- 服务账号 token 或 scoped admin token。
- app-center API 可被非浏览器客户端调用。
- artifact upload session API 对 CLI 可用。
- 创建版本、publish、set latest、archive 有审计字段。

CLI 需要支持：

```bash
tutti-app-release validate --zip ./dist/tutti-app/vibe-design-0.1.47.zip
tutti-app-release upload --brand nextop --app-id vibe-design --zip ./dist/tutti-app/vibe-design-0.1.47.zip
tutti-app-release publish --brand nextop --app-id vibe-design --zip ./dist/tutti-app/vibe-design-0.1.47.zip --promote-latest
tutti-app-release latest --brand nextop --app-id vibe-design --version 0.1.47
tutti-app-release rollback --brand nextop --app-id vibe-design --version 0.1.46
```

成功标准：

- 不打开 `admin.nextop.sh` 也能完成新增版本。
- CLI 输出版本 ID、artifact SHA256、后台 URL。
- 重复执行同一个版本时幂等，能清晰提示“版本已存在”或允许 `--replace-draft`。

### Phase 2：给应用仓库接 GitHub Actions

目标：MR 合入后自动产物入库。

推荐默认：

- `main` 合入：自动创建 draft version。
- `release tag`：自动 publish + promote latest。
- production latest 使用 GitHub Environment approval 或后台二次确认。

每个 app repo 只保留薄配置：

```json
{
  "brand": "nextop",
  "appId": "vibe-design",
  "packageCommand": "pnpm package:cloud",
  "zipPattern": "output/vibe-design-*.zip",
  "publishOn": {
    "main": "draft",
    "tag": "latest"
  }
}
```

### Phase 3：后台支持 GitHub source 绑定

目标：让发布治理从 repo 配置迁移到后台。

后台新增字段：

- `sourceRepo`: `tutti-os/vibe-design`
- `sourceBranchPattern`: `main`
- `sourceTagPattern`: `v*`
- `workflowName`: `package-cloud-app.yml`
- `artifactPattern`: `vibe-design-*.zip`
- `autoPublishPolicy`: `draft | published | latest | manual`

后台新增能力：

- GitHub webhook 接收。
- workflow 状态校验。
- artifact 下载和验签。
- 自动创建版本。
- 发布审计事件。

### Phase 4：补 release skill

目标：让开发者日常操作更轻。

skill 只做编排，不拥有发布协议：

```text
打包 vibe-design 并发布到 nextop draft
```

skill 内部执行：

```bash
pnpm package:cloud
tutti-app-release publish --config .tutti-release.json --state draft
```

## API 建议

如果现有 app-center API 只服务 UI，可以把它稳定成下面这组机器接口：

```http
GET  /v1/admin/app-center/apps
GET  /v1/admin/app-center/apps/:appId/versions
POST /v1/admin/app-center/artifact-upload-sessions
POST /v1/admin/app-center/apps/:appId/versions
POST /v1/admin/app-center/apps/:appId/versions/:versionId/publish
POST /v1/admin/app-center/apps/:appId/versions/:versionId/set-latest
POST /v1/admin/app-center/apps/:appId/versions/:versionId/archive
```

新增 GitHub 自动导入时再加：

```http
POST /v1/admin/app-center/apps/:appId/release-sources
POST /v1/admin/app-center/github/webhooks
POST /v1/admin/app-center/apps/:appId/import-github-artifact
```

## 安全和审计

必须做：

- Token 只允许指定 brand/appId 范围。
- zip 内 `tutti.app.json.appId` 必须等于目标 appId。
- `version` 必须唯一，不能静默覆盖已发布版本。
- 记录 `gitSha`、workflow run URL、操作者、发布时间、artifact SHA256。
- latest 切换必须可回滚。
- publish/latest 需要区分权限，CI token 可以只创建 draft。

建议做：

- 对 zip 做 manifest digest。
- 对 release asset 做不可变存储。
- 后台展示“来源：manual / cli / github-actions / github-webhook”。
- 后台提供版本 diff：manifest、runtime、size、gitSha。

## 对现有应用的接入方式

`vibe-design` 和 `ai-media-canvas` 不应该各自实现上传协议，只需要：

1. 保持 `pnpm package:cloud` 能生成标准 zip。
2. 增加 `.tutti-release.json` 或 package script 指向 CLI。
3. CI 调用统一 CLI。

示例：

```json
{
  "scripts": {
    "release:tutti:draft": "pnpm package:cloud && tutti-app-release publish --config .tutti-release.json --state draft",
    "release:tutti:latest": "pnpm package:cloud && tutti-app-release publish --config .tutti-release.json --promote-latest"
  }
}
```

## 结论

推荐先做 **CLI + 现有 app-center API 复用**，这是最小改动、最快解除手动上传痛点的方案。

之后用 **GitHub Actions 调 CLI** 实现合入/打 tag 后自动发版。等多个 app 都稳定后，再做 **后台 GitHub source 绑定 + webhook 自动导入**，把发布策略集中到 admin 后台。

最终形态是：

```text
app repo merge/tag
  -> GitHub Actions build/test/package
  -> tutti-app-release CLI
  -> admin app-center artifact/version API
  -> draft/published/latest
  -> admin audit + rollback
```

