import React from 'react';
import { Button, Input, ScrollArea, Textarea } from '@tutti-os/ui-system/components';
import {
  AddIcon,
  ChevronDownIcon,
  CloseIcon,
  DeleteIcon,
  ImageFileIcon,
} from '@tutti-os/ui-system/icons';
import { cn } from '@tutti-os/ui-system/utils';
import type { CanvasInspectorStyleKey, InspectorElementType } from '../CanvasInspectorPanel';
import { HexColorPopover } from '../HexColorPopover';
import { useTranslation } from '../../../i18n';

type StyleDraft = Partial<Record<CanvasInspectorStyleKey, string>>;

export interface CanvasInspectorTargetListItem {
  id: string;
  childCount?: number;
  depth?: number;
  dirty?: boolean;
  editable?: boolean;
  kind?: string;
  label: string;
  selector?: string;
  tagName: string;
}

export interface CanvasPropertyInspectorProps {
  activeTargetSelector?: string;
  activeTargetTitle: string;
  canRedo: boolean;
  canSave: boolean;
  canUndo: boolean;
  editCount: number;
  elementType: InspectorElementType;
  error: string | null;
  hoveredTargetId?: string | null;
  onCancel: () => void;
  onHoverTarget?: (targetId: string | null) => void;
  onSave: () => void;
  onSelectTarget?: (targetId: string) => void;
  onStyleChange: (key: CanvasInspectorStyleKey, value: string) => void;
  onStylePatch?: (patch: StyleDraft) => void;
  onTextChange: (value: string) => void;
  onRedo: () => void;
  onUndo: () => void;
  selected: boolean;
  selectedTargetId?: string | null;
  styleDraft: StyleDraft;
  targetList?: CanvasInspectorTargetListItem[];
  textDraft: string;
  uploadBackgroundImage?: (file: File) => Promise<string>;
}

const controlClass =
  'h-8 rounded-md border-border-1 bg-transparency-block text-xs text-foreground shadow-none transition-colors hover:bg-transparency-hover focus-visible:ring-2 focus-visible:ring-ring/30';
const sectionGapClass = 'flex flex-col gap-2';
const sourceLikeButtonClass = 'h-7 min-w-7 rounded-md px-2 text-xs';
const STYLE_INPUT_FALLBACKS: Partial<Record<CanvasInspectorStyleKey, string>> = {
  backgroundImage: 'none',
  backgroundGradient: 'none',
  borderRadius: '0',
  radiusTopLeft: '0',
  radiusTopRight: '0',
  radiusBottomRight: '0',
  radiusBottomLeft: '0',
  borderWidth: '0',
  shadowX: '0',
  shadowY: '0',
  shadowSpread: '0',
  shadowBlur: '0',
  boxShadow: 'none',
  paddingVertical: '0',
  paddingHorizontal: '0',
  paddingTop: '0',
  paddingRight: '0',
  paddingBottom: '0',
  paddingLeft: '0',
  marginVertical: '0',
  marginHorizontal: '0',
  marginTop: '0',
  marginRight: '0',
  marginBottom: '0',
  marginLeft: '0',
  gap: '0',
  rowGap: '0',
  columnGap: '0',
  gridTemplateColumns: 'none',
  gridTemplateRows: 'none',
  justifyContent: 'normal',
  alignItems: 'normal',
  lineHeight: 'normal',
  letterSpacing: '0',
  fontStyle: 'normal',
  textDecoration: 'none',
  positionRight: 'auto',
  positionBottom: 'auto',
  positionZ: 'auto',
  angle: '0',
  transform: 'none',
};

export function CanvasPropertyInspector({
  activeTargetSelector,
  activeTargetTitle,
  canRedo,
  canSave,
  canUndo,
  editCount,
  elementType,
  error,
  onCancel,
  onHoverTarget,
  onSave,
  onSelectTarget,
  onStyleChange,
  onStylePatch,
  onTextChange,
  onRedo,
  onUndo,
  selected,
  styleDraft,
  targetList = [],
  textDraft,
  uploadBackgroundImage,
}: CanvasPropertyInspectorProps) {
  const { t } = useTranslation();
  const [backgroundUploading, setBackgroundUploading] = React.useState(false);

  return (
    <aside
      aria-label={t('inspector.canvasInspector')}
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background-panel text-foreground"
      data-theme="dark"
      data-testid="canvas-property-inspector"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border-1 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="shrink-0 text-sm font-medium leading-5 text-foreground">{t('inspector.title')}</h1>
          {editCount > 0 ? (
            <span className="shrink-0 rounded bg-transparency-block px-1.5 py-0.5 text-[11px] text-text-secondary">
              {t(editCount === 1 ? 'inspector.editCount' : 'inspector.editCountPlural', { count: editCount })}
            </span>
          ) : null}
          <span className="min-w-0 truncate rounded bg-transparency-block px-1.5 py-0.5 text-[11px] text-text-secondary">
            {activeTargetSelector || activeTargetTitle}
          </span>
          {activeTargetSelector ? <span className="sr-only">{activeTargetTitle}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button aria-label={t('inspector.actions.undoAria')} disabled={!canUndo} onClick={onUndo} size="xs" type="button" variant="chrome">
            {t('inspector.actions.undo')}
          </Button>
          <Button aria-label={t('inspector.actions.redoAria')} disabled={!canRedo} onClick={onRedo} size="xs" type="button" variant="chrome">
            {t('inspector.actions.redo')}
          </Button>
          <Button aria-label={t('inspector.actions.close')} onClick={onCancel} size="icon-sm" type="button" variant="chrome">
            <CloseIcon aria-hidden="true" />
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 min-w-0 flex-1 basis-0 overflow-hidden [&_[data-slot=scroll-area-viewport]]:min-w-0 [&_[data-slot=scroll-area-viewport]]:overflow-x-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!w-full">
        {selected ? (
          <div className="flex w-full max-w-full min-w-0 flex-col gap-3 overflow-x-hidden px-4 py-4" data-testid="canvas-property-inspector-body">
            {elementType === 'generic' ? <SectionHeading title={t('inspector.fields.containerStyles')} /> : null}
            <PropertyBody
              elementType={elementType}
              onStyleChange={onStyleChange}
              onStylePatch={onStylePatch}
              onTextChange={onTextChange}
              styleDraft={styleDraft}
              textDraft={textDraft}
              onBackgroundUploadStateChange={setBackgroundUploading}
              uploadBackgroundImage={uploadBackgroundImage}
            />
            {error ? (
              <p
                className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs leading-5 text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState onHoverTarget={onHoverTarget} onSelectTarget={onSelectTarget} targetList={targetList} />
        )}
      </ScrollArea>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-1 px-4 py-3">
        <Button onClick={onCancel} size="sm" type="button" variant="secondary">
          {t('common.cancel')}
        </Button>
        <Button aria-label={t('inspector.actions.saveAria')} disabled={!canSave || backgroundUploading} onClick={onSave} size="sm" type="button">
          {t('common.apply')}
        </Button>
      </footer>
    </aside>
  );
}

function PropertyBody({
  elementType,
  onStyleChange,
  onStylePatch,
  onTextChange,
  onBackgroundUploadStateChange,
  styleDraft,
  textDraft,
  uploadBackgroundImage,
}: {
  elementType: InspectorElementType;
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  onStylePatch?: CanvasPropertyInspectorProps['onStylePatch'];
  onTextChange: CanvasPropertyInspectorProps['onTextChange'];
  onBackgroundUploadStateChange: (uploading: boolean) => void;
  styleDraft: StyleDraft;
  textDraft: string;
  uploadBackgroundImage?: CanvasPropertyInspectorProps['uploadBackgroundImage'];
}) {
  const supportsContainerLayout = elementType === 'generic';

  return (
    <div className="flex flex-col gap-3">
      <PositionSection onStyleChange={onStyleChange} styleDraft={styleDraft} />
      <LayoutSection
        onStyleChange={onStyleChange}
        showContainerControls={supportsContainerLayout}
        styleDraft={styleDraft}
      />
      {elementType === 'text' ? (
        <TextSection onStyleChange={onStyleChange} onTextChange={onTextChange} styleDraft={styleDraft} textDraft={textDraft} />
      ) : null}
      {elementType === 'image' ? <ImageFillSection onStyleChange={onStyleChange} styleDraft={styleDraft} /> : null}
      <BackgroundSection
        onBackgroundUploadStateChange={onBackgroundUploadStateChange}
        onStyleChange={onStyleChange}
        onStylePatch={onStylePatch}
        styleDraft={styleDraft}
        uploadBackgroundImage={uploadBackgroundImage}
      />
      <AppearanceSection onStyleChange={onStyleChange} styleDraft={styleDraft} />
      <BorderSection onStyleChange={onStyleChange} styleDraft={styleDraft} />
      <ShadowBlurSection onStyleChange={onStyleChange} styleDraft={styleDraft} />
    </div>
  );
}

function ExplorerRow({
  hovered,
  onHoverTarget,
  onSelectTarget,
  selected,
  target,
}: {
  hovered: boolean;
  onHoverTarget?: (targetId: string | null) => void;
  onSelectTarget?: (targetId: string) => void;
  selected: boolean;
  target: CanvasInspectorTargetListItem;
}) {
  const { t } = useTranslation();
  const primaryText = target.label;
  const secondaryText = target.selector || target.tagName.toLowerCase();
  const actionLabel = t('inspector.selectTarget', {
    kind: targetKindLabel(target, t),
    label: target.label,
  });

  return (
    <button
      aria-current={selected ? 'true' : undefined}
      aria-label={actionLabel}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30',
        selected || hovered
          ? 'bg-primary/10 text-foreground'
          : 'text-text-secondary hover:bg-transparency-hover hover:text-foreground',
      )}
      disabled={target.editable === false}
      onClick={() => onSelectTarget?.(target.id)}
      onMouseEnter={() => onHoverTarget?.(target.id)}
      onMouseLeave={() => onHoverTarget?.(null)}
      style={{ paddingLeft: `${6 + Math.min(12, target.depth ?? 0) * 12}px` }}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{primaryText}</span>
        <span className="block truncate text-[11px] text-text-secondary">{secondaryText}</span>
      </span>
      {target.dirty ? <span aria-label={t('inspector.unsavedEdits')} className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
    </button>
  );
}

function targetKindLabel(target: CanvasInspectorTargetListItem, t: ReturnType<typeof useTranslation>['t']): string {
  const normalized = target.tagName.toLowerCase();
  if (target.kind === 'image' || normalized === 'img' || normalized === 'picture') return t('inspector.targetKinds.image');
  if (target.kind === 'text' || isTextTag(normalized)) return t('inspector.targetKinds.text');
  return t('inspector.targetKinds.element');
}

function isTextTag(tagName: string): boolean {
  return ['span', 'p', 'label', 'a', 'strong', 'em', 'b', 'i', 'small', 'mark', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName);
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex h-6 items-center">
      <h2 className="text-xs font-medium leading-4 text-foreground">{title}</h2>
    </div>
  );
}

function PropertySection({
  actions,
  children,
  title,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className={sectionGapClass}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="truncate text-xs font-medium text-foreground">{title}</h2>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function AddRemoveSection({
  addLabel,
  children,
  hasContent,
  onAdd,
  onRemove,
  removeLabel,
  title,
}: {
  addLabel: string;
  children: React.ReactNode;
  hasContent: boolean;
  onAdd: () => void;
  onRemove: () => void;
  removeLabel: string;
  title: string;
}) {
  const [enabled, setEnabled] = React.useState(hasContent);

  React.useEffect(() => {
    setEnabled(hasContent);
  }, [hasContent]);

  function add(): void {
    setEnabled(true);
    onAdd();
  }

  function remove(): void {
    setEnabled(false);
    onRemove();
  }

  return (
    <PropertySection
      actions={
        enabled ? (
          <Button aria-label={removeLabel} className={sourceLikeButtonClass} onClick={remove} size="xs" type="button" variant="chrome">
            <DeleteIcon aria-hidden="true" />
          </Button>
        ) : (
          <Button aria-label={addLabel} className={sourceLikeButtonClass} onClick={add} size="xs" type="button" variant="chrome">
            <AddIcon aria-hidden="true" />
          </Button>
        )
      }
      title={title}
    >
      {enabled ? <div className="flex flex-col gap-2">{children}</div> : null}
    </PropertySection>
  );
}

function TextSection({
  onStyleChange,
  onTextChange,
  styleDraft,
  textDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  onTextChange: CanvasPropertyInspectorProps['onTextChange'];
  styleDraft: StyleDraft;
  textDraft: string;
}) {
  const { t } = useTranslation();
  return (
    <PropertySection title={t('inspector.fields.text')}>
      <StackedField label={t('inspector.fields.textContent')}>
        {(id) => (
          <Textarea
            className={cn(controlClass, 'min-h-20 resize-none px-2 py-2')}
            id={id}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onTextChange(event.currentTarget.value)}
            value={textDraft}
          />
        )}
      </StackedField>
      <StyleInput fieldKey="fontFamily" label={t('inspector.fields.fontFamily')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
      <FieldRow>
        <StyleInput ariaLabel={t('inspector.fields.fontWeight')} fieldKey="fontWeight" label={t('inspector.fields.fontWeight')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
        <StyleInput ariaLabel={t('inspector.fields.fontSize')} fieldKey="fontSize" label={t('inspector.fields.fontSize')} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
      </FieldRow>
      <StyleInput fieldKey="color" label={t('inspector.fields.color')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} swatch />
      <FieldRow>
        <StyleInput ariaLabel={t('inspector.fields.fontStyle')} fieldKey="fontStyle" label={t('inspector.fields.fontStyle')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
        <StyleInput
          ariaLabel={t('inspector.fields.decoration')}
          fieldKey="textDecoration"
          label={t('inspector.fields.decoration')}
          onStyleChange={onStyleChange}
          parseAsNumber={false}
          styleDraft={styleDraft}
        />
      </FieldRow>
      <FieldRow>
        <StyleInput ariaLabel={t('inspector.fields.lineHeight')} fieldKey="lineHeight" label={t('inspector.fields.lineHeight')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
        <StyleInput ariaLabel={t('inspector.fields.letterSpacing')} fieldKey="letterSpacing" label={t('inspector.fields.letterSpacing')} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
      </FieldRow>
      <SegmentedControl
        label={t('inspector.fields.textHorizontalAlignment')}
        onValueChange={(value) => onStyleChange('textAlign', value)}
        options={[
          { ariaLabel: t('inspector.fields.alignLeft'), label: t('inspector.fields.left'), value: 'left' },
          { ariaLabel: t('inspector.fields.alignCenter'), label: t('inspector.fields.center'), value: 'center' },
          { ariaLabel: t('inspector.fields.alignRight'), label: t('inspector.fields.right'), value: 'right' },
        ]}
        value={styleDraft.textAlign ?? 'left'}
      />
      <SegmentedControl
        label={t('inspector.fields.textVerticalAlignment')}
        onValueChange={(value) => onStyleChange('verticalAlign', value)}
        options={[
          { ariaLabel: t('inspector.fields.alignTop'), label: t('inspector.fields.top'), value: 'top' },
          { ariaLabel: t('inspector.fields.alignMiddle'), label: t('inspector.fields.middle'), value: 'middle' },
          { ariaLabel: t('inspector.fields.alignBottom'), label: t('inspector.fields.bottom'), value: 'bottom' },
        ]}
        value={styleDraft.verticalAlign ?? 'top'}
      />
    </PropertySection>
  );
}

function ImageFillSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  styleDraft: StyleDraft;
}) {
  const { t } = useTranslation();
  return (
    <PropertySection title={t('inspector.fields.imageFill')}>
      <StyleInput fieldKey="objectFit" label={t('inspector.fields.fillMode')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
      <StyleInput
        fieldKey="objectPosition"
        label={t('inspector.fields.objectPosition')}
        onStyleChange={onStyleChange}
        parseAsNumber={false}
        styleDraft={styleDraft}
      />
    </PropertySection>
  );
}

function BackgroundSection({
  onBackgroundUploadStateChange,
  onStyleChange,
  onStylePatch,
  styleDraft,
  uploadBackgroundImage,
}: {
  onBackgroundUploadStateChange: (uploading: boolean) => void;
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  onStylePatch?: CanvasPropertyInspectorProps['onStylePatch'];
  styleDraft: StyleDraft;
  uploadBackgroundImage?: CanvasPropertyInspectorProps['uploadBackgroundImage'];
}) {
  const { t } = useTranslation();
  const hasBackground = Boolean(styleDraft.backgroundColor || styleDraft.backgroundImage || styleDraft.backgroundGradient);

  return (
    <AddRemoveSection
      addLabel={t('inspector.fields.addBackgroundFill')}
      hasContent={hasBackground}
      onAdd={() => {
        onStyleChange('fillType', 'solid');
        onStyleChange('backgroundColor', styleDraft.backgroundColor || '#ffffff');
        onStyleChange('backgroundOpacity', styleDraft.backgroundOpacity || '100');
      }}
      onRemove={() => {
        onStyleChange('backgroundColor', '');
        onStyleChange('backgroundOpacity', '');
        onStyleChange('backgroundImage', '');
        onStyleChange('backgroundGradient', '');
      }}
      removeLabel={t('inspector.fields.removeBackgroundFill')}
      title={t('inspector.fields.background')}
    >
      <StyleInput fieldKey="backgroundColor" label={t('inspector.fields.backgroundColor')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} swatch />
      <StyleInput fieldKey="backgroundOpacity" label={t('inspector.fields.backgroundOpacity')} onStyleChange={onStyleChange} max={100} min={0} styleDraft={styleDraft} suffix="%" />
      {uploadBackgroundImage ? (
        <BackgroundImageUploadField
          onBackgroundUploadStateChange={onBackgroundUploadStateChange}
          onStyleChange={onStyleChange}
          onStylePatch={onStylePatch}
          styleDraft={styleDraft}
          uploadBackgroundImage={uploadBackgroundImage}
        />
      ) : null}
      <StyleInput fieldKey="backgroundGradient" label={t('inspector.fields.backgroundGradient')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
    </AddRemoveSection>
  );
}

function BackgroundImageUploadField({
  onBackgroundUploadStateChange,
  onStyleChange,
  onStylePatch,
  styleDraft,
  uploadBackgroundImage,
}: {
  onBackgroundUploadStateChange: (uploading: boolean) => void;
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  onStylePatch?: CanvasPropertyInspectorProps['onStylePatch'];
  styleDraft: StyleDraft;
  uploadBackgroundImage?: CanvasPropertyInspectorProps['uploadBackgroundImage'];
}) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const currentValue = styleDraft.backgroundImage || STYLE_INPUT_FALLBACKS.backgroundImage || '';

  async function uploadFile(file: File): Promise<void> {
    if (!uploadBackgroundImage) return;

    setUploading(true);
    onBackgroundUploadStateChange(true);
    setUploadError(null);
    try {
      const resourceUrl = await uploadBackgroundImage(file);
      const backgroundImage = cssUrl(resourceUrl);
      onStylePatch?.({ fillType: 'image', backgroundGradient: '', backgroundImage });
      onStyleChange('fillType', 'image');
      onStyleChange('backgroundGradient', '');
      onStyleChange('backgroundImage', backgroundImage);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('projectEditor.errors.backgroundImageUpload'));
    } finally {
      setUploading(false);
      onBackgroundUploadStateChange(false);
    }
  }

  return (
    <StackedField label={t('inspector.fields.backgroundImage')}>
      {(id) => (
        <div className="flex min-w-0 flex-col gap-1.5">
          <input
            accept="image/*"
            className="sr-only"
            disabled={!uploadBackgroundImage || uploading}
            id={id}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) {
                void uploadFile(file);
              }
            }}
            ref={inputRef}
            type="file"
          />
          <div className="flex min-w-0 items-center gap-2">
            <Button
              aria-label={t('inspector.fields.uploadBackgroundImage')}
              className="h-8 shrink-0 gap-1.5 rounded-md px-2 text-xs"
              disabled={!uploadBackgroundImage || uploading}
              onClick={() => inputRef.current?.click()}
              type="button"
              variant="secondary"
            >
              <ImageFileIcon aria-hidden="true" size={13} />
              {uploading ? t('common.loading') : t('files.actions.upload')}
            </Button>
            <span
              className="min-w-0 flex-1 truncate rounded-md border border-border-1 bg-transparency-block px-2 text-xs leading-8 text-text-secondary"
              title={currentValue}
            >
              {currentValue}
            </span>
          </div>
          {uploadError ? (
            <p className="text-xs leading-5 text-destructive" role="alert">
              {uploadError}
            </p>
          ) : null}
        </div>
      )}
    </StackedField>
  );
}

function cssUrl(resourceUrl: string): string {
  const escapedUrl = resourceUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
  return `url("${escapedUrl}")`;
}

function AppearanceSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  styleDraft: StyleDraft;
}) {
  const { t } = useTranslation();
  const [radiusExpanded, setRadiusExpanded] = React.useState(false);

  return (
    <PropertySection title={t('inspector.fields.appearance')}>
      <FieldRow>
        <StyleInput fieldKey="opacity" label={t('inspector.fields.opacity')} max={100} min={0} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="%" />
        <StyleInput ariaLabel={t('inspector.fields.cornerRadius')} fieldKey="borderRadius" label={t('inspector.fields.radius')} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
      </FieldRow>
      <ExpandButton expanded={radiusExpanded} label={t('inspector.fields.separateCornerRadius')} onClick={() => setRadiusExpanded((current) => !current)} />
      {radiusExpanded ? (
        <>
          <FieldRow>
            <StyleInput ariaLabel={t('inspector.fields.cornerRadiusTopLeft')} fieldKey="radiusTopLeft" label={t('inspector.fields.topLeft')} onStyleChange={onStyleChange} styleDraft={styleDraft} />
            <StyleInput ariaLabel={t('inspector.fields.cornerRadiusTopRight')} fieldKey="radiusTopRight" label={t('inspector.fields.topRight')} onStyleChange={onStyleChange} styleDraft={styleDraft} />
          </FieldRow>
          <FieldRow>
            <StyleInput ariaLabel={t('inspector.fields.cornerRadiusBottomLeft')} fieldKey="radiusBottomLeft" label={t('inspector.fields.bottomLeft')} onStyleChange={onStyleChange} styleDraft={styleDraft} />
            <StyleInput ariaLabel={t('inspector.fields.cornerRadiusBottomRight')} fieldKey="radiusBottomRight" label={t('inspector.fields.bottomRight')} onStyleChange={onStyleChange} styleDraft={styleDraft} />
          </FieldRow>
        </>
      ) : null}
    </PropertySection>
  );
}

function BorderSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  styleDraft: StyleDraft;
}) {
  const { t } = useTranslation();
  const hasBorder = Boolean(styleDraft.borderWidth || styleDraft.borderColor);

  return (
    <AddRemoveSection
      addLabel={t('inspector.fields.addBorder')}
      hasContent={hasBorder}
      onAdd={() => {
        onStyleChange('borderPosition', styleDraft.borderPosition || 'inside');
        onStyleChange('borderWidth', styleDraft.borderWidth || '1');
        onStyleChange('borderStyle', styleDraft.borderStyle || 'solid');
        onStyleChange('borderColor', styleDraft.borderColor || '#000000');
        onStyleChange('borderOpacity', styleDraft.borderOpacity || '100');
      }}
      onRemove={() => {
        onStyleChange('borderWidth', '');
        onStyleChange('borderStyle', '');
        onStyleChange('borderColor', '');
        onStyleChange('borderOpacity', '');
      }}
      removeLabel={t('inspector.fields.removeBorder')}
      title={t('inspector.fields.border')}
    >
      <StyleInput ariaLabel={t('inspector.fields.borderWeight')} fieldKey="borderWidth" label={t('inspector.fields.borderWeight')} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
      <StyleInput fieldKey="borderColor" label={t('inspector.fields.borderColor')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} swatch />
      <StyleInput fieldKey="borderOpacity" label={t('inspector.fields.borderOpacity')} max={100} min={0} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="%" />
    </AddRemoveSection>
  );
}

function ShadowBlurSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  styleDraft: StyleDraft;
}) {
  const { t } = useTranslation();
  const hasShadow = Boolean(styleDraft.boxShadow || styleDraft.shadowX || styleDraft.shadowY || styleDraft.shadowBlur || styleDraft.shadowColor);

  return (
    <AddRemoveSection
      addLabel={t('inspector.fields.addShadow')}
      hasContent={hasShadow}
      onAdd={() => {
        onStyleChange('shadowX', styleDraft.shadowX || '0');
        onStyleChange('shadowY', styleDraft.shadowY || '8');
        onStyleChange('shadowSpread', styleDraft.shadowSpread || '0');
        onStyleChange('shadowBlur', styleDraft.shadowBlur || '24');
        onStyleChange('shadowColor', styleDraft.shadowColor || '#000000');
        onStyleChange('shadowOpacity', styleDraft.shadowOpacity || '25');
      }}
      onRemove={() => {
        onStyleChange('boxShadow', '');
        onStyleChange('shadowX', '');
        onStyleChange('shadowY', '');
        onStyleChange('shadowSpread', '');
        onStyleChange('shadowBlur', '');
        onStyleChange('shadowColor', '');
        onStyleChange('shadowOpacity', '');
      }}
      removeLabel={t('inspector.fields.removeShadow')}
      title={t('inspector.fields.shadowBlur')}
    >
      <FieldRow>
        <StyleInput ariaLabel={t('inspector.fields.shadowX')} fieldKey="shadowX" label="X" onStyleChange={onStyleChange} styleDraft={styleDraft} />
        <StyleInput ariaLabel={t('inspector.fields.shadowY')} fieldKey="shadowY" label="Y" onStyleChange={onStyleChange} styleDraft={styleDraft} />
      </FieldRow>
      <FieldRow>
        <StyleInput ariaLabel={t('inspector.fields.shadowSpread')} fieldKey="shadowSpread" label={t('inspector.fields.shadowSpread')} onStyleChange={onStyleChange} styleDraft={styleDraft} />
        <StyleInput ariaLabel={t('inspector.fields.shadowBlurValue')} fieldKey="shadowBlur" label={t('inspector.fields.shadowBlurValue')} onStyleChange={onStyleChange} styleDraft={styleDraft} />
      </FieldRow>
      <StyleInput fieldKey="shadowColor" label={t('inspector.fields.shadowColor')} onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} swatch />
      <StyleInput fieldKey="shadowOpacity" label={t('inspector.fields.shadowOpacity')} max={100} min={0} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="%" />
    </AddRemoveSection>
  );
}

function LayoutSection({
  onStyleChange,
  showContainerControls,
  styleDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  showContainerControls: boolean;
  styleDraft: StyleDraft;
}) {
  const { t } = useTranslation();
  const [paddingExpanded, setPaddingExpanded] = React.useState(false);
  const [marginExpanded, setMarginExpanded] = React.useState(false);

  return (
    <PropertySection title={t('inspector.fields.layout')}>
      {showContainerControls ? (
        <CompactSegmentedControl
          testId="canvas-property-layout-flow"
          label={t('inspector.fields.flow')}
          onValueChange={(value) => onStyleChange('displayMode', value)}
          options={[
            { ariaLabel: t('inspector.fields.flowRow'), label: '↔', value: 'flex' },
            { ariaLabel: t('inspector.fields.flowColumn'), label: '↕', value: 'flex-col' },
            { ariaLabel: t('inspector.fields.flowWrap'), label: '↪', value: 'flex-wrap' },
            { ariaLabel: t('inspector.fields.flowGrid'), label: '▦', value: 'grid' },
          ]}
          value={styleDraft.displayMode ?? 'block'}
        />
      ) : null}
      <Subheading>{t('inspector.fields.dimensions')}</Subheading>
      <FieldRow data-testid="canvas-property-dimensions-row">
        <CompactStyleInput ariaLabel={t('inspector.fields.width')} fieldKey="width" label="W" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix={styleDraft.widthUnit || 'px'} />
        <CompactStyleInput ariaLabel={t('inspector.fields.height')} fieldKey="height" label="H" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix={styleDraft.heightUnit || 'px'} />
      </FieldRow>
      {showContainerControls ? (
        <>
          <Subheading>{t('inspector.fields.alignment')}</Subheading>
          <AlignmentGrid
            alignItems={styleDraft.alignItems || 'normal'}
            justifyContent={styleDraft.justifyContent || 'normal'}
            onAlignChange={(value) => onStyleChange('alignItems', value)}
            onJustifyChange={(value) => onStyleChange('justifyContent', value)}
          />
          <FieldRow>
            <CompactStyleInput ariaLabel={t('inspector.fields.gap')} fieldKey="gap" label={t('inspector.fields.gap')} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
            <CompactStyleInput ariaLabel={t('inspector.fields.columnGap')} fieldKey="columnGap" label="Col" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          </FieldRow>
          <CompactStyleInput ariaLabel={t('inspector.fields.rowGap')} fieldKey="rowGap" label={t('inspector.fields.rows')} onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          {styleDraft.displayMode === 'grid' ? (
            <>
              <Subheading>{t('inspector.fields.gridTemplate')}</Subheading>
              <StyleInput
                ariaLabel={t('inspector.fields.columns')}
                fieldKey="gridTemplateColumns"
                label={t('inspector.fields.columns')}
                onStyleChange={onStyleChange}
                parseAsNumber={false}
                styleDraft={styleDraft}
              />
              <StyleInput
                ariaLabel={t('inspector.fields.rows')}
                fieldKey="gridTemplateRows"
                label={t('inspector.fields.rows')}
                onStyleChange={onStyleChange}
                parseAsNumber={false}
                styleDraft={styleDraft}
              />
            </>
          ) : null}
        </>
      ) : null}
      <Subheading>{t('inspector.fields.padding')}</Subheading>
      <FieldRow data-testid="canvas-property-field-row-padding">
        <CompactStyleInput ariaLabel={t('inspector.fields.paddingVertical')} fieldKey="paddingVertical" label="↕" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
        <CompactStyleInput ariaLabel={t('inspector.fields.paddingHorizontal')} fieldKey="paddingHorizontal" label="↔" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
      </FieldRow>
      <ExpandButton expanded={paddingExpanded} label={t('inspector.fields.separatePadding')} onClick={() => setPaddingExpanded((current) => !current)} />
      {paddingExpanded ? (
        <>
          <FieldRow>
            <CompactStyleInput ariaLabel={t('inspector.fields.paddingTop')} fieldKey="paddingTop" label="T" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
            <CompactStyleInput ariaLabel={t('inspector.fields.paddingRight')} fieldKey="paddingRight" label="R" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          </FieldRow>
          <FieldRow>
            <CompactStyleInput ariaLabel={t('inspector.fields.paddingBottom')} fieldKey="paddingBottom" label="B" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
            <CompactStyleInput ariaLabel={t('inspector.fields.paddingLeft')} fieldKey="paddingLeft" label="L" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          </FieldRow>
        </>
      ) : null}
      <Subheading>{t('inspector.fields.margin')}</Subheading>
      <FieldRow>
        <CompactStyleInput ariaLabel={t('inspector.fields.marginVertical')} fieldKey="marginVertical" label="↕" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
        <CompactStyleInput ariaLabel={t('inspector.fields.marginHorizontal')} fieldKey="marginHorizontal" label="↔" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
      </FieldRow>
      <ExpandButton expanded={marginExpanded} label={t('inspector.fields.separateMargin')} onClick={() => setMarginExpanded((current) => !current)} />
      {marginExpanded ? (
        <>
          <FieldRow>
            <CompactStyleInput ariaLabel={t('inspector.fields.marginTop')} fieldKey="marginTop" label="T" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
            <CompactStyleInput ariaLabel={t('inspector.fields.marginRight')} fieldKey="marginRight" label="R" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          </FieldRow>
          <FieldRow>
            <CompactStyleInput ariaLabel={t('inspector.fields.marginBottom')} fieldKey="marginBottom" label="B" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
            <CompactStyleInput ariaLabel={t('inspector.fields.marginLeft')} fieldKey="marginLeft" label="L" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          </FieldRow>
        </>
      ) : null}
    </PropertySection>
  );
}

function PositionSection({
  onStyleChange,
  styleDraft,
}: {
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  styleDraft: StyleDraft;
}) {
  const { t } = useTranslation();
  const showsOffsetControls = (styleDraft.positionType ?? 'static').trim() !== 'static';

  function rotateCounterclockwise(): void {
    const currentAngle = Number.parseFloat(styleDraft.angle || '0');
    const nextAngle = Number.isNaN(currentAngle) ? -90 : currentAngle - 90;
    onStyleChange('angle', String(nextAngle));
  }

  return (
    <PropertySection title={t('inspector.fields.position')}>
      {showsOffsetControls ? (
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2" data-testid="canvas-property-position-grid">
          <CompactStyleInput ariaLabel={t('inspector.fields.xPosition')} fieldKey="positionX" label="X" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          <CompactStyleInput ariaLabel={t('inspector.fields.yPosition')} fieldKey="positionY" label="Y" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="px" />
          <CompactStyleInput ariaLabel={t('inspector.fields.zPosition')} fieldKey="positionZ" label="Z" onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))] gap-2">
        <CompactStyleInput ariaLabel={t('inspector.fields.rotationAngle')} fieldKey="angle" label="∠" onStyleChange={onStyleChange} styleDraft={styleDraft} suffix="°" />
        <Button
          aria-label={t('inspector.actions.rotateCounterclockwise')}
          className={sourceLikeButtonClass}
          onClick={rotateCounterclockwise}
          size="xs"
          type="button"
          variant="chrome"
        >
          ↺
        </Button>
        <ToggleStyleButton fieldKey="flipHorizontal" label={t('inspector.fields.flipHorizontal')} onStyleChange={onStyleChange} styleDraft={styleDraft}>
          ⇋
        </ToggleStyleButton>
        <ToggleStyleButton fieldKey="flipVertical" label={t('inspector.fields.flipVertical')} onStyleChange={onStyleChange} styleDraft={styleDraft}>
          ⇅
        </ToggleStyleButton>
      </div>
      {showsOffsetControls ? (
        <FieldRow>
          <CompactStyleInput ariaLabel={t('inspector.fields.rightPosition')} fieldKey="positionRight" label="R" onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
          <CompactStyleInput ariaLabel={t('inspector.fields.bottomPosition')} fieldKey="positionBottom" label="B" onStyleChange={onStyleChange} parseAsNumber={false} styleDraft={styleDraft} />
        </FieldRow>
      ) : null}
      <CompactStyleInput
        ariaLabel={t('inspector.fields.positionType')}
        fieldKey="positionType"
        label={t('inspector.fields.mode')}
        onStyleChange={onStyleChange}
        parseAsNumber={false}
        styleDraft={styleDraft}
      />
    </PropertySection>
  );
}

function CompactStyleInput({
  ariaLabel,
  fieldKey,
  label,
  onStyleChange,
  parseAsNumber = true,
  styleDraft,
  suffix,
}: {
  ariaLabel: string;
  fieldKey: CanvasInspectorStyleKey;
  label: string;
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  parseAsNumber?: boolean;
  styleDraft: StyleDraft;
  suffix?: string;
}) {
  const id = React.useId();

  return (
    <SourceLikeInput
      ariaLabel={ariaLabel}
      compact
      fallbackValue={STYLE_INPUT_FALLBACKS[fieldKey]}
      id={id}
      labelPrefix={label}
      onChange={(value) => onStyleChange(fieldKey, value)}
      parseAsNumber={parseAsNumber}
      suffix={suffix}
      value={styleDraft[fieldKey] ?? ''}
    />
  );
}

function CompactSegmentedControl({
  label,
  onValueChange,
  options,
  testId,
  value,
}: {
  label: string;
  onValueChange: (value: string) => void;
  options: Array<{ ariaLabel: string; label: string; value: string }>;
  testId?: string;
  value: string;
}) {
  return (
    <StackedField label={label}>
      <div
        aria-label={label}
        className="grid h-9 min-w-0 grid-cols-4 gap-1 rounded-md bg-transparency-block p-1"
        data-testid={testId}
        role="group"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              aria-label={option.ariaLabel}
              aria-pressed={selected}
              className={cn(
                'flex min-w-0 items-center justify-center rounded-[5px] text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30',
                selected ? 'bg-background-fronted text-foreground' : 'text-text-secondary hover:bg-transparency-hover hover:text-foreground',
              )}
              key={option.value}
              onClick={() => onValueChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </StackedField>
  );
}

function AlignmentGrid({
  alignItems,
  justifyContent,
  onAlignChange,
  onJustifyChange,
}: {
  alignItems: string;
  justifyContent: string;
  onAlignChange: (value: string) => void;
  onJustifyChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const columns = [
    { label: t('inspector.fields.left'), value: 'flex-start' },
    { label: t('inspector.fields.center'), value: 'center' },
    { label: t('inspector.fields.right'), value: 'flex-end' },
  ];
  const rows = [
    { label: t('inspector.fields.top'), value: 'flex-start' },
    { label: t('inspector.fields.middle'), value: 'center' },
    { label: t('inspector.fields.bottom'), value: 'flex-end' },
  ];

  return (
    <StackedField label={t('inspector.fields.alignment')}>
      <div
        aria-label={t('inspector.fields.alignment')}
        className="grid aspect-[3/2] min-h-20 grid-cols-3 gap-1 rounded-md bg-transparency-block p-2"
        data-testid="canvas-property-alignment-grid"
        role="group"
      >
        {rows.flatMap((row) =>
          columns.map((column) => {
            const selected = alignItems === row.value && justifyContent === column.value;
            return (
              <button
                aria-label={t('inspector.fields.alignGrid', {
                  horizontal: column.label.toLowerCase(),
                  vertical: row.label.toLowerCase(),
                })}
                aria-pressed={selected}
                className={cn(
                  'flex items-center justify-center rounded-[5px] text-[10px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30',
                  selected ? 'bg-background-fronted text-foreground' : 'text-text-secondary hover:bg-transparency-hover hover:text-foreground',
                )}
                key={`${row.value}-${column.value}`}
                onClick={() => {
                  onAlignChange(row.value);
                  onJustifyChange(column.value);
                }}
                type="button"
              >
                •
              </button>
            );
          }),
        )}
      </div>
    </StackedField>
  );
}

function StackedField({
  children,
  label,
}: {
  children: React.ReactNode | ((id: string) => React.ReactNode);
  label: string;
}) {
  const id = React.useId();
  const control = typeof children === 'function' ? children(id) : children;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-xs text-text-secondary" htmlFor={id}>
        {label}
      </label>
      {control}
    </div>
  );
}

function StyleInput({
  ariaLabel,
  fieldKey,
  label,
  max,
  min,
  onStyleChange,
  parseAsNumber = true,
  styleDraft,
  suffix,
  swatch = false,
}: {
  ariaLabel?: string;
  fieldKey: CanvasInspectorStyleKey;
  label: string;
  max?: number;
  min?: number;
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  parseAsNumber?: boolean;
  styleDraft: StyleDraft;
  suffix?: string;
  swatch?: boolean;
}) {
  return (
    <StackedField label={label}>
      {(id) => (
        <SourceLikeInput
          id={id}
          ariaLabel={ariaLabel ?? label}
          max={max}
          min={min}
          onChange={(value) => onStyleChange(fieldKey, value)}
          parseAsNumber={parseAsNumber}
          fallbackValue={STYLE_INPUT_FALLBACKS[fieldKey]}
          suffix={suffix}
          swatch={swatch ? styleDraft[fieldKey] : undefined}
          value={styleDraft[fieldKey] ?? ''}
        />
      )}
    </StackedField>
  );
}

function SourceLikeInput({
  ariaLabel,
  compact = false,
  fallbackValue,
  id,
  labelPrefix,
  max,
  min,
  onChange,
  parseAsNumber,
  suffix,
  swatch,
  value,
}: {
  ariaLabel: string;
  compact?: boolean;
  fallbackValue?: string;
  id: string;
  labelPrefix?: string;
  max?: number;
  min?: number;
  onChange: (value: string) => void;
  parseAsNumber: boolean;
  suffix?: string;
  swatch?: string;
  value: string;
}) {
  const displayValue = value || fallbackValue || '';
  const [localValue, setLocalValue] = React.useState(displayValue);

  React.useEffect(() => {
    setLocalValue(displayValue);
  }, [displayValue]);

  function normalize(rawValue: string): string {
    if (!parseAsNumber) return rawValue;
    const numericValue = Number.parseFloat(rawValue);
    if (Number.isNaN(numericValue)) return rawValue;
    const clampedValue = Math.min(max ?? numericValue, Math.max(min ?? numericValue, numericValue));
    return String(clampedValue);
  }

  function commit(rawValue = localValue): void {
    if (!value && fallbackValue !== undefined && rawValue === fallbackValue) {
      setLocalValue(fallbackValue);
      return;
    }

    const nextValue = normalize(rawValue);
    setLocalValue(nextValue);
    if (nextValue === value) {
      return;
    }
    onChange(nextValue);
  }

  function nudge(delta: number): void {
    const numericValue = Number.parseFloat(localValue);
    const nextValue = Number.isNaN(numericValue) ? delta : numericValue + delta;
    commit(String(nextValue));
  }

  function changeColor(nextValue: string): void {
    setLocalValue(nextValue);
    onChange(nextValue);
  }

  const input = (
    <Input
      aria-label={ariaLabel}
      className={cn(compact ? 'h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-xs text-foreground shadow-none focus-visible:ring-0' : controlClass, suffix ? 'pr-8' : undefined)}
      id={id}
      onBlur={() => commit()}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        const nextValue = event.currentTarget.value;
        setLocalValue(nextValue);
        onChange(nextValue);
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
        if (parseAsNumber && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          nudge(event.key === 'ArrowUp' ? (event.shiftKey ? 10 : 1) : event.shiftKey ? -10 : -1);
        }
      }}
      value={localValue}
    />
  );

  if (compact) {
    return (
      <div className="relative flex h-8 min-w-0 items-center overflow-hidden rounded-md border border-border-1 bg-transparency-block focus-within:ring-2 focus-within:ring-ring/30">
        {labelPrefix ? (
          <label className="flex h-full min-w-7 shrink-0 items-center justify-center border-r border-border-1 px-2 text-[11px] text-text-secondary" htmlFor={id}>
            {labelPrefix}
          </label>
        ) : null}
        {input}
        {suffix ? (
          <span aria-hidden="true" className="pointer-events-none absolute right-2 text-[11px] text-text-secondary">
            {suffix}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative flex min-w-0 items-center gap-1.5">
      {swatch !== undefined ? (
        <HexColorPopover
          className="size-8"
          label={ariaLabel}
          value={swatch || localValue}
          onChange={changeColor}
        />
      ) : null}
      {input}
      {suffix ? (
        <span aria-hidden="true" className="pointer-events-none absolute right-2 text-[11px] text-text-secondary">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function FieldRow({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 [&>*]:min-w-0" {...props}>
      {children}
    </div>
  );
}

function Subheading({ children }: { children: React.ReactNode }) {
  return <div className="pt-1 text-[11px] font-medium uppercase text-text-secondary">{children}</div>;
}

function ExpandButton({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-label={label}
      className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-xs text-text-secondary outline-none transition hover:bg-transparency-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span aria-hidden="true" className={cn('flex size-4 items-center justify-center transition-transform', expanded ? 'rotate-0' : '-rotate-90')}>
        <ChevronDownIcon />
      </span>
    </button>
  );
}

function SegmentedControl({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string;
  onValueChange: (value: string) => void;
  options: Array<{ ariaLabel: string; label: string; value: string }>;
  value: string;
}) {
  return (
    <StackedField label={label}>
      <div aria-label={label} className="grid h-8 min-w-0 grid-flow-col rounded-md bg-transparency-block p-0.5" role="group">
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <button
              aria-label={option.ariaLabel}
              aria-pressed={selected}
              className={cn(
                'min-w-0 rounded-[5px] px-2 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30',
                selected ? 'bg-background-fronted text-foreground' : 'text-text-secondary hover:bg-transparency-hover hover:text-foreground',
              )}
              key={option.value}
              onClick={() => onValueChange(option.value)}
              type="button"
            >
              <span className="block truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </StackedField>
  );
}

function ToggleStyleButton({
  children,
  fieldKey,
  label,
  onStyleChange,
  styleDraft,
}: {
  children: React.ReactNode;
  fieldKey: CanvasInspectorStyleKey;
  label: string;
  onStyleChange: CanvasPropertyInspectorProps['onStyleChange'];
  styleDraft: StyleDraft;
}) {
  const pressed = styleDraft[fieldKey] === 'true';

  return (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className={sourceLikeButtonClass}
      onClick={() => onStyleChange(fieldKey, pressed ? 'false' : 'true')}
      size="xs"
      type="button"
      variant="chrome"
    >
      {children}
    </Button>
  );
}

function EmptyState({
  onHoverTarget,
  onSelectTarget,
  targetList,
}: {
  onHoverTarget?: (targetId: string | null) => void;
  onSelectTarget?: (targetId: string) => void;
  targetList: CanvasPropertyInspectorProps['targetList'];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col gap-4 px-4 py-4">
      <div className="flex flex-1 items-center justify-center rounded-md bg-transparency-block px-4 py-8 text-center text-xs text-text-secondary">
        {t('inspector.empty.selectNode')}
      </div>
      {targetList && targetList.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase text-text-secondary">{t('inspector.empty.editableNodes')}</div>
          <div className="flex flex-col gap-1">
            {targetList.map((target) => (
              <ExplorerRow
                hovered={false}
                key={target.id}
                onHoverTarget={onHoverTarget}
                onSelectTarget={onSelectTarget}
                selected={false}
                target={target}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
