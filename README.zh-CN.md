# Vibe Design

<p align="right">
  <a href="./README.md"><kbd>English</kbd></a>
  <a href="./README.zh-CN.md"><kbd>中文</kbd></a>
</p>

![Vibe Design dashboard](docs/screenshots/vibe-design-dashboard.png)

Vibe Design 是一个运行在 Tutti workspace 里的 AI 设计原型工作台。它把自然语言生成、设计系统约束、项目文件预览、画布批注和本地 Agent 执行串在一起，让产品、设计和工程协作可以围绕同一个可运行原型持续迭代。

## 产品定位

Vibe Design 面向需要快速探索界面方向、检查生成结果并持续精修的团队。用户可以从一句需求开始创建项目，选择合适的设计系统，查看生成文件，在画布中定位具体问题，再把视觉反馈交给本地 Codex 或 Claude Code 继续处理。

核心目标不是做一个一次性生成页面的 demo，而是提供一个可持续工作的设计空间：项目、会话、文件、批注和上下文都会被保留下来，方便团队多轮调整。

## 核心功能

### 项目创建与设计系统选择

首页提供项目创建、最近项目检索和官方设计系统选择。设计系统会在生成前成为上下文的一部分，用来约束颜色、字体、间距、组件风格和产品语气。

### AI 会话式生成

项目编辑器左侧是会话工作区。用户可以选择本地 Agent、切换模型提供方、引用项目文件或附加视觉评论，让生成和修改过程保留完整上下文。

### 画布预览与文件工作区

生成的 HTML、资源和项目文件会进入右侧画布工作区。文件以标签页形式打开，支持预览、评论和标注模式；HTML 原型会直接在画布中渲染，方便检查真实布局。

![Vibe Design project editor](docs/screenshots/vibe-design-project-editor.png)

### 视觉批注闭环

用户可以在预览中针对具体位置添加评论，并把截图附件一起发送给 Agent。这样设计反馈不会散落在纯文本聊天里，而是绑定到具体文件和画布位置。

### 本地 Agent 运行时

服务端会检测本地 Codex 和 Claude Code 的安装、认证和可用状态，并在 UI 中展示问题。可用的 Agent 会通过本地 runtime 启动，适合在用户自己的开发环境里处理项目文件。

### Agent 友好的 CLI

打包后的应用会注册 `tutti vibe-design` 只读命令。其他 Agent 可以通过 CLI 查看项目、会话、消息、文件、文件内容和预览评论，而不需要依赖内部 Web UI 路由。

## 典型工作流

1. 在首页输入项目名称和需求描述。
2. 选择一个官方设计系统作为生成约束。
3. 进入项目编辑器，使用 Codex 或 Claude Code 生成原型文件。
4. 在画布中打开 HTML 预览，检查视觉层级、布局和内容。
5. 对具体区域添加批注或截图反馈。
6. 把反馈发送回 Agent，继续修改并保留会话历史。

## 适用场景

- 快速探索 SaaS、运营后台、内容工具、移动应用等界面方向。
- 把设计系统约束带入 AI 生成流程，减少无风格约束的随机输出。
- 在生成原型上直接做视觉审查和批注。
- 让 Agent 根据具体文件、截图和评论继续修改项目。
- 为其他 Agent 提供可读的项目上下文和文件资源。

## 项目结构

```text
vibe-design/
|-- server/          # Express 服务、本地 Agent 运行时、持久化、API 和 CLI 路由
|-- web/             # React 应用、画布工作区、聊天 UI、服务和 SSR 渲染器
|-- skills/          # 内置 Vibe Design skills
|-- design-systems/  # 内置设计系统定义
|-- docs/            # 规格文档、实施计划和截图
|-- scripts/         # 打包和辅助脚本
`-- COMMANDS.md      # 公开 Tutti CLI 命令参考
```

`server` 通过 workspace 依赖 `@vibe-design/web` 使用前端渲染包。

## 本地开发

依赖要求：

- 与仓库 Node 24 构建目标兼容的 Node.js。
- pnpm 10.x。
- 已安装并完成认证的 Codex 或 Claude Code，用于真实本地 Agent 运行。

安装依赖：

```bash
pnpm install
```

启动开发服务：

```bash
make dev
```

默认地址：

```text
http://127.0.0.1:3000/
```

指定端口：

```bash
make dev PORT=3100
```

## 运行时配置

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `TUTTI_APP_HOST` 或 `HOST` | HTTP 绑定主机 | `127.0.0.1` |
| `TUTTI_APP_PORT` 或 `PORT` | HTTP 绑定端口 | `3000` |
| `TUTTI_APP_DATA_DIR` | 持久化项目、会话、skill 和设计系统数据 | 当前工作目录下的 `.vibe` |
| `VIBE_USER_SKILLS_DIR` | 用户导入的 skill 根目录 | `$TUTTI_APP_DATA_DIR/skills` |
| `VIBE_BUILTIN_SKILLS_DIR` | 内置 skill 根目录 | `skills/` |
| `VIBE_USER_DESIGN_SYSTEMS_DIR` | 用户可编辑的设计系统根目录 | `$TUTTI_APP_DATA_DIR/design-systems` |
| `VIBE_BUILTIN_DESIGN_SYSTEMS_DIR` | 内置设计系统根目录 | `design-systems/` |

## 常用命令

```bash
pnpm build:web          # 构建 Web 客户端和 CSS
pnpm build:server       # 打包服务端入口
pnpm start              # 构建 Web 产物后启动服务
pnpm test               # 运行全部 workspace 测试
pnpm type-check         # 运行 server 和 web 的 TypeScript 检查
pnpm test:package       # 测试 Tutti 应用包构建器
pnpm package:tutti-app # 构建可分发的 Tutti 应用包
```

包级命令：

```bash
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/server type-check
```

## Tutti CLI

Vibe Design 在 `vibe-design` scope 下注册只读 CLI。完整说明见 `COMMANDS.md`。

```bash
tutti --json vibe-design projects
tutti --json vibe-design conversations --project-id <id>
tutti --json vibe-design conversation-messages --project-id <id> --conversation-id <id>
tutti --json vibe-design files --project-id <id>
tutti --json vibe-design file-get --project-id <id> --name hero.html
tutti --json vibe-design comments --project-id <id> --conversation-id <id>
```

## 打包

构建 Tutti 应用包：

```bash
pnpm package:tutti-app
```

打包结果会写入 `dist/tutti-app/vibe-design`，并校验运行时入口、manifest、server bundle、SQLite WASM、前端产物、内置 skills 和 design systems。

发布前建议运行：

```bash
pnpm test
pnpm type-check
pnpm test:package
```

## 许可证

Vibe Design 使用 [Apache License 2.0](./LICENSE) 开源。
