# Prototype Design CLI Commands

The Prototype Design app exposes read-only commands under the `vibe-design` scope. Commands return JSON by default so agents can inspect project state without relying on the app's internal web UI routes.

## Restrictions

- The public `vibe-design` CLI surface is read-only.
- Only the commands documented below are supported.
- Project creation, project updates, project deletion, project detail export, conversation creation/rename, agent run start, resource writes/deletes/renames, and comment create/update/delete are intentionally unavailable through `tutti vibe-design`.
- The server only registers the matching read-only `/tutti/cli/*` handlers. Removed write commands should return 404 if called directly.
- Do not treat internal Web UI `/api/*` routes as public CLI capabilities.

## Usage

Use the app scope followed by the command name:

```sh
tutti --json vibe-design <command> [options]
```

All supported commands return Tutti CLI JSON output. Prefer `--json` when another agent or script consumes the result.

## Projects

- `tutti vibe-design projects [--limit 50]`: list projects.

## Conversation Context

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
tutti --json vibe-design conversations --project-id <id>
tutti --json vibe-design conversation-messages --project-id <id> --conversation-id <id>
tutti --json vibe-design files --project-id <id>
tutti --json vibe-design file-get --project-id <id> --name hero.html
tutti --json vibe-design comments --project-id <id> --conversation-id <id>
```
