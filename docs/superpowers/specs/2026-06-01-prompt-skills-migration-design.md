# Track 3 Prompt & Skills 迁移 Spec

日期：2026-06-01

## 目标

参照 `vibe-design` 的实现逻辑，把迁移方案 `track-3-prompt-skills.md` 中定义的 D5 Skills 注册表与 D6 System Prompt 分层合成能力，语义化迁移到 `vibe-design/server`。

本次只迁移方案明确要求的能力范围，不把 Vibe Design daemon 的插件快照、运行调度、媒体 provider 执行、OAuth、数据库等外围系统整体搬进来。

## 已参考路径

- 迁移方案：`/Users/zhengweibin/Desktop/workspace/od-replication-plan/track-3-prompt-skills.md`
- 源 Skills 注册表：`/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/skills.ts`
- 源 frontmatter 解析：`/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/frontmatter.ts`
- 源 Prompt 合成模块：`/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/prompts/*`
- 源 Skills 路由参考：`/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/static-resource-routes.ts`
- 目标 server 现状：`/Users/zhengweibin/Desktop/workspace/vibe-design/server/src/main.ts`

## 源概念到目标概念映射

| 源模块概念 | 目标项目概念 |
| --- | --- |
| `apps/daemon/src/frontmatter.ts` | `server/src/frontmatter.ts` |
| `apps/daemon/src/skills.ts` | `server/src/skills.ts` |
| `apps/daemon/src/prompts/system.ts` | `server/src/prompts/system.ts` |
| `apps/daemon/src/prompts/official-system.ts` | `server/src/prompts/official-system.ts` |
| `apps/daemon/src/prompts/discovery.ts` | `server/src/prompts/discovery.ts` |
| `apps/daemon/src/prompts/deck-framework.ts` | `server/src/prompts/deck-framework.ts` |
| `apps/daemon/src/prompts/media-contract.ts` | `server/src/prompts/media-contract.ts` |
| `apps/daemon/src/prompts/panel.ts` | `server/src/prompts/panel.ts` |
| `vibe-design/skills` | `vibe-design/skills` |
| `vibe-design/craft` | `vibe-design/craft` |
| `USER_SKILLS_DIR` | `VIBE_USER_SKILLS_DIR` 或默认 `.vibe/skills` |
| Vibe Design 身份 prompt | Vibe Design 身份 prompt |

## 必须保持不变的协议

- `parseFrontmatter(raw)`：输入 `SKILL.md` 原文，输出 frontmatter 数据和正文。
- `listSkills(skillsRoots)`：支持单根或多根扫描；根目录优先级从前到后；第一个根目录视为 `user`，后续根目录视为 `built-in`。
- `SkillInfo`：保留迁移方案定义的字段语义，包括 `id`、`name`、`description`、`triggers`、`mode`、`surface`、`source`、`craftRequires`、`previewType`、`critiquePolicy`、`body`、`dir` 等。
- `SKILL_ID_ALIASES`、`resolveSkillId(id)`、`findSkillById(skills, id)`：所有通过 skill id 查找的路径必须走 alias 感知查找。
- 派生 example：`examples/<name>.html` 生成 `<parentId>:<childKey>`；派生条目继承父 skill 的 workflow body，但不继承 `featured`。
- `composeSystemPrompt(input)`：同步函数，不返回 Promise。
- `ComposeInput.skillBody`：调用方预先提取 skill body；composer 不做 skill 查找。
- Prompt layer 顺序：保留迁移方案 D6 的关键顺序，尤其是 locale 早期注入、Discovery 在 Identity 之前、Deck/Media 硬约束靠后覆盖。
- API：保留 `GET /api/skills`、`GET /api/skills/:id`、`POST /api/skills`、`DELETE /api/skills/:id` 的能力边界。

## 目标类型契约

`SkillInfo` 至少包含以下字段；实现时可以补充内部辅助类型，但不能弱化这些字段语义：

```ts
interface SkillInfo {
  id: string;
  name: string;
  displayName?: Record<string, string>;
  description: string;
  descriptionI18n?: Record<string, string>;
  triggers: unknown[];
  mode: 'prototype' | 'deck' | 'image' | 'video' | 'audio' | 'template' | 'design-system';
  surface: 'web' | 'image' | 'video' | 'audio';
  source: 'user' | 'built-in';
  craftRequires: string[];
  platform: 'desktop' | 'mobile' | null;
  scenario: string;
  category: string | null;
  previewType: string;
  designSystemRequired: boolean;
  defaultFor: string[];
  upstream: string | null;
  featured: number | null;
  fidelity: 'wireframe' | 'high-fidelity' | null;
  speakerNotes: boolean | null;
  animations: boolean | null;
  examplePrompt: string;
  examplePromptI18n?: Record<string, string>;
  aggregatesExamples: boolean;
  critiquePolicy: 'required' | 'opt-out' | 'opt-in' | null;
  body: string;
  dir: string;
}
```

`ComposeInput` 至少覆盖迁移方案列出的字段。第一阶段实现可以只让测试实际使用其中一部分字段，但类型边界应一次性建好，避免 Track 2 接入时再改 public shape。

```ts
interface ComposeInput {
  agentId?: string | null;
  includeCodexImagegenOverride?: boolean;
  streamFormat?: string;
  skillBody?: string;
  skillName?: string;
  skillMode?: 'prototype' | 'deck' | 'template' | 'design-system' | 'image' | 'video' | 'audio';
  skillModes?: Array<'prototype' | 'deck' | 'template' | 'design-system' | 'image' | 'video' | 'audio'>;
  craftBody?: string;
  craftSections?: string[];
  memoryBody?: string;
  userInstructions?: string;
  projectInstructions?: string;
  locale?: string;
  metadata?: ProjectMetadata;
  mediaExecution?: MediaExecutionPolicy;
  designSystemBody?: string;
  designSystemTitle?: string;
  designSystemUsageMd?: string;
  designSystemTokensCss?: string;
  designSystemComponentsManifest?: string;
  designSystemFixtureHtml?: string;
  designSystemPullIndex?: string;
  designSystemImportMode?: 'normalized' | 'hybrid' | 'verbatim';
}
```

## API 契约

| Method | Path | 行为 |
| --- | --- | --- |
| `GET` | `/api/skills` | 每次请求重新扫描 user root + built-in root，返回 `{ skills: SkillInfo[] }`。列表响应可以保留 `body`，当前目标项目规模较小，不先做 payload 裁剪。 |
| `GET` | `/api/skills/:id` | 通过 `findSkillById` 查找，支持 alias。找到返回 `SkillInfo`，找不到返回 `404`。 |
| `POST` | `/api/skills` | 请求体包含 `name`、`description?`、`body`、`triggers?`，写入 user root。成功返回新 skill 的 `{ id, slug, dir }` 或完整 `SkillInfo`，二选一需在实现前固定到测试。 |
| `DELETE` | `/api/skills/:id` | 只允许删除 `source === 'user'` 的 skill。built-in skill 返回 `403`，不存在返回 `404`。 |

默认 roots：

- user root：`process.env.VIBE_USER_SKILLS_DIR ?? <repo>/.vibe/skills`
- built-in root：`process.env.VIBE_BUILTIN_SKILLS_DIR ?? <repo>/skills`
- craft root：`process.env.VIBE_CRAFT_DIR ?? <repo>/craft`

## 可参考但需要语义化重写的内容

- 可参考：目录组织、metadata 归一化、扫描优先级、错误静默跳过策略、派生 example 数据流、prompt layer 拼接顺序、deck/media 条件覆盖思路。
- 必须重写：Vibe Design 品牌文案、daemon 专属类型、插件/运行时耦合、目标项目内部命名、测试描述和 mock 数据。
- 不迁移：Vibe Design 完整 daemon 路由体系、plugin snapshot、stage atom loader、真实媒体 provider catalog、外部 MCP token、数据库、桌面端运行时集成。

## UI System 说明

本 Track 只涉及 server 侧 registry、API 和 prompt 文本合成，不涉及渲染层 UI 迁移，因此不需要新增或改动 `@tutti-os/ui-system`。目标项目 `web` 包已安装该依赖，但本次不使用 UI 组件。

## 目标文件结构

```text
server/src/
  frontmatter.ts
  skills.ts
  prompts/
    system.ts
    official-system.ts
    discovery.ts
    deck-framework.ts
    media-contract.ts
    panel.ts

skills/
  .gitkeep

craft/
  .gitkeep
```

## 数据流

1. HTTP route 或内部调用方提供 skills roots。
2. `listSkills` 扫描根目录下一级目录。
3. 每个 `SKILL.md` 经 `parseFrontmatter` 拆成 metadata 与 body。
4. `skills.ts` 归一化 frontmatter，生成 `SkillInfo`。
5. 调用方通过 `findSkillById` 找到 skill，并把 `skill.body`、`skill.mode`、`skill.name` 传入 `composeSystemPrompt`。
6. `composeSystemPrompt` 按 D6 layer 顺序合成最终 system prompt。

## Prompt 合成验收点

`composeSystemPrompt` 的验收不依赖全文快照，而依赖关键片段顺序：

1. `streamFormat === 'plain'` 时，API mode override 位于最前。
2. `locale` prompt 在 Discovery 之前。
3. 非媒体模式包含 Discovery，媒体模式跳过 Discovery。
4. Identity charter 在 Discovery 之后。
5. memory、user instructions、project instructions 按顺序插入。
6. design system usage/body/import mode/tokens/manifest/pull index 按迁移方案顺序插入。
7. craft body 在 skill body 之前。
8. skill body 标题为 active skill，并保留传入 body 原文。
9. deck 模式且无 skill seed 时追加 deck framework。
10. image/video/audio 模式追加 media contract；非媒体模式追加轻量 media dispatch hint。
11. 最终必须包含角色边界禁止声明，并保持最后一层。

## 测试策略

- `frontmatter.test.ts`：覆盖无 frontmatter、标量、数组、嵌套对象、block string、body 提取。
- `skills.test.ts`：覆盖多根优先级、source 标记、metadata 归一化、alias 查找、派生 example、user skill 创建和删除。
- `prompts/system.test.ts`：覆盖 locale 早期注入、Discovery 在 Identity 前、skill/craft/design system 注入、deck/media 条件、最终角色边界。
- `main.test.ts`：覆盖 Skills API，同时确保原 `/` SSR 行为不回退。

## 验收标准

- `server/src` 中新增模块边界与目标文件结构一致。
- 所有新增 public 函数都有 focused tests。
- `pnpm --filter @vibe-design/server test` 通过。
- `pnpm --filter @vibe-design/server type-check` 通过。
- 原 SSR 首页 `/` 与 `/index.html` 行为不变。
- `git diff` 中没有 Vibe Design 大段代码机械复制痕迹；命名、文案和局部类型都落在 Vibe Design 语义里。

## 风险与边界

- 源 `skills.ts` 很大，目标实现应按迁移方案裁剪，避免把不需要的 daemon 能力带入。
- Prompt 文本不追求与 Vibe Design byte-for-byte 一致；目标是协议顺序和行为约束一致。
- 如果后续 Track 2 需要 `composeSystemPrompt` 的更多输入字段，应只补迁移方案已有字段，不临时扩展协议。
