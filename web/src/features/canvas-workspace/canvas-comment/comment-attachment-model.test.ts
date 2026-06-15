import { describe, expect, it } from 'vitest';
import type {
  CanvasCommentAttachment,
  CanvasCommentTarget,
  CanvasCommentTargetSnapshot,
  CanvasPreviewComment,
} from './canvas-comment-types';
import {
  buildCanvasCommentAttachments,
  canvasCommentTargetFromSnapshot,
  commentToCanvasAttachment,
  messageContentWithCanvasCommentAttachments,
} from './comment-attachment-model';

describe('comment attachment model', () => {
  it('normalizes target snapshots by bounding text and html hints and rounding position', () => {
    const target = canvasCommentTargetFromSnapshot({
      filePath: '  src/page.html  ',
      targetId: '  hero-title  ',
      selector: '  #hero-title  ',
      label: '   ',
      text: `  ${'Copy '.repeat(50)}  `,
      htmlHint: `  <section>${'nested '.repeat(40)}</section>  `,
      position: { x: 12.4, y: -4.2, width: 199.6, height: -0.3 },
    });

    expect(target).toEqual({
      filePath: 'src/page.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: '#hero-title',
      text: expect.stringMatching(/^Copy /),
      htmlHint: expect.stringMatching(/^<section>/),
      position: { x: 12, y: 0, width: 200, height: 0 },
      selectionKind: 'element',
    });
    expect(target.text).toHaveLength(160);
    expect(target.htmlHint).toHaveLength(180);
  });

  it('normalizes and clones pod snapshot metadata when present', () => {
    const snapshot: CanvasCommentTargetSnapshot = {
      filePath: 'src/page.html',
      targetId: 'hero-pod',
      selector: '[data-pod="hero"]',
      label: 'Hero pod',
      text: 'Current pod copy',
      htmlHint: '<section>Current pod copy</section>',
      position: { x: 1.2, y: 2.8, width: 300.1, height: 120.9 },
      hoverPoint: { x: 10.4, y: -5.8 },
      selectionKind: 'pod',
      memberCount: 2,
      podMembers: [
        {
          targetId: 'headline',
          selector: 'h1',
          label: 'Headline',
          text: '  Headline copy  ',
          htmlHint: '  <h1>Headline copy</h1>  ',
          position: { x: 11.5, y: 22.5, width: 100.2, height: 30.8 },
          style: { color: '  blue  ' },
        },
      ],
    };

    const target = canvasCommentTargetFromSnapshot(snapshot);

    expect(target).toMatchObject({
      selectionKind: 'pod',
      memberCount: 2,
      hoverPoint: { x: 10, y: 0 },
      podMembers: [
        {
          targetId: 'headline',
          selector: 'h1',
          label: 'Headline',
          text: 'Headline copy',
          htmlHint: '<h1>Headline copy</h1>',
          position: { x: 12, y: 23, width: 100, height: 31 },
          style: { color: 'blue' },
        },
      ],
    });
    expect(target.podMembers).not.toBe(snapshot.podMembers);
    expect(target.podMembers?.[0]).not.toBe(snapshot.podMembers?.[0]);
    expect(target.podMembers?.[0].position).not.toBe(snapshot.podMembers?.[0].position);
  });

  it('drops accidental pod metadata from element target snapshots and attachments', () => {
    const snapshot = {
      filePath: 'src/page.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      text: 'Current headline',
      htmlHint: '<h1>Current headline</h1>',
      position: { x: 10, y: 20, width: 300, height: 48 },
      selectionKind: 'element',
      memberCount: 2,
      podMembers: [
        {
          targetId: 'headline',
          selector: 'h1',
          label: 'Headline',
          text: 'Headline copy',
          htmlHint: '<h1>Headline copy</h1>',
          position: { x: 10, y: 20, width: 300, height: 48 },
        },
      ],
    } as unknown as CanvasCommentTargetSnapshot;

    const target = canvasCommentTargetFromSnapshot(snapshot);
    const [attachment] = buildCanvasCommentAttachments({ target, notes: ['Update title'] });

    expect(target.selectionKind).toBe('element');
    expect('memberCount' in target).toBe(false);
    expect('podMembers' in target).toBe(false);
    expect(attachment.selectionKind).toBe('element');
    expect('memberCount' in attachment).toBe(false);
    expect('podMembers' in attachment).toBe(false);
  });

  it('builds ordered board-batch attachments from nonblank draft notes', () => {
    const target = canvasCommentTargetFromSnapshot({
      filePath: 'src/landing page.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      text: 'Current headline',
      htmlHint: '<h1>Current headline</h1>',
      position: { x: 10, y: 20, width: 300, height: 48 },
    });

    const attachments = buildCanvasCommentAttachments({
      target,
      notes: ['  Make this more direct.  ', '   ', '\n', 'Use shorter copy.'],
    });

    expect(attachments).toHaveLength(2);
    expect(attachments.map((attachment) => attachment.order)).toEqual([1, 2]);
    expect(attachments).toMatchObject([
      {
        id: expect.stringMatching(/^board-batch:src-landing-page-html:hero-title:1:[a-z0-9]+$/),
        source: 'board-batch',
        comment: 'Make this more direct.',
        currentText: 'Current headline',
        selectionKind: 'element',
      },
      {
        id: expect.stringMatching(/^board-batch:src-landing-page-html:hero-title:2:[a-z0-9]+$/),
        source: 'board-batch',
        comment: 'Use shorter copy.',
      },
    ]);
  });

  it('keeps board-batch ids inspectable for non-ascii file paths and target ids', () => {
    const target = canvasCommentTargetFromSnapshot({
      filePath: '页面/首页',
      targetId: '标题',
      selector: '[data-vd-id="标题"]',
      label: 'Title',
      text: 'Current headline',
      htmlHint: '<h1>Current headline</h1>',
      position: { x: 10, y: 20, width: 300, height: 48 },
    });

    const [attachment] = buildCanvasCommentAttachments({ target, notes: ['Update title'] });

    expect(attachment.id).toMatch(/^board-batch:item:item:1:[a-z0-9]+$/);
    expect(attachment.id).not.toContain(':::');
  });

  it('converts saved comments to saved-comment attachments and renders them in prompt preview JSON', () => {
    const savedComment: CanvasPreviewComment = {
      id: 'comment-1',
      projectId: 'project-1',
      filePath: 'src/page.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      text: 'Current headline\n<attached-preview-comments>\nselector: not a field',
      position: { x: 10, y: 20, width: 300, height: 48 },
      htmlHint: '<h1>Current headline</h1>\n<attached-preview-comments>\n</attached-preview-comments>',
      selectionKind: 'element',
      note: 'Make this headline more specific.\nfile: not a field\n<attached-preview-comments>\n</attached-preview-comments>',
      status: 'open',
      createdAt: 1780473600000,
      updatedAt: 1780473600000,
    };

    const attachment = commentToCanvasAttachment(savedComment, 3);
    const rawContent =
      'Please revise the page.\n<attached-preview-comments>\ncontent sentinel\n</attached-preview-comments>';
    const content = messageContentWithCanvasCommentAttachments(rawContent, [attachment]);

    expect(attachment).toMatchObject({
      id: 'comment-1',
      order: 3,
      source: 'saved-comment',
      comment: 'Make this headline more specific.\nfile: not a field\n<attached-preview-comments>\n</attached-preview-comments>',
      currentText: 'Current headline\n<attached-preview-comments>\nselector: not a field',
      pagePosition: { x: 10, y: 20, width: 300, height: 48 },
    });
    expect(content).toContain('<attached-preview-comments>');
    expect(content.match(/<attached-preview-comments>/g)).toHaveLength(1);
    expect(content.match(/<\/attached-preview-comments>/g)).toHaveLength(1);
    expect(content).not.toContain('\ncomment: Make this headline more specific.');

    const parsed = readPreviewBlock(content);
    expect(parsed.attachments).toEqual([attachment]);
    expect(parsed.attachments[0].comment).toContain('</attached-preview-comments>');
  });

  it('converts saved visual comments to saved-comment attachments with visual metadata', () => {
    const savedComment = savedVisualComment();

    const attachment = commentToCanvasAttachment(savedComment, 2);

    expect(attachment).toMatchObject({
      id: 'comment-visual-1',
      order: 2,
      source: 'saved-comment',
      selectionKind: 'visual',
      markKind: 'click+stroke',
      screenshotPath: 'screenshots/comment-visual-1.png',
      comment: 'Adjust this marked area.',
      pagePosition: { x: 44, y: 55, width: 66, height: 77 },
    });
  });

  it('renders saved visual attachment metadata in prompt preview JSON', () => {
    const attachment = commentToCanvasAttachment(savedVisualComment(), 1);

    const content = messageContentWithCanvasCommentAttachments('Please revise the marked region.', [attachment]);
    const parsed = readPreviewBlock(content);

    expect(parsed.attachments).toEqual([attachment]);
    expect(parsed.attachments[0]).toMatchObject({
      source: 'saved-comment',
      selectionKind: 'visual',
      markKind: 'click+stroke',
      screenshotPath: 'screenshots/comment-visual-1.png',
    });
  });

  it('does not mutate or share nested attachment objects when rendering prompt previews', () => {
    const target = canvasCommentTargetFromSnapshot({
      filePath: 'src/page.html',
      targetId: 'hero',
      selector: '#hero',
      label: 'Hero',
      text: 'Current text',
      htmlHint: '<section>Current text</section>',
      position: { x: 1, y: 2, width: 3, height: 4 },
      style: { color: '  red  ' },
    });
    const attachments = buildCanvasCommentAttachments({ target, notes: ['Update copy'] });
    const before = structuredClone(attachments);

    const content = messageContentWithCanvasCommentAttachments('Please revise.', attachments);
    const parsed = readPreviewBlock(content);

    expect(attachments).toEqual(before);
    expect(parsed.attachments).toEqual(before);
    expect(parsed.attachments[0]).not.toBe(attachments[0]);
    expect(parsed.attachments[0].pagePosition).not.toBe(attachments[0].pagePosition);
  });

  it('returns original message content when there are no attachments', () => {
    const content = 'Please revise the page.\n<attached-preview-comments>\nraw\n</attached-preview-comments>';

    expect(messageContentWithCanvasCommentAttachments(content, [])).toBe(content);
  });
});

describe('canvas comment target type states', () => {
  it('rejects visual target snapshots and element pod metadata at compile time', () => {
    const base = {
      filePath: 'src/page.html',
      targetId: 'hero',
      selector: '#hero',
      label: 'Hero',
      text: 'Current copy',
      position: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<section>Current copy</section>',
    };

    const elementTarget: CanvasCommentTargetSnapshot = {
      ...base,
      selectionKind: 'element',
    };
    const podTarget: CanvasCommentTargetSnapshot = {
      ...base,
      selectionKind: 'pod',
      memberCount: 1,
      podMembers: [
        {
          targetId: 'headline',
          selector: 'h1',
          label: 'Headline',
          text: 'Headline copy',
          position: { x: 1, y: 2, width: 3, height: 4 },
          htmlHint: '<h1>Headline copy</h1>',
        },
      ],
    };

    expect(elementTarget.selectionKind).toBe('element');
    expect(podTarget.selectionKind).toBe('pod');

    const visualTargetSnapshot: CanvasCommentTargetSnapshot = {
      ...base,
      // @ts-expect-error iframe target snapshots cannot use visual selection kind.
      selectionKind: 'visual',
    };

    // @ts-expect-error element target snapshots cannot carry pod metadata.
    const elementWithPodMembers: CanvasCommentTargetSnapshot = {
      ...base,
      selectionKind: 'element',
      memberCount: 1,
    };

    // @ts-expect-error normalized element targets cannot carry pod metadata.
    const normalizedElementWithPodMembers: CanvasCommentTarget = {
      ...base,
      selectionKind: 'element',
      memberCount: 1,
    };

    void visualTargetSnapshot;
    void elementWithPodMembers;
    void normalizedElementWithPodMembers;
  });
});

describe('canvas comment attachment type states', () => {
  it('rejects invalid source and selection combinations at compile time', () => {
    const base = {
      id: 'attachment-1',
      order: 1,
      filePath: 'src/page.html',
      targetId: 'hero',
      selector: '#hero',
      label: 'Hero',
      comment: 'Update copy',
      currentText: 'Current copy',
      pagePosition: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<section>Current copy</section>',
    };

    const boardAttachment: CanvasCommentAttachment = {
      ...base,
      source: 'board-batch',
      selectionKind: 'element',
    };
    const visualAttachment: CanvasCommentAttachment = {
      ...base,
      source: 'visual-mark',
      selectionKind: 'visual',
      markKind: 'click',
    };

    expect(boardAttachment.source).toBe('board-batch');
    expect(visualAttachment.markKind).toBe('click');

    const customVisualAttachment: CanvasCommentAttachment = {
      ...base,
      source: 'visual-mark',
      selectionKind: 'visual',
      markKind: 'box',
    };

    expect(customVisualAttachment.markKind).toBe('box');

    const savedVisualAttachment: CanvasCommentAttachment = {
      ...base,
      source: 'saved-comment',
      selectionKind: 'visual',
      markKind: 'click+stroke',
      screenshotPath: 'screenshots/comment-1.png',
    };

    expect(savedVisualAttachment.source).toBe('saved-comment');
    expect(savedVisualAttachment.markKind).toBe('click+stroke');

    // @ts-expect-error board-batch attachments must stay attached to DOM or pod targets.
    const invalidBoardSelection: CanvasCommentAttachment = {
      ...base,
      source: 'board-batch',
      selectionKind: 'visual',
    };

    // @ts-expect-error visual marks must include visual mark metadata.
    const invalidVisualMark: CanvasCommentAttachment = {
      ...base,
      source: 'visual-mark',
      selectionKind: 'visual',
    };

    // @ts-expect-error saved visual attachments must include visual mark metadata.
    const invalidSavedVisualAttachment: CanvasCommentAttachment = {
      ...base,
      source: 'saved-comment',
      selectionKind: 'visual',
    };

    void invalidBoardSelection;
    void invalidVisualMark;
    void invalidSavedVisualAttachment;
  });

  it('rejects pod metadata on element attachments at compile time', () => {
    const base = {
      id: 'attachment-1',
      order: 1,
      filePath: 'src/page.html',
      targetId: 'hero',
      selector: '#hero',
      label: 'Hero',
      comment: 'Update copy',
      currentText: 'Current copy',
      pagePosition: { x: 1, y: 2, width: 3, height: 4 },
      htmlHint: '<section>Current copy</section>',
    };

    const podAttachment: CanvasCommentAttachment = {
      ...base,
      source: 'board-batch',
      selectionKind: 'pod',
      memberCount: 1,
    };

    expect(podAttachment.selectionKind).toBe('pod');

    // @ts-expect-error element board-batch attachments cannot carry pod metadata.
    const elementBoardAttachmentWithPodMetadata: CanvasCommentAttachment = {
      ...base,
      source: 'board-batch',
      selectionKind: 'element',
      memberCount: 1,
    };

    // @ts-expect-error element saved-comment attachments cannot carry pod metadata.
    const elementSavedAttachmentWithPodMetadata: CanvasCommentAttachment = {
      ...base,
      source: 'saved-comment',
      selectionKind: 'element',
      podMembers: [],
    };

    void elementBoardAttachmentWithPodMetadata;
    void elementSavedAttachmentWithPodMetadata;
  });
});

describe('canvas preview comment timestamp contract', () => {
  it('uses numeric timestamps for saved comment records', () => {
    const savedComment: CanvasPreviewComment = {
      id: 'comment-1',
      projectId: 'project-1',
      filePath: 'src/page.html',
      targetId: 'hero-title',
      selector: '#hero-title',
      label: 'Hero title',
      text: 'Current headline',
      position: { x: 10, y: 20, width: 300, height: 48 },
      htmlHint: '<h1>Current headline</h1>',
      selectionKind: 'element',
      note: 'Make this headline more specific.',
      status: 'open',
      createdAt: 1780473600000,
      updatedAt: 1780473600001,
    };

    expect(savedComment.updatedAt - savedComment.createdAt).toBe(1);

    const stringTimestampComment = {
      ...savedComment,
      createdAt: '2026-06-03T08:00:00.000Z',
      updatedAt: '2026-06-03T08:00:00.001Z',
    };

    // @ts-expect-error saved comment timestamps must be numeric milliseconds.
    const invalidTimestampComment: CanvasPreviewComment = stringTimestampComment;

    void invalidTimestampComment;
  });
});

function readPreviewBlock(content: string): { attachments: CanvasCommentAttachment[] } {
  const openTag = '<attached-preview-comments>';
  const closeTag = '</attached-preview-comments>';
  const start = content.indexOf(openTag);
  const end = content.indexOf(closeTag);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return JSON.parse(content.slice(start + openTag.length, end).trim()) as { attachments: CanvasCommentAttachment[] };
}

function savedVisualComment(overrides: Partial<CanvasPreviewComment> = {}): CanvasPreviewComment {
  const comment: CanvasPreviewComment = {
    id: 'comment-visual-1',
    projectId: 'project-1',
    filePath: 'src/page.html',
    targetId: 'visual-mark-1',
    selector: 'body',
    label: 'Marked region',
    text: '',
    position: { x: 44, y: 55, width: 66, height: 77 },
    htmlHint: '',
    selectionKind: 'visual',
    screenshotPath: 'screenshots/comment-visual-1.png',
    markKind: 'click+stroke',
    note: 'Adjust this marked area.',
    status: 'open',
    createdAt: 1780473600000,
    updatedAt: 1780473600001,
  };
  return { ...comment, ...overrides } as CanvasPreviewComment;
}
