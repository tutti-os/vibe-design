# Vibe Design Canvas Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Track 5 canvas workspace chain inside `@vibe-design/web` by migrating the relevant `vibe-design` behavior into `vibe-design`-named components, runtime helpers, and tests.

**Architecture:** The implementation lives in one feature folder, `web/src/features/canvas-workspace`, with pure helpers for tabs, HTML edit application, bridge/runtime injection, and thin React host components for preview, workspace orchestration, and inspector UI. The host app replaces the current hello-world shell with a fixture-backed canvas workspace so the migrated surface is renderable without adding server or persistence shells.

**Tech Stack:** React 19, Vitest, jsdom, `@testing-library/react`, `@tutti-os/infra/di`, `@tutti-os/ui-system`

---

## File Structure

### New Files

- `web/src/features/canvas-workspace/canvas-workspace-types.ts`
- `web/src/features/canvas-workspace/canvas-workspace-tabs.ts`
- `web/src/features/canvas-workspace/canvas-workspace-tabs.test.ts`
- `web/src/features/canvas-workspace/canvas-edit/types.ts`
- `web/src/features/canvas-workspace/canvas-edit/bridge.ts`
- `web/src/features/canvas-workspace/canvas-edit/bridge.test.ts`
- `web/src/features/canvas-workspace/canvas-edit/apply-html-edit.ts`
- `web/src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts`
- `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts`
- `web/src/features/canvas-workspace/CanvasPreview.tsx`
- `web/src/features/canvas-workspace/CanvasPreview.test.tsx`
- `web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- `web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`
- `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- `web/src/features/canvas-workspace/index.ts`
- `web/src/types/css.d.ts`

### Modified Files

- `web/package.json`
- `web/src/VibeDesignApp.tsx`
- `web/src/render-page.test.ts`
- `web/src/index.ts`
- `web/src/launch/vibe-design-flow.tsx`

### Likely Removed Files

- `web/src/services/hello/hello-service.interface.ts`
- `web/src/services/hello/hello-service.ts`

The old hello-service flow is not needed once the canvas workspace becomes the primary web surface.

### Shared Fixture Direction

The app shell should use inline fixture files so the migrated feature is renderable without inventing server APIs:

```ts
const demoFiles: WorkspaceFile[] = [
  {
    name: 'landing.html',
    path: 'landing.html',
    kind: 'html',
    mime: 'text/html',
    contents: '<main><h1 data-vd-id="hero-title">Launch faster</h1><p data-vd-id="hero-copy">Compose product visuals in one workspace.</p></main>',
  },
  {
    name: 'palette-notes.txt',
    path: 'palette-notes.txt',
    kind: 'text',
    mime: 'text/plain',
    contents: 'Warm neutrals + graphite accents',
  },
];
```

## Task 1: Replace The Hello Shell With Canvas Workspace Wiring

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/VibeDesignApp.tsx`
- Modify: `web/src/render-page.test.ts`
- Modify: `web/src/index.ts`
- Modify: `web/src/launch/vibe-design-flow.tsx`
- Create: `web/src/features/canvas-workspace/index.ts`
- Create: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Create: `web/src/types/css.d.ts`
- Remove: `web/src/services/hello/hello-service.interface.ts`
- Remove: `web/src/services/hello/hello-service.ts`

- [ ] **Step 1: Write the failing SSR/app-shell tests**

```ts
import { describe, expect, it } from 'vitest';
import { renderPage } from './render-page';

describe('renderPage', () => {
  it('renders the canvas workspace SSR page through the web flow', () => {
    const html = renderPage();

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Vibe Design Workspace');
    expect(html).toContain('Design Files');
    expect(html).toContain('landing.html');
    expect(html).not.toContain('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/render-page.test.ts
```

Expected: FAIL because `VibeDesignApp` still renders `hello world` and the workspace feature does not exist yet.

- [ ] **Step 3: Add package support and app-shell wiring**

`web/package.json`

```json
{
  "dependencies": {
    "@tutti-os/ui-system": "^0.0.26",
    "@tutti-os/infra": "0.1.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.2"
  }
}
```

`web/src/VibeDesignApp.tsx`

```tsx
import '@tutti-os/ui-system/styles.css';
import React from 'react';
import { CanvasWorkspace, type WorkspaceFile } from './features/canvas-workspace';

const demoFiles: WorkspaceFile[] = [
  {
    name: 'landing.html',
    path: 'landing.html',
    kind: 'html',
    mime: 'text/html',
    contents:
      '<main><h1 data-vd-id="hero-title">Launch faster</h1><p data-vd-id="hero-copy">Compose product visuals in one workspace.</p></main>',
  },
  {
    name: 'palette-notes.txt',
    path: 'palette-notes.txt',
    kind: 'text',
    mime: 'text/plain',
    contents: 'Warm neutrals + graphite accents',
  },
];

export function VibeDesignApp() {
  return (
    <main>
      <CanvasWorkspace files={demoFiles} title="Vibe Design Workspace" />
    </main>
  );
}
```

`web/src/index.ts`

```ts
export { renderPage } from './render-page';
export { createVibeDesignFlow, VibeDesignFlow, type VibeDesignFlowOptions } from './launch/vibe-design-flow';
export * from './features/canvas-workspace';
```

`web/src/launch/vibe-design-flow.tsx`

```tsx
import React, { type ReactNode } from 'react';
import { VibeDesignApp } from '../VibeDesignApp';

export interface VibeDesignFlowOptions {}

export class VibeDesignFlow {
  constructor(private readonly options: VibeDesignFlowOptions = {}) {
    void this.options;
  }

  init(): void {}

  render(): ReactNode {
    this.init();
    return <VibeDesignApp />;
  }
}

export function createVibeDesignFlow(options?: VibeDesignFlowOptions): VibeDesignFlow {
  return new VibeDesignFlow(options);
}
```

`web/src/features/canvas-workspace/index.ts`

```ts
export { CanvasWorkspace } from './CanvasWorkspace';
export type { WorkspaceFile, WorkspaceTabsState } from './canvas-workspace-types';
```

`web/src/features/canvas-workspace/CanvasWorkspace.tsx`

```tsx
import React from 'react';
import type { WorkspaceFile, WorkspaceTabsState } from './canvas-workspace-types';

export interface CanvasWorkspaceProps {
  files: WorkspaceFile[];
  title?: string;
  initialTabs?: WorkspaceTabsState;
}

export function CanvasWorkspace({
  files,
  title = 'Vibe Design Workspace',
}: CanvasWorkspaceProps) {
  return (
    <section aria-label={title}>
      <h1>{title}</h1>
      <div role="tablist" aria-label="Workspace tabs">
        <button role="tab" aria-selected="true">
          Design Files
        </button>
      </div>
      <div>
        {files.map((file) => (
          <div key={file.path}>{file.name}</div>
        ))}
      </div>
    </section>
  );
}
```

`web/src/types/css.d.ts`

```ts
declare module '*.css';
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/render-page.test.ts
```

Expected: PASS with SSR output containing the workspace title and seeded file row.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add web/package.json web/src/VibeDesignApp.tsx web/src/render-page.test.ts web/src/index.ts web/src/launch/vibe-design-flow.tsx web/src/features/canvas-workspace/index.ts web/src/features/canvas-workspace/CanvasWorkspace.tsx web/src/types/css.d.ts
git -C /Users/chovy/Desktop/workspace/vibe-design rm -f web/src/services/hello/hello-service.interface.ts web/src/services/hello/hello-service.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "refactor: replace hello shell with canvas workspace app"
```

## Task 2: Define Workspace Types And Tab State Helpers

**Files:**
- Create: `web/src/features/canvas-workspace/canvas-workspace-types.ts`
- Create: `web/src/features/canvas-workspace/canvas-workspace-tabs.ts`
- Create: `web/src/features/canvas-workspace/canvas-workspace-tabs.test.ts`

- [ ] **Step 1: Write failing tab-helper tests**

```ts
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

    expect(openWorkspaceFileTab(state, 'landing.html')).toEqual({
      tabs: [{ kind: 'file', key: 'file:landing.html', name: 'landing.html' }],
      activeTabKey: 'file:landing.html',
    });
  });

  it('closes the active tab and activates the previous sibling', () => {
    const state: WorkspaceTabsState = {
      tabs: [
        { kind: 'file', key: 'file:a.html', name: 'a.html' },
        { kind: 'file', key: 'file:b.html', name: 'b.html' },
      ],
      activeTabKey: 'file:b.html',
    };

    expect(closeWorkspaceTab(state, 'file:b.html').activeTabKey).toBe('file:a.html');
  });

  it('reorders a dragged tab before the destination tab', () => {
    const state: WorkspaceTabsState = {
      tabs: [
        { kind: 'file', key: 'file:a.html', name: 'a.html' },
        { kind: 'file', key: 'file:b.html', name: 'b.html' },
        { kind: 'file', key: 'file:c.html', name: 'c.html' },
      ],
      activeTabKey: 'file:b.html',
    };

    expect(reorderWorkspaceTabs(state, 'file:c.html', 'file:a.html', 'before').tabs.map((tab) => tab.key)).toEqual([
      'file:c.html',
      'file:a.html',
      'file:b.html',
    ]);
  });

  it('creates file keys with the expected prefix', () => {
    expect(fileTabKey('landing.html')).toBe('file:landing.html');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/canvas-workspace-tabs.test.ts
```

Expected: FAIL because the helper module and local workspace types do not exist.

- [ ] **Step 3: Implement the minimal types and helpers**

`web/src/features/canvas-workspace/canvas-workspace-types.ts`

```ts
export type WorkspaceFileKind = 'html' | 'image' | 'text';

export interface WorkspaceFile {
  name: string;
  path: string;
  kind: WorkspaceFileKind;
  mime: string;
  contents?: string;
  url?: string;
}

export interface WorkspaceFileTab {
  kind: 'file';
  key: string;
  name: string;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceFileTab[];
  activeTabKey: string | null;
}
```

`web/src/features/canvas-workspace/canvas-workspace-tabs.ts`

```ts
import type { WorkspaceFileTab, WorkspaceTabsState } from './canvas-workspace-types';

export type TabDropEdge = 'before' | 'after';

export function fileTabKey(name: string): string {
  return `file:${name}`;
}

export function openWorkspaceFileTab(state: WorkspaceTabsState, name: string): WorkspaceTabsState {
  const key = fileTabKey(name);
  const existing = state.tabs.find((tab) => tab.key === key);
  if (existing) return { ...state, activeTabKey: key };
  const nextTab: WorkspaceFileTab = { kind: 'file', key, name };
  return { tabs: [...state.tabs, nextTab], activeTabKey: key };
}

export function closeWorkspaceTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  if (state.activeTabKey !== key) return { tabs, activeTabKey: state.activeTabKey };
  const fallback = tabs[Math.max(0, index - 1)] ?? tabs[0] ?? null;
  return { tabs, activeTabKey: fallback?.key ?? null };
}

export function reorderWorkspaceTabs(
  state: WorkspaceTabsState,
  fromKey: string,
  toKey: string,
  edge: TabDropEdge,
): WorkspaceTabsState {
  if (fromKey === toKey) return state;
  const tabs = [...state.tabs];
  const fromIndex = tabs.findIndex((tab) => tab.key === fromKey);
  const toIndex = tabs.findIndex((tab) => tab.key === toKey);
  if (fromIndex < 0 || toIndex < 0) return state;
  const [moved] = tabs.splice(fromIndex, 1);
  const targetIndex = tabs.findIndex((tab) => tab.key === toKey);
  const insertAt = edge === 'before' ? targetIndex : targetIndex + 1;
  tabs.splice(insertAt, 0, moved);
  return { ...state, tabs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/canvas-workspace-tabs.test.ts
```

Expected: PASS with all four tab-state behaviors green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add web/src/features/canvas-workspace/canvas-workspace-types.ts web/src/features/canvas-workspace/canvas-workspace-tabs.ts web/src/features/canvas-workspace/canvas-workspace-tabs.test.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "feat: add canvas workspace tab state helpers"
```

## Task 3: Port The Canvas Edit Bridge And HTML Edit Helper

**Files:**
- Create: `web/src/features/canvas-workspace/canvas-edit/types.ts`
- Create: `web/src/features/canvas-workspace/canvas-edit/bridge.ts`
- Create: `web/src/features/canvas-workspace/canvas-edit/bridge.test.ts`
- Create: `web/src/features/canvas-workspace/canvas-edit/apply-html-edit.ts`
- Create: `web/src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts`

- [ ] **Step 1: Write failing bridge and HTML-edit tests**

`web/src/features/canvas-workspace/canvas-edit/bridge.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildCanvasEditBridge,
  canvasEditDomPathForElement,
  canvasEditStableIdForElement,
  isCanvasEditHostNode,
} from './bridge';

describe('canvas edit bridge', () => {
  it('prefers explicit data-vd-id over generated ids', () => {
    const dom = new JSDOM('<main><h1 data-vd-id="hero">Title</h1></main>');
    const target = dom.window.document.querySelector('h1')!;
    expect(canvasEditStableIdForElement(target)).toBe('hero');
  });

  it('ignores injected host nodes when computing DOM paths', () => {
    const dom = new JSDOM('<script data-vd-edit-bridge></script><main><section><p>First</p><p>Second</p></section></main>');
    const target = dom.window.document.querySelectorAll('p')[1]!;
    expect(canvasEditDomPathForElement(target)).toBe('path-0-0-1');
  });

  it('emits vd-edit-targets when edit mode turns on', async () => {
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main><h1 data-vd-source-path="path-0-0">Hero</h1></main>${buildCanvasEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1')!;
    title.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON: () => ({}) }) as DOMRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'vd-edit-mode', enabled: true } }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(posts.some((message) => message.type === 'vd-edit-targets')).toBe(true);
    dom.window.close();
  });

  it('marks bridge script nodes as host nodes', () => {
    const dom = new JSDOM('<script data-vd-edit-bridge></script>');
    expect(isCanvasEditHostNode(dom.window.document.querySelector('script')!)).toBe(true);
  });
});
```

`web/src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { applyTextCommitToHtml } from './apply-html-edit';

describe('applyTextCommitToHtml', () => {
  it('updates a node matched by data-vd-id', () => {
    const html = '<main><h1 data-vd-id="hero-title">Old title</h1></main>';

    expect(applyTextCommitToHtml(html, 'hero-title', 'New title')).toContain('New title');
  });

  it('leaves HTML unchanged when no matching node exists', () => {
    const html = '<main><p data-vd-id="body">Body</p></main>';

    expect(applyTextCommitToHtml(html, 'missing', 'Ignored')).toBe(html);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/canvas-edit/bridge.test.ts src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts
```

Expected: FAIL because the bridge and HTML-edit modules do not exist yet.

- [ ] **Step 3: Implement the bridge types, bridge script, and HTML edit helper**

`web/src/features/canvas-workspace/canvas-edit/types.ts`

```ts
export interface EditableNodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditableNode {
  id: string;
  kind: 'text' | 'image' | 'link' | 'container';
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: EditableNodeRect;
  fields: Record<string, string>;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  isLayoutContainer: boolean;
  isHidden?: boolean;
  outerHtml?: string;
}

export type CanvasEditBridgeMessage =
  | { type: 'vd-edit-targets'; targets: EditableNode[] }
  | { type: 'vd-edit-hover'; target: EditableNode }
  | { type: 'vd-edit-select'; target: EditableNode }
  | { type: 'vd-edit-text-commit'; id: string; value: string };
```

`web/src/features/canvas-workspace/canvas-edit/bridge.ts`

```ts
export const CANVAS_EDIT_SOURCE_PATH_ATTR = 'data-vd-source-path';
export const CANVAS_EDIT_DISCOVERY_SELECTOR =
  'main, nav, section, article, header, footer, div, h1, h2, h3, p, a, button, img, strong, span';
export const CANVAS_EDIT_HOST_NODE_SELECTOR = [
  '[data-vd-edit-bridge]',
  '[data-vd-edit-bridge-style]',
].join(',');

export function isCanvasEditHostNode(el: Element): boolean {
  return el.matches(CANVAS_EDIT_HOST_NODE_SELECTOR);
}

export function canvasEditDomPathForElement(el: Element): string {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parent = node.parentElement;
    if (!parent) break;
    const children = Array.from(parent.children).filter((child) => !isCanvasEditHostNode(child));
    parts.unshift(children.indexOf(node));
    node = parent;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

export function canvasEditStableIdForElement(el: Element): string {
  const explicit = el.getAttribute('data-vd-id');
  if (explicit) return explicit;
  const generated =
    el.getAttribute(CANVAS_EDIT_SOURCE_PATH_ATTR) ||
    el.getAttribute('data-vd-runtime-id') ||
    canvasEditDomPathForElement(el);
  if (generated) el.setAttribute('data-vd-runtime-id', generated);
  return generated || 'unknown';
}

export function buildCanvasEditBridge(enabled: boolean): string {
  return `<script data-vd-edit-bridge>(function(){
    var enabled = ${JSON.stringify(enabled)};
    var sourcePathAttr = ${JSON.stringify(CANVAS_EDIT_SOURCE_PATH_ATTR)};
    var selector = ${JSON.stringify(CANVAS_EDIT_DISCOVERY_SELECTOR)};
    function stableId(el){
      var explicit = el.getAttribute('data-vd-id');
      if (explicit) return explicit;
      var generated = el.getAttribute(sourcePathAttr) || el.getAttribute('data-vd-runtime-id');
      if (!generated) generated = 'path-' + Math.random().toString(36).slice(2, 8);
      el.setAttribute('data-vd-runtime-id', generated);
      return generated;
    }
    function targetFrom(el){
      var rect = el.getBoundingClientRect();
      return {
        id: stableId(el),
        kind: el.tagName.toLowerCase() === 'a' ? 'link' : el.tagName.toLowerCase() === 'img' ? 'image' : ['section','main','nav','div','article','header','footer'].indexOf(el.tagName.toLowerCase()) >= 0 ? 'container' : 'text',
        label: (el.textContent || el.tagName || 'element').trim().slice(0, 42),
        tagName: el.tagName.toLowerCase(),
        className: typeof el.className === 'string' ? el.className : '',
        text: (el.textContent || '').trim(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        fields: { text: (el.textContent || '').trim() },
        attributes: {},
        styles: {},
        isLayoutContainer: false,
        isHidden: false,
        outerHtml: el.outerHTML || '',
      };
    }
    function allTargets(){
      var nodes = document.body ? document.body.querySelectorAll(selector) : [];
      var targets = [];
      for (var i = 0; i < nodes.length; i++) {
        if (!(nodes[i].hasAttribute('data-vd-id') || nodes[i].hasAttribute(sourcePathAttr))) continue;
        targets.push(targetFrom(nodes[i]));
      }
      return targets;
    }
    window.addEventListener('message', function(ev){
      var data = ev && ev.data;
      if (!data || data.type !== 'vd-edit-mode') return;
      enabled = !!data.enabled;
      if (enabled && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'vd-edit-targets', targets: allTargets() }, '*');
      }
    });
  })();</script>`;
}
```

`web/src/features/canvas-workspace/canvas-edit/apply-html-edit.ts`

```ts
export function applyTextCommitToHtml(html: string, id: string, value: string): string {
  const marker = `data-vd-id="${id}"`;
  if (!html.includes(marker)) return html;
  const pattern = new RegExp(`(<[^>]+${marker}[^>]*>)([\\\\s\\\\S]*?)(</[^>]+>)`);
  return html.replace(pattern, `$1${escapeHtml(value)}$3`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/canvas-edit/bridge.test.ts src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts
```

Expected: PASS with green bridge normalization and HTML text-commit behavior.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add web/src/features/canvas-workspace/canvas-edit/types.ts web/src/features/canvas-workspace/canvas-edit/bridge.ts web/src/features/canvas-workspace/canvas-edit/bridge.test.ts web/src/features/canvas-workspace/canvas-edit/apply-html-edit.ts web/src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "feat: add canvas edit bridge primitives"
```

## Task 4: Build The Srcdoc Runtime

**Files:**
- Create: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- Create: `web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts`

- [ ] **Step 1: Write failing srcdoc builder tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPreviewSrcdoc } from './build-preview-srcdoc';

describe('buildPreviewSrcdoc', () => {
  it('wraps fragments in a full document shell', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', { editBridge: false });

    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<body><main><h1 data-vd-id="hero">Hero</h1></main></body>');
  });

  it('injects bridge style and script when edit mode is enabled', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-source-path="path-0-0">Hero</h1></main>', { editBridge: true });

    expect(doc).toContain('data-vd-edit-bridge-style');
    expect(doc).toContain('data-vd-edit-bridge');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts
```

Expected: FAIL because the srcdoc builder module does not exist.

- [ ] **Step 3: Implement the builder**

`web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`

```ts
import { buildCanvasEditBridge } from '../canvas-edit/bridge';

export interface BuildPreviewSrcdocOptions {
  editBridge: boolean;
}

export function buildPreviewSrcdoc(html: string, options: BuildPreviewSrcdocOptions): string {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  const isFullDocument = head.startsWith('<!doctype') || head.startsWith('<html');
  const wrapped = isFullDocument
    ? html
    : `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;

  if (!options.editBridge) return wrapped;

  const style = `<style data-vd-edit-bridge-style>
    [data-vd-edit-selected="true"] { outline: 2px solid currentColor; }
  </style>`;

  return injectBeforeBodyEnd(injectBeforeHeadEnd(wrapped, style), buildCanvasEditBridge(true));
}

function injectBeforeHeadEnd(doc: string, snippet: string): string {
  return doc.includes('</head>') ? doc.replace('</head>', `${snippet}</head>`) : `${snippet}${doc}`;
}

function injectBeforeBodyEnd(doc: string, snippet: string): string {
  return doc.includes('</body>') ? doc.replace('</body>', `${snippet}</body>`) : `${doc}${snippet}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts
```

Expected: PASS with fragment wrapping and bridge injection behavior green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts web/src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "feat: add canvas preview srcdoc runtime"
```

## Task 5: Implement CanvasPreview

**Files:**
- Create: `web/src/features/canvas-workspace/CanvasPreview.tsx`
- Create: `web/src/features/canvas-workspace/CanvasPreview.test.tsx`

- [ ] **Step 1: Write failing preview tests**

```tsx
// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPreview } from './CanvasPreview';
import type { WorkspaceFile } from './canvas-workspace-types';

function htmlFile(contents: string): WorkspaceFile {
  return {
    name: 'landing.html',
    path: 'landing.html',
    kind: 'html',
    mime: 'text/html',
    contents,
  };
}

describe('CanvasPreview', () => {
  it('renders the srcdoc iframe when edit mode is enabled', () => {
    render(<CanvasPreview file={htmlFile('<main><h1 data-vd-id="hero">Hero</h1></main>')} editMode />);

    expect(screen.getByTestId('canvas-preview-srcdoc')).toBeTruthy();
  });

  it('renders the url iframe when edit mode is disabled and a file URL exists', () => {
    render(
      <CanvasPreview
        file={{ ...htmlFile('<main>Hero</main>'), url: '/raw/landing.html' }}
        editMode={false}
      />,
    );

    expect(screen.getByTestId('canvas-preview-url')).toHaveAttribute('src', '/raw/landing.html');
  });

  it('applies a vd-edit-text-commit message back into the current HTML', () => {
    const onHtmlChange = vi.fn();
    render(
      <CanvasPreview
        file={htmlFile('<main><h1 data-vd-id="hero-title">Old title</h1></main>')}
        editMode
        onHtmlChange={onHtmlChange}
      />,
    );

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'vd-edit-text-commit', id: 'hero-title', value: 'New title' },
      }),
    );

    expect(onHtmlChange).toHaveBeenCalledWith(expect.stringContaining('New title'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasPreview.test.tsx
```

Expected: FAIL because `CanvasPreview` does not exist.

- [ ] **Step 3: Implement the minimal preview component**

`web/src/features/canvas-workspace/CanvasPreview.tsx`

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { applyTextCommitToHtml } from './canvas-edit/apply-html-edit';
import type { CanvasEditBridgeMessage } from './canvas-edit/types';
import type { WorkspaceFile } from './canvas-workspace-types';
import { buildPreviewSrcdoc } from './runtime/build-preview-srcdoc';

export interface CanvasPreviewProps {
  file: WorkspaceFile;
  editMode?: boolean;
  onHtmlChange?: (html: string) => void;
  onHoveredTargetChange?: (target: unknown | null) => void;
  onSelectedTargetChange?: (target: unknown | null) => void;
}

export function CanvasPreview({
  file,
  editMode = false,
  onHtmlChange,
  onHoveredTargetChange,
  onSelectedTargetChange,
}: CanvasPreviewProps) {
  const initialHtml = file.contents ?? '';
  const [html, setHtml] = useState(initialHtml);

  useEffect(() => {
    setHtml(file.contents ?? '');
  }, [file.path, file.contents]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<CanvasEditBridgeMessage>) {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'vd-edit-hover') onHoveredTargetChange?.(data.target);
      if (data.type === 'vd-edit-select') onSelectedTargetChange?.(data.target);
      if (data.type === 'vd-edit-text-commit') {
        const next = applyTextCommitToHtml(html, data.id, data.value);
        setHtml(next);
        onHtmlChange?.(next);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [html, onHtmlChange, onHoveredTargetChange, onSelectedTargetChange]);

  const srcDoc = useMemo(() => buildPreviewSrcdoc(html, { editBridge: editMode }), [html, editMode]);
  const showUrlFrame = !editMode && !!file.url;

  if (file.kind !== 'html') {
    return <pre data-testid="canvas-preview-text">{file.contents ?? ''}</pre>;
  }

  return (
    <div data-testid="canvas-preview-root">
      <iframe
        data-testid="canvas-preview-url"
        title={`${file.name} url preview`}
        src={showUrlFrame ? file.url : undefined}
        style={{ display: showUrlFrame ? 'block' : 'none' }}
      />
      <iframe
        data-testid="canvas-preview-srcdoc"
        title={`${file.name} srcdoc preview`}
        srcDoc={srcDoc}
        style={{ display: showUrlFrame ? 'none' : 'block' }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasPreview.test.tsx
```

Expected: PASS with URL/srcdoc switching and text-commit behavior green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add web/src/features/canvas-workspace/CanvasPreview.tsx web/src/features/canvas-workspace/CanvasPreview.test.tsx
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "feat: add canvas preview component"
```

## Task 6: Implement CanvasInspectorPanel And CanvasWorkspace

**Files:**
- Create: `web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`
- Create: `web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`
- Modify: `web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Create: `web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Modify: `web/src/features/canvas-workspace/index.ts`

- [ ] **Step 1: Write failing inspector and workspace tests**

`web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx`

```tsx
// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasInspectorPanel } from './CanvasInspectorPanel';

const target = {
  id: 'hero-title',
  kind: 'text',
  label: 'Hero Title',
  tagName: 'h1',
  className: 'hero',
  text: 'Original',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Original' },
  attributes: { 'data-vd-id': 'hero-title' },
  styles: {},
  isLayoutContainer: false,
};

describe('CanvasInspectorPanel', () => {
  it('renders the selected node title', () => {
    render(<CanvasInspectorPanel selectedTarget={target} />);
    expect(screen.getByText('Hero Title')).toBeTruthy();
  });

  it('routes save and cancel actions', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<CanvasInspectorPanel selectedTarget={target} onSaveDraft={onSave} onCancelDraft={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

`web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

```tsx
// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasWorkspace } from './CanvasWorkspace';
import type { WorkspaceFile } from './canvas-workspace-types';

const files: WorkspaceFile[] = [
  { name: 'landing.html', path: 'landing.html', kind: 'html', mime: 'text/html', contents: '<main><h1 data-vd-id="hero">Hero</h1></main>' },
  { name: 'notes.txt', path: 'notes.txt', kind: 'text', mime: 'text/plain', contents: 'Notes' },
];

describe('CanvasWorkspace', () => {
  it('renders the fixed Design Files root tab', () => {
    render(<CanvasWorkspace files={files} />);
    expect(screen.getByRole('tab', { name: 'Design Files' })).toBeTruthy();
  });

  it('opens a file tab from the file list', () => {
    render(<CanvasWorkspace files={files} />);
    fireEvent.click(screen.getByRole('button', { name: 'landing.html' }));
    expect(screen.getByRole('tab', { name: 'landing.html' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasInspectorPanel.test.tsx src/features/canvas-workspace/CanvasWorkspace.test.tsx
```

Expected: FAIL because neither component exists yet.

- [ ] **Step 3: Implement the minimal panel and workspace**

`web/src/features/canvas-workspace/CanvasInspectorPanel.tsx`

```tsx
import React from 'react';
import { Button } from '@tutti-os/ui-system/components';
import type { EditableNode } from './canvas-edit/types';

export interface CanvasInspectorPanelProps {
  selectedTarget?: EditableNode | null;
  hoveredTarget?: EditableNode | null;
  onSaveDraft?: () => void;
  onCancelDraft?: () => void;
}

export function CanvasInspectorPanel({
  selectedTarget,
  hoveredTarget,
  onSaveDraft,
  onCancelDraft,
}: CanvasInspectorPanelProps) {
  const activeTarget = selectedTarget ?? hoveredTarget ?? null;

  return (
    <aside aria-label="Canvas inspector">
      <h2>{activeTarget?.label ?? 'No selection'}</h2>
      <p>{activeTarget?.text ?? 'Select a node in the canvas preview.'}</p>
      <div>
        <Button onClick={onCancelDraft}>Cancel</Button>
        <Button onClick={onSaveDraft}>Save</Button>
      </div>
    </aside>
  );
}
```

`web/src/features/canvas-workspace/CanvasWorkspace.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import { CanvasInspectorPanel } from './CanvasInspectorPanel';
import { CanvasPreview } from './CanvasPreview';
import { closeWorkspaceTab, openWorkspaceFileTab } from './canvas-workspace-tabs';
import type { EditableNode } from './canvas-edit/types';
import type { WorkspaceFile, WorkspaceTabsState } from './canvas-workspace-types';

const DESIGN_FILES_TAB = '__design_files__';

export interface CanvasWorkspaceProps {
  files: WorkspaceFile[];
  title?: string;
  initialTabs?: WorkspaceTabsState;
}

export function CanvasWorkspace({
  files,
  title = 'Vibe Design Workspace',
  initialTabs = { tabs: [], activeTabKey: null },
}: CanvasWorkspaceProps) {
  const [tabsState, setTabsState] = useState(initialTabs);
  const [hoveredTarget, setHoveredTarget] = useState<EditableNode | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<EditableNode | null>(null);

  const activeFile = useMemo(() => {
    const activeName = tabsState.tabs.find((tab) => tab.key === tabsState.activeTabKey)?.name;
    return files.find((file) => file.name === activeName) ?? null;
  }, [files, tabsState]);

  return (
    <section aria-label={title}>
      <header>
        <h1>{title}</h1>
        <div role="tablist" aria-label="Workspace tabs">
          <button role="tab" aria-selected={tabsState.activeTabKey === null}>
            Design Files
          </button>
          {tabsState.tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={tabsState.activeTabKey === tab.key}
              onClick={() => setTabsState((state) => ({ ...state, activeTabKey: tab.key }))}
            >
              {tab.name}
            </button>
          ))}
        </div>
      </header>

      <div>
        <div>
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              aria-label={file.name}
              onClick={() => setTabsState((state) => openWorkspaceFileTab(state, file.name))}
            >
              {file.name}
            </button>
          ))}
        </div>

        <div>
          {activeFile ? (
            <CanvasPreview
              file={activeFile}
              editMode={activeFile.kind === 'html'}
              onHoveredTargetChange={(target) => setHoveredTarget(target as EditableNode | null)}
              onSelectedTargetChange={(target) => setSelectedTarget(target as EditableNode | null)}
            />
          ) : (
            <div data-testid="canvas-workspace-empty">Choose a file to preview.</div>
          )}
        </div>

        <CanvasInspectorPanel
          hoveredTarget={hoveredTarget}
          selectedTarget={selectedTarget}
          onCancelDraft={() => setSelectedTarget(null)}
          onSaveDraft={() => void 0}
        />
      </div>
    </section>
  );
}

export { DESIGN_FILES_TAB };
```

`web/src/features/canvas-workspace/index.ts`

```ts
export { CanvasWorkspace } from './CanvasWorkspace';
export { CanvasPreview } from './CanvasPreview';
export { CanvasInspectorPanel } from './CanvasInspectorPanel';
export type { WorkspaceFile, WorkspaceTabsState } from './canvas-workspace-types';
export type { EditableNode, CanvasEditBridgeMessage } from './canvas-edit/types';
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasInspectorPanel.test.tsx src/features/canvas-workspace/CanvasWorkspace.test.tsx
```

Expected: PASS with fixed tab rendering, file open behavior, and inspector actions green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add web/src/features/canvas-workspace/CanvasInspectorPanel.tsx web/src/features/canvas-workspace/CanvasInspectorPanel.test.tsx web/src/features/canvas-workspace/CanvasWorkspace.tsx web/src/features/canvas-workspace/CanvasWorkspace.test.tsx web/src/features/canvas-workspace/index.ts
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "feat: add canvas workspace host components"
```

## Task 7: Full Feature Verification

**Files:**
- No new files required

- [ ] **Step 1: Run the focused feature tests**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/render-page.test.ts src/features/canvas-workspace/canvas-workspace-tabs.test.ts src/features/canvas-workspace/canvas-edit/bridge.test.ts src/features/canvas-workspace/canvas-edit/apply-html-edit.test.ts src/features/canvas-workspace/runtime/build-preview-srcdoc.test.ts src/features/canvas-workspace/CanvasPreview.test.tsx src/features/canvas-workspace/CanvasInspectorPanel.test.tsx src/features/canvas-workspace/CanvasWorkspace.test.tsx
```

Expected: PASS with all migrated Track 5 feature tests green.

- [ ] **Step 2: Run the full web package test suite**

Run:

```bash
pnpm --filter @vibe-design/web test
```

Expected: PASS with the SSR test and feature tests green.

- [ ] **Step 3: Run type-check**

Run:

```bash
pnpm --filter @vibe-design/web type-check
```

Expected: PASS with no missing exports, CSS module declaration issues, or React type errors.

- [ ] **Step 4: Commit the final verified state**

```bash
git -C /Users/chovy/Desktop/workspace/vibe-design add -A
git -C /Users/chovy/Desktop/workspace/vibe-design commit -m "feat: migrate canvas workspace rendering chain"
```
