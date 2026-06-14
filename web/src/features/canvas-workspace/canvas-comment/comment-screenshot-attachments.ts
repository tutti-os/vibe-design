import type { CanvasCommentAttachment, ChatAttachment } from '../../../types';

export function imageAttachmentsForPreviewComments(
  commentAttachments: readonly CanvasCommentAttachment[],
  baseAttachments: readonly ChatAttachment[] = [],
): ChatAttachment[] {
  const seenPaths = new Set(baseAttachments.map((attachment) => attachment.path));
  const attachments: ChatAttachment[] = [];

  for (const commentAttachment of commentAttachments) {
    if (commentAttachment.selectionKind !== 'visual') continue;
    const screenshotPath = commentAttachment.screenshotPath?.trim();
    if (!screenshotPath || seenPaths.has(screenshotPath)) continue;

    seenPaths.add(screenshotPath);
    attachments.push({
      path: screenshotPath,
      name: fileNameFromPath(screenshotPath),
      kind: 'image',
      mimeType: mimeTypeFromImagePath(screenshotPath),
    });
  }

  return attachments;
}

function fileNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).at(-1) || path;
}

function mimeTypeFromImagePath(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.svg')) return 'image/svg+xml';
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  return 'image/*';
}
