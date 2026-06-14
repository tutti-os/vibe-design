# Vibe Design SSR Hello World Design

Date: 2026-06-01

## Goal

Create the smallest runnable `vibe-design` application with a Node server that serves a React SSR page containing `hello world`, while keeping top-level `server/` and `web/` directories separate.

## Architecture

Use `tsh-web/apps/dashboard` as the reference pattern: a launch flow owns the DI container, services expose contracts through `createDecorator`, and the React app consumes service state through `useService`. The `server/` package surface owns runtime HTTP concerns, while `web/` owns React, DI, services, and SSR HTML rendering.

## Scope

- Add a local TypeScript package in `vibe-design`.
- Add one web domain service, `HelloService`, that returns the greeting.
- Add `VibeDesignFlow` under `web/` to create the DI container and render the app.
- Add a Node HTTP server under `server/` that serves the `web/` SSR HTML on `PORT` or `3000`.
- Add tests for SSR output and service-driven rendering.

## Out Of Scope

- Client hydration.
- Bundled browser assets.
- Routing beyond `/`.
- Production deployment configuration.
