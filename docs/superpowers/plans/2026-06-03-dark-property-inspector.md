# Dark Property Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current right-side canvas inspect property form with a dense dark property inspector while preserving every existing editable field and the existing preview/save/cancel data flow.

**Architecture:** Keep `CanvasInspectorPanel` as the adapter that owns target selection, draft state, style normalization, preview dispatch, and save/cancel callbacks. Move the visual property-area rendering into a new `dark-property-inspector` component family with neutral naming. The new components render dark controls only; they do not know about the iframe bridge, HTML patching, or canvas workspace tabs.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind CSS, `@tutti-os/ui-system`

---

## Source Context

- Confirmed spec: `/Users/zhengweibin/Desktop/team-shell/vibe-design/docs/superpowers/specs/2026-06-03-dark-property-inspector-design.md`
- Product context: `/Users/zhengweibin/Desktop/team-shell/vibe-design/PRODUCT.md`
- Current adapter and normalization: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- Current workspace style bridge: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Current tests: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`

## Field Mapping

The implementation must keep these field mappings intact:

| UI group | Existing draft keys |
| --- | --- |
| Position | `positionX`, `positionY`, `positionZ`, `angle`, `flipHorizontal`, `flipVertical` |
| Layout flow | visual-only flow mode controls for this pass |
| Dimensions | `width`, `height` |
| Padding | `paddingVertical`, `paddingHorizontal`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` |
| Margin | `marginVertical`, `marginHorizontal`, `marginTop`, `marginRight`, `marginBottom`, `marginLeft` |
| Appearance | `opacity`, `borderRadius`, `radiusTopLeft`, `radiusTopRight`, `radiusBottomRight`, `radiusBottomLeft` |
| Text | `textDraft`, `fontFamily`, `fontWeight`, `fontSize`, `color`, `lineHeight`, `letterSpacing`, `textAlign`, `verticalAlign` |
| Background | `fillType`, `backgroundColor`, `backgroundOpacity`, `backgroundImage`, `backgroundGradient` |
| Border | `borderPosition`, `borderWidth`, `borderColor`, `borderOpacity` |
| Shadow & Blur | `shadowX`, `shadowY`, `shadowSpread`, `shadowBlur`, `shadowColor`, `shadowOpacity` |
| Image Fill | `imageSrc`, `objectFit`, `objectPosition` |

Strictly preserve `CanvasInspectorDraft`, `onPreviewDraft`, `onSaveDraft`, and `onCancelDraft`. Do not change the canvas bridge protocol or `INSPECTOR_STYLE_KEY_TO_CSS_PROPERTY`.

## File Structure

### Existing files to modify

- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`

### New files to create

- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/DarkPropertyInspector.tsx`
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/dark-property-inspector-fields.tsx`
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/index.ts`

### Responsibilities

- `CanvasInspectorPanel.tsx`
  - Continue owning target selection, draft state, style baseline, validation, preview dispatch, save, cancel, and helper normalization.
  - Export `CanvasInspectorStyleKey`, `CanvasInspectorStyleDraft`, and `InspectorElementType` as TypeScript types for the new presentation component.
  - Render `DarkPropertyInspector` instead of the current card-form sections.

- `DarkPropertyInspector.tsx`
  - Render the property-area layout: tabs, selected target title, sections, footer actions, empty state, and all field groups.
  - Receive values and callbacks as props.
  - Use neutral component and test names only.

- `dark-property-inspector-fields.tsx`
  - Provide reusable dark control primitives: field, color row, segmented controls, checkbox, section, icon button, unit suffix.
  - Use UI-system public icon imports when suitable. Use small local text glyphs only where UI-system has no exact icon.

- `index.ts`
  - Re-export `DarkPropertyInspector`.

## Task 1: Add Failing Tests For The Dark Property Area Contract

**Files:**
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`

- [ ] **Step 1: Replace the old grouped-panel render assertions with dark property area assertions**

Update the first three render tests so they assert the new property-area contract and no longer look for the old card-form names.

```ts
it('renders the dark property area for text targets without debug summary fields', () => {
  render(<CanvasInspectorPanel selectedTarget={target} />);

  expect(screen.getByRole('complementary', { name: 'Canvas inspector' })).toBeTruthy();
  expect(screen.getByTestId('dark-property-inspector')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'CSS' }).getAttribute('aria-selected')).toBe('false');
  expect(screen.getByText('Edit Text')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Position' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Layout' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Text' })).toBeTruthy();
  expect(screen.getByLabelText('Text content')).toBeTruthy();
  expect(screen.getByLabelText('Font family')).toBeTruthy();
  expect(screen.getByLabelText('Font weight')).toBeTruthy();
  expect(screen.getByLabelText('Font size')).toBeTruthy();
  expect(screen.getByLabelText('Color')).toBeTruthy();
  expect(screen.getByLabelText('Line height')).toBeTruthy();
  expect(screen.getByLabelText('Letter spacing')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Align text left' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Align text center' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Align text right' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Align text top' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Align text middle' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Align text bottom' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Summary' })).toBeNull();
  expect(screen.queryByText('Node ID')).toBeNull();
  expect(screen.queryByText('Tag')).toBeNull();
  expect(screen.queryByText('Class')).toBeNull();
  expect(screen.queryByText('Kind')).toBeNull();
});

it('renders every container property section in the dark property area', () => {
  render(<CanvasInspectorPanel selectedTarget={containerTarget} />);

  expect(screen.getByText('Edit section')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Position' })).toBeTruthy();
  expect(screen.getByLabelText('X position')).toBeTruthy();
  expect(screen.getByLabelText('Y position')).toBeTruthy();
  expect(screen.getByLabelText('Z position')).toBeTruthy();
  expect(screen.getByLabelText('Rotation angle')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Rotate counterclockwise' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Flip horizontal' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Flip vertical' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Layout' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Flow row' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Flow column' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Flow wrap' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Flow grid' })).toBeTruthy();
  expect(screen.getByLabelText('Width')).toBeTruthy();
  expect(screen.getByLabelText('Height')).toBeTruthy();
  expect(screen.getByLabelText('Padding vertical')).toBeTruthy();
  expect(screen.getByLabelText('Padding horizontal')).toBeTruthy();
  expect(screen.getByLabelText('Padding top')).toBeTruthy();
  expect(screen.getByLabelText('Padding right')).toBeTruthy();
  expect(screen.getByLabelText('Padding bottom')).toBeTruthy();
  expect(screen.getByLabelText('Padding left')).toBeTruthy();
  expect(screen.getByLabelText('Clip content')).toBeTruthy();
  expect(screen.getByLabelText('Margin vertical')).toBeTruthy();
  expect(screen.getByLabelText('Margin horizontal')).toBeTruthy();
  expect(screen.getByLabelText('Margin top')).toBeTruthy();
  expect(screen.getByLabelText('Margin right')).toBeTruthy();
  expect(screen.getByLabelText('Margin bottom')).toBeTruthy();
  expect(screen.getByLabelText('Margin left')).toBeTruthy();
  expect(screen.getByLabelText('Border box')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
  expect(screen.getByLabelText('Opacity')).toBeTruthy();
  expect(screen.getByLabelText('Corner radius')).toBeTruthy();
  expect(screen.getByLabelText('Corner radius top left')).toBeTruthy();
  expect(screen.getByLabelText('Corner radius top right')).toBeTruthy();
  expect(screen.getByLabelText('Corner radius bottom right')).toBeTruthy();
  expect(screen.getByLabelText('Corner radius bottom left')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Background' })).toBeTruthy();
  expect(screen.getByLabelText('Background fill type')).toBeTruthy();
  expect(screen.getByLabelText('Background color')).toBeTruthy();
  expect(screen.getByLabelText('Background opacity')).toBeTruthy();
  expect(screen.getByLabelText('Background image')).toBeTruthy();
  expect(screen.getByLabelText('Background gradient')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Toggle border controls' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Toggle shadow and blur controls' })).toBeTruthy();
});

it('renders image fill plus visual sections for image targets', () => {
  render(<CanvasInspectorPanel selectedTarget={imageTarget} />);

  expect(screen.getByText('Edit Image')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Image Fill' })).toBeTruthy();
  expect(screen.getByLabelText('Image source')).toBeTruthy();
  expect(screen.getByLabelText('Fill mode')).toBeTruthy();
  expect(screen.getByLabelText('Object position')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Background' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Toggle border controls' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Toggle shadow and blur controls' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Text' })).toBeNull();
});
```

- [ ] **Step 2: Update interaction labels used by existing behavior tests**

Replace old label names in the existing tests:

```ts
fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Updated headline' } });
```

becomes:

```ts
fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Updated headline' } });
```

Also replace:

```ts
screen.getByLabelText('Horizontal align')
screen.getByLabelText('Vertical align')
screen.getByLabelText('Radius')
screen.getByLabelText('Position X')
screen.getByLabelText('Position Y')
screen.getByLabelText('Position Z')
screen.getByLabelText('Angle')
```

with:

```ts
screen.getByRole('button', { name: 'Align text right' })
screen.getByRole('button', { name: 'Align text middle' })
screen.getByLabelText('Corner radius')
screen.getByLabelText('X position')
screen.getByLabelText('Y position')
screen.getByLabelText('Z position')
screen.getByLabelText('Rotation angle')
```

- [ ] **Step 3: Add explicit collapsed-section expansion tests**

```ts
it('expands border and shadow sections without losing field values', () => {
  render(<CanvasInspectorPanel selectedTarget={containerTarget} />);

  expect(screen.queryByLabelText('Border weight')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle border controls' }));
  expect(screen.getByLabelText('Border position')).toBeTruthy();
  expect(screen.getByLabelText('Border weight')).toBeTruthy();
  expect(screen.getByLabelText('Border color')).toBeTruthy();
  expect(screen.getByLabelText('Border opacity')).toBeTruthy();

  expect(screen.queryByLabelText('Shadow X')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle shadow and blur controls' }));
  expect(screen.getByLabelText('Shadow X')).toBeTruthy();
  expect(screen.getByLabelText('Shadow Y')).toBeTruthy();
  expect(screen.getByLabelText('Shadow spread')).toBeTruthy();
  expect(screen.getByLabelText('Shadow blur')).toBeTruthy();
  expect(screen.getByLabelText('Shadow color')).toBeTruthy();
  expect(screen.getByLabelText('Shadow opacity')).toBeTruthy();
});
```

- [ ] **Step 4: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @vibe-design/web exec vitest run src/features/canvas-workspace/CanvasInspectorPanel.test.tsx
```

Expected: FAIL because `dark-property-inspector` components and updated accessible labels do not exist yet.

- [ ] **Step 5: Commit the failing test slice only if working on a dedicated feature branch**

Do not commit unrelated dirty files. If the active branch is being used for shared work, skip this commit and continue with the next task.

```bash
git -C /Users/zhengweibin/Desktop/team-shell/vibe-design add web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx
git -C /Users/zhengweibin/Desktop/team-shell/vibe-design commit -m "test: cover dark property inspector contract"
```

## Task 2: Build Reusable Dark Inspector Field Primitives

**Files:**
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/dark-property-inspector-fields.tsx`
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/index.ts`

- [ ] **Step 1: Add the field primitives**

```tsx
// /Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/dark-property-inspector-fields.tsx
import React from 'react';
import { AddIcon, ChevronDownIcon } from '@tutti-os/ui-system/icons';

const inputBaseClass =
  'h-9 w-full rounded-[6px] border border-transparent bg-[#242424] px-3 text-[15px] font-medium text-[#e0e0e0] outline-none transition-colors placeholder:text-[#777] focus:border-[#5a88b8]';

export function DarkInspectorTabs() {
  return (
    <div role="tablist" aria-label="Inspector mode" className="flex gap-2 px-4 pt-4">
      <button
        type="button"
        role="tab"
        aria-selected="true"
        className="h-9 rounded-[7px] bg-[#343434] px-4 text-[15px] font-semibold text-[#e5e5e5]"
      >
        Design
      </button>
      <button
        type="button"
        role="tab"
        aria-selected="false"
        className="h-9 rounded-[7px] px-2 text-[15px] font-semibold text-[#8f8f8f]"
      >
        CSS
      </button>
    </div>
  );
}

export function DarkInspectorSection({
  actions,
  children,
  title,
}: {
  actions?: React.ReactNode;
  children?: React.ReactNode;
  title: string;
}) {
  return (
    <section className="border-t border-[#262626] px-4 py-5">
      <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold leading-7 text-[#e0e0e0]">{title}</h2>
        {actions ? <div className="flex items-center gap-2 text-[#aaa]">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function DarkInspectorSubheading({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-4 text-[15px] font-semibold text-[#a8a8a8]">{children}</div>;
}

export function DarkInspectorField({
  icon,
  label,
  onChange,
  placeholder,
  unit,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  unit?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span className="relative flex h-9 items-center rounded-[6px] bg-[#242424]">
        {icon ? <span className="ml-3 shrink-0 text-[#9a9a9a]">{icon}</span> : null}
        <input
          aria-label={label}
          className={`${inputBaseClass} ${icon ? 'pl-2' : ''} ${unit ? 'pr-10' : ''}`}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {unit ? <span className="pointer-events-none absolute right-3 text-[15px] font-semibold text-[#9a9a9a]">{unit}</span> : null}
      </span>
    </label>
  );
}

export function DarkInspectorTextarea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[15px] font-semibold text-[#a8a8a8]">{label}</span>
      <textarea
        aria-label={label}
        className="min-h-20 w-full resize-y rounded-[6px] border border-[#2f2f2f] bg-[#242424] px-3 py-2 text-[15px] font-medium leading-6 text-[#e0e0e0] outline-none focus:border-[#5a88b8]"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

export function DarkInspectorSelectLike({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span className="relative flex h-9 items-center rounded-[6px] border border-[#303030] bg-[#1f1f1f]">
        <input
          aria-label={label}
          className={`${inputBaseClass} border-transparent bg-transparent pr-9`}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <ChevronDownIcon aria-hidden size={16} className="pointer-events-none absolute right-3 text-[#b8b8b8]" />
      </span>
    </label>
  );
}

export function DarkInspectorColorControl({
  colorLabel,
  colorValue,
  opacityLabel,
  opacityValue,
  onColorChange,
  onOpacityChange,
}: {
  colorLabel: string;
  colorValue: string;
  opacityLabel: string;
  opacityValue: string;
  onColorChange: (value: string) => void;
  onOpacityChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_72px] overflow-hidden rounded-[6px] border border-[#303030] bg-[#1f1f1f]">
      <label className="flex h-9 min-w-0 items-center gap-3 px-3">
        <span aria-hidden className="h-5 w-5 shrink-0 rounded-[5px] border border-[#3a3a3a]" style={{ backgroundColor: colorValue || '#000000' }} />
        <span className="sr-only">{colorLabel}</span>
        <input
          aria-label={colorLabel}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#e0e0e0] outline-none"
          value={colorValue}
          onChange={(event) => onColorChange(event.currentTarget.value)}
        />
      </label>
      <label className="flex h-9 items-center border-l border-[#303030] px-3">
        <span className="sr-only">{opacityLabel}</span>
        <input
          aria-label={opacityLabel}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#e0e0e0] outline-none"
          value={opacityValue}
          onChange={(event) => onOpacityChange(event.currentTarget.value)}
        />
        <span className="ml-1 text-[15px] font-semibold text-[#9a9a9a]">%</span>
      </label>
    </div>
  );
}

export function DarkInspectorSegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; value: string; icon: React.ReactNode }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          className={`flex h-9 items-center justify-center rounded-[6px] text-[#b8b8b8] ${value === option.value ? 'bg-[#343434]' : 'bg-[#242424] hover:bg-[#2d2d2d]'}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

export function DarkInspectorCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-3 text-[17px] font-medium text-[#b8b8b8]">
      <input
        aria-label={label}
        className="h-5 w-5 rounded border border-[#3b3b3b] bg-[#242424] accent-[#9eb9d5]"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function DarkInspectorToggleSection({
  children,
  defaultOpen = false,
  title,
  toggleLabel,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
  toggleLabel: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border-t border-[#262626] px-4 py-5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={toggleLabel}
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-[20px] font-semibold leading-7 text-[#a8a8a8]">{title}</span>
        {open ? <ChevronDownIcon aria-hidden size={18} className="text-[#a8a8a8]" /> : <AddIcon aria-hidden size={20} className="text-[#8f8f8f]" />}
      </button>
      {open ? <div className="mt-4 space-y-4">{children}</div> : null}
    </section>
  );
}
```

- [ ] **Step 2: Add the barrel export**

```ts
// /Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/index.ts
export { DarkPropertyInspector } from './DarkPropertyInspector';
```

- [ ] **Step 3: Run type-check and verify it fails on the missing main component only**

Run:

```bash
pnpm --filter @vibe-design/web type-check
```

Expected: FAIL because `DarkPropertyInspector.tsx` has not been created yet and the barrel export points to it.

## Task 3: Implement The Dark Property Inspector Presentation

**Files:**
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/DarkPropertyInspector.tsx`

- [ ] **Step 1: Create the component props and layout skeleton**

```tsx
// /Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/dark-property-inspector/DarkPropertyInspector.tsx
import React from 'react';
import {
  DarkInspectorCheckbox,
  DarkInspectorColorControl,
  DarkInspectorField,
  DarkInspectorSection,
  DarkInspectorSegmentedControl,
  DarkInspectorSelectLike,
  DarkInspectorSubheading,
  DarkInspectorTabs,
  DarkInspectorTextarea,
  DarkInspectorToggleSection,
} from './dark-property-inspector-fields';
import type { CanvasInspectorStyleKey, InspectorElementType } from '../CanvasInspectorPanel';

type StyleDraft = Record<CanvasInspectorStyleKey, string>;

export interface DarkPropertyInspectorProps {
  activeTargetTitle: string;
  canSave: boolean;
  elementType: InspectorElementType;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
  onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void;
  onTextChange: (value: string) => void;
  selected: boolean;
  styleDraft: StyleDraft;
  targetList?: Array<{ id: string; label: string; tagName: string }>;
  textDraft: string;
}

export function DarkPropertyInspector({
  activeTargetTitle,
  canSave,
  elementType,
  error,
  onCancel,
  onSave,
  onStyleChange,
  onTextChange,
  selected,
  styleDraft,
  targetList = [],
  textDraft,
}: DarkPropertyInspectorProps) {
  return (
    <aside aria-label="Canvas inspector" className="h-full min-h-0 bg-[#181818] text-[#e0e0e0]">
      <div data-testid="dark-property-inspector" className="flex h-full min-h-0 flex-col">
        <DarkInspectorTabs />
        <div className="min-h-0 flex-1 overflow-auto">
          {selected ? (
            <>
              <div className="px-4 pb-2 pt-4 text-[17px] font-semibold leading-6 text-[#e0e0e0]">{activeTargetTitle}</div>
              <PositionSection styleDraft={styleDraft} onStyleChange={onStyleChange} />
              <LayoutSection styleDraft={styleDraft} onStyleChange={onStyleChange} />
              <AppearanceSection styleDraft={styleDraft} onStyleChange={onStyleChange} />
              {elementType === 'text' ? (
                <TextSection textDraft={textDraft} styleDraft={styleDraft} onTextChange={onTextChange} onStyleChange={onStyleChange} />
              ) : null}
              {elementType === 'image' ? <ImageFillSection styleDraft={styleDraft} onStyleChange={onStyleChange} /> : null}
              <BackgroundSection styleDraft={styleDraft} onStyleChange={onStyleChange} />
              <BorderSection styleDraft={styleDraft} onStyleChange={onStyleChange} />
              <ShadowSection styleDraft={styleDraft} onStyleChange={onStyleChange} />
              {error ? <p role="alert" className="px-4 pb-4 text-sm text-[#ff9d9d]">{error}</p> : null}
            </>
          ) : (
            <EmptyInspectorState targetList={targetList} />
          )}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#262626] bg-[#181818] px-4 py-4">
          <button type="button" className="h-9 rounded-[6px] bg-[#2a2a2a] px-4 text-[15px] font-semibold text-[#e0e0e0]" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="h-9 rounded-[6px] bg-[#f5f5f5] px-4 text-[15px] font-semibold text-[#111] disabled:opacity-40"
            disabled={!canSave}
            onClick={onSave}
          >
            Save
          </button>
        </footer>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add local utility icons and value helpers below the component**

```tsx
function IconText({ children }: { children: React.ReactNode }) {
  return <span aria-hidden className="inline-flex min-w-4 justify-center text-[15px] font-semibold text-[#8f8f8f]">{children}</span>;
}

function setStyle(onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void, key: CanvasInspectorStyleKey) {
  return (value: string) => onStyleChange(key, value);
}

function booleanValue(value: string): boolean {
  return value === 'true';
}

function nextBooleanValue(checked: boolean): string {
  return checked ? 'true' : 'false';
}
```

- [ ] **Step 3: Add the Position and Layout sections**

```tsx
function PositionSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void;
  styleDraft: StyleDraft;
}) {
  return (
    <DarkInspectorSection title="Position">
      <div className="grid grid-cols-3 gap-3">
        <DarkInspectorField label="X position" icon={<IconText>X</IconText>} unit="px" value={styleDraft.positionX} onChange={setStyle(onStyleChange, 'positionX')} />
        <DarkInspectorField label="Y position" icon={<IconText>Y</IconText>} unit="px" value={styleDraft.positionY} onChange={setStyle(onStyleChange, 'positionY')} />
        <DarkInspectorField label="Z position" icon={<IconText>Z</IconText>} value={styleDraft.positionZ} onChange={setStyle(onStyleChange, 'positionZ')} />
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] gap-3">
        <DarkInspectorField label="Rotation angle" icon={<IconText>∠</IconText>} unit="°" value={styleDraft.angle} onChange={setStyle(onStyleChange, 'angle')} />
        <button type="button" aria-label="Rotate counterclockwise" className="h-9 w-9 rounded-[6px] bg-[#181818] text-[#aaa]" onClick={() => onStyleChange('angle', String((Number(styleDraft.angle) || 0) - 90))}>↶</button>
        <button type="button" aria-label="Flip horizontal" className="h-9 w-9 rounded-[6px] bg-[#181818] text-[#aaa]" onClick={() => onStyleChange('flipHorizontal', nextBooleanValue(!booleanValue(styleDraft.flipHorizontal)))}>⇆</button>
        <button type="button" aria-label="Flip vertical" className="h-9 w-9 rounded-[6px] bg-[#181818] text-[#aaa]" onClick={() => onStyleChange('flipVertical', nextBooleanValue(!booleanValue(styleDraft.flipVertical)))}>⇅</button>
      </div>
    </DarkInspectorSection>
  );
}

function LayoutSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void;
  styleDraft: StyleDraft;
}) {
  return (
    <DarkInspectorSection title="Layout">
      <DarkInspectorSubheading>Flow</DarkInspectorSubheading>
      <DarkInspectorSegmentedControl
        value="row"
        onChange={() => undefined}
        options={[
          { label: 'Flow row', value: 'row', icon: <IconText>▦</IconText> },
          { label: 'Flow column', value: 'column', icon: <IconText>▥</IconText> },
          { label: 'Flow wrap', value: 'wrap', icon: <IconText>↳</IconText> },
          { label: 'Flow grid', value: 'grid', icon: <IconText>▩</IconText> },
        ]}
      />
      <DarkInspectorSubheading>Dimensions</DarkInspectorSubheading>
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorField label="Width" icon={<IconText>W</IconText>} unit="px" value={styleDraft.width} onChange={setStyle(onStyleChange, 'width')} />
        <DarkInspectorField label="Height" icon={<IconText>H</IconText>} unit="px" value={styleDraft.height} onChange={setStyle(onStyleChange, 'height')} />
      </div>
      <DarkInspectorSubheading>Padding</DarkInspectorSubheading>
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorField label="Padding vertical" icon={<IconText>▭</IconText>} unit="px" value={styleDraft.paddingVertical} onChange={setStyle(onStyleChange, 'paddingVertical')} />
        <DarkInspectorField label="Padding horizontal" icon={<IconText>▯</IconText>} unit="px" value={styleDraft.paddingHorizontal} onChange={setStyle(onStyleChange, 'paddingHorizontal')} />
        <DarkInspectorField label="Padding top" unit="px" value={styleDraft.paddingTop} onChange={setStyle(onStyleChange, 'paddingTop')} />
        <DarkInspectorField label="Padding right" unit="px" value={styleDraft.paddingRight} onChange={setStyle(onStyleChange, 'paddingRight')} />
        <DarkInspectorField label="Padding bottom" unit="px" value={styleDraft.paddingBottom} onChange={setStyle(onStyleChange, 'paddingBottom')} />
        <DarkInspectorField label="Padding left" unit="px" value={styleDraft.paddingLeft} onChange={setStyle(onStyleChange, 'paddingLeft')} />
      </div>
      <div className="mt-4"><DarkInspectorCheckbox label="Clip content" checked={false} onChange={() => undefined} /></div>
      <DarkInspectorSubheading>Margin</DarkInspectorSubheading>
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorField label="Margin vertical" icon={<IconText>▭</IconText>} unit="px" value={styleDraft.marginVertical} onChange={setStyle(onStyleChange, 'marginVertical')} />
        <DarkInspectorField label="Margin horizontal" icon={<IconText>▯</IconText>} unit="px" value={styleDraft.marginHorizontal} onChange={setStyle(onStyleChange, 'marginHorizontal')} />
        <DarkInspectorField label="Margin top" unit="px" value={styleDraft.marginTop} onChange={setStyle(onStyleChange, 'marginTop')} />
        <DarkInspectorField label="Margin right" unit="px" value={styleDraft.marginRight} onChange={setStyle(onStyleChange, 'marginRight')} />
        <DarkInspectorField label="Margin bottom" unit="px" value={styleDraft.marginBottom} onChange={setStyle(onStyleChange, 'marginBottom')} />
        <DarkInspectorField label="Margin left" unit="px" value={styleDraft.marginLeft} onChange={setStyle(onStyleChange, 'marginLeft')} />
      </div>
      <div className="mt-4"><DarkInspectorCheckbox label="Border box" checked={false} onChange={() => undefined} /></div>
    </DarkInspectorSection>
  );
}
```

- [ ] **Step 4: Add the Appearance, Text, Background, Border, Shadow, Image, and Empty sections**

```tsx
function AppearanceSection({ onStyleChange, styleDraft }: { onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void; styleDraft: StyleDraft }) {
  return (
    <DarkInspectorSection title="Appearance">
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorField label="Opacity" icon={<IconText>◉</IconText>} unit="%" value={styleDraft.opacity} onChange={setStyle(onStyleChange, 'opacity')} />
        <DarkInspectorField label="Corner radius" icon={<IconText>▢</IconText>} unit="px" value={styleDraft.borderRadius} onChange={setStyle(onStyleChange, 'borderRadius')} />
        <DarkInspectorField label="Corner radius top left" unit="px" value={styleDraft.radiusTopLeft} onChange={setStyle(onStyleChange, 'radiusTopLeft')} />
        <DarkInspectorField label="Corner radius top right" unit="px" value={styleDraft.radiusTopRight} onChange={setStyle(onStyleChange, 'radiusTopRight')} />
        <DarkInspectorField label="Corner radius bottom right" unit="px" value={styleDraft.radiusBottomRight} onChange={setStyle(onStyleChange, 'radiusBottomRight')} />
        <DarkInspectorField label="Corner radius bottom left" unit="px" value={styleDraft.radiusBottomLeft} onChange={setStyle(onStyleChange, 'radiusBottomLeft')} />
      </div>
    </DarkInspectorSection>
  );
}

function TextSection({
  onStyleChange,
  onTextChange,
  styleDraft,
  textDraft,
}: {
  onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void;
  onTextChange: (value: string) => void;
  styleDraft: StyleDraft;
  textDraft: string;
}) {
  return (
    <DarkInspectorSection title="Text">
      <DarkInspectorTextarea label="Text content" value={textDraft} onChange={onTextChange} />
      <DarkInspectorSubheading>Font</DarkInspectorSubheading>
      <DarkInspectorSelectLike label="Font family" value={styleDraft.fontFamily} onChange={setStyle(onStyleChange, 'fontFamily')} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <DarkInspectorSelectLike label="Font weight" value={styleDraft.fontWeight} onChange={setStyle(onStyleChange, 'fontWeight')} />
        <DarkInspectorField label="Font size" unit="px" value={styleDraft.fontSize} onChange={setStyle(onStyleChange, 'fontSize')} />
      </div>
      <DarkInspectorSubheading>Color</DarkInspectorSubheading>
      <DarkInspectorSelectLike label="Text color fill type" value="Solid" onChange={() => undefined} />
      <div className="mt-3">
        <DarkInspectorColorControl
          colorLabel="Color"
          colorValue={styleDraft.color}
          opacityLabel="Color opacity"
          opacityValue="100"
          onColorChange={setStyle(onStyleChange, 'color')}
          onOpacityChange={() => undefined}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <DarkInspectorField label="Line height" icon={<IconText>AI</IconText>} value={styleDraft.lineHeight} onChange={setStyle(onStyleChange, 'lineHeight')} />
        <DarkInspectorField label="Letter spacing" icon={<IconText>Abc</IconText>} value={styleDraft.letterSpacing} onChange={setStyle(onStyleChange, 'letterSpacing')} />
      </div>
      <DarkInspectorSubheading>Alignment</DarkInspectorSubheading>
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorSegmentedControl
          value={styleDraft.textAlign}
          onChange={(value) => onStyleChange('textAlign', value)}
          options={[
            { label: 'Align text left', value: 'left', icon: <IconText>≡</IconText> },
            { label: 'Align text center', value: 'center', icon: <IconText>≣</IconText> },
            { label: 'Align text right', value: 'right', icon: <IconText>≡</IconText> },
          ]}
        />
        <DarkInspectorSegmentedControl
          value={styleDraft.verticalAlign}
          onChange={(value) => onStyleChange('verticalAlign', value)}
          options={[
            { label: 'Align text top', value: 'top', icon: <IconText>↑</IconText> },
            { label: 'Align text middle', value: 'middle', icon: <IconText>↕</IconText> },
            { label: 'Align text bottom', value: 'bottom', icon: <IconText>↓</IconText> },
          ]}
        />
      </div>
    </DarkInspectorSection>
  );
}

function BackgroundSection({ onStyleChange, styleDraft }: { onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void; styleDraft: StyleDraft }) {
  return (
    <DarkInspectorSection title="Background" actions={<button type="button" aria-label="Add background fill" className="text-[22px] text-[#8f8f8f]">+</button>}>
      <DarkInspectorSelectLike label="Background fill type" value={styleDraft.fillType} onChange={setStyle(onStyleChange, 'fillType')} />
      <div className="mt-3">
        <DarkInspectorColorControl
          colorLabel="Background color"
          colorValue={styleDraft.backgroundColor}
          opacityLabel="Background opacity"
          opacityValue={styleDraft.backgroundOpacity}
          onColorChange={setStyle(onStyleChange, 'backgroundColor')}
          onOpacityChange={setStyle(onStyleChange, 'backgroundOpacity')}
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <DarkInspectorField label="Background image" value={styleDraft.backgroundImage} onChange={setStyle(onStyleChange, 'backgroundImage')} />
        <DarkInspectorField label="Background gradient" value={styleDraft.backgroundGradient} onChange={setStyle(onStyleChange, 'backgroundGradient')} />
      </div>
    </DarkInspectorSection>
  );
}

function BorderSection({ onStyleChange, styleDraft }: { onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void; styleDraft: StyleDraft }) {
  return (
    <DarkInspectorToggleSection title="Border" toggleLabel="Toggle border controls">
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorSelectLike label="Border position" value={styleDraft.borderPosition} onChange={setStyle(onStyleChange, 'borderPosition')} />
        <DarkInspectorField label="Border weight" unit="px" value={styleDraft.borderWidth} onChange={setStyle(onStyleChange, 'borderWidth')} />
      </div>
      <DarkInspectorColorControl
        colorLabel="Border color"
        colorValue={styleDraft.borderColor}
        opacityLabel="Border opacity"
        opacityValue={styleDraft.borderOpacity}
        onColorChange={setStyle(onStyleChange, 'borderColor')}
        onOpacityChange={setStyle(onStyleChange, 'borderOpacity')}
      />
    </DarkInspectorToggleSection>
  );
}

function ShadowSection({ onStyleChange, styleDraft }: { onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void; styleDraft: StyleDraft }) {
  return (
    <DarkInspectorToggleSection title="Shadow & Blur" toggleLabel="Toggle shadow and blur controls">
      <div className="grid grid-cols-2 gap-3">
        <DarkInspectorField label="Shadow X" unit="px" value={styleDraft.shadowX} onChange={setStyle(onStyleChange, 'shadowX')} />
        <DarkInspectorField label="Shadow Y" unit="px" value={styleDraft.shadowY} onChange={setStyle(onStyleChange, 'shadowY')} />
        <DarkInspectorField label="Shadow spread" unit="px" value={styleDraft.shadowSpread} onChange={setStyle(onStyleChange, 'shadowSpread')} />
        <DarkInspectorField label="Shadow blur" unit="px" value={styleDraft.shadowBlur} onChange={setStyle(onStyleChange, 'shadowBlur')} />
      </div>
      <DarkInspectorColorControl
        colorLabel="Shadow color"
        colorValue={styleDraft.shadowColor}
        opacityLabel="Shadow opacity"
        opacityValue={styleDraft.shadowOpacity}
        onColorChange={setStyle(onStyleChange, 'shadowColor')}
        onOpacityChange={setStyle(onStyleChange, 'shadowOpacity')}
      />
    </DarkInspectorToggleSection>
  );
}

function ImageFillSection({ onStyleChange, styleDraft }: { onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void; styleDraft: StyleDraft }) {
  return (
    <DarkInspectorSection title="Image Fill">
      <DarkInspectorField label="Image source" value={styleDraft.imageSrc} onChange={setStyle(onStyleChange, 'imageSrc')} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <DarkInspectorSelectLike label="Fill mode" value={styleDraft.objectFit} onChange={setStyle(onStyleChange, 'objectFit')} />
        <DarkInspectorField label="Object position" value={styleDraft.objectPosition} onChange={setStyle(onStyleChange, 'objectPosition')} />
      </div>
    </DarkInspectorSection>
  );
}

function EmptyInspectorState({ targetList }: { targetList: Array<{ id: string; label: string; tagName: string }> }) {
  return (
    <div className="space-y-4 px-4 py-5">
      <p className="text-[15px] leading-6 text-[#a8a8a8]">Select a node in inspect mode to start editing.</p>
      {targetList.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[13px] font-semibold text-[#8f8f8f]">Editable nodes</div>
          {targetList.map((target) => (
            <div key={target.id} className="rounded-[6px] border border-[#2f2f2f] bg-[#202020] px-3 py-2">
              <div className="truncate text-[14px] font-semibold text-[#e0e0e0]">{target.label}</div>
              <div className="mt-1 truncate text-[12px] text-[#8f8f8f]">{target.tagName}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run type-check and focused tests**

Run:

```bash
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/web exec vitest run src/features/canvas-workspace/CanvasInspectorPanel.test.tsx
```

Expected: type-check may still fail until `CanvasInspectorPanel.tsx` exports the referenced types and renders the new component. The focused test should still fail because the adapter has not been wired yet.

## Task 4: Wire CanvasInspectorPanel As The Adapter

**Files:**
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`

- [ ] **Step 1: Replace UI-system card imports with the dark inspector import**

Change the import block from:

```tsx
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from '@tutti-os/ui-system/components';
```

to:

```tsx
import { DarkPropertyInspector } from './dark-property-inspector';
```

- [ ] **Step 2: Export the shared presentation types**

Change:

```ts
type CanvasInspectorStyleKey =
```

to:

```ts
export type CanvasInspectorStyleKey =
```

Change:

```ts
type CanvasInspectorStyleDraft = Partial<Record<CanvasInspectorStyleKey, string>>;
```

to:

```ts
export type CanvasInspectorStyleDraft = Partial<Record<CanvasInspectorStyleKey, string>>;
```

Change:

```ts
type InspectorElementType = 'text' | 'image' | 'generic';
```

to:

```ts
export type InspectorElementType = 'text' | 'image' | 'generic';
```

- [ ] **Step 3: Add a stable style change adapter inside `CanvasInspectorPanel`**

Place this function near `saveDraft()` and `cancelDraft()`:

```tsx
function updateStyleDraft(key: CanvasInspectorStyleKey, value: string) {
  setStyleDraftValue(key, value, setStyleDraft);
}
```

- [ ] **Step 4: Replace the old return JSX with the dark presentation component**

Replace the whole `return (` block in `CanvasInspectorPanel` with:

```tsx
  return (
    <DarkPropertyInspector
      activeTargetTitle={activeTarget ? inspectorTitle(activeTarget, elementType) : 'Edit element'}
      canSave={Boolean(activeTarget)}
      elementType={elementType}
      error={styleError}
      onCancel={cancelDraft}
      onSave={saveDraft}
      onStyleChange={updateStyleDraft}
      onTextChange={setTextDraft}
      selected={Boolean(activeTarget)}
      styleDraft={styleDraft}
      targetList={targets.map((target) => ({
        id: target.id,
        label: target.label,
        tagName: target.tagName,
      }))}
      textDraft={textDraft}
    />
  );
```

- [ ] **Step 5: Delete obsolete local presentation helpers**

Remove these obsolete functions and interfaces from `CanvasInspectorPanel.tsx` after the adapter is wired:

```ts
function ElementViewSection(...)
function TypographyInspectorSection(...)
function ImageInspectorPanel(...)
function BackgroundInspectorSection(...)
function AppearanceInspectorSection(...)
function BorderInspectorSection(...)
function ShadowInspectorSection(...)
function SizeLayoutInspectorSection(...)
interface InspectorFieldProps
function InspectorField(...)
function InspectorGroupLabel(...)
function InspectorTwoColumnGrid(...)
function InspectorThreeColumnGrid(...)
```

Keep every normalization helper starting at `normalizeCanvasInspectorStyles()` and every helper it calls.

- [ ] **Step 6: Run type-check and fix only adapter/presentation compile errors**

Run:

```bash
pnpm --filter @vibe-design/web type-check
```

Expected: PASS. If it fails, fix only import paths, exported type names, or removed helper references.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @vibe-design/web exec vitest run src/features/canvas-workspace/CanvasInspectorPanel.test.tsx
```

Expected: PASS for all inspector tests after label updates.

## Task 5: Preserve Existing Behavior Through Integration Tests

**Files:**
- Modify if needed: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`
- Do not modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx` unless a test proves the style bridge is broken.

- [ ] **Step 1: Add or update one preview-callback test for segmented alignment**

```ts
it('reports segmented text alignment changes through the preview callback', () => {
  const onPreviewDraft = vi.fn();

  render(<CanvasInspectorPanel selectedTarget={target} onPreviewDraft={onPreviewDraft} />);
  onPreviewDraft.mockClear();

  fireEvent.click(screen.getByRole('button', { name: 'Align text right' }));
  fireEvent.click(screen.getByRole('button', { name: 'Align text middle' }));

  expect(onPreviewDraft).toHaveBeenLastCalledWith({
    id: 'hero-title',
    styles: {
      textAlign: 'right',
      verticalAlign: 'middle',
    },
  });
});
```

- [ ] **Step 2: Update the existing save test for alignment controls**

Use button clicks instead of direct text input:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Align text right' }));
fireEvent.click(screen.getByRole('button', { name: 'Align text middle' }));
fireEvent.click(screen.getByRole('button', { name: 'Save' }));
```

Keep the existing expected draft:

```ts
expect(onSave).toHaveBeenCalledWith({
  id: 'hero-title',
  styles: {
    textAlign: 'right',
    verticalAlign: 'middle',
  },
});
```

- [ ] **Step 3: Run the inspector/workspace/preview regression suite**

Run:

```bash
pnpm --filter @vibe-design/web exec vitest run src/features/canvas-workspace/CanvasInspectorPanel.test.tsx src/features/canvas-workspace/CanvasWorkspace.test.tsx src/features/canvas-workspace/CanvasPreview.test.tsx
```

Expected: PASS. If a workspace test fails because of accessible-label changes only, update the test query. If it fails because `CanvasInspectorDraft` changed shape, revert the protocol change and keep the old draft contract.

- [ ] **Step 4: Commit the implementation slice only if working on a dedicated feature branch**

Do not commit unrelated dirty files. If the branch contains user work that should remain unstaged, skip this commit.

```bash
git -C /Users/zhengweibin/Desktop/team-shell/vibe-design add \
  web/src/features/canvas-workspace/CanvasInspectorPanel.tsx \
  web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx \
  web/src/features/canvas-workspace/dark-property-inspector/DarkPropertyInspector.tsx \
  web/src/features/canvas-workspace/dark-property-inspector/dark-property-inspector-fields.tsx \
  web/src/features/canvas-workspace/dark-property-inspector/index.ts
git -C /Users/zhengweibin/Desktop/team-shell/vibe-design commit -m "feat: add dark property inspector"
```

## Task 6: Browser Visual Verification And Final Gates

**Files:**
- No planned source changes. If visual issues are found, modify only the new `dark-property-inspector` component files.

- [ ] **Step 1: Run full web checks**

Run:

```bash
pnpm --filter @vibe-design/web type-check
pnpm --filter @vibe-design/web test
pnpm --filter @vibe-design/web build
```

Expected: all commands PASS.

- [ ] **Step 2: Open the current local app in the in-app browser**

Use the existing browser URL if it is still running:

```text
http://localhost:64882/
```

If the server is no longer available, start the existing app dev command from `/Users/zhengweibin/Desktop/team-shell/vibe-design` and use the printed local URL.

- [ ] **Step 3: Verify the property area visually**

Check the generated-file inspect mode with a selected node:

- Right panel is a continuous dark surface, not a white card.
- `Design` tab is active and `CSS` is muted.
- The section order is `Position`, `Layout`, `Appearance`, `Text` when a text node is selected.
- Container/image targets show their applicable sections while keeping `Background`, `Border`, and `Shadow & Blur`.
- All controls fit inside the right panel at the current browser width.
- Text does not overlap icons, suffixes, or neighboring controls.
- Save and Cancel remain visible at the bottom.
- No UI text contains the external reference product name.

- [ ] **Step 4: Run the neutral-name scan**

Run:

```bash
blocked_terms=(
  "$(printf 'cur%s' 'sor')"
  "$(printf 'T%s' 'BD')"
  "$(printf 'T%s' 'ODO')"
  "$(printf 'implement %s' 'later')"
  "$(printf 'fill %s' 'in')"
  "$(printf 'appropr%s' 'iate')"
)
pattern="$(IFS='|'; printf '%s' "${blocked_terms[*]}")"
rg -n -i "$pattern" \
  /Users/zhengweibin/Desktop/team-shell/vibe-design/docs/superpowers/plans/2026-06-03-dark-property-inspector.md \
  /Users/zhengweibin/Desktop/team-shell/vibe-design/docs/superpowers/specs/2026-06-03-dark-property-inspector-design.md \
  /Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace
```

Expected: no matches. If existing unrelated code has a match, inspect it before changing anything and only edit if it belongs to this inspector work.

- [ ] **Step 5: Capture final git status**

Run:

```bash
git -C /Users/zhengweibin/Desktop/team-shell/vibe-design status --short
```

Expected: only planned files are modified by this task, plus pre-existing unrelated dirty files. Do not revert unrelated dirty files.

## Completion Notes

At handoff, report:

- Root cause of the current mismatch: the existing inspector renders a generic card-style form and debug-era section hierarchy instead of a dense design-tool property area.
- What changed: new dark presentation component family, adapter wiring, updated tests.
- Preserved protocol: `CanvasInspectorDraft`, preview/save/cancel callbacks, style normalization, and workspace CSS property mapping.
- UI-system usage: global `@tutti-os/ui-system/styles.css` is already imported by `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/styles.css`; the new panel uses UI-system public icons where available and local dark controls for the unsupported dense inspector control vocabulary.
- Verification results: exact commands and PASS/FAIL output.
- Residual risk: visual fidelity may need one browser iteration after screenshots, especially icon shape and spacing details.
