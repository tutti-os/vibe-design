import { describe, expect, it } from 'vitest';
import {
  extractMentionQuery,
  removeActiveMentionToken,
  replaceActiveMentionToken,
} from './composer-mention';

describe('composer mention helpers', () => {
  it('extracts and removes active mention tokens', () => {
    expect(extractMentionQuery('Use @auto')).toBe('auto');
    expect(removeActiveMentionToken('Use @auto')).toBe('Use');
  });

  it('replaces active mention tokens with literal replacement text', () => {
    expect(replaceActiveMentionToken('Use @auto', '[$& $$ $1](mention://workspace-app/app)')).toBe(
      'Use [$& $$ $1](mention://workspace-app/app)',
    );
  });
});
