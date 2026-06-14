import { describe, expect, it } from 'vitest';
import { filterMentionResults } from './mention-query';

describe('filterMentionResults', () => {
  it('filters skills and design files by query', () => {
    const results = filterMentionResults('hero', {
      skills: [{ id: 'skill-1', name: 'Hero Builder', description: 'Build hero sections' }],
      designFiles: [
        {
          id: 'file-1',
          path: 'src/Hero.tsx',
          name: 'Hero.tsx',
          type: 'file',
          size: 0,
          mtime: 0,
          kind: 'code',
          mime: 'text/tsx',
        },
      ],
    });

    expect(results.map((result) => result.id)).toEqual(['skill:skill-1', 'design-file:file-1']);
  });
});
