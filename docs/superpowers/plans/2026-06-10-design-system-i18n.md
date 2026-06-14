# Design System I18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class locale-aware design system metadata and content resolution for API responses, frontend loading, and agent prompt context.

**Architecture:** Extend the design system package manifest with locale overrides and resolve them centrally in `server/src/design-systems.ts`. API routes, project validation, preview rendering, and agent launcher continue to call the design-system service, passing locale only when the result is user-visible or prompt-visible.

**Tech Stack:** TypeScript, Express, React, Vitest, existing Vibe Design i18n runtime.

---

### Task 1: Server Locale Resolution

**Files:**
- Modify: `server/src/design-systems.ts`
- Modify: `server/src/routes/design-system-routes.ts`
- Test: `server/src/main.test.ts`

- [ ] Add `DesignSystemLocaleOverride` and `DesignSystemLocaleMap` types.
- [ ] Add `locale?: string` to list/detail/body/package asset inputs.
- [ ] Resolve `manifest.i18n[locale]` with field-level fallback to default manifest and markdown extraction.
- [ ] Resolve localized `files.design` and `usage` paths with fallback to default paths.
- [ ] Read route locale from `?locale=` first, then `Accept-Language`.
- [ ] Add tests for query locale and `Accept-Language` fallback.

### Task 2: Agent Prompt Locale Wiring

**Files:**
- Modify: `server/src/agent-launcher.ts`
- Test: `server/src/agent-launcher.test.ts`

- [ ] Pass `request.locale` into project design system resolution.
- [ ] Add a test design system with `i18n.zh-CN` metadata, `DESIGN.zh-CN.md`, and `USAGE.zh-CN.md`.
- [ ] Assert the recorded system prompt contains localized title/body/usage and omits the default English body when localized files exist.

### Task 3: Frontend Locale-Aware Fetches

**Files:**
- Modify: `web/src/DashboardPage.tsx`
- Modify: `web/src/ProjectEditorPage.tsx`
- Test: `web/src/VibeDesignApp.test.tsx`

- [ ] Use `useTranslation().locale` in design system loading code.
- [ ] Fetch `/api/design-systems?locale=${encodeURIComponent(locale)}` from dashboard and project editor.
- [ ] Add or update tests to verify `zh-CN` locale is sent.

### Task 4: Built-In Design System Data

**Files:**
- Modify: `design-systems/*/manifest.json`
- Add: selected `design-systems/*/DESIGN.zh-CN.md`
- Add: selected `design-systems/*/USAGE.zh-CN.md`

- [ ] Add `i18n.zh-CN.name/category/description` for each built-in design system.
- [ ] Add localized body and usage files for at least the default design system to prove the full package contract.
- [ ] Keep tokens and component fixtures unchanged.

### Task 5: Validation

**Files:**
- Run commands only.

- [ ] Run `pnpm --filter @vibe-design/server test`.
- [ ] Run `pnpm --filter @vibe-design/web test -- --run`.
- [ ] Run relevant type checks if available in package scripts.
