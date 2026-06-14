import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LiveArtifactBadges } from './LiveArtifactBadges';
import { liveArtifactTabId } from '../types';
import type { LiveArtifactWorkspaceEntry } from '../types';

function artifact(overrides: Partial<LiveArtifactWorkspaceEntry> = {}): LiveArtifactWorkspaceEntry {
  return {
    kind: 'live-artifact',
    tabId: liveArtifactTabId('artifact-1'),
    artifactId: 'artifact-1',
    projectId: 'project-1',
    title: 'Hero image',
    slug: 'hero-image',
    status: 'active',
    refreshStatus: 'idle',
    pinned: false,
    preview: { type: 'image', url: 'https://example.com/hero.png' },
    hasDocument: true,
    updatedAt: new Date(2026, 4, 1).toISOString(),
    ...overrides,
  };
}

describe('LiveArtifactBadges', () => {
  it('receives live artifact entries and renders media cards', () => {
    const html = renderToString(
      <LiveArtifactBadges
        artifacts={[
          artifact(),
          artifact({
            tabId: liveArtifactTabId('artifact-2'),
            artifactId: 'artifact-2',
            title: 'Ambient audio',
            preview: { type: 'audio', url: 'https://example.com/audio.mp3' },
          }),
        ]}
        onOpenLiveArtifact={vi.fn()}
      />,
    );

    expect(html).toContain('Generated Media');
    expect(html).toContain('Hero image');
    expect(html).toContain('Ambient audio');
    expect(html).toContain('Audio preview');
    expect(html).toContain('Download');
  });
});
