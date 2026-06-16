# Prototype Design

<p align="right">
  <a href="./README.md"><kbd>English</kbd></a>
  <a href="./README.zh-CN.md"><kbd>中文</kbd></a>
</p>

![Prototype Design dashboard](docs/screenshots/vibe-design-dashboard.png)

> **Turn a prompt into a real, runnable prototype — then review, annotate, and refine it with AI in one workspace.**

Prototype Design is an AI-assisted design prototyping workspace. Start from a single prompt, ground the generation in a real design system, preview the live result on an interactive canvas, mark up exactly what needs to change, and send that visual feedback straight back to a local coding agent (Codex or Claude Code). Projects, conversations, files, and comments all persist — so a prototype keeps improving across many rounds instead of resetting every time.

Inspired by Open Design, Prototype Design keeps the creation loop open, inspectable, and grounded in real project artifacts.

## Why Prototype Design

- **From prompt to runnable prototype** — Describe a screen and get real HTML and assets you can open and click, not a static mockup.
- **Design-system-grounded output** — Pick an official design system and it becomes generation context, keeping color, typography, spacing, and component style on-brand.
- **Review on the canvas, not in chat** — Pin comments to exact locations and attach screenshots, so feedback stays tied to a specific file and point.
- **A closed visual feedback loop** — Send annotated feedback back to the agent and keep iterating in the same conversation.
- **Runs on your local agents** — Uses your installed Codex / Claude Code, so edits happen in your own development environment.
- **A durable workspace, not a one-shot generator** — Projects, conversations, files, and comments stay available across every round.

## Features

### 🎨 Projects & design systems

Create a project from the dashboard, search recent work, and choose an official design system. The selected system is injected as context before the agent runs, guiding color, typography, spacing, component style, and overall product tone.

### 💬 Conversational AI generation

The project editor is built around a conversation workspace. Choose a local agent, switch model providers, reference project files, and attach visual comments so every generation and edit keeps the right context.

### 🖼 Canvas preview & file workspace

Generated HTML, assets, and project files land in the canvas workspace. Files open as tabs with preview, comment, and annotation modes, and HTML prototypes render directly on the canvas so you inspect the real layout — not a screenshot of one.

![Prototype Design project editor](docs/screenshots/vibe-design-project-editor.png)

### 📌 Visual review loop

Place comments on exact preview locations and send screenshot attachments to the agent. Design feedback stays bound to a concrete file and canvas point instead of getting lost in plain chat history.

### 🤖 Local agent runtime

The server detects local Codex and Claude Code installation, authentication, and availability, then surfaces any problems in the UI. Available agents run through the local runtime, so the workflow edits project files inside your own development environment.

### ⌨️ Agent-friendly CLI

The packaged app registers read-only `tutti vibe-design` commands. Other agents can inspect projects, conversations, messages, files, file contents, and preview comments without depending on private Web UI routes.

## How it works

1. Enter a project name and prompt on the dashboard.
2. Select an official design system as generation guidance.
3. Open the project editor and generate prototype files with Codex or Claude Code.
4. Preview HTML files on the canvas and inspect hierarchy, layout, and content.
5. Add comments or screenshot feedback to specific areas.
6. Send the feedback back to the agent, keep editing, and retain the full conversation history.

## Who it's for

- Teams exploring interface directions for SaaS tools, operations dashboards, content tools, mobile apps, and similar products.
- Designers and PMs who want AI generation constrained by a real design system instead of random, unstructured output.
- Anyone who needs to review and annotate generated prototypes directly on the canvas.
- Workflows where an agent should continue editing based on concrete files, screenshots, and comments.
- Other agents that need read-only access to project context and file resources through a CLI surface.

---

## For developers

### Quick start

Requirements:

- Node.js compatible with the repository's Node 24 build target.
- pnpm 10.x.
- Codex and/or Claude Code installed and authenticated for real local agent runs.

```bash
pnpm install        # install dependencies
make dev            # start the dev server at http://127.0.0.1:3000/
make dev PORT=3100  # override the port
```

### Repository layout

```text
vibe-design/
|-- server/          # Express server, local agent runtime, persistence, API and CLI routes
|-- web/             # React app, canvas workspace, chat UI, services, and SSR renderer
|-- skills/          # Bundled Prototype Design skills
|-- design-systems/  # Built-in design system definitions
|-- docs/            # Specs, implementation plans, and screenshots
|-- scripts/         # Packaging and support scripts
`-- COMMANDS.md      # Public Tutti CLI command reference
```

The server consumes the web renderer through the workspace dependency `@vibe-design/web`.

### Runtime configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `TUTTI_APP_HOST` or `HOST` | HTTP bind host | `127.0.0.1` |
| `TUTTI_APP_PORT` or `PORT` | HTTP bind port | `3000` |
| `TUTTI_APP_DATA_DIR` | Durable project, conversation, skill, and design system data | `.vibe` under the current working directory |
| `VIBE_USER_SKILLS_DIR` | User-imported skill root | `$TUTTI_APP_DATA_DIR/skills` |
| `VIBE_BUILTIN_SKILLS_DIR` | Bundled skill root | `skills/` |
| `VIBE_USER_DESIGN_SYSTEMS_DIR` | User-editable design system root | `$TUTTI_APP_DATA_DIR/design-systems` |
| `VIBE_BUILTIN_DESIGN_SYSTEMS_DIR` | Bundled design system root | `design-systems/` |

### Scripts

```bash
pnpm build:web          # Build the web client and CSS
pnpm build:server       # Bundle the server entrypoint
pnpm start              # Build web assets, then start the server
pnpm test               # Run all workspace tests
pnpm type-check         # Run TypeScript checks for server and web
pnpm test:package       # Test the Tutti package builder
pnpm package:tutti-app  # Build the distributable Tutti app package
```

Package-scoped commands:

```bash
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/server type-check
```

### Tutti CLI

Prototype Design registers read-only CLI commands under the `vibe-design` scope. See `COMMANDS.md` for the full reference.

```bash
tutti --json vibe-design projects
tutti --json vibe-design conversations --project-id <id>
tutti --json vibe-design conversation-messages --project-id <id> --conversation-id <id>
tutti --json vibe-design files --project-id <id>
tutti --json vibe-design file-get --project-id <id> --name hero.html
tutti --json vibe-design comments --project-id <id> --conversation-id <id>
```

### Packaging

```bash
pnpm package:tutti-app
```

The package is written to `dist/tutti-app/vibe-design` and validates the runtime entrypoint, manifests, server bundle, SQLite WASM, web assets, bundled skills, and design systems. Recommended checks before shipping:

```bash
pnpm test
pnpm type-check
pnpm test:package
```

## License

Prototype Design is licensed under the [Apache License 2.0](./LICENSE).
