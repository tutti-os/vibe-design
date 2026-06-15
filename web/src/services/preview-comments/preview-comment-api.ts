import type {
  CanvasCommentMember,
  CanvasCommentPoint,
  CanvasCommentPosition,
  CanvasCommentStatus,
  CanvasCommentStyleSnapshot,
  CanvasPreviewComment,
} from '../../features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { PreviewCommentUpsertInput } from './preview-comment-types';

export interface PreviewCommentApi {
  list(projectId: string): Promise<CanvasPreviewComment[]>;
  upsert(projectId: string, input: PreviewCommentUpsertInput): Promise<CanvasPreviewComment>;
  patchStatus(projectId: string, commentId: string, status: CanvasCommentStatus): Promise<CanvasPreviewComment>;
  delete(projectId: string, commentId: string): Promise<void>;
}

export class FetchPreviewCommentApi implements PreviewCommentApi {
  async list(projectId: string): Promise<CanvasPreviewComment[]> {
    const response = await fetch(collectionUrl(projectId));
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not list preview comments.'));
    }

    if (!isObject(data) || !Array.isArray(data.comments)) {
      throw new Error('Could not list preview comments.');
    }

    const comments: CanvasPreviewComment[] = [];
    for (const row of data.comments) {
      const comment = readPreviewComment(row);
      if (!comment) {
        throw new Error('Could not list preview comments.');
      }
      comments.push(comment);
    }

    return comments;
  }

  async upsert(projectId: string, input: PreviewCommentUpsertInput): Promise<CanvasPreviewComment> {
    const response = await fetch(collectionUrl(projectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not save preview comment.'));
    }

    const comment = readCommentPayload(data);
    if (!comment) {
      throw new Error('Could not save preview comment.');
    }

    return comment;
  }

  async patchStatus(projectId: string, commentId: string, status: CanvasCommentStatus): Promise<CanvasPreviewComment> {
    const response = await fetch(commentUrl(projectId, commentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not update preview comment status.'));
    }

    const comment = readCommentPayload(data);
    if (!comment) {
      throw new Error('Could not update preview comment status.');
    }

    return comment;
  }

  async delete(projectId: string, commentId: string): Promise<void> {
    const response = await fetch(commentUrl(projectId, commentId), {
      method: 'DELETE',
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not delete preview comment.'));
    }

    if (!isObject(data) || data.ok !== true) {
      throw new Error('Could not delete preview comment.');
    }
  }
}

function collectionUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/comments`;
}

function commentUrl(projectId: string, commentId: string): string {
  return `${collectionUrl(projectId)}/${encodeURIComponent(commentId)}`;
}

function readCommentPayload(data: unknown): CanvasPreviewComment | null {
  const value = isObject(data) ? data.comment : data;
  return readPreviewComment(value);
}

function readPreviewComment(value: unknown): CanvasPreviewComment | null {
  const target = isObject(value) && isObject(value.target) ? value.target : value;
  if (
    !isObject(value) ||
    !isObject(target) ||
    typeof value.id !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof target.filePath !== 'string' ||
    typeof target.targetId !== 'string' ||
    typeof target.selector !== 'string' ||
    typeof target.label !== 'string' ||
    typeof target.text !== 'string' ||
    !isPosition(target.position) ||
    typeof target.htmlHint !== 'string' ||
    typeof value.note !== 'string' ||
    !isCommentStatus(value.status) ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }

  let style: CanvasCommentStyleSnapshot | undefined;
  if (target.style !== undefined && target.style !== null) {
    const nextStyle = readStyle(target.style);
    if (!nextStyle) return null;
    style = nextStyle;
  }

  let hoverPoint: CanvasCommentPoint | undefined;
  if (target.hoverPoint !== undefined) {
    const nextHoverPoint = readPoint(target.hoverPoint);
    if (!nextHoverPoint) return null;
    hoverPoint = nextHoverPoint;
  }

  let screenshotPath: string | undefined;
  if (target.screenshotPath !== undefined && target.screenshotPath !== null) {
    if (typeof target.screenshotPath !== 'string') return null;
    screenshotPath = target.screenshotPath;
  }

  if (target.selectionKind === 'visual') {
    const markKind = readBoundedNonEmptyString(target.markKind, 64);
    if (!markKind) return null;

    let intent: string | undefined;
    if (target.intent !== undefined && target.intent !== null) {
      if (typeof target.intent !== 'string') return null;
      intent = target.intent.slice(0, 200);
    }

    return {
      id: value.id,
      projectId: value.projectId,
      filePath: target.filePath,
      targetId: target.targetId,
      selector: target.selector,
      label: target.label,
      text: target.text,
      position: target.position,
      htmlHint: target.htmlHint,
      style,
      hoverPoint,
      selectionKind: 'visual',
      screenshotPath,
      markKind,
      intent,
      note: value.note,
      status: value.status,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  if (target.selectionKind === 'pod') {
    let podMembers: CanvasCommentMember[] | undefined;
    if (target.podMembers !== undefined && target.podMembers !== null) {
      const nextPodMembers = readMembers(target.podMembers);
      if (!nextPodMembers) return null;
      podMembers = nextPodMembers;
    }
    return {
      id: value.id,
      projectId: value.projectId,
      filePath: target.filePath,
      targetId: target.targetId,
      selector: target.selector,
      label: target.label,
      text: target.text,
      position: target.position,
      htmlHint: target.htmlHint,
      style,
      hoverPoint,
      screenshotPath,
      selectionKind: 'pod',
      memberCount: typeof target.memberCount === 'number' ? target.memberCount : undefined,
      podMembers,
      note: value.note,
      status: value.status,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  if (target.selectionKind !== 'element') {
    return null;
  }

  return {
    id: value.id,
    projectId: value.projectId,
    filePath: target.filePath,
    targetId: target.targetId,
    selector: target.selector,
    label: target.label,
    text: target.text,
    position: target.position,
    htmlHint: target.htmlHint,
    style,
    hoverPoint,
    screenshotPath,
    selectionKind: 'element',
    note: value.note,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readMembers(value: unknown): CanvasCommentMember[] | null {
  if (!Array.isArray(value)) return null;
  const members: CanvasCommentMember[] = [];
  for (const row of value) {
    const member = readMember(row);
    if (!member) return null;
    members.push(member);
  }
  return members;
}

function readMember(value: unknown): CanvasCommentMember | null {
  if (
    !isObject(value) ||
    typeof value.targetId !== 'string' ||
    typeof value.selector !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.text !== 'string' ||
    !isPosition(value.position) ||
    typeof value.htmlHint !== 'string'
  ) {
    return null;
  }

  let style: CanvasCommentStyleSnapshot | undefined;
  if (value.style !== undefined) {
    const nextStyle = readStyle(value.style);
    if (!nextStyle) return null;
    style = nextStyle;
  }

  return {
    targetId: value.targetId,
    selector: value.selector,
    label: value.label,
    text: value.text,
    position: value.position,
    htmlHint: value.htmlHint,
    style,
  };
}

function readStyle(value: unknown): CanvasCommentStyleSnapshot | null {
  if (!isObject(value)) return null;
  return {
    color: readOptionalString(value.color),
    backgroundColor: readOptionalString(value.backgroundColor),
    fontSize: readOptionalString(value.fontSize),
    fontWeight: readOptionalString(value.fontWeight),
    lineHeight: readOptionalString(value.lineHeight),
    textAlign: readOptionalString(value.textAlign),
    fontFamily: readOptionalString(value.fontFamily),
    paddingTop: readOptionalString(value.paddingTop),
    paddingRight: readOptionalString(value.paddingRight),
    paddingBottom: readOptionalString(value.paddingBottom),
    paddingLeft: readOptionalString(value.paddingLeft),
    borderRadius: readOptionalString(value.borderRadius),
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoundedNonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed ? trimmed : null;
}

function isPosition(value: unknown): value is CanvasCommentPosition {
  return (
    isObject(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

function readPoint(value: unknown): CanvasCommentPoint | null {
  if (!isObject(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    return null;
  }
  return { x: value.x, y: value.y };
}

function isCommentStatus(value: unknown): value is CanvasCommentStatus {
  return (
    value === 'open' ||
    value === 'attached' ||
    value === 'applying' ||
    value === 'needs_review' ||
    value === 'resolved' ||
    value === 'failed'
  );
}

function readErrorMessage(data: unknown, fallbackMessage: string): string {
  if (isObject(data) && isObject(data.error) && typeof data.error.message === 'string') {
    return data.error.message;
  }
  if (isObject(data) && typeof data.message === 'string') {
    return data.message;
  }
  return fallbackMessage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
