# Ledger

> Category: Editorial

Paper surfaces, ink typography, and a margin-gold accent for document-led tools.

## Color

- Accent: #c8a64b
- Highlight: #f3eac8
- Canvas: #f9f9f9
- Panel: #ffffff
- Ink: #3a3a3a
- Ink soft: #444444
- Muted: #505050
- Border: #747272
- Field: #e3e3e3
- Danger: #c87a7a

Ink type on paper does the work; a warm gold accent marks highlights and primary actions sparingly, like a highlighter.

## Typography

Use a clear sans stack for UI and headings; reserve the serif for long-form or editorial passages and the mono stack for code and data. Keep headings confident and body copy legible with generous line-height.

## Layout

Build on a stable grid with breathable spacing. Lead with one clear primary action per view, keep secondary actions quiet, and let the accent mark only what matters most.

## Components

Buttons, cards, fields, badges, and panels read their values from `tokens.css`. Always compose from the `--vd-*` token contract instead of hard-coding raw colors.
