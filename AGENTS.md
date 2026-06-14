# AGENTS.md

## Scope

This file applies to the whole `vibe-design` repository.

## Tutti CLI Surface

- The public Tutti CLI surface is defined by `tutti.cli.json`.
- `COMMANDS.md` is the human-readable source for CLI usage, limits, and examples.
- When any CLI interface changes, update `COMMANDS.md` in the same change. This includes command additions/removals, input fields, output behavior, route paths, read/write capability, and direct `/tutti/cli/*` handler availability.
- Keep `tutti.cli.json`, `COMMANDS.md`, `server/src/routes/cli-routes.ts`, and related tests synchronized.
- The current public CLI policy is read-only: project list, conversation list/messages, resource list/detail, and comment list only.
- Do not add or restore CLI write commands without updating the documented restrictions and tests in the same change.
