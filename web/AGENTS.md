# AGENTS.md

## Scope

This file applies to all code under `web/`.

`web/` owns the React UI, DI launch flow, page-level rendering, and web-facing services. Keep the `server/` runtime boundary separate: server code may call web render entrypoints, but web code should not own HTTP listeners or deployment/runtime adapters.

## UI System

Web UI must follow the design conventions from `@tutti-os/ui-system`.

Rules:

- Prefer `@tutti-os/ui-system` primitives, icons, styles, and utilities before creating local base components.
- Import only through stable public entrypoints:
  - `@tutti-os/ui-system`
  - `@tutti-os/ui-system/components`
  - `@tutti-os/ui-system/icons`
  - `@tutti-os/ui-system/metadata`
  - `@tutti-os/ui-system/styles.css`
  - `@tutti-os/ui-system/utils`
- Do not deep import from `@tutti-os/ui-system/src/*` or per-file component paths.
- Load `@tutti-os/ui-system/styles.css` once from the web shell or app entry when client/browser styling is introduced.
- Use UI-system CSS variables and token-backed utilities as the source of truth for colors, spacing, layering, and shared visual treatment.
- Do not create a second local visual system for buttons, dialogs, inputs, menus, icons, or common layout primitives.

## Component Boundaries

- Keep UI-system components presentation-focused. Pass resolved labels, props, callbacks, icons, children, and status values from the caller.
- Keep business state, data loading, persistence, routing, confirmation flows, and workflow orchestration in `web/` services or page-level code, not inside UI-system primitives.
- Follow the existing dashboard-style DI pattern: service interfaces define tokens with `createDecorator`, launch flows register implementations, and React components consume services through DI.
- UI components should render service-provided state and call service commands. Avoid embedding domain rules directly in components.

## Service Architecture

Follow the `tsh-web/apps/dashboard` service split and the `tutti/apps/desktop` renderer feature rules.

### Domain Boundaries

- Model each meaningful domain as one service boundary. A service owns the domain data, rules, commands, side effects, and state transition boundary for that domain.
- Before adding a service, check whether an existing domain service can naturally own the requirement. Extend the existing closed boundary first; add a new service only when the domain responsibility would otherwise become unclear.
- Name services by domain responsibility, not by transport or UI location. Prefer names like `workspace-filesystem`, `room-detail`, `task`, or `workspace-launcher` over generic names like `api-service`, `data-service`, `manager`, or `common-service`.
- Keep service files grouped by domain. The default shape is:

```text
web/src/
  services/
    <domain>/
      <domain>-service.interface.ts
      <domain>-service.ts
      <domain>-types.ts
      <domain>-api.ts
```

- If a domain grows feature-specific UI, use a feature-owned shape adapted from `tutti`:

```text
web/src/
  features/
    <feature>/
      services/
        <feature>-service.interface.ts
        <feature>-types.ts
        register-<feature>-services.ts
        internal/
          <feature>-service.ts
          <feature>-store.ts
          <feature>-model.ts
          adapters/
      ui/
        use-<feature>-service.ts
        <Feature>.tsx
```

- `services/internal/**` is private to the owning feature. Other features must use the public service interface, registration function, or feature `index.ts` exports.

### DI And Composition

- Use `@tutti-os/infra/di` for web service tokens and composition.
- Every injectable service interface must export a `createDecorator` token from its `.interface.ts` file.
- Register service implementations in the launch flow or a feature registration function. Do not instantiate domain services directly inside React components.
- The launch flow is the composition root. It may create the root container, register app-wide services, and render the React tree inside `InstantiationContext`.
- Feature registration functions may receive runtime capabilities or adapters and register concrete services, but should expose only the stable public service contract.
- DI is for composition and replaceable capabilities, not a global service locator for arbitrary code.

### Store And State Flow

- Services own their stores. UI must not mutate service stores directly.
- Public service interfaces should expose readonly UI-facing state, for example `readonly store` or a `useStore()`/snapshot accessor.
- Mutable stores, reducers, model helpers, and adapters should stay inside the owning service or `services/internal/**`.
- UI reads state through a small hook or service accessor, then calls service commands for writes and side effects.
- Derived render data, filtering, grouping, status labels, and projection should live in services, selectors, or pure model helpers, not in JSX.
- When state transitions become non-trivial, prefer pure reducers/model functions with focused tests over scattered imperative mutations.

### Data And Adapter Boundaries

- Service commands should hide raw transport details from UI. UI should not build API URLs, parse raw server payloads, normalize backend fields, or translate transport errors.
- Put HTTP/API clients in `<domain>-api.ts` or `internal/adapters/**`. API mapping should preserve server-owned canonical values and project them into domain types.
- Runtime-specific capabilities must enter through explicit adapters. In this repository, `server/` may call exported `web/` render entrypoints, but `web/` services should not own HTTP listeners, port selection, process supervision, or deployment adapters.
- If a service aggregates multiple lower-level services, treat it as an anti-corruption/projection layer. Keep cross-domain projection there rather than leaking one domain's raw payload into another domain or into UI.

### React Boundary

- React components are for rendering, DOM events, subscriptions, and local presentational state.
- Avoid using `useEffect` as hidden orchestration. If a flow coordinates requests, adapters, stores, retries, derived flags, or error handling, move it behind the owning service command.
- Page or route components may coordinate initial service calls and pass render-ready state to feature UI, but should not contain domain rules.
- Keep UI components close to their usage until there is stable reuse, a clear domain boundary, or file size has started to hurt readability.

### Testing Expectations

- Test service state transitions, API mapping, projection logic, reducers/model helpers, and error-state behavior at the service layer.
- Test React pages/features for consuming render-ready state and invoking service commands, not for revalidating service internals.
- Add a server integration test when `server/` depends on `web/` package exports or SSR behavior, so workspace package resolution and runtime JSX rendering stay covered.

## Validation

For changes under `web/`, run the smallest relevant checks:

```bash
pnpm type-check
pnpm test
```

If a change starts using `@tutti-os/ui-system` components directly, also verify imports use only the stable public entrypoints listed above.
