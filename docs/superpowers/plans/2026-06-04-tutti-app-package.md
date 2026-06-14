# Vibe Design Tutti App Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vibe-design` produce a Tutti-standard app package named `vibe-design`.

**Architecture:** Keep runtime ownership in `server/`, package metadata at repo root, and packaging orchestration in `scripts/package-tutti-app.mjs`. The package remains a pnpm workspace snapshot with prebuilt web assets and installed dependencies so `bootstrap.sh` can start without runtime installation.

**Tech Stack:** Node.js, pnpm, Express, React SSR, Vitest, Node test runner.

---

### Task 1: Server Runtime Contract

**Files:**
- Modify: `server/src/main.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/main.test.ts`

- [ ] Add tests proving `/healthz` returns 2xx and Tutti env selects host, port, and data dir.
- [ ] Run `pnpm --filter @vibe-design/server test` and verify the new tests fail before implementation.
- [ ] Implement `resolveRuntimeConfig()` in `server/src/main.ts`, wire `createServer({ runtimeDir })`, and add `/healthz` in `server/src/server.ts`.
- [ ] Re-run `pnpm --filter @vibe-design/server test` and verify it passes.

### Task 2: App Package Metadata

**Files:**
- Create: `tutti.app.json`
- Create: `bootstrap.sh`
- Create: `AGENTS.tutti-app.md`

- [ ] Add a manifest with app id `vibe-design`, runtime kind `node`, bootstrap `bootstrap.sh`, and healthcheck `/healthz`.
- [ ] Add `bootstrap.sh` that validates Tutti env vars, creates runtime directories, and executes `pnpm --filter @vibe-design/server start`.
- [ ] Add package guidance for future edits.
- [ ] Mark `bootstrap.sh` executable.

### Task 3: Production Package Pipeline

**Files:**
- Create: `scripts/package-tutti-app.mjs`
- Create: `scripts/package-tutti-app.test.mjs`
- Modify: `package.json`

- [ ] Add tests for manifest validation, package file selection, and missing asset detection.
- [ ] Run `node --test scripts/package-tutti-app.test.mjs` and verify failure.
- [ ] Implement packaging helpers and CLI.
- [ ] Add `package:tutti-app` and `test:package` scripts.
- [ ] Re-run package tests and root package script.

### Task 4: End-to-End Validation

**Files:**
- Existing touched files only.

- [ ] Run `pnpm --filter @vibe-design/server test`.
- [ ] Run `pnpm --filter @vibe-design/server type-check`.
- [ ] Run `pnpm --filter @vibe-design/web type-check`.
- [ ] Run `pnpm test:package`.
- [ ] Run `pnpm package:tutti-app`.
- [ ] Inspect `dist/tutti-app/vibe-design` for the Tutti package root files.
