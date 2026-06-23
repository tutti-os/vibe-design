# Managed Agent Invocation Credential Plan

## Current Conclusion

Do not merge a separate TSH `loadURL(..., { extraHeaders })` implementation.

`tutti-lab/tsh#1077` is already merged into `origin/main` and provides the TSH-side credential projection through the Website runtime preview proxy. vibe-design should consume that mainline protocol:

```http
X-TSH-Managed-Agent-Credential: <credential>
```

vibe-design should not define its own `X-Tutti-Agent-Credential` constant. It should use `@tutti-os/agent-acp-kit@0.2.3-beta.0` exports instead:

- `MANAGED_AGENT_INVOCATION_CREDENTIAL_HEADER`
- `getManagedAgentInvocationCredentialFromHeaders(headers)`

This keeps TSH, vibe-design, and agent-acp-kit on the same protocol constant.

## SSR Boundary

SSR cannot call JSB. The SSR project route runs in the vibe-design Node server, where `window.tutti` does not exist.

The initial `GET /project/:projectId` agent availability detection happens during SSR, so it must read the credential from the incoming request header. After hydration, browser code can call:

```ts
window.tutti.agent.getManagedAgentInvocationCredential()
```

and pass the value through vibe-design-owned API contracts at the exact call sites that need it.

## TSH Mainline Behavior

The merged TSH implementation from `tutti-lab/tsh#1077` works like this:

1. Website launch URLs are converted to local preview proxy URLs with `resolveWebsiteRuntimePreviewProxyUrl(...)`.
2. `WebsiteRuntimePreviewProxy.configureSession(...)` configures the Electron session proxy.
3. The proxy resolves the preview route to a room/workspace.
4. `WebsiteManagedAgentCredentialProjector` calls `getManagedAgentInvocationCredential(roomId)`.
5. The proxy strips spoofed page-provided managed credential headers, then injects `X-TSH-Managed-Agent-Credential`.
6. Credential lookup is cached for 5s, has a 1s timeout, and fails open when unavailable.

vibe-design should still own the post-hydration API contract. TSH should not need an application API whitelist.

## vibe-design Behavior

### SSR Agent Availability

`GET /project/:projectId` reads:

```ts
getManagedAgentInvocationCredentialFromHeaders(req.headers)
```

When a credential exists, build a transient detect context:

```ts
{
  env: {
    ...process.env,
    [MANAGED_AGENT_INVOCATION_CREDENTIAL_ENV]: credential,
  },
}
```

Pass that context into availability detection. Do not write the credential to SSR HTML, `window.__VIBE_DESIGN_INITIAL__`, JSON responses, logs, or persisted data.

### Model Catalog

`GET /api/agents/models` reads the same explicit header and passes it into model detection.

After hydration, if the browser refreshes the model catalog and needs managed detection, it should call JSB first and explicitly set:

```http
X-TSH-Managed-Agent-Credential: <credential>
```

### Run Creation

`POST /api/runs` keeps the existing request body contract:

```json
{
  "managedAgentInvocationCredential": "<credential>"
}
```

The browser reads the credential through JSB immediately before creating a run. The server stores it only on transient run metadata, clears it when launching the agent, and never exposes it in status, SSE, starter requests, logs, or persisted data.

## Verification

Run from `/Users/wwcome/work/demo/vibe-design`:

```bash
pnpm --dir server exec vitest run src/main.test.ts src/local-claude-provider.test.ts src/agent-launcher.test.ts
pnpm --dir web exec vitest run src/services/managed-agent/managed-agent-credential.test.ts src/services/run/internal/run-service.test.ts
pnpm --filter @vibe-design/server type-check
pnpm --filter @vibe-design/web type-check
```

## End-to-End Flow

```text
TSH Website runtime preview proxy
  -> resolve preview route / room
  -> getManagedAgentInvocationCredential(roomId)
  -> inject X-TSH-Managed-Agent-Credential
  -> vibe-design SSR/model API reads agent-acp-kit header helper
  -> convert credential to agent-acp-kit detect env
  -> agent-acp-kit detect uses credential

After hydration, run creation
  -> vibe-design web reads credential through JSB
  -> POST /api/runs body.managedAgentInvocationCredential
  -> agent-acp-kit run uses credential
  -> credential is never reflected to browser-visible data
```
