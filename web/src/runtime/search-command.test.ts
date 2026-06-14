import { describe, expect, it } from 'vitest';
import { expandSearchCommand } from './search-command';

describe('expandSearchCommand', () => {
  it('returns null for non-search input', () => {
    expect(expandSearchCommand('make a dashboard')).toBeNull();
  });

  it('expands /search into a research-first prompt', () => {
    const result = expandSearchCommand('/search EV market 2025 trends');

    expect(result?.query).toBe('EV market 2025 trends');
    expect(result?.prompt).toContain('Search for: EV market 2025 trends');
    expect(result?.prompt).toContain(
      'research search --query "<search query>" --max-sources 5',
    );
    expect(result?.prompt).toContain('research/<safe-query-slug>.md');
  });
});
