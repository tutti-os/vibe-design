export type MediaSurface = 'image' | 'video' | 'audio';

export interface MediaExecutionPolicy {
  mode?: 'enabled' | 'disabled';
  allowedSurfaces?: MediaSurface[];
  allowedModels?: string[];
}

export interface MediaPromptMetadata {
  imageModel?: string | null;
  imageAspect?: string | null;
  imageStyle?: string | null;
  videoModel?: string | null;
  videoLength?: number | null;
  videoAspect?: string | null;
  audioKind?: string | null;
  audioModel?: string | null;
  audioDuration?: number | null;
  voice?: string | null;
}

function formatList(values: readonly string[] | undefined): string {
  return values && values.length > 0
    ? values.map((value) => `\`${value}\``).join(', ')
    : '';
}

export function renderMediaGenerationContract(
  surface: MediaSurface,
  metadata?: MediaPromptMetadata,
  mediaExecution?: MediaExecutionPolicy,
): string {
  const mode = mediaExecution?.mode ?? 'enabled';
  const surfaceScope = formatList(mediaExecution?.allowedSurfaces);
  const modelScope = formatList(mediaExecution?.allowedModels);
  const metadataLines = renderSurfaceMetadata(surface, metadata);
  const scopeLines = [
    surfaceScope ? `Allowed surfaces: ${surfaceScope}.` : '',
    modelScope ? `Allowed models: ${modelScope}.` : '',
  ].filter(Boolean);
  const activeSurfaceBlock = [
    '### Active media surface',
    '',
    `- **surface**: ${surface}`,
    ...metadataLines,
  ].join('\n');

  if (mode === 'disabled') {
    return `

---

## Media generation contract

Media execution is disabled for this run. Do not claim that media bytes were generated. If the user asks for media, provide the creative brief and stop.

${activeSurfaceBlock}${scopeLines.length > 0 ? `\n\n${scopeLines.join('\n')}` : ''}`;
  }

  return `

---

## Media generation contract

This is a media surface: image, video, or audio. The active skill and project metadata define what to make; the media dispatcher is responsible for producing bytes. Do not emit HTML artifacts as a substitute for generated media, and do not fabricate file outputs.

${activeSurfaceBlock}

Describe the prompt, surface, aspect or duration choices, and output filename clearly. Use the configured media execution path when available.${scopeLines.length > 0 ? `\n\n${scopeLines.join('\n')}` : ''}`;
}

function renderSurfaceMetadata(
  surface: MediaSurface,
  metadata: MediaPromptMetadata | undefined,
): string[] {
  if (!metadata) return [];
  if (surface === 'image') {
    return renderKnownMetadata(metadata, ['imageModel', 'imageAspect', 'imageStyle']);
  }
  if (surface === 'video') {
    return renderKnownMetadata(metadata, ['videoModel', 'videoLength', 'videoAspect']);
  }
  return renderKnownMetadata(metadata, ['audioKind', 'audioModel', 'audioDuration', 'voice']);
}

function renderKnownMetadata(
  metadata: MediaPromptMetadata,
  keys: Array<keyof MediaPromptMetadata>,
): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key];
    return value === undefined || value === null || value === ''
      ? []
      : [`- **${key}**: ${String(value)}`];
  });
}
