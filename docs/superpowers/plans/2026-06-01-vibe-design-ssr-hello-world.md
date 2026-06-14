# Vibe Design SSR Hello World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal Node-served React SSR page in `vibe-design` that renders `hello world` with separate `server/` and `web/` directories.

**Architecture:** Follow `tsh-web/apps/dashboard`: service interfaces define DI tokens with `createDecorator`, a launch flow creates an `InstantiationService`, and React renders inside `InstantiationContext`. `web/` owns React, DI, services, and SSR rendering; `server/` owns the HTTP listener and calls into `web/` at request time.

**Tech Stack:** TypeScript, React, React DOM server rendering, `@tutti-os/infra` DI, Node `http`, Vitest, `tsx`.

---

### Task 1: Project Skeleton And Failing SSR Test

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `web/src/render-page.test.ts`

- [ ] Add package/test/typecheck scripts and TypeScript config.
- [ ] Write a failing test that imports `renderPage()` and expects the returned HTML to contain `hello world`.
- [ ] Run `pnpm test` and confirm it fails because `renderPage` does not exist.

### Task 2: Web DI Service, Flow, And SSR Renderer

**Files:**
- Create: `web/src/services/hello/hello-service.interface.ts`
- Create: `web/src/services/hello/hello-service.ts`
- Create: `web/src/VibeDesignApp.tsx`
- Create: `web/src/launch/vibe-design-flow.tsx`
- Create: `web/src/render-page.tsx`

- [ ] Implement `IHelloService` with a `createDecorator` DI token.
- [ ] Implement `HelloService.getGreeting()` returning `hello world`.
- [ ] Implement `VibeDesignApp` using `useService(IHelloService)`.
- [ ] Implement `VibeDesignFlow` that registers `IHelloService` and renders the app in `InstantiationContext`.
- [ ] Implement `renderPage()` with `renderToString`.
- [ ] Run `pnpm test` and confirm the SSR test passes.

### Task 3: Runtime Server

**Files:**
- Create: `server/src/main.ts`
- Modify: `README.md`

- [ ] Implement a Node HTTP server using `PORT` or `3000`.
- [ ] Serve `/` as SSR HTML and return `404` for other paths.
- [ ] Document `pnpm install`, `pnpm dev`, `pnpm test`, and `pnpm type-check`.
- [ ] Run `pnpm type-check`, `pnpm test`, and a local `curl` request against the server.
