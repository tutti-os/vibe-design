# Agent Runtime Design

## Source Material

This spec implements the Track 2 Agent runtime migration described in:

- `/Users/zhengweibin/Desktop/workspace/od-replication-plan/track-2-agent-runtime.md`
- `/Users/zhengweibin/Desktop/workspace/od-replication-plan/cross-track-interface-review.md`

The source implementation is read from these Vibe Design modules:

- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/claude-stream.ts`
- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/role-marker-guard.ts`
- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/codex-cli.ts`
- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/runtimes/defs/claude.ts`
- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/runtimes/defs/codex.ts`
- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/runtimes/defs/gemini.ts`
- `/Users/zhengweibin/Desktop/workspace/vibe-design/apps/daemon/src/runtimes/registry.ts`

## Goal

Add the Track 2 runtime foundation to `vibe-design/server`: Claude stream-json parsing, role-marker protection, Codex MCP installation helpers, and a small Agent registry for Claude, Codex, and Gemini.

## Current Context

`vibe-design/server` currently contains only a small HTTP server in `server/src/main.ts` and one SSR integration test. Track 1 modules such as `runs.ts`, `types/run.ts`, and `ChatRunService` are not present. Track 3 modules such as `skills.ts` and `prompts/system.ts` are also not present.

Because of that, this work will land independently testable runtime modules first. `agent-launcher.ts` will be designed around dependency injection so it can connect to Track 1 and Track 3 once those files exist, without hard-coding imports to absent modules.

## Concept Mapping

| Source concept | Target concept |
| --- | --- |
| Vibe Design daemon runtime layer | Vibe Design server runtime layer |
| `RuntimeAgentDef` in `runtimes/types.ts` | A Track 2 scoped `RuntimeAgentDef` in `server/src/agents.ts` |
| `claudeAgentDef` | `server/src/runtimes/claude.ts` |
| `codexAgentDef` | `server/src/runtimes/codex.ts` |
| `geminiAgentDef` | `server/src/runtimes/gemini.ts` |
| `AGENT_DEFS` / `getAgentDef` | `createAgentRegistry`, `getAgentDef`, `listAgentDefs` |
| Claude Code stream-json stdout parser | `createClaudeStreamHandler` |
| Fabricated role marker guard | `createRoleMarkerGuard` |
| Vibe Design MCP server install in Codex | Vibe Design MCP server install in Codex |
| `codex mcp get/add/remove` wrapper | `probeCodexInstall`, `installCodexMcp`, `uninstallCodexMcp` |
| Vibe Design chat run bridge | Future Vibe Design `ChatRunService` integration through injected launcher dependencies |

## Protocols To Preserve

Claude stdin must remain JSONL for `stream-json` input:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"message"}]}}
```

Claude tool-result stdin must use Anthropic `tool_result` content:

```json
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01xxx","content":"answer"}]}}
```

Claude stdout parsing must emit the Track 2 / Track 4 event contract:

- `status`
- `text_delta`
- `thinking_delta`
- `thinking_start`
- `tool_use`
- `tool_result`
- `usage`
- `turn_end`
- `raw`
- `fabricated_role_marker`

`turn_end` must be emitted after all assistant content blocks are processed. This preserves the `AskUserQuestion` pending-answer ordering described in Track 2.

Role-marker protection must apply only to visible assistant text. It must not filter `thinking_delta`.

Codex MCP setup must use the Codex CLI:

- Probe: `codex mcp get <name>`
- Install: `codex mcp add <name> --env KEY=value -- <command> ...args`
- Uninstall: `codex mcp remove <name>`

The helper must expose a runner injection seam for tests and must not edit `~/.codex/config.toml` directly.

## Architecture

### Runtime Modules

`server/src/role-marker-guard.ts` will provide a stateful guard that detects fabricated Markdown role markers across stream chunks. It will keep bounded tail state instead of buffering the entire message.

`server/src/claude-stream.ts` will parse JSONL from Claude Code and map structured objects to `AgentEvent`-shaped payloads. It will preserve Vibe Design's behavior for streamed text, streamed thinking, streamed tool-use JSON accumulation, final assistant wrapper fallback, usage events, and raw malformed lines.

`server/src/codex-cli.ts` will wrap Codex MCP installation commands behind `CodexRunner`. Tests will inject a stub runner; production will spawn `codex`.

`server/src/agents.ts` will own the Vibe Design registry interfaces:

```ts
type RuntimeAgentDef = {
  id: string;
  label: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  promptInputFormat: 'text' | 'stream-json';
  capabilities: string[];
  models: ModelSummary[];
  buildArgs?: (ctx: RuntimeBuildContext) => string[];
  env?: (ctx: EnvContext) => Record<string, string>;
};
```

The registry will expose:

```ts
type AgentRegistry = {
  getAgentDef(agentId: string): RuntimeAgentDef | null;
  listAgentDefs(): RuntimeAgentDef[];
  isKnownModel(agentId: string, model: string): boolean;
  sanitizeCustomModel(agentId: string, model: string): string;
  listProviderModels(agentId: string): ModelSummary[];
  testAgentConnection(agentId: string): Promise<ConnectionTestResult>;
};
```

`server/src/runtimes/index.ts` will export the base runtime list and registry factory. `claude.ts`, `codex.ts`, and `gemini.ts` will hold one descriptor each.

### Launcher Integration

`server/src/agent-launcher.ts` will not import Track 1 or Track 3 modules directly in this migration because those files do not exist yet. Instead, it will expose helper functions and types that future Track 1/3 code can call:

- `buildInitialClaudeUserMessage(prompt: string): string`
- `buildClaudeToolResultMessage(toolUseId: string, content: string): string`
- `wireClaudeStream(child, run, runs)`

If a full `launchAgent` function is added in this track, it will accept explicit `runs`, `composeSystemPrompt`, and skill/design-system resolver dependencies through a context object.

## Data Flow

Claude stream-json flow:

1. Runtime descriptor builds Claude CLI args.
2. Launcher writes one JSONL user message to stdin and keeps stdin open.
3. `createClaudeStreamHandler` consumes stdout chunks.
4. The handler emits Track 2 events.
5. Future `ChatRunService` will forward each event through `runs.emit(run, event.type, event)`.
6. Future tool-result routes will write JSONL `tool_result` messages into the same stdin pipe.
7. On assistant `turn_end`, future run logic will close stdin only when no host answers remain pending.

Text-mode runtime flow:

1. Runtime descriptor builds CLI args.
2. Launcher writes composed prompt as text to stdin.
3. Launcher closes stdin immediately.
4. Plain or JSON-event stream parsers can be added by later tracks as needed.

## Error Handling

Malformed Claude JSONL lines emit `{ type: 'raw', line }` instead of throwing.

Malformed streamed tool-use JSON does not emit prematurely. The final assistant wrapper can still provide the completed `tool_use`.

Codex CLI failures throw errors that include stderr first, stdout second, then exit code.

Missing `codex` binary during probe returns `{ available: false, installed: false }`. Other spawn errors are rethrown.

Duplicate runtime ids throw during registry creation.

Unknown agent ids return `null` from `getAgentDef` and safe defaults from model helpers.

## Tests

Add focused Vitest coverage under `server/src` or `server/tests` following the current server test style:

- Role marker regex positive and negative cases.
- Role marker cross-chunk detection and pending suffix behavior.
- Claude stream parser status, text delta, thinking delta, tool use, tool result, usage, raw line, and turn_end ordering.
- Guard scope: text deltas are protected; thinking deltas pass through unchanged.
- Codex MCP probe/install/uninstall runner argv and failure handling.
- Registry lookup, duplicate-id rejection, model sanitization, and connection-test behavior.
- Runtime descriptor arg construction for Claude, Codex, and Gemini.

Validation commands:

```bash
pnpm --filter @vibe-design/server test
pnpm --filter @vibe-design/server type-check
```

## Semantic Rewrite Notes

The migration will preserve Vibe Design's control flow and edge-case coverage but adapt the implementation to the smaller Vibe Design server:

- Keep the Claude JSONL parser behavior, but define local event/types rather than importing Vibe Design daemon types.
- Keep the role-marker guard algorithm because it is security-sensitive and well tested.
- Simplify runtime descriptors to the fields required by Track 2 instead of copying Vibe Design's full multi-agent daemon abstraction.
- Keep Codex MCP command semantics, but use Vibe Design naming in tests and examples.
- Do not add UI, CSS, or `@tutti-os/ui-system` in this track because the migration target is server-only.

## Non-Goals

- Do not implement Track 1 run storage or SSE routes.
- Do not implement Track 3 skill loading or system prompt composition.
- Do not implement Track 4 frontend event consumption.
- Do not add ACP, Pi RPC, Qoder, Copilot, OpenCode, Cursor, DeepSeek, or other Vibe Design runtime families.
- Do not directly modify user Codex config files.
- Do not install new dependencies unless TypeScript compilation requires one.
