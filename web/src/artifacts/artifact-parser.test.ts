import { describe, expect, it } from 'vitest';
import { createArtifactParser } from './artifact-parser';

describe('createArtifactParser', () => {
  it('streams prose separately from an artifact block split across chunks', () => {
    const parser = createArtifactParser();
    const events = [
      ...parser.feed('Starting.\n<arti'),
      ...parser.feed('fact identifier="landing" type="text/html" title="Landing">'),
      ...parser.feed('<!doctype html><html><body>Hi'),
      ...parser.feed('</body></html></artifact>\nDone.'),
      ...parser.flush(),
    ];

    expect(events[0]).toEqual({ type: 'text', delta: 'Starting.\n' });
    expect(events[1]).toEqual({
      type: 'artifact:start',
      identifier: 'landing',
      artifactType: 'text/html',
      title: 'Landing',
    });
    expect(events.filter((event) => event.type === 'artifact:chunk').map((event) => event.delta).join('')).toBe(
      '<!doctype html><html><body>Hi</body></html>',
    );
    expect(events[events.length - 2]).toEqual({
      type: 'artifact:end',
      identifier: 'landing',
      fullContent: '<!doctype html><html><body>Hi</body></html>',
    });
    expect(events[events.length - 1]).toEqual({ type: 'text', delta: '\nDone.' });
  });
});
