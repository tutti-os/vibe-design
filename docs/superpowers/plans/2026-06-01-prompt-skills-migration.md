# Track 3 Prompt & Skills 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 或等价流程逐项执行。当前文档只是计划，未获得用户确认前不要开始实现。

**目标：** 将迁移方案 Track 3 的 D5 Skills 注册表与 D6 System Prompt 合成能力迁移到 `vibe-design/server`。

**架构：** server 内新增三个独立边界：`frontmatter.ts` 负责解析，`skills.ts` 负责注册表和 API 数据模型，`prompts/*` 负责同步 prompt 合成。`main.ts` 只做 HTTP 路由组装，避免把业务逻辑写进入口文件。

**技术栈：** TypeScript、Node `fs/promises`、Node `http`、Vitest。

---

## 前置检查

- [ ] 确认只保留文档变更，未开始实现代码。
- [ ] 阅读 spec：`docs/superpowers/specs/2026-06-01-prompt-skills-migration-design.md`。
- [ ] 阅读迁移方案：`/Users/zhengweibin/Desktop/workspace/od-replication-plan/track-3-prompt-skills.md`。
- [ ] 对照源实现路径：
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/frontmatter.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/skills.ts`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/prompts/*`
  - `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/static-resource-routes.ts`
- [ ] 执行前确认用户明确说“开始实现”或同等意思；只说“推进方案”时只改文档。

## 交付物清单

- [ ] `server/src/frontmatter.ts`
- [ ] `server/src/frontmatter.test.ts`
- [ ] `server/src/skills.ts`
- [ ] `server/src/skills.test.ts`
- [ ] `server/src/prompts/official-system.ts`
- [ ] `server/src/prompts/discovery.ts`
- [ ] `server/src/prompts/deck-framework.ts`
- [ ] `server/src/prompts/media-contract.ts`
- [ ] `server/src/prompts/panel.ts`
- [ ] `server/src/prompts/system.ts`
- [ ] `server/src/prompts/system.test.ts`
- [ ] `server/src/main.ts`
- [ ] `server/src/main.test.ts`
- [ ] `skills/.gitkeep`
- [ ] `craft/.gitkeep`

## Task 1：Frontmatter Parser

**文件：**
- 新建：`server/src/frontmatter.ts`
- 新建测试：`server/src/frontmatter.test.ts`

**步骤：**
- [ ] 先写失败测试，覆盖无 frontmatter、标量、数组、嵌套对象、block string、body 提取。
- [ ] 运行：`pnpm --filter @vibe-design/server test -- src/frontmatter.test.ts`
- [ ] 期望：失败原因是 `./frontmatter` 模块不存在。
- [ ] 实现最小 YAML subset parser，不引入新依赖。
- [ ] 复跑同一测试，期望通过。

**验收：**
- [ ] `parseFrontmatter('# body')` 返回空 frontmatter 和原 body。
- [ ] YAML `|` block string 能保留换行。
- [ ] 嵌套 `od.craft.requires` 能解析为数组。
- [ ] parser 对 `\r\n` 和 BOM 有兼容处理。

## Task 2：Skills 注册表

**文件：**
- 新建：`server/src/skills.ts`
- 新建测试：`server/src/skills.test.ts`

**步骤：**
- [ ] 先写失败测试，覆盖多根扫描优先级、`source` 标记、metadata 归一化、alias 查找、派生 example、user skill 创建/删除。
- [ ] 运行：`pnpm --filter @vibe-design/server test -- src/skills.test.ts`
- [ ] 期望：失败原因是 `./skills` 模块不存在。
- [ ] 实现 `SkillInfo`、`SKILL_ID_ALIASES`、`resolveSkillId`、`findSkillById`。
- [ ] 实现 `listSkills`，支持静默跳过不可读目录和解析失败 skill。
- [ ] 实现派生 example：`splitDerivedSkillId`、`resolveDerivedExamplePath`。
- [ ] 实现 user skill create/delete：`importUserSkill`、`deleteUserSkill`。
- [ ] 复跑同一测试，期望通过。

**验收：**
- [ ] `listSkills([userRoot, builtInRoot])` 中 user skill 覆盖同 id built-in skill。
- [ ] `findSkillById(skills, 'editorial-collage')` 能解析到 `vibe-design-landing`。
- [ ] `examples/pricing-grid.html` 生成 `parent:pricing-grid`。
- [ ] 派生条目的 `featured` 为 `null`。
- [ ] 删除 built-in skill 被拒绝，删除不存在 skill 返回明确错误。
- [ ] 无法读取的目录或坏 `SKILL.md` 不让整个扫描失败。

## Task 3：Prompt Composer

**文件：**
- 新建：`server/src/prompts/official-system.ts`
- 新建：`server/src/prompts/discovery.ts`
- 新建：`server/src/prompts/deck-framework.ts`
- 新建：`server/src/prompts/media-contract.ts`
- 新建：`server/src/prompts/panel.ts`
- 新建：`server/src/prompts/system.ts`
- 新建测试：`server/src/prompts/system.test.ts`

**步骤：**
- [ ] 先写失败测试，覆盖 locale 早期注入、Discovery 在 Identity 前、skill body 注入、design system 注入、deck 条件、media 条件、最终角色边界。
- [ ] 运行：`pnpm --filter @vibe-design/server test -- src/prompts/system.test.ts`
- [ ] 期望：失败原因是 prompt 模块不存在。
- [ ] 实现 prompt 常量，保留迁移方案要求的行为约束，但将 Vibe Design 品牌身份改为 Vibe Design。
- [ ] 实现 `ComposeInput` 与同步 `composeSystemPrompt(input)`。
- [ ] 复跑同一测试，期望通过。

**验收：**
- [ ] `composeSystemPrompt` 类型是同步函数。
- [ ] locale block 出现在 Discovery 前。
- [ ] Discovery 出现在 Identity 前。
- [ ] 媒体模式不包含 Discovery，包含 media contract。
- [ ] deck 模式包含 deck framework。
- [ ] `skillBody` 原文被注入，且 composer 不依赖 `SkillInfo`。
- [ ] 最后一层是角色边界禁止声明。

## Task 4：Skills HTTP API

**文件：**
- 修改：`server/src/main.ts`
- 修改测试：`server/src/main.test.ts`

**步骤：**
- [ ] 先扩展失败测试，用临时 roots 覆盖：
  - `GET /api/skills`
  - `GET /api/skills/:id`
  - `POST /api/skills`
  - `DELETE /api/skills/:id`
- [ ] 运行：`pnpm --filter @vibe-design/server test -- src/main.test.ts`
- [ ] 期望：新增 API 测试失败，原 `/` SSR 测试仍应通过。
- [ ] 在 `main.ts` 中加入最小 route 分发，保留 `/` 和 `/index.html` 原行为。
- [ ] 复跑同一测试，期望通过。

**验收：**
- [ ] `GET /api/skills` 返回 JSON，至少形如 `{ "skills": [] }`。
- [ ] `GET /api/skills/:id` 必须通过 `findSkillById`，支持 alias。
- [ ] `POST /api/skills` 写入 user root，不写 built-in root。
- [ ] `DELETE /api/skills/:id` 只能删除 user source。
- [ ] 非 JSON 或非法 body 返回 `400`，不让 server crash。

## Task 5：运行时目录与验证

**文件：**
- 新建：`skills/.gitkeep`
- 新建：`craft/.gitkeep`

**步骤：**
- [ ] 创建空的 built-in roots，保证默认扫描路径稳定。
- [ ] 运行：`pnpm --filter @vibe-design/server test`
- [ ] 运行：`pnpm --filter @vibe-design/server type-check`
- [ ] 如 server 通过，再运行：`pnpm test`
- [ ] 如 server 通过，再运行：`pnpm type-check`

**验收：**
- [ ] 默认 root 不存在时 API 仍可返回空列表。
- [ ] 默认 `skills/` 和 `craft/` 目录被纳入仓库。
- [ ] 最终报告列出测试命令和结果。

## 明确不做

- [ ] 不迁移 Vibe Design daemon 的数据库、插件快照、OAuth、stage atom loader、真实媒体 provider catalog。
- [ ] 不新增 UI 页面，不触碰 `@tutti-os/ui-system`。
- [ ] 不扩展迁移方案以外的 API 字段。
- [ ] 不在未获得用户确认前开始实现。

## 执行暂停点

当前暂停在方案阶段。下一步只有在用户确认“开始实现”后，才从 Task 1 开始按 TDD 执行。
