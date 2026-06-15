import type { CanvasCommentStatus, CanvasPreviewComment } from '../../../features/canvas-workspace/canvas-comment/canvas-comment-types';
import type { PreviewCommentApi } from '../preview-comment-api';
import type { IPreviewCommentService } from '../preview-comment-service.interface';
import type { PreviewCommentSnapshot, PreviewCommentUpsertInput } from '../preview-comment-types';

export class PreviewCommentService implements IPreviewCommentService {
  readonly _serviceBrand = undefined;

  private snapshot: PreviewCommentSnapshot = {
    comments: [],
    loading: false,
    error: null,
  };

  private readonly listeners = new Set<() => void>();
  private loadSequence = 0;
  private contentVersion = 0;
  private commentMutationSequence = 0;
  private readonly commentMutationVersions = new Map<string, number>();

  constructor(
    private readonly api: PreviewCommentApi,
    private readonly projectId: string,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PreviewCommentSnapshot {
    return {
      ...this.snapshot,
      comments: this.snapshot.comments.map(cloneComment),
    };
  }

  async load(): Promise<void> {
    const loadId = this.nextLoadId();
    const contentVersion = this.bumpContentVersion();
    this.setSnapshot({
      loading: true,
      error: null,
    });

    try {
      const comments = await this.api.list(this.projectId);
      if (!this.isCurrentLoad(loadId, contentVersion)) return;
      this.setSnapshot({ comments: [...comments], loading: false, error: null });
    } catch (error) {
      if (!this.isCurrentLoad(loadId, contentVersion)) return;
      this.setSnapshot({ loading: false, error: errorMessage(error, 'Could not list preview comments.') });
    }
  }

  async upsert(input: PreviewCommentUpsertInput): Promise<CanvasPreviewComment> {
    const commentMutationTicket = this.beginUpsertMutation(input);
    const comment = await this.api.upsert(this.projectId, input);
    if (!this.isCurrentUpsertMutation(commentMutationTicket, comment.id)) {
      return comment;
    }
    this.markUpsertCommentMutation(comment.id, commentMutationTicket);
    this.markLocalMutation();
    this.setSnapshot({
      comments: [comment, ...this.snapshot.comments.filter((current) => current.id !== comment.id)],
      loading: false,
      error: null,
    });
    return comment;
  }

  async patchStatus(commentId: string, status: CanvasCommentStatus): Promise<CanvasPreviewComment> {
    const commentMutationVersion = this.beginCommentMutation(commentId);
    const comment = await this.api.patchStatus(this.projectId, commentId, status);
    if (!this.isCurrentCommentMutation(commentId, commentMutationVersion)) {
      return comment;
    }
    this.markLocalMutation();
    const existingIndex = this.snapshot.comments.findIndex((current) => current.id === comment.id);
    const comments =
      existingIndex >= 0
        ? this.snapshot.comments.map((current) => (current.id === comment.id ? comment : current))
        : [comment, ...this.snapshot.comments];

    this.setSnapshot({ comments, loading: false, error: null });
    return comment;
  }

  async delete(commentId: string): Promise<void> {
    const commentMutationVersion = this.beginCommentMutation(commentId);
    await this.api.delete(this.projectId, commentId);
    if (!this.isCurrentCommentMutation(commentId, commentMutationVersion)) return;
    this.markLocalMutation();
    this.setSnapshot({
      comments: this.snapshot.comments.filter((comment) => comment.id !== commentId),
      loading: false,
      error: null,
    });
  }

  private nextLoadId(): number {
    this.loadSequence += 1;
    return this.loadSequence;
  }

  private bumpContentVersion(): number {
    this.contentVersion += 1;
    return this.contentVersion;
  }

  private markLocalMutation(): void {
    this.bumpContentVersion();
  }

  private isCurrentLoad(loadId: number, contentVersion: number): boolean {
    return this.loadSequence === loadId && this.contentVersion === contentVersion;
  }

  private beginCommentMutation(commentId: string): number {
    const version = this.nextCommentMutationVersion();
    this.commentMutationVersions.set(commentMutationKey(commentId), version);
    return version;
  }

  private isCurrentCommentMutation(commentId: string, version: number): boolean {
    return this.commentMutationVersions.get(commentMutationKey(commentId)) === version;
  }

  private beginUpsertMutation(input: PreviewCommentUpsertInput): CommentMutationTicket {
    const version = this.nextCommentMutationVersion();
    const key = upsertMutationKey(input);
    if (key) {
      this.commentMutationVersions.set(key, version);
    }
    return { key, version };
  }

  private isCurrentUpsertMutation(ticket: CommentMutationTicket, commentId: string): boolean {
    if (ticket.key && this.commentMutationVersions.get(ticket.key) !== ticket.version) {
      return false;
    }
    const commentVersion = this.commentMutationVersions.get(commentMutationKey(commentId));
    return commentVersion === undefined || commentVersion <= ticket.version;
  }

  private markUpsertCommentMutation(commentId: string, ticket: CommentMutationTicket): void {
    this.commentMutationVersions.set(commentMutationKey(commentId), ticket.version);
  }

  private nextCommentMutationVersion(): number {
    this.commentMutationSequence += 1;
    return this.commentMutationSequence;
  }

  private setSnapshot(next: Partial<PreviewCommentSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...next,
      comments: next.comments ? next.comments.map(cloneComment) : this.snapshot.comments,
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function cloneComment(comment: CanvasPreviewComment): CanvasPreviewComment {
  return structuredClone(comment);
}

interface CommentMutationTicket {
  key: string | null;
  version: number;
}

function upsertMutationKey(input: PreviewCommentUpsertInput): string | null {
  const target = input.target;
  if (!isRecord(target)) return null;

  const id = readNonEmptyString(target.id);
  if (id) return commentMutationKey(id);

  const filePath = readNonEmptyString(target.filePath);
  const targetId = readNonEmptyString(target.targetId);
  const selector = readNonEmptyString(target.selector);
  if (!filePath || !targetId || !selector) return null;

  const selectionKind = readNonEmptyString(target.selectionKind) ?? 'element';
  return `target:${JSON.stringify([selectionKind, filePath, targetId, selector])}`;
}

function commentMutationKey(commentId: string): string {
  return `comment:${commentId}`;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
