# Slate

> Category: Monochrome

A pure grayscale system for neutral, content-first surfaces with no color noise.

## Color

- Accent: #525252
- Highlight: #c0c0c0
- Canvas: #f0f0f0
- Panel: #f5f5f5
- Ink: #333333
- Ink soft: #4a4a4a
- Muted: #666666
- Border: #d0d0d0
- Field: #d9d9d9
- Danger: #cc3333

The system is fully monochrome. Hierarchy comes from layered grays and weight, never from hue.

## Typography

Use a clear sans stack for UI and headings; reserve the serif for long-form or editorial passages and the mono stack for code and data. Keep headings confident and body copy legible with generous line-height.

## Layout

Build on a stable grid with breathable spacing. Lead with one clear primary action per view, keep secondary actions quiet, and let the accent mark only what matters most.

## Components

Buttons, cards, fields, badges, and panels read their values from `tokens.css`. Always compose from the `--vd-*` token contract instead of hard-coding raw colors.
