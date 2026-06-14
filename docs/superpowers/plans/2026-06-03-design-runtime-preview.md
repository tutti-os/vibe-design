# Design Runtime Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vibe Design render multi-file HTML runtime packages, such as `index.html` plus sibling JSX files, in both active canvas preview and design file detail preview.

**Architecture:** Keep URL preview unchanged because browser-relative sibling loading already works through `/api/projects/:id/files/:name`. Add a focused srcdoc builder that inlines same-project sibling scripts before delegating to the existing preview size and edit bridge injection. Thread the workspace file list into `CanvasPreview` and `HtmlDesignFilePreview` so srcdoc rendering has the dependency context it needs.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, jsdom, existing iframe preview runtime

---

## Source Context

- Confirmed spec: `/Users/zhengweibin/Desktop/team-shell/vibe-design/docs/superpowers/specs/2026-06-03-design-runtime-preview-design.md`
- Current preview component: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`
- Existing srcdoc builder: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-preview-srcdoc.ts`
- Current workspace surface: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
- Workspace file types: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/canvas-workspace-types.ts`
- Current preview tests: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.test.tsx`
- Current workspace tests: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`

## Scope

This plan implements Phase 1 from the spec:

- inline same-project sibling scripts for srcdoc rendering
- preserve URL preview behavior
- wire active canvas preview and design file detail preview
- test edit bridge and size bridge still inject after inlining

This plan does not implement Phase 2 host-owned tweaks.

## File Structure

### New files

- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`
  - Owns dependency inlining for HTML runtime srcdoc.
  - Delegates bridge injection to `buildPreviewSrcdoc`.

- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts`
  - Covers sibling inlining, remote script preservation, missing-source diagnostics, and bridge delegation.

### Existing files to modify

- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`
  - Accept optional `files?: WorkspaceFile[]`.
  - Build HTML srcdoc with `buildDesignRuntimeSrcdoc`.

- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.test.tsx`
  - Assert sibling JSX is inlined in active canvas srcdoc.
  - Assert URL preview mode still uses the file URL.

- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`
  - Pass the full file list into `CanvasPreview`.
  - Pass the full file list into `HtmlDesignFilePreview`.

- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
  - Assert design file detail preview inlines sibling JSX.
  - Assert opened canvas preview inlines sibling JSX.

## Task 1: Add The Runtime Srcdoc Builder

**Files:**
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts`
- Create: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`

- [ ] **Step 1: Write failing tests for sibling script handling**

Create `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildDesignRuntimeSrcdoc } from './build-design-runtime-srcdoc';

const entryFile = {
  name: 'index.html',
  path: 'index.html',
  mime: 'text/html',
  contents: `<!doctype html>
<html>
  <head>
    <script src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" src="design-canvas.jsx"></script>
    <script type="text/babel" src="./app.jsx"></script>
  </body>
</html>`,
};

const files = [
  entryFile,
  {
    name: 'design-canvas.jsx',
    path: 'design-canvas.jsx',
    mime: 'text/javascript',
    contents: 'function VDDesignCanvas({ children }) { return <main>{children}</main>; }',
  },
  {
    name: 'app.jsx',
    path: 'app.jsx',
    mime: 'text/javascript',
    contents: 'function App() { return <VDDesignCanvas />; }',
  },
];

describe('buildDesignRuntimeSrcdoc', () => {
  it('inlines same-project relative JSX scripts and preserves remote scripts', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile,
      files,
      editBridge: false,
      sizeBridge: false,
    });

    expect(doc).toContain('src="https://unpkg.com/react@18.3.1/umd/react.development.js"');
    expect(doc).toContain('type="text/babel" data-vd-source="design-canvas.jsx"');
    expect(doc).toContain('function VDDesignCanvas');
    expect(doc).toContain('type="text/babel" data-vd-source="app.jsx"');
    expect(doc).toContain('function App()');
    expect(doc).not.toContain('src="design-canvas.jsx"');
    expect(doc).not.toContain('src="./app.jsx"');
  });

  it('does not inline absolute, parent-directory, hash, mail, data, or remote script sources', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        ...entryFile,
        contents: `<!doctype html><html><body>
          <script src="/absolute/app.jsx"></script>
          <script src="../outside.jsx"></script>
          <script src="#local"></script>
          <script src="mailto:test@example.com"></script>
          <script src="data:text/javascript,alert(1)"></script>
          <script src="https://example.com/app.jsx"></script>
        </body></html>`,
      },
      files,
      editBridge: false,
    });

    expect(doc).toContain('src="/absolute/app.jsx"');
    expect(doc).toContain('src="../outside.jsx"');
    expect(doc).toContain('src="#local"');
    expect(doc).toContain('src="mailto:test@example.com"');
    expect(doc).toContain('src="data:text/javascript,alert(1)"');
    expect(doc).toContain('src="https://example.com/app.jsx"');
  });

  it('annotates missing same-project scripts without throwing', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        ...entryFile,
        contents: '<!doctype html><html><body><script type="text/babel" src="missing.jsx"></script></body></html>',
      },
      files,
      editBridge: false,
    });

    expect(doc).toContain('src="missing.jsx"');
    expect(doc).toContain('data-vd-missing-source="true"');
  });

  it('escapes closing script tags inside inlined source', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        ...entryFile,
        contents: '<!doctype html><html><body><script type="text/babel" src="app.jsx"></script></body></html>',
      },
      files: [
        entryFile,
        {
          name: 'app.jsx',
          path: 'app.jsx',
          mime: 'text/javascript',
          contents: 'const html = "</script><div>safe</div>";',
        },
      ],
      editBridge: false,
    });

    expect(doc).toContain('const html = "<\\/script><div>safe</div>";');
  });

  it('delegates size bridge and edit bridge injection after inlining', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile,
      files,
      editBridge: true,
      sizeBridge: true,
    });

    expect(doc).toContain('data-vd-source="app.jsx"');
    expect(doc).toContain('data-vd-preview-size-bridge');
    expect(doc).toContain('data-vd-edit-bridge');
    expect(doc.indexOf('data-vd-source="app.jsx"')).toBeLessThan(doc.indexOf('data-vd-preview-size-bridge'));
  });
});
```

- [ ] **Step 2: Run tests and verify they fail because the module is missing**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts
```

Expected: FAIL with an import error for `./build-design-runtime-srcdoc`.

- [ ] **Step 3: Implement the srcdoc builder**

Create `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts`:

```ts
import { buildPreviewSrcdoc } from './build-preview-srcdoc';

export interface BuildDesignRuntimeSrcdocFile {
  name: string;
  path: string;
  contents?: string;
  mime: string;
}

export interface BuildDesignRuntimeSrcdocOptions {
  entryFile: BuildDesignRuntimeSrcdocFile;
  files: BuildDesignRuntimeSrcdocFile[];
  editBridge: boolean;
  sizeBridge?: boolean;
}

export function buildDesignRuntimeSrcdoc(options: BuildDesignRuntimeSrcdocOptions): string {
  const entryHtml = options.entryFile.contents ?? '';
  const inlinedHtml = inlineSameProjectScripts(entryHtml, options.entryFile, options.files);

  return buildPreviewSrcdoc(inlinedHtml, {
    editBridge: options.editBridge,
    sizeBridge: options.sizeBridge,
  });
}

function inlineSameProjectScripts(
  html: string,
  entryFile: BuildDesignRuntimeSrcdocFile,
  files: BuildDesignRuntimeSrcdocFile[],
): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  const scripts = Array.from(document.querySelectorAll('script[src]'));

  for (const script of scripts) {
    const source = script.getAttribute('src');
    if (!source || !isSameProjectRelativeSource(source)) {
      continue;
    }

    const resolvedPath = resolveSiblingPath(entryFile.path, source);
    const sourceFile = findSourceFile(files, resolvedPath);
    if (!sourceFile?.contents) {
      script.setAttribute('data-vd-missing-source', 'true');
      continue;
    }

    script.removeAttribute('src');
    script.setAttribute('data-vd-source', resolvedPath);
    script.textContent = escapeScriptText(sourceFile.contents);
  }

  return `${doctypeForHtml(html)}${document.documentElement.outerHTML}`;
}

function isSameProjectRelativeSource(source: string): boolean {
  const trimmedSource = source.trim();

  if (
    trimmedSource.startsWith('/') ||
    trimmedSource.startsWith('#') ||
    trimmedSource.startsWith('../') ||
    trimmedSource.includes('://') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmedSource)
  ) {
    return false;
  }

  return trimmedSource.length > 0;
}

function resolveSiblingPath(entryPath: string, source: string): string {
  const entryParts = entryPath.split('/');
  entryParts.pop();
  const sourceParts = source.split('/').filter((part) => part.length > 0 && part !== '.');
  return [...entryParts, ...sourceParts].join('/');
}

function findSourceFile(
  files: BuildDesignRuntimeSrcdocFile[],
  resolvedPath: string,
): BuildDesignRuntimeSrcdocFile | null {
  return files.find((file) => file.path === resolvedPath || file.name === resolvedPath) ?? null;
}

function escapeScriptText(contents: string): string {
  return contents.replace(/<\/script/gi, '<\\/script');
}

function doctypeForHtml(html: string): string {
  return html.trimStart().toLowerCase().startsWith('<!doctype') ? '<!doctype html>' : '';
}
```

- [ ] **Step 4: Run builder tests and verify they pass**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts
```

Expected: PASS for all `buildDesignRuntimeSrcdoc` tests.

- [ ] **Step 5: Commit the runtime builder**

Run:

```bash
git add web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.ts \
  web/src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts
git commit -m "feat: add design runtime srcdoc builder"
```

Expected: commit succeeds and includes only the new runtime builder and its tests.

## Task 2: Wire Runtime Srcdoc Into Active Canvas Preview

**Files:**
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.test.tsx`
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`

- [ ] **Step 1: Add failing CanvasPreview tests**

In `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.test.tsx`, add this helper near `htmlFile`:

```ts
function runtimeFiles(): WorkspaceFile[] {
  return [
    htmlFile('<!doctype html><html><body><div id="root"></div><script type="text/babel" src="app.jsx"></script></body></html>'),
    {
      name: 'app.jsx',
      path: 'app.jsx',
      kind: 'text',
      mime: 'text/javascript',
      contents: 'function App() { return <VDDesignCanvas />; }',
    },
  ];
}
```

Then add these tests inside `describe('CanvasPreview', () => { ... })`:

```ts
it('inlines sibling JSX files into the active srcdoc preview', () => {
  const [entryFile, ...allFiles] = runtimeFiles();

  render(<CanvasPreview file={entryFile} files={[entryFile, ...allFiles]} />);

  const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
  expect(srcdoc).toContain('data-vd-source="app.jsx"');
  expect(srcdoc).toContain('function App()');
  expect(srcdoc).not.toContain('src="app.jsx"');
});

it('keeps URL preview mode on the raw file URL when a URL exists', () => {
  const [entryFile, ...allFiles] = runtimeFiles();

  render(
    <CanvasPreview
      file={{ ...entryFile, url: '/api/projects/demo/files/index.html' }}
      files={[entryFile, ...allFiles]}
      editMode={false}
    />,
  );

  const urlFrame = screen.getByTestId('canvas-preview-url');
  expect(urlFrame.getAttribute('src')).toBe('/api/projects/demo/files/index.html');
  expect(urlFrame.getAttribute('style')).toContain('visibility: visible');
});
```

- [ ] **Step 2: Run CanvasPreview tests and verify the first new test fails**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasPreview.test.tsx
```

Expected: FAIL because the srcdoc still contains `src="app.jsx"` and does not contain `data-vd-source="app.jsx"`.

- [ ] **Step 3: Update CanvasPreview props and srcdoc construction**

In `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasPreview.tsx`, replace the builder import:

```ts
import { buildPreviewSrcdoc } from './runtime/build-preview-srcdoc';
```

with:

```ts
import { buildDesignRuntimeSrcdoc } from './runtime/build-design-runtime-srcdoc';
```

Update `CanvasPreviewProps`:

```ts
export interface CanvasPreviewProps {
  file: WorkspaceFile;
  files?: WorkspaceFile[];
  editMode?: boolean;
  onHtmlChange?: (html: string) => void;
  onTargetsChange?: (targets: EditableNode[]) => void;
  onHoveredTargetChange?: (target: EditableNode | null) => void;
  onSelectedTargetChange?: (target: EditableNode | null) => void;
  selectedTargetId?: string | null;
  stylePreview?: CanvasPreviewStylePreview | null;
}
```

Update the component parameter list:

```ts
export function CanvasPreview({
  file,
  files = [file],
  editMode = false,
  onHtmlChange,
  onTargetsChange,
  onHoveredTargetChange,
  onSelectedTargetChange,
  selectedTargetId = null,
  stylePreview = null,
}: CanvasPreviewProps) {
```

Replace the `srcDoc` line:

```ts
const srcDoc = isHtmlPreview ? buildPreviewSrcdoc(html, { editBridge: editMode, sizeBridge: true }) : '';
```

with:

```ts
const srcDoc = isHtmlPreview
  ? buildDesignRuntimeSrcdoc({
      entryFile: { ...file, contents: html },
      files: files.map((candidate) =>
        candidate.path === file.path ? { ...candidate, contents: html } : candidate,
      ),
      editBridge: editMode,
      sizeBridge: true,
    })
  : '';
```

- [ ] **Step 4: Run CanvasPreview tests and verify they pass**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasPreview.test.tsx
```

Expected: PASS for all `CanvasPreview` tests.

- [ ] **Step 5: Commit CanvasPreview integration**

Run:

```bash
git add web/src/features/canvas-workspace/CanvasPreview.tsx \
  web/src/features/canvas-workspace/CanvasPreview.test.tsx
git commit -m "feat: inline runtime sources in canvas preview"
```

Expected: commit succeeds and includes only `CanvasPreview` integration changes.

## Task 3: Wire Runtime Srcdoc Into Workspace And Design File Detail Preview

**Files:**
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`
- Modify: `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`

- [ ] **Step 1: Add failing workspace tests for detail and opened canvas preview**

In `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.test.tsx`, add this fixture near the existing `files` fixture:

```ts
const runtimeFiles: WorkspaceFile[] = [
  {
    name: 'index.html',
    path: 'index.html',
    kind: 'html',
    mime: 'text/html',
    contents: '<!doctype html><html><body><div id="root"></div><script type="text/babel" src="app.jsx"></script></body></html>',
  },
  {
    name: 'app.jsx',
    path: 'app.jsx',
    kind: 'text',
    mime: 'text/javascript',
    contents: 'function App() { return <VDDesignCanvas />; }',
  },
];
```

Add these tests inside the `CanvasWorkspace` describe block:

```ts
it('inlines sibling JSX in the selected html design file detail preview', () => {
  render(<CanvasWorkspace files={runtimeFiles} />);

  fireEvent.click(screen.getByRole('button', { name: 'index.html' }));

  const srcdoc = screen.getByTestId('design-file-preview-srcdoc').getAttribute('srcdoc') ?? '';
  expect(srcdoc).toContain('data-vd-source="app.jsx"');
  expect(srcdoc).toContain('function App()');
  expect(srcdoc).not.toContain('src="app.jsx"');
});

it('passes sibling files into the opened canvas preview', () => {
  render(<CanvasWorkspace files={runtimeFiles} />);

  openDesignFile('index.html');

  const srcdoc = screen.getByTestId('canvas-preview-srcdoc').getAttribute('srcdoc') ?? '';
  expect(srcdoc).toContain('data-vd-source="app.jsx"');
  expect(srcdoc).toContain('function App()');
});
```

- [ ] **Step 2: Run workspace tests and verify the new tests fail**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasWorkspace.test.tsx
```

Expected: FAIL because `HtmlDesignFilePreview` and `CanvasWorkspace` do not pass sibling file context into the srcdoc builder yet.

- [ ] **Step 3: Import the runtime builder in CanvasWorkspace**

In `/Users/zhengweibin/Desktop/team-shell/vibe-design/web/src/features/canvas-workspace/CanvasWorkspace.tsx`, add:

```ts
import { buildDesignRuntimeSrcdoc } from './runtime/build-design-runtime-srcdoc';
```

- [ ] **Step 4: Pass files into CanvasPreview**

In the `CanvasPreview` JSX, update the props:

```tsx
<CanvasPreview
  file={activeFile}
  files={files}
  editMode={isInspectMode && activeFile.kind === 'html'}
  selectedTargetId={selectedTarget?.id ?? null}
  stylePreview={stylePreview}
  onHtmlChange={handleHtmlChange}
  onTargetsChange={setAvailableTargets}
  onHoveredTargetChange={setHoveredTarget}
  onSelectedTargetChange={handleSelectedTargetChange}
/>
```

- [ ] **Step 5: Thread files through the design file detail preview**

Update `DesignFilesSurface` props:

```ts
function DesignFilesSurface({
  files,
  selectedFile,
  onSelectFile,
  onOpenFile,
}: {
  files: WorkspaceFile[];
  selectedFile: WorkspaceFile | null;
  onSelectFile: (file: WorkspaceFile) => void;
  onOpenFile: (file: WorkspaceFile) => void;
}) {
```

Keep its call to `DesignFileDetail` as:

```tsx
<DesignFileDetail selectedFile={selectedFile} files={files} onOpenFile={onOpenFile} />
```

Update `DesignFileDetail` props where it is declared:

```ts
function DesignFileDetail({
  selectedFile,
  files,
  onOpenFile,
}: {
  selectedFile: WorkspaceFile | null;
  files: WorkspaceFile[];
  onOpenFile: (file: WorkspaceFile) => void;
}) {
```

Update the preview call inside `DesignFileDetail`:

```tsx
<DesignFilePreview file={selectedFile} files={files} />
```

Update `DesignFilePreview`:

```ts
function DesignFilePreview({ file, files }: { file: WorkspaceFile; files: WorkspaceFile[] }) {
  if (file.kind === 'html') {
    return <HtmlDesignFilePreview file={file} files={files} />;
  }

  if (file.kind === 'image' && file.url) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-[var(--background-fronted)]">
        <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  return <CodeDesignFilePreview file={file} />;
}
```

Update `HtmlDesignFilePreview` signature:

```ts
function HtmlDesignFilePreview({ file, files }: { file: WorkspaceFile; files: WorkspaceFile[] }) {
```

Inside `HtmlDesignFilePreview`, add:

```ts
  const srcDoc = React.useMemo(
    () =>
      buildDesignRuntimeSrcdoc({
        entryFile: file,
        files,
        editBridge: false,
        sizeBridge: false,
      }),
    [file, files],
  );
```

Replace:

```tsx
srcDoc={file.contents ?? ''}
```

with:

```tsx
srcDoc={srcDoc}
```

- [ ] **Step 6: Run workspace tests and verify they pass**

Run:

```bash
pnpm --filter @vibe-design/web test -- src/features/canvas-workspace/CanvasWorkspace.test.tsx
```

Expected: PASS for all `CanvasWorkspace` tests.

- [ ] **Step 7: Commit workspace integration**

Run:

```bash
git add web/src/features/canvas-workspace/CanvasWorkspace.tsx \
  web/src/features/canvas-workspace/CanvasWorkspace.test.tsx
git commit -m "feat: inline runtime sources in workspace previews"
```

Expected: commit succeeds and includes only workspace preview integration changes.

## Task 4: Full Web Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused runtime and preview tests together**

Run:

```bash
pnpm --filter @vibe-design/web test -- \
  src/features/canvas-workspace/runtime/build-design-runtime-srcdoc.test.ts \
  src/features/canvas-workspace/CanvasPreview.test.tsx \
  src/features/canvas-workspace/CanvasWorkspace.test.tsx
```

Expected: PASS for all focused runtime, preview, and workspace tests.

- [ ] **Step 2: Run full web tests**

Run:

```bash
pnpm --filter @vibe-design/web test
```

Expected: PASS for the `@vibe-design/web` test suite.

- [ ] **Step 3: Run type check**

Run:

```bash
pnpm --filter @vibe-design/web type-check
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Confirm no unrelated files were staged**

Run:

```bash
git status --short
```

Expected: the output may still include pre-existing dirty files from the workspace, but no unrelated files should be staged for this plan. Any source fixes made during verification must be handled by returning to the failing task, editing the exact files named there, rerunning that task's tests, and committing with that task's commit command.

## Self-Review

Spec coverage:

- Multi-file srcdoc inlining is covered by Task 1.
- Active canvas preview integration is covered by Task 2.
- Design file detail preview integration is covered by Task 3.
- URL preview contract is covered by Task 2.
- Existing edit and size bridge preservation is covered by Task 1 and Task 2.
- Phase 2 host-owned tweaks is intentionally excluded from this Phase 1 implementation plan.

Type consistency:

- `BuildDesignRuntimeSrcdocFile` matches the subset of `WorkspaceFile` required by the builder.
- `CanvasPreviewProps.files?: WorkspaceFile[]` defaults to `[file]`.
- `HtmlDesignFilePreview` receives `files: WorkspaceFile[]` from the existing `CanvasWorkspace` file list.

Validation:

- The final required commands are `pnpm --filter @vibe-design/web test` and `pnpm --filter @vibe-design/web type-check`.
