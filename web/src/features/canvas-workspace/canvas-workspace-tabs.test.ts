import { describe, expect, it } from 'vitest';
import {
  closeWorkspaceTab,
  fileTabKey,
  openWorkspaceFileTab,
  reorderWorkspaceTabs,
} from './canvas-workspace-tabs';
import type { WorkspaceTabsState } from './canvas-workspace-types';

describe('canvas workspace tabs', () => {
  it('opens a file tab once and activates it', () => {
    const state: WorkspaceTabsState = { tabs: [], activeTabKey: null };

    expect(openWorkspaceFileTab(state, { path: 'pages/landing.html', name: 'landing.html' })).toEqual({
      tabs: [{ kind: 'file', key: 'file:pages/landing.html', path: 'pages/landing.html', name: 'landing.html' }],
      activeTabKey: 'file:pages/landing.html',
    });
  });

  it('opens duplicate basenames as distinct path-keyed tabs', () => {
    const state: WorkspaceTabsState = { tabs: [], activeTabKey: null };

    const withPage = openWorkspaceFileTab(state, { path: 'pages/index.html', name: 'index.html' });
    const withComponent = openWorkspaceFileTab(withPage, { path: 'components/index.html', name: 'index.html' });

    expect(withComponent).toEqual({
      tabs: [
        { kind: 'file', key: 'file:pages/index.html', path: 'pages/index.html', name: 'index.html' },
        { kind: 'file', key: 'file:components/index.html', path: 'components/index.html', name: 'index.html' },
      ],
      activeTabKey: 'file:components/index.html',
    });
  });

  it('focuses an existing path when a saved file tab has a stale key', () => {
    const state: WorkspaceTabsState = {
      tabs: [{ kind: 'file', key: 'todo-app.html', path: 'todo-app.html', name: 'todo-app.html' }],
      activeTabKey: 'todo-app.html',
    };

    expect(openWorkspaceFileTab(state, { path: 'todo-app.html', name: 'todo-app.html' })).toEqual({
      tabs: [{ kind: 'file', key: 'file:todo-app.html', path: 'todo-app.html', name: 'todo-app.html' }],
      activeTabKey: 'file:todo-app.html',
    });
  });

  it('closes the active tab and activates the previous sibling', () => {
    const state: WorkspaceTabsState = {
      tabs: [
        { kind: 'file', key: 'file:a.html', path: 'a.html', name: 'a.html' },
        { kind: 'file', key: 'file:b.html', path: 'b.html', name: 'b.html' },
      ],
      activeTabKey: 'file:b.html',
    };

    expect(closeWorkspaceTab(state, 'file:b.html').activeTabKey).toBe('file:a.html');
  });

  it('reorders a dragged tab before the destination tab', () => {
    const state: WorkspaceTabsState = {
      tabs: [
        { kind: 'file', key: 'file:a.html', path: 'a.html', name: 'a.html' },
        { kind: 'file', key: 'file:b.html', path: 'b.html', name: 'b.html' },
        { kind: 'file', key: 'file:c.html', path: 'c.html', name: 'c.html' },
      ],
      activeTabKey: 'file:b.html',
    };

    expect(
      reorderWorkspaceTabs(state, 'file:c.html', 'file:a.html', 'before').tabs.map((tab) => tab.key),
    ).toEqual(['file:c.html', 'file:a.html', 'file:b.html']);
  });

  it('creates file keys with the expected prefix', () => {
    expect(fileTabKey('pages/landing.html')).toBe('file:pages/landing.html');
  });
});
