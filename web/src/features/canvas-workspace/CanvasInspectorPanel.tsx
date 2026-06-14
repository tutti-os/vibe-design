import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EditableNode } from './canvas-edit/types';
import { CanvasPropertyInspector } from './canvas-property-inspector';
import { useTranslation } from '../../i18n';

export interface CanvasInspectorDraft {
  id: string;
  text?: string;
  styles: CanvasInspectorStyleDraft;
}

interface InspectorEditEntry {
  targetId: string;
  key: CanvasInspectorStyleKey | '__text__';
  prev: string;
  next: string;
}

interface InspectorDraftBucket {
  snapshot: string;
  baselineText: string;
  currentText: string;
  baselineStyles: Record<CanvasInspectorStyleKey, string>;
  currentStyles: Record<CanvasInspectorStyleKey, string>;
}

interface CanvasInspectorStyleNormalizationResult {
  styles: CanvasInspectorStyleDraft;
  error: string | null;
}

export interface CanvasInspectorPanelProps {
  selectedTarget?: EditableNode | null;
  hoveredTarget?: EditableNode | null;
  targets?: EditableNode[];
  onHoverTarget?: (target: EditableNode | null) => void;
  onSaveDraft?: (draft: CanvasInspectorDraft) => void;
  onCancelDraft?: () => void;
  onPreviewDraft?: (draft: CanvasInspectorDraft | null) => void;
  onSelectTarget?: (target: EditableNode | null) => void;
  uploadBackgroundImage?: (file: File) => Promise<string>;
}

export type CanvasInspectorStyleKey =
  | 'fontFamily'
  | 'fontSize'
  | 'color'
  | 'backgroundColor'
  | 'backgroundOpacity'
  | 'backgroundImage'
  | 'backgroundGradient'
  | 'fillType'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textAlign'
  | 'verticalAlign'
  | 'imageSrc'
  | 'objectFit'
  | 'objectPosition'
  | 'paddingVertical'
  | 'paddingHorizontal'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'marginVertical'
  | 'marginHorizontal'
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom'
  | 'marginLeft'
  | 'borderRadius'
  | 'radiusTopLeft'
  | 'radiusTopRight'
  | 'radiusBottomRight'
  | 'radiusBottomLeft'
  | 'borderPosition'
  | 'borderWidth'
  | 'borderStyle'
  | 'borderColor'
  | 'borderOpacity'
  | 'shadowX'
  | 'shadowY'
  | 'shadowSpread'
  | 'shadowBlur'
  | 'shadowColor'
  | 'shadowOpacity'
  | 'boxShadow'
  | 'opacity'
  | 'positionX'
  | 'positionY'
  | 'positionZ'
  | 'angle'
  | 'flipHorizontal'
  | 'flipVertical'
  | 'transform'
  | 'width'
  | 'height'
  | 'positionType'
  | 'positionRight'
  | 'positionBottom'
  | 'displayMode'
  | 'display'
  | 'flexDirection'
  | 'flexWrap'
  | 'widthUnit'
  | 'heightUnit'
  | 'justifyContent'
  | 'alignItems'
  | 'gap'
  | 'rowGap'
  | 'columnGap'
  | 'gridTemplateColumns'
  | 'gridTemplateRows'
  | 'backgroundFillType'
  | 'fontStyle'
  | 'textDecoration';

export type CanvasInspectorStyleDraft = Partial<Record<CanvasInspectorStyleKey, string>>;

const STYLE_FIELD_CSS_NAMES: Record<CanvasInspectorStyleKey, string> = {
  fontFamily: 'font-family',
  fontSize: 'font-size',
  color: 'color',
  backgroundColor: 'background-color',
  backgroundOpacity: 'background-opacity',
  backgroundImage: 'background-image',
  backgroundGradient: 'background-image',
  fillType: 'background-fill-type',
  fontWeight: 'font-weight',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  textAlign: 'text-align',
  verticalAlign: 'vertical-align',
  imageSrc: 'src',
  objectFit: 'object-fit',
  objectPosition: 'object-position',
  paddingVertical: 'padding-vertical',
  paddingHorizontal: 'padding-horizontal',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  marginVertical: 'margin-vertical',
  marginHorizontal: 'margin-horizontal',
  marginTop: 'margin-top',
  marginRight: 'margin-right',
  marginBottom: 'margin-bottom',
  marginLeft: 'margin-left',
  borderRadius: 'border-radius',
  radiusTopLeft: 'border-top-left-radius',
  radiusTopRight: 'border-top-right-radius',
  radiusBottomRight: 'border-bottom-right-radius',
  radiusBottomLeft: 'border-bottom-left-radius',
  borderPosition: 'border-position',
  borderWidth: 'border-width',
  borderStyle: 'border-style',
  borderColor: 'border-color',
  borderOpacity: 'border-opacity',
  shadowX: 'shadow-x',
  shadowY: 'shadow-y',
  shadowSpread: 'shadow-spread',
  shadowBlur: 'shadow-blur',
  shadowColor: 'shadow-color',
  shadowOpacity: 'shadow-opacity',
  boxShadow: 'box-shadow',
  opacity: 'opacity',
  positionX: 'left',
  positionY: 'top',
  positionZ: 'z-index',
  angle: 'angle',
  flipHorizontal: 'flip-horizontal',
  flipVertical: 'flip-vertical',
  transform: 'transform',
  width: 'width',
  height: 'height',
  positionType: 'position',
  positionRight: 'right',
  positionBottom: 'bottom',
  displayMode: 'display',
  display: 'display',
  flexDirection: 'flex-direction',
  flexWrap: 'flex-wrap',
  widthUnit: 'width-unit',
  heightUnit: 'height-unit',
  justifyContent: 'justify-content',
  alignItems: 'align-items',
  gap: 'gap',
  rowGap: 'row-gap',
  columnGap: 'column-gap',
  gridTemplateColumns: 'grid-template-columns',
  gridTemplateRows: 'grid-template-rows',
  backgroundFillType: 'background-fill-type',
  fontStyle: 'font-style',
  textDecoration: 'text-decoration',
};

export function CanvasInspectorPanel({
  selectedTarget,
  hoveredTarget,
  targets = [],
  onHoverTarget,
  onSaveDraft,
  onCancelDraft,
  onPreviewDraft,
  onSelectTarget,
  uploadBackgroundImage,
}: CanvasInspectorPanelProps) {
  const { t } = useTranslation();
  const activeTarget = selectedTarget ?? null;
  const [textDraft, setTextDraft] = useState('');
  const [styleDraft, setStyleDraft] = useState<Record<CanvasInspectorStyleKey, string>>(emptyStyleDraft);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [editEntries, setEditEntries] = useState<InspectorEditEntry[]>([]);
  const [redoEntries, setRedoEntries] = useState<InspectorEditEntry[]>([]);
  const [draftBuckets, setDraftBuckets] = useState<Record<string, InspectorDraftBucket>>({});
  const previousTargetIdRef = useRef<string | null>(null);
  const observedStyleDraft = useMemo(() => styleDraftForTarget(activeTarget), [activeTarget]);
  const activeTargetDraftBaseline = useMemo(
    () =>
      JSON.stringify({
        id: activeTarget?.id ?? null,
        text: activeTarget?.fields.text ?? activeTarget?.text ?? '',
        styles: observedStyleDraft,
      }),
    [activeTarget?.fields.text, activeTarget?.id, activeTarget?.text, observedStyleDraft],
  );

  useEffect(() => {
    if (!activeTarget) {
      previousTargetIdRef.current = null;
      setTextDraft('');
      setStyleDraft(emptyStyleDraft());
      setStyleError(null);
      setDraftBuckets((currentBuckets) => (Object.keys(currentBuckets).length === 0 ? currentBuckets : {}));
      setEditEntries([]);
      setRedoEntries([]);
      return;
    }

    const targetChanged = previousTargetIdRef.current !== activeTarget.id;
    previousTargetIdRef.current = activeTarget.id;
    const baseline = {
      snapshot: activeTargetDraftBaseline,
      baselineText: activeTarget.fields.text ?? activeTarget.text ?? '',
      currentText: activeTarget.fields.text ?? activeTarget.text ?? '',
      baselineStyles: observedStyleDraft,
      currentStyles: observedStyleDraft,
    };
    const bucket = targetChanged ? undefined : draftBuckets[activeTarget.id];
    const nextBucket = bucket && bucket.snapshot === activeTargetDraftBaseline ? bucket : baseline;
    if (targetChanged || !bucket || bucket.snapshot !== activeTargetDraftBaseline) {
      setDraftBuckets({ [activeTarget.id]: nextBucket });
      if (targetChanged) {
        setEditEntries([]);
        setRedoEntries([]);
      }
    }
    setTextDraft(nextBucket.currentText);
    setStyleDraft(nextBucket.currentStyles);
    setStyleError(null);
  }, [activeTarget, activeTargetDraftBaseline, draftBuckets, observedStyleDraft]);

  const baselineText = activeTarget?.fields.text ?? activeTarget?.text ?? '';
  const activeBaselineStyles = activeTarget ? draftBuckets[activeTarget.id]?.baselineStyles ?? observedStyleDraft : observedStyleDraft;
  const activeDraftBucket = activeTarget ? draftBuckets[activeTarget.id] : null;
  const isActiveDraftReady =
    !activeTarget ||
    Boolean(
      activeDraftBucket &&
        activeDraftBucket.snapshot === activeTargetDraftBaseline &&
        activeDraftBucket.currentText === textDraft &&
        areStyleDraftsEqual(activeDraftBucket.currentStyles, styleDraft),
    );
  const editCount = editEntries.length;
  const canRedo = redoEntries.some((entry) => entry.targetId === activeTarget?.id);
  const hasDirtyDrafts = activeTarget
    ? hasDirtyDraftsForApply(draftBuckets, activeTarget.id, styleDraft, textDraft, activeBaselineStyles)
    : false;

  useEffect(() => {
    if (!activeTarget) {
      onPreviewDraft?.(null);
      return;
    }
    if (!isActiveDraftReady) {
      onPreviewDraft?.(null);
      return;
    }

    const baselineText = activeTarget.fields.text ?? activeTarget.text ?? '';
    const rawStyleDraft = rawStyleDraftForSave(styleDraft, activeBaselineStyles);
    const hasTextChange = textDraft !== baselineText;
    const hasStyleChange = Object.keys(rawStyleDraft).length > 0;
    const result = normalizeCanvasInspectorStyles(rawStyleDraft, styleDraft);
    setStyleError(result.error);

    if (!hasTextChange && !hasStyleChange) {
      onPreviewDraft?.(null);
      return;
    }

    onPreviewDraft?.({
      id: activeTarget.id,
      ...(hasTextChange ? { text: textDraft } : {}),
      styles: result.error ? {} : result.styles,
    });
  }, [activeTarget, isActiveDraftReady, observedStyleDraft, onPreviewDraft, styleDraft, textDraft]);

  function saveDraft() {
    if (!activeTarget) {
      return;
    }

    const dirtyBuckets = activeTarget ? dirtyDraftsForApply(draftBuckets, activeTarget.id, styleDraft, textDraft, activeBaselineStyles) : [];
    const result = normalizeCanvasInspectorStyles(rawStyleDraftForSave(styleDraft, activeBaselineStyles), styleDraft);
    setStyleError(result.error);

    if (result.error) {
      return;
    }

    if (dirtyBuckets.length === 0) {
      return;
    }

    const draftsToSave = dirtyBuckets;
    draftsToSave.forEach((draft) => onSaveDraft?.(draft));
    const activeDraft = draftsToSave.find((draft) => draft.id === activeTarget.id);
    const nextActiveStyles = { ...styleDraft, ...rebaselineStyleDraftAfterSave(activeDraft?.styles ?? {}) };
    setTextDraft(activeDraft?.text ?? (activeTarget.fields.text ?? activeTarget.text ?? ''));
    setStyleDraft(nextActiveStyles);
    setDraftBuckets({
      [activeTarget.id]: {
        snapshot: activeTargetDraftBaseline,
        baselineText: activeDraft?.text ?? (activeTarget.fields.text ?? activeTarget.text ?? ''),
        currentText: activeDraft?.text ?? (activeTarget.fields.text ?? activeTarget.text ?? ''),
        baselineStyles: nextActiveStyles,
        currentStyles: nextActiveStyles,
      },
    });
    setEditEntries([]);
    setRedoEntries([]);
    setStyleError(null);
  }

  function cancelDraft() {
    setTextDraft(activeTarget?.fields.text ?? activeTarget?.text ?? '');
    setStyleDraft(observedStyleDraft);
    setEditEntries([]);
    setRedoEntries([]);
    setStyleError(null);
    onPreviewDraft?.(null);
    onCancelDraft?.();
  }

  function updateStyleDraft(key: CanvasInspectorStyleKey, value: string) {
    if (activeTarget && styleDraft[key] !== value) {
      setEditEntries((currentEntries) => [
        ...currentEntries,
        { targetId: activeTarget.id, key, prev: styleDraft[key] ?? '', next: value },
      ]);
      setRedoEntries([]);
    }
    if (activeTarget) {
      setDraftBuckets((currentBuckets) => {
        const bucket = currentBuckets[activeTarget.id] ?? {
          snapshot: activeTargetDraftBaseline,
          baselineText,
          currentText: textDraft,
          baselineStyles: activeBaselineStyles,
          currentStyles: styleDraft,
        };
        return {
          ...currentBuckets,
          [activeTarget.id]: {
            ...bucket,
            currentStyles: { ...bucket.currentStyles, [key]: value },
          },
        };
      });
    }
    setStyleDraftValue(key, value, setStyleDraft);
  }

  function updateStyleDrafts(patch: CanvasInspectorStyleDraft) {
    if (!activeTarget) {
      return;
    }

    const entries = Object.entries(patch)
      .filter((entry): entry is [CanvasInspectorStyleKey, string] => entry[1] !== undefined)
      .filter(([key, value]) => styleDraft[key] !== value)
      .map(([key, value]) => ({ targetId: activeTarget.id, key, prev: styleDraft[key] ?? '', next: value }));

    if (entries.length > 0) {
      setEditEntries((currentEntries) => [...currentEntries, ...entries]);
      setRedoEntries([]);
    }

    setDraftBuckets((currentBuckets) => {
      const bucket = currentBuckets[activeTarget.id] ?? {
        snapshot: activeTargetDraftBaseline,
        baselineText,
        currentText: textDraft,
        baselineStyles: activeBaselineStyles,
        currentStyles: styleDraft,
      };
      return {
        ...currentBuckets,
        [activeTarget.id]: {
          ...bucket,
          currentStyles: { ...bucket.currentStyles, ...patch },
        },
      };
    });
    setStyleDraft((currentDraft) => ({ ...currentDraft, ...patch }));
  }

  function updateTextDraft(value: string) {
    if (activeTarget && textDraft !== value) {
      setEditEntries((currentEntries) => [
        ...currentEntries,
        { targetId: activeTarget.id, key: '__text__', prev: textDraft, next: value },
      ]);
      setRedoEntries([]);
    }
    if (activeTarget) {
      setDraftBuckets((currentBuckets) => {
        const bucket = currentBuckets[activeTarget.id] ?? {
          snapshot: activeTargetDraftBaseline,
          baselineText,
          currentText: textDraft,
          baselineStyles: activeBaselineStyles,
          currentStyles: styleDraft,
        };
        return {
          ...currentBuckets,
          [activeTarget.id]: {
            ...bucket,
            currentText: value,
          },
        };
      });
    }
    setTextDraft(value);
  }

  function undoLastEdit() {
    const lastEntry = editEntries.at(-1);
    if (!lastEntry || !activeTarget || lastEntry.targetId !== activeTarget.id) {
      return;
    }

    setEditEntries((currentEntries) => currentEntries.slice(0, -1));
    setRedoEntries((currentEntries) => [...currentEntries, lastEntry]);
    applyInspectorEditValue(lastEntry, lastEntry.prev);
  }

  function redoLastEdit() {
    const lastEntry = redoEntries.at(-1);
    if (!lastEntry || !activeTarget || lastEntry.targetId !== activeTarget.id) {
      return;
    }

    setRedoEntries((currentEntries) => currentEntries.slice(0, -1));
    setEditEntries((currentEntries) => [...currentEntries, lastEntry]);
    applyInspectorEditValue(lastEntry, lastEntry.next);
  }

  function applyInspectorEditValue(entry: InspectorEditEntry, value: string) {
    if (!activeTarget) {
      return;
    }

    if (entry.key === '__text__') {
      setTextDraft(value);
      setDraftBuckets((currentBuckets) => {
        const bucket = currentBuckets[activeTarget.id];
        return bucket
          ? { ...currentBuckets, [activeTarget.id]: { ...bucket, currentText: value } }
          : currentBuckets;
      });
      return;
    }

    setStyleDraft((currentDraft) => ({ ...currentDraft, [entry.key]: value }));
    setDraftBuckets((currentBuckets) => {
      const bucket = currentBuckets[activeTarget.id];
      return bucket
        ? {
            ...currentBuckets,
            [activeTarget.id]: {
              ...bucket,
              currentStyles: { ...bucket.currentStyles, [entry.key]: value },
            },
          }
        : currentBuckets;
    });
  }

  function selectTargetById(targetId: string) {
    onSelectTarget?.(targets.find((target) => target.id === targetId) ?? null);
  }

  function hoverTargetById(targetId: string | null) {
    onHoverTarget?.(targetId ? targets.find((target) => target.id === targetId) ?? null : null);
  }

  const elementType = resolveInspectorElementType(activeTarget);

  return (
    <CanvasPropertyInspector
      activeTargetSelector={activeTarget?.selector}
      activeTargetTitle={activeTarget ? inspectorTitle(activeTarget, elementType, t) : t('inspector.editElement')}
      canRedo={canRedo}
      canSave={Boolean(activeTarget) && hasDirtyDrafts}
      canUndo={editCount > 0}
      editCount={editCount}
      elementType={elementType}
      error={styleError}
      hoveredTargetId={hoveredTarget?.id ?? null}
      onCancel={cancelDraft}
      onHoverTarget={hoverTargetById}
      onSave={saveDraft}
      onSelectTarget={selectTargetById}
      onStyleChange={updateStyleDraft}
      onStylePatch={updateStyleDrafts}
      onTextChange={updateTextDraft}
      onRedo={redoLastEdit}
      onUndo={undoLastEdit}
      selected={Boolean(activeTarget)}
      selectedTargetId={activeTarget?.id ?? null}
      styleDraft={styleDraft}
      targetList={targets.map((target) => ({
        id: target.id,
        childCount: target.childCount,
        depth: target.depth ?? 0,
        dirty: editEntries.some((entry) => entry.targetId === target.id),
        editable: target.editable,
        kind: target.kind,
        label: target.label,
        selector: target.selector,
        tagName: target.tagName,
      }))}
      textDraft={textDraft}
      uploadBackgroundImage={uploadBackgroundImage}
    />
  );
}

export type InspectorElementType = 'text' | 'image' | 'generic';

function resolveInspectorElementType(target: EditableNode | null): InspectorElementType {
  if (!target) return 'generic';
  const tagName = target.tagName.toLowerCase();
  if (target.kind === 'image' || tagName === 'img' || tagName === 'picture') return 'image';
  if (target.kind === 'text' || isTextTag(tagName)) return 'text';
  return 'generic';
}

function inspectorTitle(
  target: EditableNode,
  elementType: InspectorElementType,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (elementType === 'text') return t('inspector.editText');
  if (elementType === 'image') return t('inspector.editImage');
  return t('inspector.editTarget', { tag: target.tagName.toLowerCase() });
}

function isTextTag(tagName: string): boolean {
  return ['span', 'p', 'label', 'a', 'strong', 'em', 'b', 'i', 'small', 'mark', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName);
}

export function normalizeCanvasInspectorStyles(
  styles: CanvasInspectorStyleDraft,
  fullDraft: CanvasInspectorStyleDraft = styles,
): CanvasInspectorStyleNormalizationResult {
  const normalized: CanvasInspectorStyleDraft = {};

  for (const [key, value] of Object.entries(styles) as Array<[CanvasInspectorStyleKey, string | undefined]>) {
    const expansion = expandCanvasInspectorStyleValue(key, value ?? '', fullDraft);

    if (expansion.error) {
      return { styles: {}, error: expansion.error };
    }

    Object.assign(normalized, expansion.styles);
  }

  return { styles: normalized, error: null };
}

function expandCanvasInspectorStyleValue(
  key: CanvasInspectorStyleKey,
  value: string,
  fullDraft: CanvasInspectorStyleDraft,
): { styles: CanvasInspectorStyleDraft; error?: string } {
  const trimmedValue = value.trim();

  if (isInspectorOnlyStyleKey(key)) {
    return { styles: {} };
  }

  if ((key === 'backgroundOpacity' || key === 'borderOpacity') && trimmedValue === '') {
    return { styles: buildInspectorColorOpacityClearPatch(key, fullDraft) };
  }

  if (key === 'shadowOpacity' && trimmedValue === '') {
    return { styles: { boxShadow: buildInspectorBoxShadow(fullDraft) } };
  }

  if (trimmedValue === '') {
    if (key === 'backgroundGradient' && fullDraft.backgroundImage?.includes('url(')) return { styles: {} };
    if (key === 'paddingVertical') return { styles: { paddingTop: '', paddingBottom: '' } };
    if (key === 'paddingHorizontal') return { styles: { paddingLeft: '', paddingRight: '' } };
    if (key === 'marginVertical') return { styles: { marginTop: '', marginBottom: '' } };
    if (key === 'marginHorizontal') return { styles: { marginLeft: '', marginRight: '' } };
    return { styles: { [outputKeyForEmptyValue(key)]: '' } };
  }

  if (key === 'paddingVertical') {
    const nextValue = normalizePixelValue(trimmedValue);
    return { styles: { paddingTop: nextValue, paddingBottom: nextValue } };
  }

  if (key === 'paddingHorizontal') {
    const nextValue = normalizePixelValue(trimmedValue);
    return { styles: { paddingLeft: nextValue, paddingRight: nextValue } };
  }

  if (key === 'marginVertical') {
    const nextValue = normalizePixelValue(trimmedValue);
    return { styles: { marginTop: nextValue, marginBottom: nextValue } };
  }

  if (key === 'marginHorizontal') {
    const nextValue = normalizePixelValue(trimmedValue);
    return { styles: { marginLeft: nextValue, marginRight: nextValue } };
  }

  if (key === 'radiusTopLeft') return { styles: { radiusTopLeft: normalizePixelValue(trimmedValue) } };
  if (key === 'radiusTopRight') return { styles: { radiusTopRight: normalizePixelValue(trimmedValue) } };
  if (key === 'radiusBottomRight') return { styles: { radiusBottomRight: normalizePixelValue(trimmedValue) } };
  if (key === 'radiusBottomLeft') return { styles: { radiusBottomLeft: normalizePixelValue(trimmedValue) } };

  if (key === 'width' || key === 'height') {
    return { styles: { [key]: normalizeUnitValue(trimmedValue, fullDraft[key === 'width' ? 'widthUnit' : 'heightUnit']) } };
  }

  if (key === 'widthUnit' || key === 'heightUnit') {
    return { styles: {} };
  }

  if (key === 'displayMode') {
    return { styles: displayModeStylePatch(trimmedValue) };
  }

  if (isPositionOffsetStyleKey(key)) {
    return { styles: positionOffsetStylePatch(key, trimmedValue, fullDraft) };
  }

  if (key === 'gap' || key === 'rowGap' || key === 'columnGap') {
    return { styles: { [key]: normalizePixelValue(trimmedValue) } };
  }

  if (key === 'borderWidth') {
    return { styles: { borderWidth: normalizePixelValue(trimmedValue), borderStyle: visibleBorderStyle(fullDraft) } };
  }

  if (isPixelStyleKey(key)) {
    return { styles: { [key]: normalizePixelValue(trimmedValue) } };
  }

  if (key === 'opacity') {
    const opacity = normalizePercentOpacity(trimmedValue, 'Opacity');
    if (opacity.error) return { styles: {}, error: opacity.error };
    return { styles: { opacity: opacity.cssValue } };
  }

  if (key === 'backgroundOpacity' || key === 'borderOpacity' || key === 'shadowOpacity') {
    const opacity = normalizePercentOpacity(trimmedValue, styleLabelForKey(key));
    if (opacity.error) return { styles: {}, error: opacity.error };
    if (key === 'shadowOpacity') {
      return { styles: { boxShadow: buildInspectorBoxShadow(fullDraft, opacity.percentValue) } };
    }
    const styles = buildInspectorColorOpacityPatch(key, fullDraft, opacity.percentValue);
    return { styles: key === 'borderOpacity' ? { ...styles, borderStyle: visibleBorderStyle(fullDraft) } : styles };
  }

  if (key === 'textAlign' && !['left', 'center', 'right'].includes(trimmedValue)) {
    return { styles: {}, error: 'Text align must be one of: left, center, right.' };
  }

  if (key === 'verticalAlign' && !['top', 'middle', 'bottom'].includes(trimmedValue)) {
    return { styles: {}, error: 'Vertical align must be one of: top, middle, bottom.' };
  }

  if (isHexColorStyleKey(key) && !isHexColorValue(trimmedValue)) {
    return { styles: {}, error: `${styleLabelForKey(key)} must be a hex value like #111 or #111111.` };
  }

  if (key === 'borderColor') {
    return { styles: { borderColor: trimmedValue, borderStyle: visibleBorderStyle(fullDraft) } };
  }

  if (isShadowComponentKey(key)) {
    return { styles: { boxShadow: buildInspectorBoxShadow(fullDraft) } };
  }

  if (key === 'angle' || key === 'flipHorizontal' || key === 'flipVertical') {
    return { styles: { transform: buildInspectorTransform(fullDraft) } };
  }

  if (key === 'backgroundGradient') {
    return { styles: { backgroundImage: trimmedValue } };
  }

  return { styles: { [key]: trimmedValue } };
}

function outputKeyForEmptyValue(key: CanvasInspectorStyleKey): CanvasInspectorStyleKey {
  if (key === 'paddingVertical') return 'paddingTop';
  if (key === 'paddingHorizontal') return 'paddingLeft';
  if (key === 'marginVertical') return 'marginTop';
  if (key === 'marginHorizontal') return 'marginLeft';
  if (key === 'backgroundGradient') return 'backgroundImage';
  if (isShadowComponentKey(key)) return 'boxShadow';
  if (key === 'angle' || key === 'flipHorizontal' || key === 'flipVertical') return 'transform';
  return key;
}

function normalizePixelValue(value: string): string {
  return /^-?\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value;
}

function normalizeUnitValue(value: string, unit = 'px'): string {
  if (unit === 'auto' || value === 'auto') {
    return 'auto';
  }
  if (!value) {
    return '';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return `${value}${unit || 'px'}`;
  }
  return value;
}

function displayModeStylePatch(value: string): CanvasInspectorStyleDraft {
  if (value === 'flex') {
    return { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' };
  }
  if (value === 'flex-col') {
    return { display: 'flex', flexDirection: 'column', flexWrap: 'nowrap' };
  }
  if (value === 'flex-wrap') {
    return { display: 'flex', flexDirection: 'row', flexWrap: 'wrap' };
  }
  if (value === 'grid') {
    return { display: 'grid' };
  }
  return { display: value };
}

function positionOffsetStylePatch(
  key: Extract<CanvasInspectorStyleKey, 'positionX' | 'positionY' | 'positionRight' | 'positionBottom' | 'positionZ'>,
  value: string,
  fullDraft: CanvasInspectorStyleDraft,
): CanvasInspectorStyleDraft {
  const styles: CanvasInspectorStyleDraft = {
    [key]: key === 'positionZ' ? value : normalizePixelValue(value),
  };

  if (shouldPromoteStaticPosition(fullDraft)) {
    styles.positionType = 'relative';
  }

  return styles;
}

function shouldPromoteStaticPosition(fullDraft: CanvasInspectorStyleDraft): boolean {
  return fullDraft.positionType?.trim() === 'static';
}

function normalizePercentOpacity(value: string, label: string): { cssValue: string; percentValue: number; error?: string } {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return { cssValue: '', percentValue: 100, error: `${label} must be a number from 0 to 100.` };
  }
  const clampedValue = Math.min(100, Math.max(0, numericValue));
  return { cssValue: String(clampedValue / 100), percentValue: clampedValue };
}

function isInspectorOnlyStyleKey(key: CanvasInspectorStyleKey): boolean {
  return ['fillType', 'backgroundFillType', 'borderPosition', 'imageSrc', 'widthUnit', 'heightUnit'].includes(key);
}

function isPositionOffsetStyleKey(
  key: CanvasInspectorStyleKey,
): key is Extract<CanvasInspectorStyleKey, 'positionX' | 'positionY' | 'positionRight' | 'positionBottom' | 'positionZ'> {
  return ['positionX', 'positionY', 'positionRight', 'positionBottom', 'positionZ'].includes(key);
}

function isPixelStyleKey(key: CanvasInspectorStyleKey): boolean {
  return [
    'fontSize',
    'letterSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'borderRadius',
    'positionX',
    'positionY',
  ].includes(key);
}

function isHexColorStyleKey(key: CanvasInspectorStyleKey): boolean {
  return ['color', 'backgroundColor', 'borderColor', 'shadowColor'].includes(key);
}

function isShadowComponentKey(key: CanvasInspectorStyleKey): boolean {
  return ['shadowX', 'shadowY', 'shadowSpread', 'shadowBlur', 'shadowColor'].includes(key);
}

function buildInspectorColorOpacityPatch(
  key: 'backgroundOpacity' | 'borderOpacity',
  fullDraft: CanvasInspectorStyleDraft,
  opacity: number,
): CanvasInspectorStyleDraft {
  const colorKey = key === 'backgroundOpacity' ? 'backgroundColor' : 'borderColor';
  const defaultColor = key === 'backgroundOpacity' ? '#ffffff' : '#000000';
  const pairedColor = fullDraft[colorKey]?.trim() || defaultColor;

  if (opacity >= 100 || Number.isNaN(opacity)) {
    return { [colorKey]: pairedColor };
  }

  const rgbColor = parseInspectorRgbColor(pairedColor) ?? parseInspectorRgbColor(defaultColor);
  return { [colorKey]: rgbColor ? rgbToRgba(rgbColor, opacity / 100) : defaultColor };
}

function buildInspectorColorOpacityClearPatch(
  key: 'backgroundOpacity' | 'borderOpacity',
  fullDraft: CanvasInspectorStyleDraft,
): CanvasInspectorStyleDraft {
  const colorKey = key === 'backgroundOpacity' ? 'backgroundColor' : 'borderColor';
  const pairedColor = fullDraft[colorKey]?.trim();
  return pairedColor ? { [colorKey]: pairedColor } : {};
}

function visibleBorderStyle(fullDraft: CanvasInspectorStyleDraft): string {
  const borderStyle = fullDraft.borderStyle?.trim();
  return borderStyle && borderStyle !== 'none' ? borderStyle : 'solid';
}

function buildInspectorBoxShadow(fullDraft: CanvasInspectorStyleDraft, opacityOverride?: number): string {
  const x = normalizePixelValue(fullDraft.shadowX || '0');
  const y = normalizePixelValue(fullDraft.shadowY || '0');
  const blur = normalizePixelValue(fullDraft.shadowBlur || '0');
  const spread = normalizePixelValue(fullDraft.shadowSpread || '0');
  const color = fullDraft.shadowColor || '#000000';
  const opacity = opacityOverride ?? Number(fullDraft.shadowOpacity || '100');

  if (opacity >= 100 || Number.isNaN(opacity)) {
    return `${x} ${y} ${blur} ${spread} ${color}`;
  }

  return `${x} ${y} ${blur} ${spread} ${hexToRgba(color, opacity / 100)}`;
}

function isHexColorValue(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function hexToRgba(hex: string, alpha: number): string {
  return rgbToRgba(hexToRgb(hex), alpha);
}

interface InspectorRgbColor {
  r: number;
  g: number;
  b: number;
}

interface InspectorColorValue {
  rgb: InspectorRgbColor;
  alpha: number;
}

function parseInspectorRgbColor(value: string): InspectorRgbColor | null {
  const color = parseInspectorColorValue(value);
  return color?.rgb ?? null;
}

function parseInspectorColorValue(value: string): InspectorColorValue | null {
  if (isHexColorValue(value)) {
    return { rgb: hexToRgb(value), alpha: 1 };
  }

  const match = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!match) {
    return null;
  }

  const [r, g, b] = match.slice(1, 4).map((part) => Number(part));
  if ([r, g, b].some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }

  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (Number.isNaN(alpha) || alpha < 0 || alpha > 1) {
    return null;
  }

  return { rgb: { r: Math.round(r), g: Math.round(g), b: Math.round(b) }, alpha };
}

function hexToRgb(hex: string): InspectorRgbColor {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3 ? normalized.split('').map((part) => `${part}${part}`).join('') : normalized;
  const numeric = Number.parseInt(expanded, 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  };
}

function rgbToRgba({ r, g, b }: InspectorRgbColor, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbToHex({ r, g, b }: InspectorRgbColor): string {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function buildInspectorTransform(fullDraft: CanvasInspectorStyleDraft): string {
  const angle = Number.parseFloat(fullDraft.angle || '0') || 0;
  const scaleX = fullDraft.flipHorizontal === 'true' ? -1 : 1;
  const scaleY = fullDraft.flipVertical === 'true' ? -1 : 1;
  const parts = [`rotate(${angle}deg)`];
  if (scaleX !== 1 || scaleY !== 1) {
    parts.push(`scale(${scaleX}, ${scaleY})`);
  }
  return parts.join(' ');
}

function rawStyleDraftForSave(
  draft: Record<CanvasInspectorStyleKey, string>,
  observedStyles: Record<CanvasInspectorStyleKey, string>,
): CanvasInspectorStyleDraft {
  const rawStyles: CanvasInspectorStyleDraft = {};

  (Object.keys(STYLE_FIELD_CSS_NAMES) as CanvasInspectorStyleKey[]).forEach((key) => {
    const value = draft[key];
    if (value !== observedStyles[key]) {
      rawStyles[key] = value;
    }
  });

  return rawStyles;
}

function areStyleDraftsEqual(
  left: Record<CanvasInspectorStyleKey, string>,
  right: Record<CanvasInspectorStyleKey, string>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of keys) {
    const styleKey = key as CanvasInspectorStyleKey;
    if (left[styleKey] !== right[styleKey]) {
      return false;
    }
  }

  return true;
}

function dirtyDraftsForApply(
  buckets: Record<string, InspectorDraftBucket>,
  activeTargetId: string,
  activeStyles: Record<CanvasInspectorStyleKey, string>,
  activeText: string,
  activeBaselineStyles: Record<CanvasInspectorStyleKey, string>,
): CanvasInspectorDraft[] {
  return Object.entries(buckets)
    .map(([targetId, bucket]) => {
      const currentStyles = targetId === activeTargetId ? activeStyles : bucket.currentStyles;
      const currentText = targetId === activeTargetId ? activeText : bucket.currentText;
      const baselineStyles = targetId === activeTargetId ? activeBaselineStyles : bucket.baselineStyles;
      const rawStyles = rawStyleDraftForSave(currentStyles, baselineStyles);
      const normalized = normalizeCanvasInspectorStyles(rawStyles, currentStyles);
      if (normalized.error) {
        return null;
      }
      const hasTextChange = currentText !== bucket.baselineText;
      const hasStyleChange = Object.keys(normalized.styles).length > 0;
      if (!hasTextChange && !hasStyleChange) {
        return null;
      }
      return {
        id: targetId,
        ...(hasTextChange ? { text: currentText } : {}),
        styles: normalized.styles,
      };
    })
    .filter((draft): draft is CanvasInspectorDraft => draft !== null);
}

function hasDirtyDraftsForApply(
  buckets: Record<string, InspectorDraftBucket>,
  activeTargetId: string,
  activeStyles: Record<CanvasInspectorStyleKey, string>,
  activeText: string,
  activeBaselineStyles: Record<CanvasInspectorStyleKey, string>,
): boolean {
  return Object.entries(buckets).some(([targetId, bucket]) => {
    const currentStyles = targetId === activeTargetId ? activeStyles : bucket.currentStyles;
    const currentText = targetId === activeTargetId ? activeText : bucket.currentText;
    const baselineStyles = targetId === activeTargetId ? activeBaselineStyles : bucket.baselineStyles;

    return currentText !== bucket.baselineText || Object.keys(rawStyleDraftForSave(currentStyles, baselineStyles)).length > 0;
  });
}

function rebaselineStyleDraftAfterSave(styles: CanvasInspectorStyleDraft): CanvasInspectorStyleDraft {
  const nextStyles: CanvasInspectorStyleDraft = { ...styles };
  if (typeof styles.opacity === 'string' && styles.opacity !== '') {
    const opacity = Number(styles.opacity);
    if (!Number.isNaN(opacity)) {
      nextStyles.opacity = String(Math.round(opacity * 100));
    }
  }
  return nextStyles;
}

function styleDraftForTarget(target: EditableNode | null): Record<CanvasInspectorStyleKey, string> {
  if (!target) {
    return emptyStyleDraft();
  }

  const shadowParts = parseInspectorBoxShadow(styleValue(target, 'boxShadow') || '');
  const paddingTop = stripPixelSuffix(styleValue(target, 'paddingTop') || styleValue(target, 'padding') || '');
  const paddingRight = stripPixelSuffix(styleValue(target, 'paddingRight') || styleValue(target, 'padding') || '');
  const paddingBottom = stripPixelSuffix(styleValue(target, 'paddingBottom') || styleValue(target, 'padding') || '');
  const paddingLeft = stripPixelSuffix(styleValue(target, 'paddingLeft') || styleValue(target, 'padding') || '');
  const marginTop = stripPixelSuffix(styleValue(target, 'marginTop') || styleValue(target, 'margin') || '');
  const marginRight = stripPixelSuffix(styleValue(target, 'marginRight') || styleValue(target, 'margin') || '');
  const marginBottom = stripPixelSuffix(styleValue(target, 'marginBottom') || styleValue(target, 'margin') || '');
  const marginLeft = stripPixelSuffix(styleValue(target, 'marginLeft') || styleValue(target, 'margin') || '');
  const textColor = inspectorColorDisplayValue(styleValue(target, 'color'));
  const backgroundColor = inspectorColorDisplayValue(styleValue(target, 'backgroundColor'));
  const borderColor = inspectorColorDisplayValue(styleValue(target, 'borderColor') || '#000000');

  return {
    fontFamily: styleValue(target, 'fontFamily'),
    fontSize: stripPixelSuffix(styleValue(target, 'fontSize')),
    color: textColor.color,
    backgroundColor: backgroundColor.color,
    backgroundOpacity: backgroundColor.opacity,
    backgroundImage: styleValue(target, 'backgroundImage'),
    backgroundGradient: backgroundGradientValue(target),
    fillType: inferBackgroundFillType(target),
    fontWeight: styleValue(target, 'fontWeight'),
    lineHeight: stripPixelSuffix(styleValue(target, 'lineHeight')),
    letterSpacing: stripPixelSuffix(styleValue(target, 'letterSpacing')),
    textAlign: styleValue(target, 'textAlign') || 'left',
    verticalAlign: styleValue(target, 'verticalAlign') || 'top',
    imageSrc: target.attributes.src ?? target.styles.src ?? '',
    objectFit: styleValue(target, 'objectFit') || 'cover',
    objectPosition: styleValue(target, 'objectPosition') || 'center',
    paddingVertical: paddingTop === paddingBottom ? paddingTop : 'Mixed',
    paddingHorizontal: paddingLeft === paddingRight ? paddingLeft : 'Mixed',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    marginVertical: marginTop === marginBottom ? marginTop : 'Mixed',
    marginHorizontal: marginLeft === marginRight ? marginLeft : 'Mixed',
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    borderRadius: stripPixelSuffix(styleValue(target, 'borderRadius')),
    radiusTopLeft: stripPixelSuffix(styleValue(target, 'radiusTopLeft')),
    radiusTopRight: stripPixelSuffix(styleValue(target, 'radiusTopRight')),
    radiusBottomRight: stripPixelSuffix(styleValue(target, 'radiusBottomRight')),
    radiusBottomLeft: stripPixelSuffix(styleValue(target, 'radiusBottomLeft')),
    borderPosition: 'Inside',
    borderWidth: stripPixelSuffix(styleValue(target, 'borderWidth')),
    borderStyle: styleValue(target, 'borderStyle'),
    borderColor: borderColor.color,
    borderOpacity: borderColor.opacity,
    shadowX: shadowParts.x,
    shadowY: shadowParts.y,
    shadowSpread: shadowParts.spread,
    shadowBlur: shadowParts.blur,
    shadowColor: shadowParts.color,
    shadowOpacity: shadowParts.opacity,
    boxShadow: styleValue(target, 'boxShadow'),
    opacity: opacityPercentValue(styleValue(target, 'opacity')),
    positionX: stripPixelSuffix(styleValue(target, 'positionX')) || String(Math.round(target.rect.x)),
    positionY: stripPixelSuffix(styleValue(target, 'positionY')) || String(Math.round(target.rect.y)),
    positionZ: styleValue(target, 'positionZ'),
    positionType: styleValue(target, 'positionType') || 'static',
    positionRight: stripPixelSuffix(styleValue(target, 'positionRight')),
    positionBottom: stripPixelSuffix(styleValue(target, 'positionBottom')),
    displayMode: inferDisplayMode(target),
    display: styleValue(target, 'display'),
    flexDirection: styleValue(target, 'flexDirection'),
    flexWrap: styleValue(target, 'flexWrap'),
    widthUnit: inferSizeUnit(styleValue(target, 'width')) || 'px',
    heightUnit: inferSizeUnit(styleValue(target, 'height')) || 'px',
    justifyContent: styleValue(target, 'justifyContent'),
    alignItems: styleValue(target, 'alignItems'),
    gap: stripPixelSuffix(styleValue(target, 'gap')),
    rowGap: stripPixelSuffix(styleValue(target, 'rowGap')),
    columnGap: stripPixelSuffix(styleValue(target, 'columnGap')),
    gridTemplateColumns: styleValue(target, 'gridTemplateColumns'),
    gridTemplateRows: styleValue(target, 'gridTemplateRows'),
    backgroundFillType: inferBackgroundFillType(target),
    fontStyle: styleValue(target, 'fontStyle'),
    textDecoration: styleValue(target, 'textDecoration'),
    angle: parseInspectorAngle(styleValue(target, 'transform')),
    flipHorizontal: 'false',
    flipVertical: 'false',
    transform: styleValue(target, 'transform'),
    width: stripPixelSuffix(styleValue(target, 'width')) || String(Math.round(target.rect.width)),
    height: stripPixelSuffix(styleValue(target, 'height')) || String(Math.round(target.rect.height)),
  };
}

function inspectorColorDisplayValue(value: string): { color: string; opacity: string } {
  if (!value) {
    return { color: '', opacity: '100' };
  }

  const parsedColor = parseInspectorColorValue(value);
  if (!parsedColor) {
    return { color: value, opacity: '100' };
  }

  return {
    color: rgbToHex(parsedColor.rgb),
    opacity: String(Math.round(parsedColor.alpha * 100)),
  };
}

function emptyStyleDraft(): Record<CanvasInspectorStyleKey, string> {
  return {
    fontFamily: '',
    fontSize: '',
    color: '',
    backgroundColor: '',
    backgroundOpacity: '100',
    backgroundImage: '',
    backgroundGradient: '',
    fillType: 'solid',
    fontWeight: '',
    lineHeight: '',
    letterSpacing: '',
    textAlign: 'left',
    verticalAlign: 'top',
    imageSrc: '',
    objectFit: 'cover',
    objectPosition: 'center',
    paddingVertical: '',
    paddingHorizontal: '',
    paddingTop: '',
    paddingRight: '',
    paddingBottom: '',
    paddingLeft: '',
    marginVertical: '',
    marginHorizontal: '',
    marginTop: '',
    marginRight: '',
    marginBottom: '',
    marginLeft: '',
    borderRadius: '',
    radiusTopLeft: '',
    radiusTopRight: '',
    radiusBottomRight: '',
    radiusBottomLeft: '',
    borderPosition: 'Inside',
    borderWidth: '',
    borderStyle: '',
    borderColor: '#000000',
    borderOpacity: '100',
    shadowX: '',
    shadowY: '',
    shadowSpread: '',
    shadowBlur: '',
    shadowColor: '#000000',
    shadowOpacity: '100',
    boxShadow: '',
    opacity: '100',
    positionX: '',
    positionY: '',
    positionZ: '',
    positionType: 'static',
    positionRight: '',
    positionBottom: '',
    displayMode: 'block',
    display: '',
    flexDirection: '',
    flexWrap: '',
    widthUnit: 'px',
    heightUnit: 'px',
    justifyContent: '',
    alignItems: '',
    gap: '',
    rowGap: '',
    columnGap: '',
    gridTemplateColumns: '',
    gridTemplateRows: '',
    backgroundFillType: 'solid',
    fontStyle: '',
    textDecoration: '',
    angle: '',
    flipHorizontal: 'false',
    flipVertical: 'false',
    transform: '',
    width: '',
    height: '',
  };
}

function styleValue(target: EditableNode, key: CanvasInspectorStyleKey | string): string {
  const cssName = STYLE_FIELD_CSS_NAMES[key as CanvasInspectorStyleKey] ?? key;
  return target.styles[key] ?? target.styles[cssName] ?? '';
}

function stripPixelSuffix(value: string): string {
  return value.replace(/px$/i, '');
}

function opacityPercentValue(value: string): string {
  if (!value) return '100';
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return value;
  return String(Math.round(numericValue * 100));
}

function backgroundGradientValue(target: EditableNode): string {
  const backgroundImage = styleValue(target, 'backgroundImage');
  return backgroundImage.includes('gradient(') ? backgroundImage : '';
}

function inferBackgroundFillType(target: EditableNode): string {
  const backgroundImage = styleValue(target, 'backgroundImage');
  if (backgroundImage.includes('gradient(')) return 'gradient';
  if (backgroundImage.includes('url(')) return 'image';
  return 'solid';
}

function inferDisplayMode(target: EditableNode): string {
  const display = styleValue(target, 'displayMode') || styleValue(target, 'display');
  const flexDirection = styleValue(target, 'flexDirection');
  const flexWrap = styleValue(target, 'flexWrap');
  if (display === 'grid') return 'grid';
  if (display === 'flex' && flexWrap === 'wrap') return 'flex-wrap';
  if (display === 'flex' && flexDirection === 'column') return 'flex-col';
  if (display === 'flex') return 'flex';
  return display || 'block';
}

function inferSizeUnit(value: string): string {
  if (value === 'auto') return 'auto';
  const match = value.match(/^-?\d+(?:\.\d+)?(px|%|rem|em)$/);
  return match?.[1] ?? '';
}

function parseInspectorBoxShadow(boxShadow: string): {
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
  opacity: string;
} {
  const colorPattern = '(#[0-9a-fA-F]{3,6}|rgba?\\([^)]+\\))';
  const lengthPattern = '(-?\\d+(?:\\.\\d+)?)(?:px)?';
  const lengthFirstMatch = boxShadow.match(
    new RegExp(`${lengthPattern}\\s+${lengthPattern}\\s+${lengthPattern}\\s+${lengthPattern}\\s+${colorPattern}`),
  );
  const colorFirstMatch = boxShadow.match(
    new RegExp(`${colorPattern}\\s+${lengthPattern}\\s+${lengthPattern}\\s+${lengthPattern}\\s+${lengthPattern}`),
  );

  if (!lengthFirstMatch && !colorFirstMatch) {
    return { x: '', y: '', blur: '', spread: '', color: '#000000', opacity: '100' };
  }

  const shadowParts = lengthFirstMatch
    ? {
        x: lengthFirstMatch[1],
        y: lengthFirstMatch[2],
        blur: lengthFirstMatch[3],
        spread: lengthFirstMatch[4],
        color: lengthFirstMatch[5],
      }
    : {
        color: colorFirstMatch?.[1] ?? '#000000',
        x: colorFirstMatch?.[2] ?? '',
        y: colorFirstMatch?.[3] ?? '',
        blur: colorFirstMatch?.[4] ?? '',
        spread: colorFirstMatch?.[5] ?? '',
      };
  const parsedColor = parseInspectorColorValue(shadowParts.color);
  return {
    x: shadowParts.x,
    y: shadowParts.y,
    blur: shadowParts.blur,
    spread: shadowParts.spread,
    color: parsedColor ? rgbToHex(parsedColor.rgb) : '#000000',
    opacity: parsedColor ? String(Math.round(parsedColor.alpha * 100)) : '100',
  };
}

function parseInspectorAngle(transform: string): string {
  const match = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return match?.[1] ?? '';
}

function setStyleDraftValue(
  key: CanvasInspectorStyleKey,
  value: string,
  setStyleDraft: React.Dispatch<React.SetStateAction<Record<CanvasInspectorStyleKey, string>>>,
) {
  setStyleDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
}

function styleLabelForKey(key: CanvasInspectorStyleKey): string {
  if (key === 'backgroundColor') return 'Background color';
  if (key === 'borderColor') return 'Border color';
  if (key === 'shadowColor') return 'Shadow color';
  if (key === 'backgroundOpacity') return 'Background opacity';
  if (key === 'borderOpacity') return 'Border opacity';
  if (key === 'shadowOpacity') return 'Shadow opacity';
  return 'Color';
}
