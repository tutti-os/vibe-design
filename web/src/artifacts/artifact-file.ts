export interface ArtifactFileMetadata {
  identifier?: string;
  title?: string;
}

export function artifactFileName(artifact: ArtifactFileMetadata): string {
  const source = artifact.identifier || artifact.title || 'artifact';
  const safeBase = source
    .toLowerCase()
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'artifact';
  return `${safeBase}.html`;
}

export function isCompleteHtmlDocument(html: string): boolean {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
}
