import { describe, expect, it, vi } from 'vitest';
import type { CanvasPreviewComment } from '../../../features/canvas-workspace';
import type { PreviewCommentApi } from '../preview-comment-api';
import { PreviewCommentService } from './preview-comment-service';

describe('PreviewCommentService', () => {
  it('loads comments through the API and exposes them in the snapshot', async () => {
    const comments = [previewComment({ id: 'comment-1', note: 'Revise headline' })];
    const api = createApi({ list: vi.fn(async () => comments) });
    const service = new PreviewCommentService(api, 'project-1');

    await service.load('conversation-1');

    expect(api.list).toHaveBeenCalledWith('project-1', 'conversation-1');
    expect(service.getSnapshot()).toEqual({ comments, loading: false, error: null });
  });

  it('notifies subscribers for loading and error transitions while keeping existing comments', async () => {
    const existing = previewComment({ id: 'comment-existing', note: 'Keep me' });
    const api = createApi({
      list: vi.fn(async () => {
        throw new Error('List failed');
      }),
      upsert: vi.fn(async () => existing),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.upsert('conversation-1', { target: existing, note: existing.note });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    await expect(service.load('conversation-1')).resolves.toBeUndefined();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual({ comments: [existing], loading: false, error: 'List failed' });
    unsubscribe();
    await service.upsert('conversation-1', { target: existing, note: 'After unsubscribe' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores stale load responses when a newer conversation load wins', async () => {
    const firstLoad = deferred<CanvasPreviewComment[]>();
    const secondLoad = deferred<CanvasPreviewComment[]>();
    const firstComment = previewComment({ id: 'comment-a', conversationId: 'conversation-a', note: 'A' });
    const secondComment = previewComment({ id: 'comment-b', conversationId: 'conversation-b', note: 'B' });
    const api = createApi({
      list: vi
        .fn<PreviewCommentApi['list']>()
        .mockReturnValueOnce(firstLoad.promise)
        .mockReturnValueOnce(secondLoad.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');

    const loadA = service.load('conversation-a');
    const loadB = service.load('conversation-b');
    secondLoad.resolve([secondComment]);
    await loadB;
    firstLoad.resolve([firstComment]);
    await loadA;

    expect(service.getSnapshot()).toEqual({ comments: [secondComment], loading: false, error: null });
  });

  it('clears comments immediately when loading a different conversation', async () => {
    const firstComment = previewComment({ id: 'comment-a', conversationId: 'conversation-a', note: 'A' });
    const secondLoad = deferred<CanvasPreviewComment[]>();
    const api = createApi({
      list: vi.fn<PreviewCommentApi['list']>().mockResolvedValueOnce([firstComment]).mockReturnValueOnce(secondLoad.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-a');

    const loadB = service.load('conversation-b');

    expect(service.getSnapshot()).toEqual({ comments: [], loading: true, error: null });
    secondLoad.reject(new Error('List B failed'));
    await loadB;
    expect(service.getSnapshot()).toEqual({ comments: [], loading: false, error: 'List B failed' });
  });

  it('ignores stale load responses after a local mutation changes active comments', async () => {
    const pendingLoad = deferred<CanvasPreviewComment[]>();
    const loadedComment = previewComment({ id: 'comment-loaded', note: 'Loaded' });
    const savedComment = previewComment({ id: 'comment-saved', note: 'Saved' });
    const api = createApi({
      list: vi.fn(async () => pendingLoad.promise),
      upsert: vi.fn(async () => savedComment),
    });
    const service = new PreviewCommentService(api, 'project-1');

    const load = service.load('conversation-1');
    await service.upsert('conversation-1', { target: savedComment, note: savedComment.note });
    pendingLoad.resolve([loadedComment]);
    await load;

    expect(service.getSnapshot()).toEqual({ comments: [savedComment], loading: false, error: null });
  });

  it('ignores stale load responses after a local delete changes active comments', async () => {
    const pendingLoad = deferred<CanvasPreviewComment[]>();
    const currentComment = previewComment({ id: 'comment-current', note: 'Current' });
    const loadedComment = previewComment({ id: 'comment-loaded', note: 'Loaded' });
    const api = createApi({
      list: vi.fn(async () => pendingLoad.promise),
      upsert: vi.fn(async () => currentComment),
      delete: vi.fn(async () => undefined),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.upsert('conversation-1', { target: currentComment, note: currentComment.note });

    const load = service.load('conversation-1');
    await service.delete('conversation-1', 'comment-current');
    pendingLoad.resolve([loadedComment]);
    await load;

    expect(service.getSnapshot()).toEqual({ comments: [], loading: false, error: null });
  });

  it('moves an upserted comment to the front without duplicates', async () => {
    const first = previewComment({ id: 'comment-1', note: 'First' });
    const second = previewComment({ id: 'comment-2', note: 'Second' });
    const updatedFirst = previewComment({ id: 'comment-1', note: 'Updated first', updatedAt: 3 });
    const api = createApi({
      list: vi.fn(async () => [first, second]),
      upsert: vi.fn(async () => updatedFirst),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');

    await expect(service.upsert('conversation-1', { target: first, note: 'Updated first' })).resolves.toEqual(updatedFirst);

    expect(api.upsert).toHaveBeenCalledWith('project-1', 'conversation-1', { target: first, note: 'Updated first' });
    expect(service.getSnapshot().comments.map((comment) => comment.id)).toEqual(['comment-1', 'comment-2']);
    expect(service.getSnapshot().comments[0]).toEqual(updatedFirst);
  });

  it('does not apply or notify for stale upsert results after switching conversations', async () => {
    const pendingUpsert = deferred<CanvasPreviewComment>();
    const conversationAComment = previewComment({ id: 'comment-a', conversationId: 'conversation-a', note: 'Saved A' });
    const conversationBComment = previewComment({ id: 'comment-b', conversationId: 'conversation-b', note: 'Loaded B' });
    const api = createApi({
      list: vi.fn(async () => [conversationBComment]),
      upsert: vi.fn(async () => pendingUpsert.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-a');
    const listener = vi.fn();
    service.subscribe(listener);

    const upsert = service.upsert('conversation-a', { target: conversationAComment, note: conversationAComment.note });
    await service.load('conversation-b');
    listener.mockClear();
    pendingUpsert.resolve(conversationAComment);

    await expect(upsert).resolves.toEqual(conversationAComment);
    expect(service.getSnapshot()).toEqual({ comments: [conversationBComment], loading: false, error: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it('applies concurrent same-conversation upserts as each request resolves', async () => {
    const firstUpsert = deferred<CanvasPreviewComment>();
    const secondUpsert = deferred<CanvasPreviewComment>();
    const firstComment = previewComment({ id: 'comment-1', note: 'First' });
    const secondComment = previewComment({ id: 'comment-2', note: 'Second' });
    const api = createApi({
      upsert: vi
        .fn<PreviewCommentApi['upsert']>()
        .mockReturnValueOnce(firstUpsert.promise)
        .mockReturnValueOnce(secondUpsert.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    const listener = vi.fn();
    service.subscribe(listener);

    const firstRequest = service.upsert('conversation-1', { target: firstComment, note: firstComment.note });
    const secondRequest = service.upsert('conversation-1', { target: secondComment, note: secondComment.note });
    firstUpsert.resolve(firstComment);
    await firstRequest;
    secondUpsert.resolve(secondComment);
    await secondRequest;

    expect(service.getSnapshot()).toEqual({ comments: [secondComment, firstComment], loading: false, error: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not let an older patch overwrite a newer same-comment upsert', async () => {
    const pendingPatch = deferred<CanvasPreviewComment>();
    const pendingUpsert = deferred<CanvasPreviewComment>();
    const open = previewComment({ id: 'comment-1', status: 'open', note: 'Original' });
    const patched = previewComment({ id: 'comment-1', status: 'resolved', note: 'Patched', updatedAt: 4 });
    const upserted = previewComment({ id: 'comment-1', status: 'open', note: 'Newer upsert', updatedAt: 5 });
    const target = {
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      selectionKind: 'element',
    };
    const api = createApi({
      list: vi.fn(async () => [open]),
      patchStatus: vi.fn(async () => pendingPatch.promise),
      upsert: vi.fn(async () => pendingUpsert.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');
    const listener = vi.fn();
    service.subscribe(listener);

    const patchRequest = service.patchStatus('conversation-1', 'comment-1', 'resolved');
    const upsertRequest = service.upsert('conversation-1', { target, note: upserted.note });
    pendingUpsert.resolve(upserted);
    await expect(upsertRequest).resolves.toEqual(upserted);
    expect(service.getSnapshot().comments).toEqual([upserted]);
    listener.mockClear();

    pendingPatch.resolve(patched);
    await expect(patchRequest).resolves.toEqual(patched);

    expect(service.getSnapshot().comments).toEqual([upserted]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the later-started same-comment upsert when upsert responses resolve out of order', async () => {
    const firstUpsert = deferred<CanvasPreviewComment>();
    const secondUpsert = deferred<CanvasPreviewComment>();
    const target = {
      filePath: 'index.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      selectionKind: 'element',
    };
    const firstComment = previewComment({ id: 'comment-1', note: 'First save', updatedAt: 3 });
    const secondComment = previewComment({ id: 'comment-1', note: 'Second save', updatedAt: 4 });
    const api = createApi({
      upsert: vi
        .fn<PreviewCommentApi['upsert']>()
        .mockReturnValueOnce(firstUpsert.promise)
        .mockReturnValueOnce(secondUpsert.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    const listener = vi.fn();
    service.subscribe(listener);

    const firstRequest = service.upsert('conversation-1', { target, note: firstComment.note });
    const secondRequest = service.upsert('conversation-1', { target, note: secondComment.note });
    secondUpsert.resolve(secondComment);
    await expect(secondRequest).resolves.toEqual(secondComment);
    expect(service.getSnapshot().comments).toEqual([secondComment]);
    listener.mockClear();

    firstUpsert.resolve(firstComment);
    await expect(firstRequest).resolves.toEqual(firstComment);

    expect(service.getSnapshot().comments).toEqual([secondComment]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('replaces an existing comment on status patch and notifies subscribers', async () => {
    const open = previewComment({ id: 'comment-1', status: 'open' });
    const resolved = previewComment({ id: 'comment-1', status: 'resolved', updatedAt: 4 });
    const api = createApi({
      list: vi.fn(async () => [open]),
      patchStatus: vi.fn(async () => resolved),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');
    const listener = vi.fn();
    service.subscribe(listener);

    await expect(service.patchStatus('conversation-1', 'comment-1', 'resolved')).resolves.toEqual(resolved);

    expect(api.patchStatus).toHaveBeenCalledWith('project-1', 'conversation-1', 'comment-1', 'resolved');
    expect(service.getSnapshot().comments).toEqual([resolved]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not restore a deleted comment when an older patch resolves after delete', async () => {
    const pendingPatch = deferred<CanvasPreviewComment>();
    const pendingDelete = deferred<void>();
    const open = previewComment({ id: 'comment-1', status: 'open' });
    const resolved = previewComment({ id: 'comment-1', status: 'resolved', updatedAt: 4 });
    const api = createApi({
      list: vi.fn(async () => [open]),
      patchStatus: vi.fn(async () => pendingPatch.promise),
      delete: vi.fn(async () => pendingDelete.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');
    const listener = vi.fn();
    service.subscribe(listener);

    const patchRequest = service.patchStatus('conversation-1', 'comment-1', 'resolved');
    const deleteRequest = service.delete('conversation-1', 'comment-1');
    pendingDelete.resolve();
    await deleteRequest;
    expect(service.getSnapshot().comments).toEqual([]);
    listener.mockClear();

    pendingPatch.resolve(resolved);
    await expect(patchRequest).resolves.toEqual(resolved);

    expect(service.getSnapshot().comments).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('applies concurrent same-conversation patches for different comments', async () => {
    const firstPatch = deferred<CanvasPreviewComment>();
    const secondPatch = deferred<CanvasPreviewComment>();
    const firstOpen = previewComment({ id: 'comment-1', status: 'open' });
    const secondOpen = previewComment({ id: 'comment-2', status: 'open' });
    const firstResolved = previewComment({ id: 'comment-1', status: 'resolved', updatedAt: 4 });
    const secondNeedsReview = previewComment({ id: 'comment-2', status: 'needs_review', updatedAt: 5 });
    const api = createApi({
      list: vi.fn(async () => [firstOpen, secondOpen]),
      patchStatus: vi
        .fn<PreviewCommentApi['patchStatus']>()
        .mockReturnValueOnce(firstPatch.promise)
        .mockReturnValueOnce(secondPatch.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');
    const listener = vi.fn();
    service.subscribe(listener);

    const firstRequest = service.patchStatus('conversation-1', 'comment-1', 'resolved');
    const secondRequest = service.patchStatus('conversation-1', 'comment-2', 'needs_review');
    secondPatch.resolve(secondNeedsReview);
    await secondRequest;
    firstPatch.resolve(firstResolved);
    await firstRequest;

    expect(service.getSnapshot().comments).toEqual([firstResolved, secondNeedsReview]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not apply or notify for stale delete results after switching conversations', async () => {
    const pendingDelete = deferred<void>();
    const conversationAComment = previewComment({ id: 'comment-a', conversationId: 'conversation-a', note: 'A' });
    const conversationBComment = previewComment({ id: 'comment-b', conversationId: 'conversation-b', note: 'B' });
    const api = createApi({
      list: vi
        .fn<PreviewCommentApi['list']>()
        .mockResolvedValueOnce([conversationAComment])
        .mockResolvedValueOnce([conversationBComment]),
      delete: vi.fn(async () => pendingDelete.promise),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-a');
    const listener = vi.fn();
    service.subscribe(listener);

    const deleteRequest = service.delete('conversation-a', 'comment-a');
    await service.load('conversation-b');
    listener.mockClear();
    pendingDelete.resolve();
    await deleteRequest;

    expect(service.getSnapshot()).toEqual({ comments: [conversationBComment], loading: false, error: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it('prepends a patched comment when it is not already loaded', async () => {
    const patched = previewComment({ id: 'comment-missing', status: 'needs_review' });
    const api = createApi({ patchStatus: vi.fn(async () => patched) });
    const service = new PreviewCommentService(api, 'project-1');

    await service.patchStatus('conversation-1', 'comment-missing', 'needs_review');

    expect(service.getSnapshot().comments).toEqual([patched]);
  });

  it('removes a deleted comment and notifies subscribers', async () => {
    const first = previewComment({ id: 'comment-1' });
    const second = previewComment({ id: 'comment-2' });
    const api = createApi({
      list: vi.fn(async () => [first, second]),
      delete: vi.fn(async () => undefined),
    });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');
    const listener = vi.fn();
    service.subscribe(listener);

    await service.delete('conversation-1', 'comment-1');

    expect(api.delete).toHaveBeenCalledWith('project-1', 'conversation-1', 'comment-1');
    expect(service.getSnapshot().comments).toEqual([second]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns cloned comment arrays so callers cannot mutate internal state', async () => {
    const first = previewComment({ id: 'comment-1' });
    const api = createApi({ list: vi.fn(async () => [first]) });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');

    service.getSnapshot().comments.pop();

    expect(service.getSnapshot().comments).toEqual([first]);
  });

  it('returns cloned comment objects so callers cannot mutate internal state', async () => {
    const first = previewComment({ id: 'comment-1', note: 'Original note' });
    const api = createApi({ list: vi.fn(async () => [first]) });
    const service = new PreviewCommentService(api, 'project-1');
    await service.load('conversation-1');
    const expectedNote = first.note;
    const expectedX = first.position.x;

    const snapshotComment = service.getSnapshot().comments[0];
    if (!snapshotComment) {
      throw new Error('expected snapshot comment');
    }
    snapshotComment.note = 'Mutated outside service';
    snapshotComment.position.x = 999;

    expect(service.getSnapshot().comments[0]?.note).toBe(expectedNote);
    expect(service.getSnapshot().comments[0]?.position.x).toBe(expectedX);
  });
});

function createApi(overrides: Partial<PreviewCommentApi> = {}): PreviewCommentApi {
  return {
    list: vi.fn(async () => []),
    upsert: vi.fn(async () => previewComment()),
    patchStatus: vi.fn(async () => previewComment()),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

function previewComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  const comment: CanvasPreviewComment = {
    id: 'comment-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    filePath: 'index.html',
    targetId: 'hero-title',
    selector: '#hero-title',
    label: 'Hero title',
    text: 'Current headline',
    position: { x: 1, y: 2, width: 300, height: 48 },
    htmlHint: '<h1>Current headline</h1>',
    selectionKind: 'element',
    note: 'Make this more specific',
    status: 'open',
    createdAt: 1,
    updatedAt: 2,
  };
  return { ...comment, ...overrides } as CanvasPreviewComment;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
