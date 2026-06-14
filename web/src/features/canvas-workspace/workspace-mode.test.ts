import { describe, expect, it } from 'vitest';
import {
  defaultModeForTab,
  removeModeForTab,
  setModeForTab,
} from './workspace-mode';

describe('workspace-mode', () => {
  it('defaults file tabs to preview mode', () => {
    expect(
      defaultModeForTab({
        kind: 'file',
        key: 'file:landing.html',
        path: 'landing.html',
        name: 'landing.html',
      }),
    ).toBe('preview');
  });

  it('stores per-tab mode overrides', () => {
    expect(setModeForTab({}, 'file:landing.html', 'comment')).toEqual({
      'file:landing.html': 'comment',
    });
  });

  it('clears per-tab mode state when a tab closes so reopening can use the default', () => {
    const tab = {
      kind: 'file' as const,
      key: 'file:landing.html',
      path: 'landing.html',
      name: 'landing.html',
    };
    const modeByTab = setModeForTab({}, tab.key, 'comment');

    expect(removeModeForTab(modeByTab, tab.key)).toEqual({});
    expect(defaultModeForTab(tab)).toBe('preview');
  });
});
