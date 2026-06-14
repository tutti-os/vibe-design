import type {
  CanvasCommentMember,
  CanvasCommentPoint,
  CanvasCommentPosition,
  CanvasCommentStyleSnapshot,
  CanvasCommentTarget,
  CanvasCommentTargetSnapshot,
  CanvasBoardBatchCommentAttachment,
  CanvasCommentAttachment,
  CanvasSavedCommentAttachment,
  CanvasPreviewComment,
} from './canvas-comment-types';

const TARGET_TEXT_LIMIT = 160;
const HTML_HINT_LIMIT = 180;
const STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'fontFamily',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
] as const satisfies readonly (keyof CanvasCommentStyleSnapshot)[];

export function canvasCommentTargetFromSnapshot(snapshot: CanvasCommentTargetSnapshot): CanvasCommentTarget {
  const filePath = trimBounded(snapshot.filePath);
  const targetId = trimBounded(snapshot.targetId);
  const selector = trimBounded(snapshot.selector);
  const text = trimBounded(snapshot.text, TARGET_TEXT_LIMIT);
  const htmlHint = trimBounded(snapshot.htmlHint, HTML_HINT_LIMIT);
  const label = trimBounded(snapshot.label) || selector || targetId;
  const style = normalizeStyleSnapshot(snapshot.style);
  const hoverPoint = snapshot.hoverPoint ? normalizePoint(snapshot.hoverPoint) : undefined;
  const screenshotPath = snapshot.screenshotPath ? trimBounded(snapshot.screenshotPath) : '';
  const normalizedBase = {
    filePath,
    targetId,
    selector,
    label,
    text,
    position: normalizePosition(snapshot.position),
    htmlHint,
    ...(style ? { style } : {}),
    ...(hoverPoint ? { hoverPoint } : {}),
    ...(screenshotPath ? { screenshotPath } : {}),
  };

  if (snapshot.selectionKind === 'pod') {
    const podMembers = snapshot.podMembers ? normalizePodMembers(snapshot.podMembers) : undefined;

    return {
      ...normalizedBase,
      selectionKind: 'pod',
      ...(snapshot.memberCount === undefined ? {} : { memberCount: Math.max(0, Math.round(snapshot.memberCount)) }),
      ...(podMembers ? { podMembers } : {}),
    };
  }

  return {
    ...normalizedBase,
    selectionKind: 'element',
  };
}

export function commentToCanvasAttachment(comment: CanvasPreviewComment, order: number): CanvasSavedCommentAttachment {
  const attachmentBase = {
    id: comment.id,
    order,
    filePath: comment.filePath,
    targetId: comment.targetId,
    selector: comment.selector,
    label: comment.label,
    comment: comment.note,
    currentText: comment.text,
    pagePosition: { ...comment.position },
    htmlHint: comment.htmlHint,
    ...(comment.style ? { style: { ...comment.style } } : {}),
    source: 'saved-comment' as const,
  };

  if (comment.selectionKind === 'pod') {
    return {
      ...attachmentBase,
      selectionKind: 'pod',
      ...(comment.memberCount === undefined ? {} : { memberCount: comment.memberCount }),
      ...(comment.podMembers ? { podMembers: clonePodMembers(comment.podMembers) } : {}),
    };
  }

  if (comment.selectionKind === 'visual') {
    if (!comment.markKind) {
      throw new Error('Saved visual comments require markKind.');
    }

    return {
      ...attachmentBase,
      selectionKind: 'visual',
      markKind: comment.markKind,
      ...(comment.screenshotPath ? { screenshotPath: comment.screenshotPath } : {}),
      ...(comment.intent ? { intent: comment.intent } : {}),
    };
  }

  return {
    ...attachmentBase,
    selectionKind: 'element',
  };
}

export function buildCanvasCommentAttachments(input: {
  target: CanvasCommentTarget;
  notes: string[];
}): CanvasBoardBatchCommentAttachment[] {
  return input.notes
    .map((note) => note.trim())
    .filter((note) => note.length > 0)
    .map((note, index) => targetToBoardAttachment(input.target, note, index + 1));
}

export function messageContentWithCanvasCommentAttachments(
  content: string,
  attachments: readonly CanvasCommentAttachment[],
): string {
  if (attachments.length === 0) return content;

  const payload = {
    attachments: attachments.map((attachment) => cloneAttachment(attachment)),
  };
  const previewBlock = [
    '<attached-preview-comments>',
    stringifyPreviewPayload(payload),
    '</attached-preview-comments>',
  ].join('\n');

  return `${escapePreviewCommentSentinels(content)}\n\n${previewBlock}`;
}

function targetToBoardAttachment(
  target: CanvasCommentTarget,
  note: string,
  order: number,
): CanvasBoardBatchCommentAttachment {
  const attachmentBase = {
    id: boardBatchAttachmentId(target, order),
    order,
    filePath: target.filePath,
    targetId: target.targetId,
    selector: target.selector,
    label: target.label,
    comment: note,
    currentText: target.text,
    pagePosition: { ...target.position },
    htmlHint: target.htmlHint,
    ...(target.style ? { style: { ...target.style } } : {}),
    source: 'board-batch' as const,
  };

  if (target.selectionKind === 'pod') {
    return {
      ...attachmentBase,
      selectionKind: 'pod',
      ...(target.memberCount === undefined ? {} : { memberCount: target.memberCount }),
      ...(target.podMembers ? { podMembers: clonePodMembers(target.podMembers) } : {}),
    };
  }

  return {
    ...attachmentBase,
    selectionKind: 'element',
  };
}

function boardBatchAttachmentId(target: CanvasCommentTarget, order: number): string {
  const key = `${target.filePath}:${target.targetId}:${order}`;
  return `board-batch:${idSlug(target.filePath)}:${idSlug(target.targetId)}:${order}:${stableHash(key)}`;
}

function idSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'item';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

function normalizePosition(position: CanvasCommentPosition): CanvasCommentPosition {
  return {
    x: roundClampedNumber(position.x),
    y: roundClampedNumber(position.y),
    width: roundClampedNumber(position.width),
    height: roundClampedNumber(position.height),
  };
}

function normalizePoint(point: CanvasCommentPoint): CanvasCommentPoint {
  return {
    x: roundClampedNumber(point.x),
    y: roundClampedNumber(point.y),
  };
}

function roundClampedNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeStyleSnapshot(style: CanvasCommentStyleSnapshot | undefined): CanvasCommentStyleSnapshot | undefined {
  if (!style) return undefined;

  const normalized: CanvasCommentStyleSnapshot = {};
  for (const key of STYLE_KEYS) {
    const value = style[key]?.trim();
    if (value) normalized[key] = value;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function clonePodMembers(members: CanvasCommentMember[]): CanvasCommentMember[] {
  return members.map((member) => ({
    ...member,
    position: { ...member.position },
    ...(member.style ? { style: { ...member.style } } : {}),
  }));
}

function normalizePodMembers(members: CanvasCommentMember[]): CanvasCommentMember[] {
  return members.map((member) => {
    const style = normalizeStyleSnapshot(member.style);

    return {
      targetId: trimBounded(member.targetId),
      selector: trimBounded(member.selector),
      label: trimBounded(member.label) || trimBounded(member.selector) || trimBounded(member.targetId),
      text: trimBounded(member.text, TARGET_TEXT_LIMIT),
      position: normalizePosition(member.position),
      htmlHint: trimBounded(member.htmlHint, HTML_HINT_LIMIT),
      ...(style ? { style } : {}),
    };
  });
}

function cloneAttachment(attachment: CanvasCommentAttachment): CanvasCommentAttachment {
  if (attachment.selectionKind === 'visual') {
    return {
      ...attachment,
      pagePosition: { ...attachment.pagePosition },
      ...(attachment.style ? { style: { ...attachment.style } } : {}),
    };
  }

  if (attachment.selectionKind === 'pod') {
    return {
      ...attachment,
      selectionKind: 'pod',
      pagePosition: { ...attachment.pagePosition },
      ...(attachment.style ? { style: { ...attachment.style } } : {}),
      ...(attachment.podMembers ? { podMembers: clonePodMembers(attachment.podMembers) } : {}),
    };
  }

  return {
    ...attachment,
    selectionKind: 'element',
    pagePosition: { ...attachment.pagePosition },
    ...(attachment.style ? { style: { ...attachment.style } } : {}),
  };
}

function stringifyPreviewPayload(payload: { attachments: CanvasCommentAttachment[] }): string {
  return JSON.stringify(payload, null, 2).replace(/</g, '\\u003c');
}

function escapePreviewCommentSentinels(content: string): string {
  return content
    .replace(/<attached-preview-comments>/g, '\\u003cattached-preview-comments>')
    .replace(/<\/attached-preview-comments>/g, '\\u003c/attached-preview-comments>');
}

function trimBounded(value: string, maxLength?: number): string {
  const trimmed = value.trim();
  return maxLength === undefined ? trimmed : trimmed.slice(0, maxLength);
}
