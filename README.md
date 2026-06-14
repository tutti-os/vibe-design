# Vibe Design

<p align="right">
  <a href="./README.md"><kbd>English</kbd></a>
  <a href="./README.zh-CN.md"><kbd>中文</kbd></a>
</p>

![Vibe Design dashboard](docs/screenshots/vibe-design-dashboard.png)

Vibe Design is an AI-assisted design prototyping workspace for Tutti. It connects prompt-driven generation, design-system guidance, project file previews, canvas comments, and local agent execution so product, design, and engineering work can iterate around the same runnable prototype.

## Product Positioning

Vibe Design is built for teams that need to explore interface directions quickly, inspect generated output, and keep refining it. A user can start from one prompt, choose a design system, review generated files, point to issues directly on the canvas, and send that visual feedback back into Codex or Claude Code for follow-up work.

The goal is not a one-off page generator. It is a durable design workspace where projects, conversations, files, comments, and context stay available across multiple rounds of iteration.

## Core Capabilities

### Project Setup And Design Systems

The dashboard supports project creation, recent-project search, and official design-system selection. The selected design system becomes generation context before the agent runs, guiding color, typography, spacing, component style, and product tone.

### Conversational AI Generation

The project editor includes a conversation workspace. Users can choose a local agent, switch model providers, reference project files, or attach visual comments so generation and edits keep the right context.

### Canvas Preview And File Workspace

Generated HTML, assets, and project files appear in the canvas workspace. Files open as tabs with preview, comment, and annotation modes; HTML prototypes render directly in the canvas so users can inspect the real layout.

![Vibe Design project editor](docs/screenshots/vibe-design-project-editor.png)

### Visual Review Loop

Users can place comments on exact preview locations and send screenshot attachments to the agent. Design feedback stays tied to a concrete file and canvas point instead of getting buried in plain chat history.

### Local Agent Runtime

The server detects local Codex and Claude Code installation, authentication, and availability, then reports problems in the UI. Available agents run through the local runtime, making the workflow suitable for editing project files inside the user's own development environment.

### Agent-Friendly CLI

The packaged app registers read-only `tutti vibe-design` commands. Other agents can inspect projects, conversations, messages, files, file contents, and preview comments without depending on private Web UI routes.

## Typical Workflow

1. Enter a project name and prompt on the dashboard.
2. Select an official design system as generation guidance.
3. Open the project editor and generate prototype files with Codex or Claude Code.
4. Preview HTML files on the canvas and inspect hierarchy, layout, and content.
5. Add comments or screenshot feedback to specific areas.
6. Send feedback back to the agent, continue editing, and keep the conversation history.

## Use Cases

- Explore interface directions for SaaS tools, operations dashboards, content tools, mobile apps, and similar products.
- Bring design-system constraints into AI generation to reduce random, unstructured output.
- Review and annotate generated prototypes directly on the canvas.
- Let agents continue editing based on concrete files, screenshots, and comments.
- Expose project context and file resources to other agents through a read-only CLI surface.

## Repository Layout

```text
vibe-design/
|-- server/          # Express server, local agent runtime, persistence, API and CLI routes
|-- web/             # React app, canvas workspace, chat UI, services, and SSR renderer
|-- skills/          # Bundled Vibe Design skills
|-- design-systems/  # Built-in design system definitions
|-- docs/            # Specs, implementation plans, and screenshots
|-- scripts/         # Packaging and support scripts
`-- COMMANDS.md      # Public Tutti CLI command reference
```

The server consumes the web renderer through the workspace dependency `@vibe-design/web`.

## Local Development

Requirements:

- Node.js compatible with the repository's Node 24 build target.
- pnpm 10.x.
- Codex and/or Claude Code installed and authenticated for real local agent runs.

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
make dev
```

Default URL:

```text
http://127.0.0.1:3000/
```

Override the port:

```bash
make dev PORT=3100
```

## Runtime Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `TUTTI_APP_HOST` or `HOST` | HTTP bind host | `127.0.0.1` |
| `TUTTI_APP_PORT` or `PORT` | HTTP bind port | `3000` |
| `TUTTI_APP_DATA_DIR` | Durable project, conversation, skill, and design system data | `.vibe` under the current working directory |
| `VIBE_USER_SKILLS_DIR` | User-imported skill root | `$TUTTI_APP_DATA_DIR/skills` |
| `VIBE_BUILTIN_SKILLS_DIR` | Bundled skill root | `skills/` |
| `VIBE_USER_DESIGN_SYSTEMS_DIR` | User-editable design system root | `$TUTTI_APP_DATA_DIR/design-systems` |
| `VIBE_BUILTIN_DESIGN_SYSTEMS_DIR` | Bundled design system root | `design-systems/` |

## Scripts

```bash
pnpm build:web          # Build the web client and CSS
pnpm build:server       # Bundle the server entrypoint
pnpm start              # Build web assets, then start the server
pnpm test               # Run all workspace tests
pnpm type-check         # Run TypeScript checks for server and web
pnpm test:package       # Test the Tutti package builder
pnpm package:tutti-app # Build the distributable Tutti app package
```

Package-scoped commands:

```bash
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/server type-check
```

## Tutti CLI

Vibe Design registers read-only CLI commands under the `vibe-design` scope. See `COMMANDS.md` for the full reference.

```bash
tutti --json vibe-design projects
tutti --json vibe-design conversations --project-id <id>
tutti --json vibe-design conversation-messages --project-id <id> --conversation-id <id>
tutti --json vibe-design files --project-id <id>
tutti --json vibe-design file-get --project-id <id> --name hero.html
tutti --json vibe-design comments --project-id <id> --conversation-id <id>
```

## Packaging

Build the Tutti app package:

```bash
pnpm package:tutti-app
```

The package is written to `dist/tutti-app/vibe-design` and validates the runtime entrypoint, manifests, server bundle, SQLite WASM, web assets, bundled skills, and design systems.

Recommended checks before shipping:

```bash
pnpm test
pnpm type-check
pnpm test:package
```

## License

Vibe Design is licensed under the [Apache License 2.0](./LICENSE).
