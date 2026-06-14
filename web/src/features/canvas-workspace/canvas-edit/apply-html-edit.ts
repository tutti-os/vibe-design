import parseInlineStyleDeclarations, { type Declaration as InlineStyleDeclaration } from 'inline-style-parser';
import { parse } from 'parse5';

export function applyTextCommitToHtml(html: string, id: string, value: string): string {
  const target = findElementByVdTarget(html, id);

  if (!target?.contentRange) {
    return html;
  }

  return `${html.slice(0, target.contentRange.start)}${escapeHtmlText(value)}${html.slice(target.contentRange.end)}`;
}

export function applyStylePatchToHtml(html: string, id: string, styles: Record<string, string>): string {
  const target = findElementByVdTarget(html, id);

  if (!target || Object.keys(styles).length === 0) {
    return html;
  }

  const nextHtml = applyStylePatchToTarget(html, target, styles);
  return nextHtml ?? html;
}

type Parse5Attribute = {
  name: string;
  value: string;
};

type Parse5Location = {
  startOffset: number;
  endOffset: number;
  startTag?: Parse5Location & {
    attrs?: Record<string, Parse5Location>;
  };
  endTag?: Parse5Location;
  attrs?: Record<string, Parse5Location>;
};

type Parse5Node = {
  nodeName: string;
  tagName?: string;
  attrs?: Parse5Attribute[];
  childNodes?: Parse5Node[];
  sourceCodeLocation?: Parse5Location | null;
};

type EditableElement = {
  node: Parse5Node;
  tagName: string;
  startTagRange: Range;
  contentRange: Range | null;
};

type Range = {
  start: number;
  end: number;
};

type StyleDeclaration = {
  property: string;
  value: string;
};

const EDIT_HOST_ATTRIBUTES = new Set([
  'data-vd-edit-bridge',
  'data-vd-edit-bridge-style',
  'data-vd-edit-overlay-layer',
  'data-vd-edit-overlay',
  'data-vd-preview-size-bridge',
  'data-vd-preview-scrollbar',
  'data-vd-preview-snapshot-bridge',
  'data-vd-comment-bridge',
  'data-vd-comment-owned',
  'data-vd-comment-pod-layer',
]);

function findElementByVdTarget(html: string, id: string): EditableElement | null {
  const root = parseDocument(html);
  return (
    findElementByAttribute(root, 'data-vd-id', id) ??
    findElementByAttribute(root, 'data-vd-source-path', id) ??
    findElementByAttribute(root, 'id', id) ??
    findElementByGeneratedSourcePath(root, id) ??
    findElementByInspectDomPath(root, id)
  );
}

function parseDocument(html: string): Parse5Node {
  return parse(html, { sourceCodeLocationInfo: true }) as Parse5Node;
}

function findElementByAttribute(root: Parse5Node, name: string, value: string): EditableElement | null {
  for (const element of walkElements(root)) {
    if (isEditHostElement(element)) {
      continue;
    }

    if (attributeValue(element, name) === value) {
      return editableElementForNode(element);
    }
  }

  return null;
}

function findElementByGeneratedSourcePath(root: Parse5Node, id: string): EditableElement | null {
  const path = parseGeneratedSourcePath(id);
  if (!path) {
    return null;
  }

  let parent = bodyElement(root);
  if (!parent) {
    return null;
  }

  let target: Parse5Node | null = null;
  for (const childIndex of path) {
    const children: Parse5Node[] = elementChildren(parent).filter((child) => !isEditHostElement(child));
    target = children[childIndex] ?? null;

    if (!target) {
      return null;
    }

    parent = target;
  }

  return target ? editableElementForNode(target) : null;
}

function parseGeneratedSourcePath(id: string): number[] | null {
  if (!/^path-\d+(?:-\d+)*$/.test(id)) {
    return null;
  }

  return id
    .slice('path-'.length)
    .split('-')
    .map((segment) => Number(segment));
}

function findElementByInspectDomPath(root: Parse5Node, id: string): EditableElement | null {
  const path = parseInspectDomPath(id);
  if (!path) {
    return null;
  }

  let parent: Parse5Node = root;
  let target: Parse5Node | null = null;

  for (const segment of path) {
    const children = elementChildren(parent)
      .filter((child) => !isEditHostElement(child))
      .filter((child) => tagName(child) === segment.tagName);
    target = children[(segment.nthOfType ?? 1) - 1] ?? null;

    if (!target) {
      return null;
    }

    parent = target;
  }

  return target ? editableElementForNode(target) : null;
}

type InspectDomPathSegment = {
  tagName: string;
  nthOfType?: number;
};

function parseInspectDomPath(id: string): InspectDomPathSegment[] | null {
  const segments = id.split('>');
  if (segments.length === 0 || segments.some((segment) => segment.trim() === '')) {
    return null;
  }

  const path = segments.map((segment) => {
    const match = /^([A-Za-z][\w:-]*)(?::nth-of-type\((\d+)\))?$/.exec(segment.trim());
    if (!match) {
      return null;
    }

    const nthOfType = match[2] ? Number(match[2]) : undefined;
    if (nthOfType !== undefined && (!Number.isInteger(nthOfType) || nthOfType < 1)) {
      return null;
    }

    return nthOfType === undefined
      ? { tagName: match[1].toLowerCase() }
      : { tagName: match[1].toLowerCase(), nthOfType };
  });

  if (!path.every((segment): segment is InspectDomPathSegment => segment !== null)) {
    return null;
  }

  return path;
}

function bodyElement(root: Parse5Node): Parse5Node | null {
  return Array.from(walkElements(root)).find((element) => tagName(element) === 'body') ?? null;
}

function* walkElements(node: Parse5Node): Generator<Parse5Node> {
  if (node.tagName) {
    yield node;
  }

  for (const child of node.childNodes ?? []) {
    yield* walkElements(child);
  }
}

function elementChildren(node: Parse5Node): Parse5Node[] {
  return (node.childNodes ?? []).filter((child) => Boolean(child.tagName));
}

function editableElementForNode(node: Parse5Node): EditableElement | null {
  const location = node.sourceCodeLocation;
  const startTag = location?.startTag;
  const tag = tagName(node);

  if (!tag || !startTag || !Number.isFinite(startTag.startOffset) || !Number.isFinite(startTag.endOffset)) {
    return null;
  }

  const contentRange = location?.endTag
    ? { start: startTag.endOffset, end: location.endTag.startOffset }
    : null;

  return {
    node,
    tagName: tag,
    startTagRange: { start: startTag.startOffset, end: startTag.endOffset },
    contentRange,
  };
}

function attributeValue(node: Parse5Node, name: string): string | null {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function tagName(node: Parse5Node): string {
  return node.tagName?.toLowerCase() ?? '';
}

function isEditHostElement(node: Parse5Node): boolean {
  return (node.attrs ?? []).some((attribute) => EDIT_HOST_ATTRIBUTES.has(attribute.name.toLowerCase()));
}

function applyStylePatchToTarget(
  html: string,
  target: EditableElement,
  styles: Record<string, string>,
): string | null {
  const styleAttribute = styleAttributeForTarget(target, html);
  const currentStyle = styleAttribute?.value ?? '';
  const declarations = mergeStyleDeclarations(parseInlineStyle(currentStyle), styles);
  const serializedStyle = serializeInlineStyle(declarations);
  const escapedStyle = escapeHtmlAttributeValue(serializedStyle);

  if (styleAttribute) {
    const replacement = serializedStyle ? ` style="${escapedStyle}"` : '';
    return `${html.slice(0, styleAttribute.replaceRange.start)}${replacement}${html.slice(styleAttribute.replaceRange.end)}`;
  }

  if (!serializedStyle) {
    return null;
  }

  const insertAt = styleInsertOffset(html, target.startTagRange);
  return `${html.slice(0, insertAt)} style="${escapedStyle}"${html.slice(insertAt)}`;
}

type StyleAttribute = {
  value: string;
  replaceRange: Range;
};

function styleAttributeForTarget(target: EditableElement, html: string): StyleAttribute | null {
  const attrLocation = target.node.sourceCodeLocation?.startTag?.attrs?.style;
  const value = attributeValue(target.node, 'style');

  if (!attrLocation || value === null) {
    return null;
  }

  return {
    value,
    replaceRange: {
      start: leadingWhitespaceStart(html, attrLocation.startOffset, target.startTagRange.start),
      end: attrLocation.endOffset,
    },
  };
}

function leadingWhitespaceStart(html: string, startOffset: number, floor: number): number {
  let index = startOffset;
  while (index > floor && /\s/.test(html[index - 1] ?? '')) {
    index -= 1;
  }
  return index;
}

function styleInsertOffset(html: string, startTagRange: Range): number {
  const openingTag = html.slice(startTagRange.start, startTagRange.end);
  const closingOffset = openingTag.endsWith('/>') ? 2 : 1;
  return startTagRange.end - closingOffset;
}

function parseInlineStyle(style: string): StyleDeclaration[] {
  return parseInlineStyleDeclarations(style)
    .filter((node): node is InlineStyleDeclaration => node.type === 'declaration')
    .map((declaration) => ({
      property: declaration.property.trim(),
      value: declaration.value.trim(),
    }))
    .filter((declaration) => declaration.property.length > 0);
}

function mergeStyleDeclarations(
  declarations: StyleDeclaration[],
  styles: Record<string, string>,
): StyleDeclaration[] {
  const nextDeclarations = [...declarations];

  Object.entries(styles).forEach(([property, value]) => {
    const normalizedProperty = normalizeStylePropertyName(property);
    const existingIndex = nextDeclarations.findIndex(
      (declaration) => declaration.property.toLowerCase() === normalizedProperty.toLowerCase(),
    );

    if (value === '') {
      if (existingIndex !== -1) {
        nextDeclarations.splice(existingIndex, 1);
      }
      return;
    }

    if (existingIndex === -1) {
      nextDeclarations.push({ property: normalizedProperty, value });
      return;
    }

    nextDeclarations[existingIndex] = { ...nextDeclarations[existingIndex], property: normalizedProperty, value };
  });

  return nextDeclarations;
}

function serializeInlineStyle(declarations: StyleDeclaration[]): string {
  return declarations.map(({ property, value }) => `${property}: ${value}`).join('; ');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeStylePropertyName(property: string): string {
  const inspectorAlias = INSPECTOR_STYLE_PROPERTY_ALIASES[property];
  if (inspectorAlias) {
    return inspectorAlias;
  }
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const INSPECTOR_STYLE_PROPERTY_ALIASES: Record<string, string> = {
  positionType: 'position',
  positionX: 'left',
  positionY: 'top',
  positionRight: 'right',
  positionBottom: 'bottom',
  positionZ: 'z-index',
  radiusTopLeft: 'border-top-left-radius',
  radiusTopRight: 'border-top-right-radius',
  radiusBottomRight: 'border-bottom-right-radius',
  radiusBottomLeft: 'border-bottom-left-radius',
};
