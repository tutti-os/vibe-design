import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasPreviewComment } from '../../features/canvas-workspace';
import { FetchPreviewCommentApi } from './preview-comment-api';

describe('FetchPreviewCommentApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists comments from the encoded project endpoint', async () => {
    const comment = previewComment({ projectId: 'project/1' });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ comments: [storedComment(comment)] }));
    vi.stubGlobal('fetch', fetch);

    await expect(new FetchPreviewCommentApi().list('project/1')).resolves.toEqual([comment]);

    expect(fetch).toHaveBeenCalledWith('/api/projects/project%2F1/comments');
  });

  it('maps persisted visual comments without dropping visual metadata', async () => {
    const comment = visualComment({ intent: 'Tune the highlighted region', markKind: 'box' });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ comments: [storedComment(comment)] }));
    vi.stubGlobal('fetch', fetch);

    await expect(new FetchPreviewCommentApi().list('project-1')).resolves.toEqual([comment]);
  });

  it('maps persisted element comment screenshots without changing selection kind', async () => {
    const comment = previewComment({ screenshotPath: 'screenshots/hero-comment.svg' });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ comments: [storedComment(comment)] }));
    vi.stubGlobal('fetch', fetch);

    await expect(new FetchPreviewCommentApi().list('project-1')).resolves.toEqual([comment]);
  });

  it('serializes upsert bodies and reads the returned comment', async () => {
    const comment = previewComment();
    const input = { target: { filePath: 'index.html', targetId: 'hero-title' }, note: 'Update heading' };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ comment: storedComment(comment) }));
    vi.stubGlobal('fetch', fetch);

    await expect(new FetchPreviewCommentApi().upsert('project-1', input)).resolves.toEqual(comment);

    expect(fetch).toHaveBeenCalledWith('/api/projects/project-1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('patches status on the encoded comment endpoint', async () => {
    const comment = previewComment({ status: 'resolved' });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ comment: storedComment(comment) }));
    vi.stubGlobal('fetch', fetch);

    await expect(new FetchPreviewCommentApi().patchStatus('project-1', 'comment:1', 'resolved')).resolves.toEqual(
      comment,
    );

    expect(fetch).toHaveBeenCalledWith('/api/projects/project-1/comments/comment%3A1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
  });

  it('deletes comments from the encoded comment endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);

    await expect(new FetchPreviewCommentApi().delete('project-1', 'comment:1')).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith('/api/projects/project-1/comments/comment%3A1', {
      method: 'DELETE',
    });
  });

  it('rejects malformed successful delete payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false })));

    await expect(new FetchPreviewCommentApi().delete('project-1', 'comment-1')).rejects.toThrow(
      'Could not delete preview comment.',
    );
  });

  it('uses nested API error messages when requests fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'project not found' } }), { status: 404 })),
    );

    await expect(new FetchPreviewCommentApi().list('project-1')).rejects.toThrow('project not found');
  });

  it('falls back to a friendly message when failed responses are not parseable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })));

    await expect(new FetchPreviewCommentApi().upsert('project-1', { target: {}, note: 'Note' })).rejects.toThrow(
      'Could not save preview comment.',
    );
  });

  it('throws when a successful list payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ comments: [{ id: 'comment-1' }] })));

    await expect(new FetchPreviewCommentApi().list('project-1')).rejects.toThrow('Could not list preview comments.');
  });

  it('throws when a successful visual comment payload is missing markKind', async () => {
    const malformed = storedComment(visualComment());
    if (isObject(malformed.target)) {
      delete malformed.target.markKind;
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ comments: [malformed] })));

    await expect(new FetchPreviewCommentApi().list('project-1')).rejects.toThrow('Could not list preview comments.');
  });

  it('throws when a successful mutation payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ comment: { id: 'comment-1' } })));

    await expect(new FetchPreviewCommentApi().patchStatus('project-1', 'comment-1', 'resolved')).rejects.toThrow(
      'Could not update preview comment status.',
    );
  });
});

function previewComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  const comment: CanvasPreviewComment = {
    id: 'comment-1',
    projectId: 'project-1',
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

function visualComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  const comment: CanvasPreviewComment = {
    id: 'comment-visual',
    projectId: 'project-1',
    filePath: 'index.html',
    targetId: 'visual-mark-1',
    selector: 'body',
    label: 'Visual mark',
    text: '',
    position: { x: 40, y: 50, width: 24, height: 24 },
    htmlHint: '',
    selectionKind: 'visual',
    screenshotPath: 'screenshots/visual-mark.png',
    markKind: 'click+stroke',
    note: 'Adjust this region',
    status: 'open',
    createdAt: 3,
    updatedAt: 4,
  };
  return { ...comment, ...overrides } as CanvasPreviewComment;
}

function storedComment(comment: CanvasPreviewComment): Record<string, unknown> {
  return {
    id: comment.id,
    projectId: comment.projectId,
    target: {
      filePath: comment.filePath,
      targetId: comment.targetId,
      selector: comment.selector,
      label: comment.label,
      text: comment.text,
      position: comment.position,
      htmlHint: comment.htmlHint,
      style: comment.style ?? null,
      selectionKind: comment.selectionKind,
      memberCount: comment.memberCount ?? null,
      podMembers: comment.podMembers ?? null,
      screenshotPath: comment.screenshotPath ?? null,
      markKind: comment.markKind ?? null,
      intent: comment.selectionKind === 'visual' ? (comment.intent ?? null) : null,
    },
    note: comment.note,
    status: comment.status,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
