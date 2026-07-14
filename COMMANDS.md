# Prototype Design CLI Commands

The Prototype Design app exposes commands under the `vibe-design` scope. Commands return JSON by default so agents can drive and inspect project state without relying on the app's internal web UI routes.

The surface is mostly read-only, plus an `open` command for UI activation and two **prototype-creation** commands so external agents can create a project and run the agent to generate a prototype.

## Restrictions

- Only the commands documented below are supported.
- `open` is limited to UI activation: it can open the dashboard or an existing project, but it does not create or update project data.
- Write capability is limited to prototype creation: `project-create` and `session-start`. (`session-start` also creates the conversation when one is not supplied.)
- Project updates, project deletion, project detail export, standalone conversation creation/rename, resource writes/deletes/renames, and comment create/update/delete remain intentionally unavailable through `tutti vibe-design`.
- The server only registers the matching `/tutti/cli/*` handlers. Unsupported write commands should return 404 if called directly.
- Do not treat internal Web UI `/api/*` routes as public CLI capabilities.

## Usage

Use the app scope followed by the command name:

```sh
tutti --json vibe-design <command> [options]
```

All supported commands return Tutti CLI JSON output. Prefer `--json` when another agent or script consumes the result.

## Projects

- `tutti vibe-design projects [--limit 50]`: list projects.
- `tutti vibe-design open`: open the Prototype Design dashboard.
- `tutti vibe-design open --project-id <id>`: open an existing project.
- `tutti vibe-design project-create --prompt <text> [--title <text>] [--project-kind <kind>] [--design-system-id <id>]`: create a project from a prompt and initialize its default conversation. Returns `{ project, conversationId, resolvedDir }`. This only creates the records — call `session-start` to actually generate the prototype.

## Creating a Prototype Page

End-to-end flow for an external caller to generate a prototype page (e.g. `index.html`) and read it back:

```sh
# 1. Create the project. Returns project.id and a default conversationId.
tutti --json vibe-design project-create --prompt "A SaaS pricing page prototype"
#    -> { "project": { "id": "<projectId>", ... }, "conversationId": "<conversationId>", ... }

# 2. Run the agent to build the page.
#    session-start is SYNCHRONOUS: it runs the agent to completion and returns the
#    full agent conversation (messages) verbatim. Omit --conversation-id to have a
#    conversation created automatically before the message is sent.
tutti --json vibe-design session-start \
  --project-id <projectId> \
  --prompt "Create index.html: a modern SaaS pricing page with three tiers, a monthly/annual toggle, and an FAQ. Single file, inline CSS, no external deps."
#    -> { "runId": "...", "conversationId": "...", "assistantMessageId": "...",
#         "agentTargetId": "...", "provider": "...", "status": "succeeded", "agentFallback": null,
#         "messages": [ ...verbatim agent messages... ] }

# 3. List the files the agent generated.
tutti --json vibe-design files --project-id <projectId>
#    -> each file has a name and a static url (http://127.0.0.1:<port>/static/projects/<id>/assets/<name>)

# 4. Read the generated page back.
tutti --json vibe-design file-get --project-id <projectId> --name index.html
```

Notes:

- `session-start` blocks until the run finishes and returns `status` (`succeeded` | `failed` | `canceled`) plus the conversation `messages` exactly as stored, so you usually don't need a separate `conversation-messages` call.
- Omit `--conversation-id` to create a conversation and send in one call; pass it to target an existing conversation (e.g. to continue iterating).
- The Agent Target defaults to `defaultAgentTargetId` from the current Tutti agent catalog. Pick another exact target with `--agent-id <agent-target-id>` and optionally `--model`.
- A conversation is locked to the exact Agent Target used for its first run. Selecting a different target returns `CONVERSATION_AGENT_LOCKED`; create a new conversation explicitly instead of resuming across targets that happen to share a provider.
- Provider identifiers are runtime metadata. Deprecated provider-only input is accepted only when the complete catalog maps it to one available Agent Target; ambiguous or stale values fail closed.
- `session-start` does not perform provider-specific fallback. When `AGENT_UNAVAILABLE` is returned, report the failure instead of modifying project files as a substitute for a successful run.
- The generated page is delivered as a project file asset, not as page markup in the command output — retrieve it with `files` / `file-get` (or the static `url`).

## Conversation Context

- `tutti vibe-design session-start --project-id <id> [--prompt <text>] [--conversation-id <id>] [--agent-id <agent-target-id>] [--model <id>]`: send a message and run the exact Agent Target to completion. Returns `{ runId, conversationId, assistantMessageId, agentTargetId, provider, status, agentFallback, messages }`; `provider` is runtime metadata and `agentFallback` is always `null`.
- `tutti vibe-design conversations --project-id <id>`: list project conversations.
- `tutti vibe-design conversation-messages --project-id <id> --conversation-id <id>`: return messages in one conversation.

## Resources

- `tutti vibe-design files --project-id <id>`: list project files. Each file includes a static `url` such as `http://127.0.0.1:<port>/static/projects/<project-id>/assets/<name>`.
- `tutti vibe-design file-get --project-id <id> --name <file>`: return file content. Text files return `encoding: "utf8"`; binary files return `encoding: "base64"`.

## Comments

- `tutti vibe-design comments --project-id <id> --conversation-id <id>`: list preview comments.

## Examples

```sh
tutti --json vibe-design projects
tutti --json vibe-design open
tutti --json vibe-design open --project-id <id>
tutti --json vibe-design project-create --prompt "A pricing page for a SaaS app"
tutti --json vibe-design session-start --project-id <id> --prompt "A pricing page for a SaaS app"
tutti --json vibe-design conversations --project-id <id>
tutti --json vibe-design conversation-messages --project-id <id> --conversation-id <id>
tutti --json vibe-design files --project-id <id>
tutti --json vibe-design file-get --project-id <id> --name hero.html
tutti --json vibe-design comments --project-id <id> --conversation-id <id>
```
