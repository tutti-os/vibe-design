// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasInspectorPanel, normalizeCanvasInspectorStyles } from './CanvasInspectorPanel';
import type { EditableNode } from './canvas-edit/types';

const target: EditableNode = {
  id: 'hero-title',
  kind: 'text',
  label: 'Hero Title',
  tagName: 'h1',
  className: 'hero',
  text: 'Original',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Original' },
  attributes: { 'data-vd-id': 'hero-title' },
  styles: {},
  isLayoutContainer: false,
  depth: 0,
  classList: ['hero'],
  selector: 'h1.hero',
  editable: true,
  childCount: 0,
};

const secondaryTarget: EditableNode = {
  ...target,
  id: 'hero-subtitle',
  label: 'Hero Subtitle',
  tagName: 'p',
  text: 'Subtitle',
  fields: { text: 'Subtitle' },
  attributes: { 'data-vd-id': 'hero-subtitle' },
  selector: 'p',
};

const containerTarget: EditableNode = {
  ...target,
  id: 'alarm-card',
  kind: 'container',
  label: 'Next alarm card',
  tagName: 'section',
  className: 'summary',
  text: 'Next alarm 07:20 Tomorrow',
  fields: { text: 'Next alarm 07:20 Tomorrow' },
  styles: {
    backgroundColor: '#f8fafc',
    opacity: '0.92',
    borderRadius: '18px',
    paddingTop: '16px',
    paddingRight: '20px',
    paddingBottom: '16px',
    paddingLeft: '20px',
    width: '358px',
    height: '92px',
    position: 'relative',
    left: '24px',
    top: '32px',
    zIndex: '2',
    borderWidth: '1px',
    borderColor: '#dbeafe',
    boxShadow: '0px 8px 24px 0px #1d4ed8',
  },
  isLayoutContainer: true,
};

const rgbContainerTarget: EditableNode = {
  ...containerTarget,
  styles: {
    ...containerTarget.styles,
    backgroundColor: 'rgb(248, 250, 252)',
    borderColor: 'rgba(219, 234, 254, 0.8)',
  },
};

const rgbaContainerTarget: EditableNode = {
  ...containerTarget,
  styles: {
    ...containerTarget.styles,
    color: 'rgb(17, 24, 39)',
    backgroundColor: 'rgba(248, 250, 252, 0.5)',
    borderColor: 'rgba(219, 234, 254, 0.8)',
  },
};

const rectOnlyContainerTarget: EditableNode = {
  ...containerTarget,
  rect: { x: -35, y: 12, width: 386, height: 674 },
  styles: {
    backgroundColor: '#f8fafc',
    position: 'relative',
  },
};

const rgbaShadowTarget: EditableNode = {
  ...containerTarget,
  styles: {
    ...containerTarget.styles,
    boxShadow: '0px 8px 24px 0px rgba(29, 78, 216, 0.25)',
  },
};

const computedRgbaShadowTarget: EditableNode = {
  ...containerTarget,
  styles: {
    ...containerTarget.styles,
    boxShadow: 'rgba(29, 78, 216, 0.25) 0px 8px 24px 0px',
  },
};

const imageTarget: EditableNode = {
  ...target,
  id: 'hero-image',
  kind: 'image',
  label: 'Hero image',
  tagName: 'img',
  className: 'hero-image',
  text: '',
  fields: {},
  attributes: { src: '/hero.png', 'data-vd-id': 'hero-image' },
  styles: {
    src: '/hero.png',
    objectFit: 'cover',
    objectPosition: 'center',
    opacity: '0.8',
    borderRadius: '12px',
    borderWidth: '1px',
    borderColor: '#111111',
    boxShadow: '0px 4px 16px 0px #000000',
  },
};

type NormalizeStyles = Parameters<typeof normalizeCanvasInspectorStyles>[0];

const shadowDraft: NormalizeStyles = {
  shadowX: '2',
  shadowY: '4',
  shadowBlur: '8',
  shadowSpread: '1',
  shadowColor: '#112233',
  shadowOpacity: '50',
};

const editableNormalizationCases: Array<{
  name: string;
  styles: NormalizeStyles;
  fullDraft?: NormalizeStyles;
  expected: Record<string, string>;
}> = [
  { name: 'font family', styles: { fontFamily: 'Inter' }, expected: { fontFamily: 'Inter' } },
  { name: 'font size', styles: { fontSize: '18' }, expected: { fontSize: '18px' } },
  { name: 'text color', styles: { color: '#112233' }, expected: { color: '#112233' } },
  { name: 'background color', styles: { backgroundColor: '#ffffff' }, expected: { backgroundColor: '#ffffff' } },
  {
    name: 'background opacity',
    styles: { backgroundOpacity: '40' },
    fullDraft: { backgroundColor: '#112233', backgroundOpacity: '40' },
    expected: { backgroundColor: 'rgba(17, 34, 51, 0.4)' },
  },
  { name: 'background image', styles: { backgroundImage: 'url(/hero.png)' }, expected: { backgroundImage: 'url(/hero.png)' } },
  {
    name: 'background gradient',
    styles: { backgroundGradient: 'linear-gradient(red, blue)' },
    expected: { backgroundImage: 'linear-gradient(red, blue)' },
  },
  {
    name: 'background image replacing an existing gradient',
    styles: { backgroundImage: 'url("/hero.png")', backgroundGradient: '' },
    fullDraft: { fillType: 'image', backgroundImage: 'url("/hero.png")', backgroundGradient: '' },
    expected: { backgroundImage: 'url("/hero.png")' },
  },
  { name: 'font weight', styles: { fontWeight: '700' }, expected: { fontWeight: '700' } },
  { name: 'line height', styles: { lineHeight: '1.4' }, expected: { lineHeight: '1.4' } },
  { name: 'letter spacing', styles: { letterSpacing: '1.5' }, expected: { letterSpacing: '1.5px' } },
  { name: 'text align', styles: { textAlign: 'center' }, expected: { textAlign: 'center' } },
  { name: 'vertical align', styles: { verticalAlign: 'middle' }, expected: { verticalAlign: 'middle' } },
  { name: 'object fit', styles: { objectFit: 'contain' }, expected: { objectFit: 'contain' } },
  { name: 'object position', styles: { objectPosition: 'top left' }, expected: { objectPosition: 'top left' } },
  { name: 'padding vertical', styles: { paddingVertical: '12' }, expected: { paddingTop: '12px', paddingBottom: '12px' } },
  { name: 'padding horizontal', styles: { paddingHorizontal: '14' }, expected: { paddingLeft: '14px', paddingRight: '14px' } },
  { name: 'padding top', styles: { paddingTop: '2' }, expected: { paddingTop: '2px' } },
  { name: 'padding right', styles: { paddingRight: '4' }, expected: { paddingRight: '4px' } },
  { name: 'padding bottom', styles: { paddingBottom: '6' }, expected: { paddingBottom: '6px' } },
  { name: 'padding left', styles: { paddingLeft: '8' }, expected: { paddingLeft: '8px' } },
  { name: 'margin vertical', styles: { marginVertical: '10' }, expected: { marginTop: '10px', marginBottom: '10px' } },
  { name: 'margin horizontal', styles: { marginHorizontal: '12' }, expected: { marginLeft: '12px', marginRight: '12px' } },
  { name: 'margin top', styles: { marginTop: '2' }, expected: { marginTop: '2px' } },
  { name: 'margin right', styles: { marginRight: '4' }, expected: { marginRight: '4px' } },
  { name: 'margin bottom', styles: { marginBottom: '6' }, expected: { marginBottom: '6px' } },
  { name: 'margin left', styles: { marginLeft: '8' }, expected: { marginLeft: '8px' } },
  { name: 'border radius', styles: { borderRadius: '9' }, expected: { borderRadius: '9px' } },
  { name: 'top left radius', styles: { radiusTopLeft: '3' }, expected: { radiusTopLeft: '3px' } },
  { name: 'top right radius', styles: { radiusTopRight: '4' }, expected: { radiusTopRight: '4px' } },
  { name: 'bottom right radius', styles: { radiusBottomRight: '5' }, expected: { radiusBottomRight: '5px' } },
  { name: 'bottom left radius', styles: { radiusBottomLeft: '6' }, expected: { radiusBottomLeft: '6px' } },
  { name: 'border width', styles: { borderWidth: '2' }, expected: { borderWidth: '2px', borderStyle: 'solid' } },
  { name: 'border color', styles: { borderColor: '#112233' }, expected: { borderColor: '#112233', borderStyle: 'solid' } },
  {
    name: 'border opacity',
    styles: { borderOpacity: '70' },
    fullDraft: { borderColor: '#112233', borderOpacity: '70' },
    expected: { borderColor: 'rgba(17, 34, 51, 0.7)', borderStyle: 'solid' },
  },
  { name: 'shadow x', styles: { shadowX: '6' }, fullDraft: { ...shadowDraft, shadowX: '6' }, expected: { boxShadow: '6px 4px 8px 1px rgba(17, 34, 51, 0.5)' } },
  { name: 'shadow y', styles: { shadowY: '7' }, fullDraft: { ...shadowDraft, shadowY: '7' }, expected: { boxShadow: '2px 7px 8px 1px rgba(17, 34, 51, 0.5)' } },
  { name: 'shadow spread', styles: { shadowSpread: '3' }, fullDraft: { ...shadowDraft, shadowSpread: '3' }, expected: { boxShadow: '2px 4px 8px 3px rgba(17, 34, 51, 0.5)' } },
  { name: 'shadow blur', styles: { shadowBlur: '10' }, fullDraft: { ...shadowDraft, shadowBlur: '10' }, expected: { boxShadow: '2px 4px 10px 1px rgba(17, 34, 51, 0.5)' } },
  { name: 'shadow color', styles: { shadowColor: '#445566' }, fullDraft: { ...shadowDraft, shadowColor: '#445566' }, expected: { boxShadow: '2px 4px 8px 1px rgba(68, 85, 102, 0.5)' } },
  { name: 'shadow opacity', styles: { shadowOpacity: '30' }, fullDraft: { ...shadowDraft, shadowOpacity: '30' }, expected: { boxShadow: '2px 4px 8px 1px rgba(17, 34, 51, 0.3)' } },
  { name: 'box shadow', styles: { boxShadow: '1px 2px 3px 0px #000000' }, expected: { boxShadow: '1px 2px 3px 0px #000000' } },
  { name: 'opacity', styles: { opacity: '65' }, expected: { opacity: '0.65' } },
  { name: 'position x', styles: { positionX: '40' }, expected: { positionX: '40px' } },
  { name: 'position y', styles: { positionY: '56' }, expected: { positionY: '56px' } },
  { name: 'position z', styles: { positionZ: '5' }, expected: { positionZ: '5' } },
  { name: 'position right', styles: { positionRight: '16' }, expected: { positionRight: '16px' } },
  { name: 'position bottom', styles: { positionBottom: '24' }, expected: { positionBottom: '24px' } },
  { name: 'angle', styles: { angle: '15' }, fullDraft: { angle: '15' }, expected: { transform: 'rotate(15deg)' } },
  { name: 'flip horizontal', styles: { flipHorizontal: 'true' }, fullDraft: { flipHorizontal: 'true' }, expected: { transform: 'rotate(0deg) scale(-1, 1)' } },
  { name: 'flip vertical', styles: { flipVertical: 'true' }, fullDraft: { flipVertical: 'true' }, expected: { transform: 'rotate(0deg) scale(1, -1)' } },
  { name: 'transform', styles: { transform: 'rotate(8deg)' }, expected: { transform: 'rotate(8deg)' } },
  { name: 'width', styles: { width: '50' }, fullDraft: { width: '50', widthUnit: '%' }, expected: { width: '50%' } },
  { name: 'height', styles: { height: 'auto' }, fullDraft: { height: 'auto', heightUnit: 'auto' }, expected: { height: 'auto' } },
  { name: 'position type', styles: { positionType: 'absolute' }, expected: { positionType: 'absolute' } },
  { name: 'display mode', styles: { displayMode: 'flex-wrap' }, expected: { display: 'flex', flexDirection: 'row', flexWrap: 'wrap' } },
  { name: 'display', styles: { display: 'grid' }, expected: { display: 'grid' } },
  { name: 'flex direction', styles: { flexDirection: 'column' }, expected: { flexDirection: 'column' } },
  { name: 'flex wrap', styles: { flexWrap: 'wrap' }, expected: { flexWrap: 'wrap' } },
  { name: 'justify content', styles: { justifyContent: 'center' }, expected: { justifyContent: 'center' } },
  { name: 'align items', styles: { alignItems: 'flex-end' }, expected: { alignItems: 'flex-end' } },
  { name: 'gap', styles: { gap: '12' }, expected: { gap: '12px' } },
  { name: 'row gap', styles: { rowGap: '8' }, expected: { rowGap: '8px' } },
  { name: 'column gap', styles: { columnGap: '10' }, expected: { columnGap: '10px' } },
  { name: 'grid template columns', styles: { gridTemplateColumns: 'repeat(3, 1fr)' }, expected: { gridTemplateColumns: 'repeat(3, 1fr)' } },
  { name: 'grid template rows', styles: { gridTemplateRows: 'auto 1fr' }, expected: { gridTemplateRows: 'auto 1fr' } },
  { name: 'font style', styles: { fontStyle: 'italic' }, expected: { fontStyle: 'italic' } },
  { name: 'text decoration', styles: { textDecoration: 'underline' }, expected: { textDecoration: 'underline' } },
];

describe('CanvasInspectorPanel', () => {
  it('renders the Cursor-style Components header with edit count, undo, redo, and no theme toggle', () => {
    render(<CanvasInspectorPanel selectedTarget={target} />);

    expect(screen.getByRole('heading', { name: 'Components' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo last edit' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Redo last undone edit' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Apply edits' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to dark theme preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to light theme preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Light' })).toBeNull();
  });

  it('enables apply only after the selected target has dirty edits', () => {
    render(<CanvasInspectorPanel selectedTarget={target} />);

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } });

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('tracks edits across the session, undoes, redoes, and applies the draft', () => {
    const onSave = vi.fn();
    const onPreviewDraft = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onPreviewDraft={onPreviewDraft} onSaveDraft={onSave} />);
    onPreviewDraft.mockClear();

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } });
    expect(screen.getByText('1 Edit')).toBeTruthy();
    expect(onPreviewDraft).toHaveBeenLastCalledWith({
      id: 'hero-title',
      styles: { color: '#123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo last edit' }));
    expect(screen.queryByText('1 Edit')).toBeNull();
    expect((screen.getByLabelText('Color') as HTMLInputElement).value).toBe('');
    expect(onPreviewDraft).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Redo last undone edit' }));
    expect(screen.getByText('1 Edit')).toBeTruthy();
    expect((screen.getByLabelText('Color') as HTMLInputElement).value).toBe('#123456');
    expect(onPreviewDraft).toHaveBeenLastCalledWith({
      id: 'hero-title',
      styles: { color: '#123456' },
    });

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      styles: { color: '#abcdef' },
    });
    expect(screen.queryByText('1 Edit')).toBeNull();
  });

  it('renders the migrated property inspector for text targets without debug summary fields', () => {
    render(<CanvasInspectorPanel selectedTarget={target} />);

    expect(screen.getByRole('complementary', { name: 'Canvas inspector' })).toBeTruthy();
    expect(screen.getByTestId('canvas-property-inspector')).toBeTruthy();
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
    expect(screen.queryByLabelText('X position')).toBeNull();
    expect(screen.queryByLabelText('Y position')).toBeNull();
    expect(screen.queryByLabelText('Z position')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flow row' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flow column' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flow wrap' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flow grid' })).toBeNull();
    expect(screen.queryByTestId('canvas-property-alignment-grid')).toBeNull();
    expect(screen.queryByLabelText('Gap')).toBeNull();
    expect(screen.queryByLabelText('Column gap')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Inspector tabs' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Props' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'CSS' })).toBeNull();
    expect(screen.queryByText('This element is not a React component instance.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Summary' })).toBeNull();
    expect(screen.queryByText('Node ID')).toBeNull();
    expect(screen.queryByText('Tag')).toBeNull();
    expect(screen.queryByText('Class')).toBeNull();
    expect(screen.queryByText('Kind')).toBeNull();
  });

  it('renders every container property section in the migrated property inspector', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Separate padding' }));
    expect(screen.getByLabelText('Padding top')).toBeTruthy();
    expect(screen.getByLabelText('Padding right')).toBeTruthy();
    expect(screen.getByLabelText('Padding bottom')).toBeTruthy();
    expect(screen.getByLabelText('Padding left')).toBeTruthy();
    expect(screen.queryByLabelText('Clip content')).toBeNull();
    expect(screen.getByLabelText('Margin vertical')).toBeTruthy();
    expect(screen.getByLabelText('Margin horizontal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Separate margin' }));
    expect(screen.getByLabelText('Margin top')).toBeTruthy();
    expect(screen.getByLabelText('Margin right')).toBeTruthy();
    expect(screen.getByLabelText('Margin bottom')).toBeTruthy();
    expect(screen.getByLabelText('Margin left')).toBeTruthy();
    expect(screen.queryByLabelText('Border box')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByLabelText('Opacity')).toBeTruthy();
    expect(screen.getByLabelText('Corner radius')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Separate corner radius' }));
    expect(screen.getByLabelText('Corner radius top left')).toBeTruthy();
    expect(screen.getByLabelText('Corner radius top right')).toBeTruthy();
    expect(screen.getByLabelText('Corner radius bottom right')).toBeTruthy();
    expect(screen.getByLabelText('Corner radius bottom left')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Background' })).toBeTruthy();
    expect(screen.queryByLabelText('Background fill type')).toBeNull();
    expect(screen.getByLabelText('Background color')).toBeTruthy();
    expect(screen.getByLabelText('Background opacity')).toBeTruthy();
    expect(screen.queryByLabelText('Background image')).toBeNull();
    expect(screen.getByLabelText('Background gradient')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove border' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove shadow' })).toBeTruthy();
  });

  it('renders position and layout controls in a compact design-tool grid', () => {
    render(<CanvasInspectorPanel selectedTarget={containerTarget} />);

    const inspector = screen.getByTestId('canvas-property-inspector');
    expect(inspector.getAttribute('data-theme')).toBe('dark');
    expect(inspector.className).toContain('bg-background');
    expect(inspector.className).toContain('bg-background-panel');
    expect(screen.getByTestId('canvas-property-position-grid').className).toContain('grid-cols-[repeat(3,minmax(0,1fr))]');
    expect(screen.getByTestId('canvas-property-layout-flow').className).toContain('grid-cols-4');
    expect(screen.getByTestId('canvas-property-alignment-grid').className).toContain('grid-cols-3');
    expect(screen.getByTestId('canvas-property-dimensions-row').className).toContain('grid-cols-2');
    expect(screen.getByRole('button', { name: 'Flow row' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Align top left' })).toBeTruthy();
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('358');
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('92');
  });

  it('keeps the migrated property inspector form constrained to a narrow floating panel', () => {
    render(
      <div style={{ width: 320 }}>
        <CanvasInspectorPanel selectedTarget={containerTarget} />
      </div>,
    );

    const inspector = screen.getByTestId('canvas-property-inspector');
    const scrollArea = inspector.querySelector('[data-slot="scroll-area"]');
    const body = screen.getByTestId('canvas-property-inspector-body');
    const paddingRow = screen.getByTestId('canvas-property-field-row-padding');
    const positionGrid = screen.getByTestId('canvas-property-position-grid');
    const rotationRow = screen.getByLabelText('Rotation angle').parentElement?.parentElement;
    const verticalField = screen.getByLabelText('Padding vertical').parentElement?.parentElement;
    const horizontalField = screen.getByLabelText('Padding horizontal').parentElement?.parentElement;

    if (!rotationRow) {
      throw new Error('Expected rotation controls to render inside a grid row.');
    }

    expect(scrollArea?.className).toContain('min-w-0');
    expect(scrollArea?.className).toContain('[&_[data-slot=scroll-area-viewport]]:min-w-0');
    expect(scrollArea?.className).toContain('[&_[data-slot=scroll-area-viewport]]:overflow-x-hidden');
    expect(scrollArea?.className).toContain('[&_[data-slot=scroll-area-viewport]>div]:!block');
    expect(scrollArea?.className).toContain('[&_[data-slot=scroll-area-viewport]>div]:!w-full');
    expect(scrollArea?.className).toContain('[&_[data-slot=scroll-area-viewport]>div]:!min-w-0');
    expect(body.className).toContain('min-w-0');
    expect(body.className).toContain('w-full');
    expect(body.className).toContain('max-w-full');
    expect(body.className).toContain('overflow-x-hidden');
    expect(paddingRow.className).toContain('min-w-0');
    expect(paddingRow.className).toContain('[&>*]:min-w-0');
    expect(positionGrid.className).toContain('grid-cols-[repeat(3,minmax(0,1fr))]');
    expect(rotationRow.className).toContain('grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))]');
    expect(verticalField?.className).toContain('min-w-0');
    expect(horizontalField?.className).toContain('min-w-0');
  });

  it('omits the element navigator above selected element styles', () => {
    render(<CanvasInspectorPanel selectedTarget={containerTarget} targets={[containerTarget, target, imageTarget]} />);

    expect(screen.getByTestId('canvas-property-inspector')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Element navigator' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Elements' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Structure' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select Hero Title text' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select Hero image image' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Container styles' })).toBeTruthy();
  });

  it('routes empty-state editable node hover and selection', () => {
    const onHoverTarget = vi.fn();
    const onSelectTarget = vi.fn();

    render(
      <CanvasInspectorPanel
        selectedTarget={null}
        targets={[containerTarget, target, imageTarget]}
        onHoverTarget={onHoverTarget}
        onSelectTarget={onSelectTarget}
      />,
    );

    const titleRow = screen.getByRole('button', { name: 'Select Hero Title text' });
    fireEvent.mouseEnter(titleRow);
    fireEvent.click(titleRow);
    fireEvent.mouseLeave(titleRow);

    expect(onHoverTarget).toHaveBeenNthCalledWith(1, target);
    expect(onSelectTarget).toHaveBeenCalledWith(target);
    expect(onHoverTarget).toHaveBeenLastCalledWith(null);

    expect(screen.queryByRole('tab', { name: 'Structure' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resize element navigator' })).toBeNull();
  });

  it('uses source-like add and remove controls for optional visual layers', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove border' }));
    expect(screen.queryByLabelText('Border weight')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add border' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        borderWidth: '',
        borderColor: '',
      }),
    });
  });

  it('adds a visible border style when enabling a border', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove border' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add border' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        borderStyle: 'solid',
        borderColor: '#000000',
      }),
    });
  });

  it('adds background using only effective CSS style patches', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add background fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      styles: {
        backgroundColor: '#ffffff',
      },
    });
    const savedStyles = onSave.mock.calls[0][0].styles;
    expect(savedStyles).not.toHaveProperty('fillType');
    expect(savedStyles).not.toHaveProperty('backgroundFillType');
    expect(savedStyles).not.toHaveProperty('backgroundOpacity');
  });

  it('opens a react-colorful picker from color swatches instead of a native color input', () => {
    render(<CanvasInspectorPanel selectedTarget={containerTarget} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick Border color' }));

    expect(screen.getByRole('dialog', { name: 'Border color picker' })).toBeTruthy();
    expect(document.querySelector('input[type="color"]')).toBeNull();
  });

  it('hydrates geometry controls from the selected node rect when styles omit geometry', () => {
    render(<CanvasInspectorPanel selectedTarget={rectOnlyContainerTarget} />);

    expect((screen.getByLabelText('Position type') as HTMLInputElement).value).toBe('relative');
    expect((screen.getByLabelText('X position') as HTMLInputElement).value).toBe('-35');
    expect((screen.getByLabelText('Y position') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('386');
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('674');
  });

  it('shows fallback values for unconfigured style controls without creating edits', () => {
    render(<CanvasInspectorPanel selectedTarget={containerTarget} />);

    expect(screen.queryByLabelText('Background image')).toBeNull();
    expect(screen.queryByTitle('none')).toBeNull();
    expect((screen.getByLabelText('Background gradient') as HTMLInputElement).value).toBe('none');
    expect((screen.getByLabelText('Gap') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Column gap') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Right position') as HTMLInputElement).value).toBe('auto');
    expect(screen.getByRole('button', { name: 'Undo last edit' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Redo last undone edit' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders image fill plus visual sections for image targets', () => {
    render(<CanvasInspectorPanel selectedTarget={imageTarget} />);

    expect(screen.getByText('Edit Image')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Image Fill' })).toBeTruthy();
    expect(screen.queryByLabelText('Image source')).toBeNull();
    expect(screen.getByLabelText('Fill mode')).toBeTruthy();
    expect(screen.getByLabelText('Object position')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Background' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove border' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove shadow' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Text' })).toBeNull();
  });

  it('renders the inspect empty state and disables save without a target', () => {
    render(<CanvasInspectorPanel selectedTarget={null} />);

    expect(screen.getByText('Edit element')).toBeTruthy();
    expect(screen.getByText('Select a node in inspect mode to start editing.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('does not populate the editable dock from a hovered target alone', () => {
    render(<CanvasInspectorPanel selectedTarget={null} hoveredTarget={target} />);

    expect(screen.getByText('Edit element')).toBeTruthy();
    expect(screen.queryByDisplayValue('Original')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('routes save and cancel actions', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} onCancelDraft={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('edits text and calls save with the inspector draft', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Updated headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      text: 'Updated headline',
      styles: {},
    });
  });

  it('blocks save and shows an invalid color message for non-hex colors', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'red' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Color must be a hex value like #111 or #111111.')).toBeTruthy();
  });

  it('accepts valid text align values', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Align text right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Align text middle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      styles: {
        textAlign: 'right',
        verticalAlign: 'middle',
      },
    });
  });

  it('rejects unsupported text alignment values during normalization', () => {
    expect(normalizeCanvasInspectorStyles({ textAlign: 'top' }).error).toBe(
      'Text align must be one of: left, center, right.',
    );
    expect(normalizeCanvasInspectorStyles({ verticalAlign: 'left' }).error).toBe(
      'Vertical align must be one of: top, middle, bottom.',
    );
  });

  it('does not create default colors when clearing opacity without a paired color', () => {
    const backgroundResult = normalizeCanvasInspectorStyles({ backgroundOpacity: '' }, { backgroundOpacity: '' });
    const borderResult = normalizeCanvasInspectorStyles({ borderOpacity: '' }, { borderOpacity: '' });

    expect(backgroundResult.styles).toEqual({});
    expect(borderResult.styles).toEqual({});
    expect(backgroundResult.styles).not.toHaveProperty('backgroundOpacity');
    expect(borderResult.styles).not.toHaveProperty('borderOpacity');
  });

  it('normalizes numeric typography values before save', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Line height'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('Letter spacing'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      styles: {
        fontSize: '18px',
        lineHeight: '24',
        letterSpacing: '1.5px',
      },
    });
  });

  it('normalizes generic container layout values and clamps opacity before save', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Padding vertical'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: {
        opacity: '1',
        paddingTop: '12px',
        paddingBottom: '12px',
      },
    });
  });

  it('clears compound padding and margin controls as paired empty style patches', () => {
    const onSave = vi.fn();
    const marginTarget: EditableNode = {
      ...containerTarget,
      styles: {
        ...containerTarget.styles,
        marginLeft: '10px',
        marginRight: '10px',
      },
    };

    render(<CanvasInspectorPanel selectedTarget={marginTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Padding vertical'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Margin horizontal'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        paddingTop: '',
        paddingBottom: '',
        marginLeft: '',
        marginRight: '',
      }),
    });
  });

  it('normalizes background and border opacity through color style patches', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Background opacity'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Border opacity'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        backgroundColor: 'rgba(248, 250, 252, 0.5)',
        borderColor: 'rgba(219, 234, 254, 0.25)',
      }),
    });
  });

  it('preserves computed rgb background and border colors when saving opacity controls', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={rgbContainerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Background opacity'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Border opacity'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        backgroundColor: 'rgba(248, 250, 252, 0.5)',
        borderColor: 'rgba(219, 234, 254, 0.25)',
      }),
    });
  });

  it('hydrates computed rgb and rgba color styles as hex colors plus opacity fields', () => {
    render(<CanvasInspectorPanel selectedTarget={rgbaContainerTarget} />);

    expect((screen.getByLabelText('Background color') as HTMLInputElement).value).toBe('#f8fafc');
    expect((screen.getByLabelText('Background opacity') as HTMLInputElement).value).toBe('50');

    expect((screen.getByLabelText('Border color') as HTMLInputElement).value).toBe('#dbeafe');
    expect((screen.getByLabelText('Border opacity') as HTMLInputElement).value).toBe('80');
  });

  it('clears synthetic opacity fields by restoring paired color styles', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Background opacity'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Border opacity'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        backgroundColor: '#f8fafc',
        borderColor: '#dbeafe',
      }),
    });
    const savedStyles = onSave.mock.calls[0][0].styles;
    expect(savedStyles).not.toHaveProperty('backgroundOpacity');
    expect(savedStyles).not.toHaveProperty('borderOpacity');
  });

  it('clearing shadow opacity updates box shadow without synthetic opacity keys', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Shadow opacity'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const draft = onSave.mock.calls[0][0];
    expect(draft.styles.boxShadow).toBe('0px 8px 24px 0px #1d4ed8');
    expect(draft.styles).not.toHaveProperty('shadowOpacity');
  });

  it('preserves rgba shadow color and alpha when editing another shadow field', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={rgbaShadowTarget} onSaveDraft={onSave} />);

    expect((screen.getByLabelText('Shadow color') as HTMLInputElement).value).toBe('#1d4ed8');
    expect((screen.getByLabelText('Shadow opacity') as HTMLInputElement).value).toBe('25');
    fireEvent.change(screen.getByLabelText('Shadow blur'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: {
        boxShadow: '0px 8px 12px 0px rgba(29, 78, 216, 0.25)',
      },
    });
  });

  it('preserves browser-computed color-first rgba shadows when editing another shadow field', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={computedRgbaShadowTarget} onSaveDraft={onSave} />);

    expect((screen.getByLabelText('Shadow color') as HTMLInputElement).value).toBe('#1d4ed8');
    expect((screen.getByLabelText('Shadow opacity') as HTMLInputElement).value).toBe('25');
    expect((screen.getByLabelText('Shadow Y') as HTMLInputElement).value).toBe('8');
    fireEvent.change(screen.getByLabelText('Shadow blur'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: {
        boxShadow: '0px 8px 12px 0px rgba(29, 78, 216, 0.25)',
      },
    });
  });


  it('expands border and shadow sections without losing field values', () => {
    render(<CanvasInspectorPanel selectedTarget={containerTarget} />);

    expect(screen.queryByLabelText('Border position')).toBeNull();
    expect(screen.getByLabelText('Border weight')).toBeTruthy();
    expect(screen.getByLabelText('Border color')).toBeTruthy();
    expect(screen.getByLabelText('Border opacity')).toBeTruthy();
    expect((screen.getByLabelText('Border weight') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Border color') as HTMLInputElement).value).toBe('#dbeafe');

    expect(screen.getByLabelText('Shadow X')).toBeTruthy();
    expect(screen.getByLabelText('Shadow Y')).toBeTruthy();
    expect(screen.getByLabelText('Shadow spread')).toBeTruthy();
    expect(screen.getByLabelText('Shadow blur')).toBeTruthy();
    expect(screen.getByLabelText('Shadow color')).toBeTruthy();
    expect(screen.getByLabelText('Shadow opacity')).toBeTruthy();
    expect((screen.getByLabelText('Shadow X') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Shadow Y') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Shadow spread') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Shadow blur') as HTMLInputElement).value).toBe('24');
    expect((screen.getByLabelText('Shadow color') as HTMLInputElement).value).toBe('#1d4ed8');
  });

  it('expands compound border, shadow, position, padding, and margin fields before save', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Border weight'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Border color'), { target: { value: '#123456' } });
    fireEvent.change(screen.getByLabelText('Shadow X'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Shadow Y'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Shadow spread'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Shadow blur'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Shadow color'), { target: { value: '#000000' } });
    fireEvent.change(screen.getByLabelText('X position'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Y position'), { target: { value: '56' } });
    fireEvent.change(screen.getByLabelText('Z position'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Rotation angle'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Margin horizontal'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'alarm-card',
      styles: expect.objectContaining({
        borderWidth: '2px',
        borderStyle: 'solid',
        borderColor: '#123456',
        boxShadow: '4px 8px 20px 2px #000000',
        positionX: '40px',
        positionY: '56px',
        positionZ: '5',
        transform: 'rotate(15deg)',
        marginLeft: '10px',
        marginRight: '10px',
      }),
    });
  });

  it('adds pixel units to negative numeric lengths before save', () => {
    expect(normalizeCanvasInspectorStyles({ marginLeft: '-8', positionX: '-35' }).styles).toEqual({
      marginLeft: '-8px',
      positionX: '-35px',
    });
    expect(
      normalizeCanvasInspectorStyles(
        { shadowX: '-6' },
        { shadowX: '-6', shadowY: '4', shadowBlur: '10', shadowSpread: '0', shadowColor: '#111111', shadowOpacity: '50' },
      ).styles,
    ).toEqual({
      boxShadow: '-6px 4px 10px 0px rgba(17, 17, 17, 0.5)',
    });
  });

  it('omits inspector-only style fields that do not map to CSS', () => {
    expect(
      normalizeCanvasInspectorStyles({
        fillType: 'solid',
        backgroundFillType: 'solid',
        borderPosition: 'inside',
        imageSrc: '/hero.png',
        widthUnit: '%',
        heightUnit: 'auto',
      }).styles,
    ).toEqual({});
  });

  it.each(editableNormalizationCases)('normalizes editable inspector property: $name', ({ styles, fullDraft, expected }) => {
    expect(normalizeCanvasInspectorStyles(styles, fullDraft ?? styles)).toEqual({
      error: null,
      styles: expected,
    });
  });

  it('promotes static elements to relative positioning when offset controls change', () => {
    expect(
      normalizeCanvasInspectorStyles({ positionX: '40' }, { positionX: '40', positionType: 'static' }).styles,
    ).toEqual({
      positionX: '40px',
      positionType: 'relative',
    });
    expect(
      normalizeCanvasInspectorStyles(
        { positionRight: '16', positionBottom: '24', positionZ: '3' },
        { positionRight: '16', positionBottom: '24', positionZ: '3', positionType: 'static' },
      ).styles,
    ).toEqual({
      positionRight: '16px',
      positionBottom: '24px',
      positionZ: '3',
      positionType: 'relative',
    });
  });

  it('normalizes Cursor layout keys into concrete CSS style patches', () => {
    expect(
      normalizeCanvasInspectorStyles({
        positionType: 'absolute',
        positionRight: '16',
        positionBottom: '24',
        display: 'flex',
        flexDirection: 'column',
        flexWrap: 'nowrap',
        width: '50',
        widthUnit: '%',
        height: 'auto',
        heightUnit: 'auto',
        justifyContent: 'center',
        alignItems: 'flex-end',
        gap: '12',
        rowGap: '8',
        columnGap: '10',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'auto',
      }),
    ).toEqual({
      error: null,
      styles: {
        positionType: 'absolute',
        positionRight: '16px',
        positionBottom: '24px',
        display: 'flex',
        flexDirection: 'column',
        flexWrap: 'nowrap',
        width: '50%',
        height: 'auto',
        justifyContent: 'center',
        alignItems: 'flex-end',
        gap: '12px',
        rowGap: '8px',
        columnGap: '10px',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'auto',
      },
    });
  });

  it('expands display mode into display and flex layout styles', () => {
    expect(normalizeCanvasInspectorStyles({ displayMode: 'flex-col' }).styles).toEqual({
      display: 'flex',
      flexDirection: 'column',
      flexWrap: 'nowrap',
    });
  });

  it('rebaselines local form state from normalized saved styles', () => {
    const onSave = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={containerTarget} onSaveDraft={onSave} />);

    fireEvent.change(screen.getByLabelText('Padding vertical'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((screen.getByLabelText('Padding vertical') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Opacity') as HTMLInputElement).value).toBe('100');
  });

  it('resets local drafts when a same-id target snapshot refreshes text and styles', () => {
    const { rerender } = render(<CanvasInspectorPanel selectedTarget={target} />);

    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Locally edited' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } });

    rerender(
      <CanvasInspectorPanel
        selectedTarget={{
          ...target,
          text: 'Server refreshed',
          fields: { text: 'Server refreshed' },
          styles: { color: '#abcdef' },
        }}
      />,
    );

    expect((screen.getByLabelText('Text content') as HTMLTextAreaElement).value).toBe('Server refreshed');
    expect((screen.getByLabelText('Color') as HTMLInputElement).value).toBe('#abcdef');
  });

  it('preserves local drafts when a same-id target rerenders with identical snapshot content', () => {
    const { rerender } = render(<CanvasInspectorPanel selectedTarget={target} />);

    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Locally edited' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#123456' } });

    rerender(
      <CanvasInspectorPanel
        selectedTarget={{
          ...target,
          fields: { ...target.fields },
          styles: { ...target.styles },
        }}
      />,
    );

    expect((screen.getByLabelText('Text content') as HTMLTextAreaElement).value).toBe('Locally edited');
    expect((screen.getByLabelText('Color') as HTMLInputElement).value).toBe('#123456');
  });

  it('reports text-only draft changes through the preview callback for shell dirty tracking', () => {
    const onPreviewDraft = vi.fn();

    render(<CanvasInspectorPanel selectedTarget={target} onPreviewDraft={onPreviewDraft} />);
    onPreviewDraft.mockClear();

    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Draft headline' } });

    expect(onPreviewDraft).toHaveBeenLastCalledWith({
      id: 'hero-title',
      text: 'Draft headline',
      styles: {},
    });
  });

  it('discards unapplied drafts when switching selected targets', async () => {
    const onPreviewDraft = vi.fn();
    const { rerender } = render(<CanvasInspectorPanel selectedTarget={target} onPreviewDraft={onPreviewDraft} />);
    onPreviewDraft.mockClear();

    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Draft headline' } });

    expect(onPreviewDraft).toHaveBeenLastCalledWith({
      id: 'hero-title',
      text: 'Draft headline',
      styles: {},
    });

    onPreviewDraft.mockClear();

    rerender(<CanvasInspectorPanel selectedTarget={secondaryTarget} onPreviewDraft={onPreviewDraft} />);

    expect(onPreviewDraft).not.toHaveBeenCalledWith({
      id: 'hero-subtitle',
      text: 'Draft headline',
      styles: {},
    });
    await waitFor(() => expect((screen.getByLabelText('Text content') as HTMLTextAreaElement).value).toBe('Subtitle'));

    onPreviewDraft.mockClear();

    rerender(<CanvasInspectorPanel selectedTarget={target} onPreviewDraft={onPreviewDraft} />);

    await waitFor(() => expect((screen.getByLabelText('Text content') as HTMLTextAreaElement).value).toBe('Original'));
    expect(onPreviewDraft).not.toHaveBeenCalledWith({
      id: 'hero-title',
      text: 'Draft headline',
      styles: {},
    });
  });

  it('keeps uploaded background image URLs in the active draft', async () => {
    const onSave = vi.fn();
    const uploadBackgroundImage = vi.fn(async () => '/api/projects/project-1/files/more_lined.svg');

    render(
      <CanvasInspectorPanel
        selectedTarget={target}
        onSaveDraft={onSave}
        uploadBackgroundImage={uploadBackgroundImage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add background fill' }));
    fireEvent.change(screen.getByLabelText('Background image'), {
      target: { files: [new File(['<svg></svg>'], 'more_lined.svg', { type: 'image/svg+xml' })] },
    });

    await waitFor(() => expect(uploadBackgroundImage).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByTitle('url("/api/projects/project-1/files/more_lined.svg")')).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      styles: {
        backgroundColor: '#ffffff',
        backgroundImage: 'url("/api/projects/project-1/files/more_lined.svg")',
      },
    });
  });

  it('keeps uploaded background image URLs when the target already has a solid background', async () => {
    const onSave = vi.fn();
    const uploadBackgroundImage = vi.fn(async () => '/api/projects/project-1/files/more_lined.svg');

    render(
      <CanvasInspectorPanel
        selectedTarget={{
          ...target,
          styles: { ...target.styles, backgroundColor: '#ffffff' },
        }}
        onSaveDraft={onSave}
        uploadBackgroundImage={uploadBackgroundImage}
      />,
    );

    fireEvent.change(screen.getByLabelText('Background image'), {
      target: { files: [new File(['<svg></svg>'], 'more_lined.svg', { type: 'image/svg+xml' })] },
    });

    await waitFor(() => expect(screen.getByTitle('url("/api/projects/project-1/files/more_lined.svg")')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'hero-title',
      styles: {
        backgroundImage: 'url("/api/projects/project-1/files/more_lined.svg")',
      },
    });
  });

  it('disables apply while a background image upload is pending', async () => {
    let resolveUpload!: (resourceUrl: string) => void;
    const uploadBackgroundImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    render(
      <CanvasInspectorPanel
        selectedTarget={target}
        uploadBackgroundImage={uploadBackgroundImage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add background fill' }));
    fireEvent.change(screen.getByLabelText('Background image'), {
      target: { files: [new File(['<svg></svg>'], 'more_lined.svg', { type: 'image/svg+xml' })] },
    });

    await waitFor(() => expect(uploadBackgroundImage).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    resolveUpload('/api/projects/project-1/files/more_lined.svg');

    await waitFor(() => expect(screen.getByTitle('url("/api/projects/project-1/files/more_lined.svg")')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps uploaded background image URLs when the selected target object is refreshed during upload', async () => {
    let resolveUpload!: (resourceUrl: string) => void;
    const uploadBackgroundImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const onSave = vi.fn();
    const selectedContainer = {
      ...containerTarget,
      id: 'path-0',
      styles: {},
    };
    const { rerender } = render(
      <CanvasInspectorPanel
        selectedTarget={selectedContainer}
        onSaveDraft={onSave}
        uploadBackgroundImage={uploadBackgroundImage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add background fill' }));
    fireEvent.change(screen.getByLabelText('Background image'), {
      target: { files: [new File(['<svg></svg>'], 'more_lined.svg', { type: 'image/svg+xml' })] },
    });

    rerender(
      <CanvasInspectorPanel
        selectedTarget={{
          ...selectedContainer,
          styles: {},
        }}
        onSaveDraft={onSave}
        uploadBackgroundImage={uploadBackgroundImage}
      />,
    );
    resolveUpload('/api/projects/project-1/files/more_lined.svg');

    await waitFor(() => expect(screen.getByTitle('url("/api/projects/project-1/files/more_lined.svg")')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      id: 'path-0',
      styles: {
        backgroundColor: '#ffffff',
        backgroundImage: 'url("/api/projects/project-1/files/more_lined.svg")',
      },
    });
  });
});
