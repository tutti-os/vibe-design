# Dark Property Inspector Design

## Context

The current canvas inspect panel has the right data flow, but its presentation does not match the requested dark, dense property inspector shown in the reference screenshots. The existing implementation also grew from a field-completeness pass, so the UI reads like a generic form rather than a design-tool property panel.

This design replaces the property-area presentation with a new dark inspector component family while preserving the current canvas edit data flow.

## Goals

- Rebuild only the right-side property area. The upper component tree is out of scope.
- Keep every existing editable field available.
- Use neutral names in product UI, component names, file names, tests, and docs.
- Match the reference screenshots' visual density and hierarchy:
  - dark continuous panel, no card-like white surface
  - compact section titles
  - 38px-ish controls
  - icon-leading inputs
  - unit suffixes
  - segmented button groups
  - checkboxes
  - collapsed additive sections
  - thin section dividers
- Preserve existing save, preview, cancel, and dirty-tracking behavior.
- Continue using `@tutti-os/ui-system` public component imports where practical.

## Non-Goals

- Do not rebuild the upper component tree.
- Do not change the canvas edit bridge protocol.
- Do not change how selected targets are discovered.
- Do not add new editing capabilities beyond the fields already represented by the current inspector data model.
- Do not introduce the reference product name into UI, code, tests, or docs.
- Do not migrate unrelated workspace or chat UI.

## Source References

Reference screenshots provided in the thread define the visual target. Existing target code is:

- `web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- `web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`
- `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

The implementation must preserve the existing `CanvasInspectorDraft` contract and the `onPreviewDraft` / `onSaveDraft` callbacks.

## UI Structure

The property area will be a single dark panel surface, not a card. It will contain:

1. Mode tabs
   - `Design` active
   - `CSS` inactive placeholder
   - CSS mode is visual-only for this pass unless current code already supports CSS content.

2. `Position`
   - X, Y, Z inputs in one row.
   - Angle input plus rotate/flip icon buttons.
   - Values map to current position and transform style draft keys.

3. `Layout`
   - Flow segmented buttons.
   - Dimensions: W and H inputs with `px` suffix.
   - Padding: vertical and horizontal compact inputs, plus individual direction fields available in expanded rows.
   - `Clip content` checkbox.
   - Margin: vertical and horizontal compact inputs, plus individual direction fields available in expanded rows.
   - `Border box` checkbox.

4. `Appearance`
   - Opacity input with percent suffix.
   - Corner Radius input with px suffix.
   - Four-corner radius fields available in expanded rows.

5. `Text`
   - Text content field remains available.
   - Font family select-like control.
   - Font weight and font size row.
   - Color mode row and color value row with swatch, hex, and opacity.
   - Line height and letter spacing row.
   - Horizontal and vertical alignment segmented controls.
   - This section appears for text-capable targets.

6. `Background`
   - Add/remove affordance.
   - Fill type control.
   - Solid color row with swatch, hex, and opacity.
   - Background image and gradient fields remain available, shown in the same section when applicable.

7. `Border`
   - Collapsed by default when no border data exists.
   - Expanded fields: position, weight, color, opacity.

8. `Shadow & Blur`
   - Collapsed by default when no shadow data exists.
   - Expanded fields: X, Y, spread, blur, color, opacity.

9. `Image Fill`
   - For image targets, image source, fill mode, and object position are shown using the same dark controls.
   - Appearance, Border, and Shadow remain available for image targets.

## Component Boundary

Create a new component family under the canvas workspace feature, with neutral naming such as:

- `DarkPropertyInspector`
- `DarkInspectorField`
- `DarkInspectorSection`
- `DarkInspectorSegmentedControl`
- `DarkInspectorColorControl`
- `DarkInspectorCheckbox`

The existing `CanvasInspectorPanel` can either become a thin adapter around this new component family or be split so the data logic stays in the adapter and presentation moves into the new files.

The preferred split:

- `CanvasInspectorPanel.tsx`
  - owns selected target, draft state, normalization, save/cancel/preview callbacks
  - passes field values and change handlers into the dark presentation component

- `DarkPropertyInspector.tsx`
  - owns layout and visual rendering only
  - no canvas bridge or HTML patch knowledge

- `dark-property-inspector-fields.tsx`
  - reusable low-level dark controls

## Data Flow

The implementation keeps the existing data flow:

1. `CanvasWorkspace` receives selection from the preview.
2. `CanvasInspectorPanel` creates a draft from `EditableNode`.
3. Dark inspector controls update draft values.
4. Draft changes call `onPreviewDraft`.
5. Save normalizes draft values into `CanvasInspectorDraft`.
6. `CanvasWorkspace` maps style keys to CSS properties and patches preview HTML.
7. Cancel resets preview and local draft.

Normalization rules remain in `CanvasInspectorPanel` unless they are split into a small local helper file. No bridge protocol changes are required.

## Styling Requirements

The panel should use local scoped utility classes and UI-system primitives where they fit. Exact visual constants:

- Panel background: near `#181818`.
- Input background: near `#242424`.
- Active segmented button: near `#343434`.
- Divider: near `#262626`.
- Primary text: near `#e0e0e0`.
- Secondary label text: near `#a8a8a8`.
- Muted text: near `#777`.
- Control radius: 6-8px depending on control type.
- Section vertical rhythm: around 18-22px between sections.
- Control height: around 34-38px.

If UI-system components fight the target styling, wrap them in local dark inspector components rather than changing the UI-system package.

## Accessibility

- Inputs keep accessible labels even when the visible UI is icon-first.
- Segmented controls use buttons with clear `aria-label` values.
- Checkbox controls use real checkbox semantics or accessible button semantics with `aria-pressed` only if necessary.
- Collapsed additive sections must expose their expanded/collapsed state.

## Testing

Update and add focused tests for:

- Dark property area renders `Design` and `CSS` tabs.
- Position section renders X, Y, Z, angle, rotate, horizontal flip, vertical flip.
- Layout renders flow buttons, dimensions, padding, clip content, margin, border box.
- Appearance renders opacity and corner radius.
- Text targets render Text fields and alignment controls.
- Generic/container targets render Background, Border, and Shadow & Blur sections.
- Image targets render Image Fill plus visual sections.
- Existing save, preview, cancel, validation, dirty tracking, and HTML patch tests continue to pass.

Validation commands:

```bash
pnpm --filter @vibe-design/web exec vitest run src/features/canvas-workspace/CanvasInspectorPanel.test.tsx src/features/canvas-workspace/CanvasWorkspace.test.tsx src/features/canvas-workspace/CanvasPreview.test.tsx
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/web build
```

## Risks

- Pixel-level fidelity may require visual iteration after implementation.
- The current field data model does not include every possible design-tool state; the UI must not imply unsupported behavior is fully functional.
- If too much logic remains in `CanvasInspectorPanel.tsx`, the file may become hard to maintain. Splitting presentation components is part of the design to control this.
- Local visual companion files live under `.superpowers/`; they should remain untracked local artifacts.

## Acceptance Criteria

- The visible property area matches the approved dark inspector direction from the browser mockup.
- No new UI, code, test, or doc identifiers use the reference product name.
- All current inspector fields remain reachable.
- Existing canvas inspect save/preview/dirty behavior still works.
- The listed validation commands pass.
