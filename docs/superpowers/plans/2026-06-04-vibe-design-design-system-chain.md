# Vibe Design Design-System Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standard design-system resource chain in Vibe Design so a project can bind a design system and inject its package context into agent runs.

**Architecture:** Add a focused server-side registry for `design-systems/<id>` packages, expose read/preview APIs, validate project `designSystemId`, and hydrate `composeSystemPrompt` from the bound package at run launch. Keep UI management, import, publishing, and generated workspace flows out of this first pass.

**Tech Stack:** TypeScript, Express 5, Vitest, existing SQLite project store, existing `composeSystemPrompt` design-system fields.

---

### Task 1: Registry And API Tests

**Files:**
- Modify: `server/src/main.test.ts`
- Create: `server/src/design-systems.ts`
- Create: `server/src/routes/design-system-routes.ts`

- [ ] Add tests that create temporary design-system roots and assert `GET /api/design-systems`, `GET /api/design-systems/:id`, and `GET /api/design-systems/:id/preview`.
- [ ] Run `pnpm --filter @vibe-design/server test -- src/main.test.ts` and confirm the new tests fail because the routes do not exist.
- [ ] Implement a minimal registry that reads `DESIGN.md`, optional `USAGE.md`, `tokens.css`, `components.html`, and optional `manifest.json`.
- [ ] Implement the API routes and register them from `server/src/server.ts`.

### Task 2: Project Binding Tests

**Files:**
- Modify: `server/src/main.test.ts`
- Modify: `server/src/routes/project-routes.ts`
- Modify: `server/src/server-context.ts`

- [ ] Add tests for project creation with a valid `designSystemId`, null design system, and an unknown design system.
- [ ] Run the focused server tests and confirm the unknown-id behavior fails before implementation.
- [ ] Extend route context paths with design-system roots.
- [ ] Validate `designSystemId` during project creation and persist it through the existing `StoredProject.designSystemId` field.

### Task 3: Run Injection Tests

**Files:**
- Modify: `server/src/agent-launcher.test.ts`
- Modify: `server/src/agent-launcher.ts`

- [ ] Add a test that writes a project row with `designSystemId`, creates a matching package, starts a Codex run, and asserts the prompt contains `DESIGN.md`, `USAGE.md`, `tokens.css`, and `components.html` evidence.
- [ ] Run `pnpm --filter @vibe-design/server test -- src/agent-launcher.test.ts` and confirm the test fails before implementation.
- [ ] Add design-system roots to `StartAgentRunInput.paths`.
- [ ] Resolve the project from the store, read bound design-system assets, and pass them to `composeSystemPrompt`.

### Task 4: Bundled Default Package And Validation

**Files:**
- Create: `design-systems/default/DESIGN.md`
- Create: `design-systems/default/USAGE.md`
- Create: `design-systems/default/tokens.css`
- Create: `design-systems/default/components.html`
- Create: `design-systems/default/manifest.json`

- [ ] Add a small default package so the chain works in a fresh checkout.
- [ ] Run `pnpm --filter @vibe-design/server test`.
- [ ] Run `pnpm --filter @vibe-design/server type-check`.
- [ ] Run `pnpm type-check` if the server package checks pass.
