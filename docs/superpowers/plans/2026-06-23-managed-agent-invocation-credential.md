# Managed Agent Invocation Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let vibe-design runs launched inside the TSH website WebView carry the per-room managed-agent invocation credential to `@tutti-os/agent-acp-kit`, so the agent can authenticate managed-agent command-gateway communication.

**Architecture:** Use a narrowly scoped TSH-injected navigation request header for the initial SSR project page load. TSH should attach `X-Tutti-Agent-Credential` through `contents.loadURL(desiredUrl, { extraHeaders })` only when opening the trusted `GET /project/:projectId` page. TSH should not maintain a post-hydration API whitelist with `webRequest.onBeforeSendHeaders`, because only vibe-design knows which business APIs need managed credentials. After hydration, vibe-design should call `window.tutti.agent.getManagedAgentInvocationCredential()` at the exact API call sites that need it and pass the value through its own explicit API contract, such as the existing `managedAgentInvocationCredential` body field for `POST /api/runs`.

**Tech Stack:** Electron preload bridge in `tsh/tsh`, React/TypeScript client and Express SSR/API in `vibe-design`, `@tutti-os/agent-acp-kit`.

---

## Current Findings

### TSH Side

- `apps/tsh-desktop/src/app/preload/bridges/websiteWindowBridge/entryBridge.ts` exposes the website bridge as `window.__tsh` and `window.tutti`.
- `apps/tsh-desktop/src/shared/contracts/websiteWindowBridge/methodDescriptors.ts` already registers `agent.getManagedAgentInvocationCredential`.
- `apps/tsh-desktop/src/app/main/websiteGuestBridge/methods/agent/getManagedAgentInvocationCredential.ts` calls `ctx.desktopShellService.getManagedAgentInvocationCredential(ctx.roomId)`.
- `apps/tsh-desktop/src/contexts/tshDesktop/presentation/main-ipc/service.ts` calls desktopd `GET /v1/rooms/{roomId}/managed-agent/invocation-credential`.
- `cmd/desktopd/service/runtime/managed_agent_credential.go` dials guest-agent and retrieves the credential.
- `runtimes/guest-agent/session/managed_agent_credential.go` generates a random 32-byte base64url credential.
- `runtimes/guest-agent/session/dial.go` sends that credential to command-gateway as the managed-agent connection header.
- `runtimes/command-gateway/gateway/managedagent/server.go` validates managed agent requests by looking up that credential.

### vibe-design Side

- `web/src/services/run/run-types.ts` already defines `CreateRunInput.managedAgentInvocationCredential?: string`.
- `server/src/server.ts` already copies `body.managedAgentInvocationCredential` into run metadata in `createRunMeta`.
- `server/src/server.ts` strips `managedAgentInvocationCredential` before passing the original request object to the starter.
- `server/src/main.test.ts` already verifies the credential does not leak into starter request or status response.
- `server/src/agent-launcher.ts` already clears `run.managedAgentInvocationCredential`, then passes it to `agent-acp-kit` as either `managedAgentInvocation` or `MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV`.
- Missing piece: vibe-design web never calls the TSH bridge, so `/api/runs` normally sends no credential.
- Important correction: `agent-acp-kit` supports managed credentials during detection (`runtime.detect({ managedAgentInvocation })`) and detection is called during SSR for project pages. Therefore, if SSR availability detection must reflect the managed-agent environment, JSB cannot supply the credential and TSH must expose it on the initial navigation request.

## Recommendation

Do not inject the credential as a WebView-wide request header, and do not maintain a TSH-side API route whitelist. Do inject `X-Tutti-Agent-Credential` as a tightly scoped navigation request header for the SSR project page:

- `GET /project/:projectId`: SSR project editor initial data calls `safeDetectAgentAvailability(...)`.

SSR boundary: the Express SSR renderer cannot call `window.tutti` or any JSB API because it runs in Node, not inside the Electron WebView. The earlier JSB/body approach is only valid after hydration when the browser app creates `POST /api/runs`; it cannot make SSR availability detection use managed-agent credentials.

Reasons:

- Header injection can accidentally attach the credential to static assets, telemetry calls, unrelated API calls, or third-party requests unless it is extremely tightly filtered.
- The current vibe-design server contract already has a body field and tests for keeping it out of responses.
- Server-side `agent-acp-kit` detection happens before hydration, so JSB cannot cover this path.
- A custom header is acceptable only when route, method, host, scheme, and request type are explicitly matched.

For hydrated run creation, keep the existing request-body field as the server's internal normalized representation. The client should call JSB immediately before `POST /api/runs`, place the returned value in `managedAgentInvocationCredential`, and store the value only on the transient run object server-side.

This header is not a JavaScript API. It should be attached by TSH to the outgoing HTTP request before it reaches the vibe-design server. The page should not read it, and vibe-design must not reflect it into SSR HTML, response headers, JSON payloads, or browser-visible initial state.

Do not put the credential into SSR HTML, `window.__VIBE_DESIGN_INITIAL__`, cookies, local/session storage, project files, conversation files, model catalog responses, status responses, SSE events, or persisted run logs.

## File Structure

### vibe-design

- Modify `server/src/server.ts`
  - Reads the TSH credential header on the SSR project route and passes the value into availability detection.
  - Accepts an explicit vibe-design-owned credential header on `GET /api/agents/models` when the hydrated client chooses to call JSB first.
  - Continues to accept `managedAgentInvocationCredential` in body for hydrated run creation.
- Modify `server/src/agent-availability.ts`
  - Accepts an optional detection context/env and calls `localAgentRuntime.detect(context)`.
- Modify `server/src/agent-model-catalog.ts`
  - Accepts an optional detection context/env and calls `agentModelRuntime.detect(context)`.
- Modify `server/src/local-claude-provider.ts`
  - Lets custom Claude detection respect detect `env`/`cwd`, matching the package Codex provider behavior.
- Create `web/src/services/managed-agent/managed-agent-credential.ts`
  - Calls JSB after hydration for API calls that explicitly need managed credentials.

### tsh/tsh

- Create `apps/tsh-desktop/src/app/main/websiteWindow/managedAgentInvocationCredentialHeader.ts`
  - Owns loopback host/scheme/path checks and builds `loadURL` `extraHeaders` for project page navigation.
- Create `apps/tsh-desktop/src/app/main/websiteWindow/managedAgentInvocationCredentialHeader.spec.ts`
  - Covers allowed/disallowed navigation URL matching and header redaction behavior.
- Modify `apps/tsh-desktop/src/app/main/websiteWindow/websiteWindowNavigationOps.ts`
  - Allows `requestWebsiteGuestLoad(...)` / `loadWebsiteWindowRuntimeDesiredUrl(...)` to pass navigation `extraHeaders` into `contents.loadURL(...)`.
- Modify `apps/tsh-desktop/src/app/main/websiteWindow/resolveWebsiteGuestManager.ts`
  - Accepts manager options so the cached `WebsiteGuestManager` is constructed with header injection dependencies.
- Modify `apps/tsh-desktop/src/app/main/websiteWindow/WebsiteGuestManager.ts`
  - Resolves the active runtime/room before opening the project page and passes navigation header dependencies into the load path.
- Modify `apps/tsh-desktop/src/app/main/ipc/registerWebsiteWindowIpcHandlers.ts`
  - Accepts `desktopShellService` and `resolveRoomIdForWebContentsId`, and passes them to `resolveWebsiteGuestManager(...)`.
- Modify `apps/tsh-desktop/src/app/main/ipc/registerIpcHandlers.ts`
  - Passes `desktopShellService` and `deps.resolveRoomIdForWebContentsId` into `registerWebsiteWindowIpcHandlers(...)`, not only into `registerWebsiteWindowBridgeIpcHandlers(...)`.
- Reuse existing `apps/tsh-desktop/src/contexts/tshDesktop/presentation/main-ipc/service.ts`
  - `desktopShellService.getManagedAgentInvocationCredential(roomId)` already fetches the credential from desktopd.

## Primary Task 0: Scoped Header For SSR Agent Detection

**Files:**

- Modify: `server/src/server.ts`
- Modify: `server/src/agent-availability.ts`
- Modify: `server/src/agent-model-catalog.ts`
- Modify: `server/src/local-claude-provider.ts`
- Test: `server/src/main.test.ts`
- Test: `server/src/agent-launcher.test.ts`

- [ ] **Step 1: Add server tests for SSR/header credential handling**

Add tests that issue `GET /project/:projectId` with:

```http
X-Tutti-Agent-Credential: credential-run-1
```

Expected assertions:

- `detectAgentAvailability` receives a context/env containing `TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL`.
- The rendered HTML does not contain `credential-run-1`.
- `window.__VIBE_DESIGN_INITIAL__` does not contain `credential-run-1`.

`GET /api/agents/models` uses an explicit vibe-design API contract after hydration: the client calls JSB first and sets `X-Tutti-Agent-Credential` on that request.

Expected assertions:

- model catalog detection receives the credential in detect env.
- JSON response does not contain `credential-run-1`.

Add or update `POST /api/runs` tests:

- body credential from JSB is accepted.
- starter request, run status, and SSE/status payloads never contain either credential.

- [ ] **Step 2: Keep SSR header and hydrated body credential paths separate in `server.ts`**

Add helpers near `withoutManagedAgentInvocationCredential`:

```ts
const MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER = 'x-tutti-agent-credential';

function readManagedAgentInvocationCredentialHeader(req: Request): string | null {
  return readString(req.get(MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER));
}

function readManagedAgentInvocationCredentialBody(body?: Record<string, unknown>): string | null {
  return readString(body?.managedAgentInvocationCredential);
}
```

Use the header helper only on the SSR route:

- `GET /project/:projectId`

Use the body helper for hydrated API calls such as `POST /api/runs`. Do not implement a generic header fallback for post-hydration API calls.

- [ ] **Step 3: Pass detect context into availability/model detection**

Extend `DetectAgentAvailability` and `DetectAgentModelCatalog` so they accept an optional context:

```ts
import type { DetectContext } from '@tutti-os/agent-acp-kit';

export type DetectAgentAvailability = (context?: DetectContext) => Promise<AgentAvailability[]>;
export type DetectAgentModelCatalog = (context?: DetectContext) => Promise<AgentModelCatalogEntry[]>;
```

Build the context from the request credential:

```ts
function createManagedAgentDetectContext(credential: string | null): DetectContext | undefined {
  if (!credential) return undefined;
  return {
    env: {
      ...process.env,
      [MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV]: credential,
    },
  };
}
```

Use env-based detect context for app-data project paths. Only use `managedAgentInvocation: { credential, cwd }` when the cwd is `/workspace` or below, because `agent-acp-kit` rejects managed invocation cwd values outside `/workspace`.

- [ ] **Step 4: Make custom Claude detection respect detect context**

`createVibeClaudeProvider().detect()` currently ignores context. Change it to accept context and pass `context.env`/`context.cwd` into `detectClaude`, `execFileAsync(command, ['--version'], ...)`, and `detectClaudeAuthState(...)`.

The package Codex provider already respects detect context; the custom Claude provider needs to match it.

- [ ] **Step 5: TSH injects the header only when opening the SSR project page**

Do not register an Electron `webRequest.onBeforeSendHeaders` handler for post-hydration API traffic. TSH cannot safely own vibe-design's business API whitelist.

Inject `X-Tutti-Agent-Credential` only when all are true:

- `contents.loadURL(...)` is opening a loopback host: `localhost`, `127.0.0.1`, or `[::1]`
- scheme is `http` or `https`, but non-loopback hosts are rejected
- production hosted origins require a future explicit trusted origin registry before they can receive this header
- path is exactly `GET /project/:projectId`
- the Website runtime can be resolved to the room that owns the credential

The navigation header builder should obtain the value through the existing main-process service path, not through page JavaScript:

```ts
const { credential } = await desktopShellService.getManagedAgentInvocationCredential(roomId)
```

That service already reaches desktopd `GET /v1/rooms/{roomId}/managed-agent/invocation-credential`, which in turn asks guest-agent for the per-room managed credential. The header is attached only to the top-level navigation request; it is not exposed as a readable page API.

Attach only `X-Tutti-Agent-Credential`. Do not expose this value through page JavaScript, response headers, logs, diagnostics, or renderer events.

Do not inject for static assets, API calls, `GET /api/runs/:id/events`, unrelated hosts, top-level non-project navigations, requests with no resolved room, or telemetry.

- [ ] **Step 6: Run focused verification**

Run from `/Users/wwcome/work/demo/vibe-design`:

```bash
pnpm --filter @vibe-design/server test src/main.test.ts src/agent-launcher.test.ts
pnpm --filter @vibe-design/server type-check
```

Run from `/Users/wwcome/work/tsh/tsh`:

```bash
pnpm --dir apps/tsh-desktop exec vitest run src/app/main/websiteWindow/managedAgentInvocationCredentialHeader.spec.ts src/app/main/websiteWindow/websiteWindowNavigationOps.spec.ts
pnpm --dir apps/tsh-desktop check
```

## Task 1: Browser JSB For Hydrated API Calls

This is required for hydrated API calls that need managed credentials. It is not a replacement for SSR agent availability.

**Files:**

- Create: `web/src/services/managed-agent/managed-agent-credential.ts`
- Create: `web/src/services/managed-agent/managed-agent-credential.test.ts`
- Modify: `web/src/services/run/internal/run-service.ts`
- Modify: `web/src/services/run/internal/run-service.test.ts`

**Implementation shape:**

- Add a browser helper that calls `window.tutti?.agent?.getManagedAgentInvocationCredential?.()`.
- Have `RunService.createRun()` call that helper immediately before `POST /api/runs`.
- Attach the returned value to the existing `managedAgentInvocationCredential` request body field.
- Keep the credential out of React state and persistent browser storage.

**Limitations:**

- This fallback cannot make SSR `GET /project/:projectId` availability detection use managed credentials.
- It affects `GET /api/agents/models` only where the client explicitly wraps that request with a JSB credential read and a vibe-design-owned header.
- It must not store the credential in React state, local/session storage, timeline state, or SSR initial data.

## End-to-End Verification

- Start TSH desktop with a room that has a managed agent runtime connected.
- Open vibe-design inside the TSH website WebView.
- On `GET /project/:projectId`, verify the request includes `X-Tutti-Agent-Credential`.
- Verify the SSR HTML and `window.__VIBE_DESIGN_INITIAL__` do not include the credential.
- Verify SSR agent availability detection receives `TSH_MANAGED_AGENT_INVOCATION_CREDENTIAL` in detect env.
- From vibe-design, submit a prompt with Codex selected.
- Verify `POST /api/runs` includes the body field `managedAgentInvocationCredential` obtained through JSB.
- Verify `/api/runs/:id` response and SSE events do not include the credential.
- Verify `agent-acp-kit` receives either:
  - `managedAgentInvocation: { credential, cwd }`, or
  - `MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV`
- Verify managed-agent command-gateway calls succeed.

## Rollout Notes

- Keep the credential out of SSR initial data.
- Fetch or inject the credential per matched request; do not cache it globally at page load.
- Do not store it in React state, localStorage, sessionStorage, IndexedDB, logs, response headers, or timeline messages.
- The dashboard route does not need this credential.
- If the TSH bridge is unavailable, vibe-design should continue working as a normal local-agent flow without managed-agent invocation.

## Self-Review

- Spec coverage: covers TSH credential source, scoped request header injection, vibe-design server acquisition, existing server pass-through, and agent-acp-kit detect/run handoff.
- Placeholder scan: no `TBD`/`TODO` implementation placeholders remain. Production host must be substituted only if `*.nextop.ai` is not the real target.
- Type consistency: uses the existing `managedAgentInvocationCredential` field already present in `CreateRunInput`, `ChatRunCreateMeta`, and `agent-launcher`.
