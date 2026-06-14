# Design System I18n Design

## Goal

Add first-class multilingual design system support so Vibe Design can show and use localized design system descriptions when the UI locale is `zh-CN`, while preserving the current English behavior as the default fallback.

## Scope

- Localize built-in design system metadata: title, category, and short summary.
- Support localized `DESIGN.md` and `USAGE.md` files for agent prompt context.
- Resolve locale on the server for design system list/detail APIs and agent runs.
- Send the active UI locale from the dashboard and project editor when loading design systems.
- Keep tokens and component fixtures shared unless a package explicitly supplies localized alternatives.

## Package Contract

Design system packages keep the current root fields as default English values:

- `name`
- `category`
- `description`
- `files.design`
- `usage`

Packages may add locale overrides under `i18n`:

```json
{
  "i18n": {
    "zh-CN": {
      "name": "默认应用设计系统",
      "category": "应用",
      "description": "适合清晰工作台界面的克制应用设计系统。",
      "files": {
        "design": "DESIGN.zh-CN.md"
      },
      "usage": "USAGE.zh-CN.md"
    }
  }
}
```

Fallback is field-level. Missing localized metadata falls back to the default manifest field, then to the existing markdown extraction logic. Missing localized files fall back to `DESIGN.md` and `USAGE.md`.

## API Design

`GET /api/design-systems` and `GET /api/design-systems/:id` accept an optional locale through:

- `?locale=zh-CN`
- `Accept-Language` as a secondary source

The response shape stays unchanged. Existing consumers continue to receive `title`, `category`, and `summary`; the server resolves those values for the requested locale.

## Agent Prompt Flow

When a run includes `request.locale`, `agent-launcher` passes that locale to design system resolution. The active design system title, body, and usage guidance use the localized package files when available, so the agent sees the same language context as the UI. Machine-readable tokens and component manifests remain unchanged.

## Frontend Flow

Dashboard and project editor already know the active locale through `useTranslation()`. Their design system fetches will include `?locale=${locale}`. Parsing and rendering remain unchanged because localization is handled by the server response.

## Data Migration

Built-in design systems gain `i18n.zh-CN` metadata and optional localized `DESIGN.zh-CN.md` / `USAGE.zh-CN.md` files. This can be introduced incrementally because every localized field and file has a fallback.

## Testing

- Server API test for localized metadata through `?locale=zh-CN`.
- Server API test for `Accept-Language` fallback.
- Agent launcher test that localized design system title/body/usage are injected into the system prompt.
- Frontend tests that design system fetches include the current locale.

## Risks

- Translating full design system bodies increases maintenance work. The fallback model keeps partial translations safe.
- User-created design systems may not provide i18n metadata. They continue to behave as they do today.
