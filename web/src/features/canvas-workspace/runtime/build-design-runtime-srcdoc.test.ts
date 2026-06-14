// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CANVAS_COMMENT_BRIDGE_ATTR } from '../canvas-comment/bridge';
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
  it('rewrites same-project relative asset URLs to their project file URLs inside srcdoc', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        name: 'login.html',
        path: 'login.html',
        mime: 'text/html',
        contents: `<!doctype html><html><head>
          <link rel="stylesheet" href="theme.css">
        </head><body>
          <img src="assets/hero.png" alt="Hero">
        </body></html>`,
      },
      files: [
        {
          name: 'login.html',
          path: 'login.html',
          mime: 'text/html',
          contents: '',
          url: '/api/projects/project-1/files/login.html',
        },
        {
          name: 'hero.png',
          path: 'hero.png',
          mime: 'image/png',
          url: '/api/projects/project-1/files/hero.png',
        },
        {
          name: 'theme.css',
          path: 'theme.css',
          mime: 'text/css',
          contents: 'body { color: red; }',
          url: '/api/projects/project-1/files/theme.css',
        },
      ],
      editBridge: false,
    });

    const parsed = new DOMParser().parseFromString(doc, 'text/html');

    expect(parsed.querySelector('img')?.getAttribute('src')).toBe('/api/projects/project-1/files/hero.png');
    expect(parsed.querySelector('link')?.getAttribute('href')).toBe('/api/projects/project-1/files/theme.css');
  });

  it('preserves plain fragments so preview wrapping adds the standard shell', () => {
    const fragmentEntryFile = {
      name: 'fragment.html',
      path: 'fragment.html',
      mime: 'text/html',
      contents: '<main><h1 data-vd-id="hero">Hero</h1></main>',
    };

    const doc = buildDesignRuntimeSrcdoc({
      entryFile: fragmentEntryFile,
      files: [fragmentEntryFile],
      editBridge: false,
    });

    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<meta charset="utf-8" />');
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(doc).toContain('<body><main><h1 data-vd-id="hero">Hero</h1></main>');
    expect(doc).toContain('data-vd-preview-navigation-bridge');
    expect(doc).not.toContain("window.parent.postMessage({ type: 'vd-preview-navigate'");
  });

  it('wraps fragments after inlining same-project local scripts', () => {
    const fragmentEntryFile = {
      name: 'fragment.html',
      path: 'fragment.html',
      mime: 'text/html',
      contents: '<main><h1>Hero</h1><script type="text/babel" src="app.jsx"></script></main>',
    };

    const doc = buildDesignRuntimeSrcdoc({
      entryFile: fragmentEntryFile,
      files: [
        fragmentEntryFile,
        {
          name: 'app.jsx',
          path: 'app.jsx',
          mime: 'text/javascript',
          contents: 'function App() { return <VDDesignCanvas />; }',
        },
      ],
      editBridge: false,
    });

    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<meta charset="utf-8" />');
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(doc).toContain('<body><main><h1>Hero</h1><script type="text/babel" data-vd-source="app.jsx">');
    expect(doc).toContain('function App()');
  });

  it('wraps fragments after annotating missing same-project local scripts', () => {
    const fragmentEntryFile = {
      name: 'fragment.html',
      path: 'fragment.html',
      mime: 'text/html',
      contents: '<main><script type="text/babel" src="missing.jsx"></script></main>',
    };

    const doc = buildDesignRuntimeSrcdoc({
      entryFile: fragmentEntryFile,
      files: [fragmentEntryFile],
      editBridge: false,
    });

    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<meta charset="utf-8" />');
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(doc).toContain('<body><main><script type="text/babel" src="missing.jsx" data-vd-missing-source="true">');
  });

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

  it('resolves nested entry path script sources relative to the entry file', () => {
    const nestedEntryFile = {
      name: 'index.html',
      path: 'pages/index.html',
      mime: 'text/html',
      contents: '<!doctype html><html><body><script type="text/babel" src="./app.jsx"></script></body></html>',
    };

    const doc = buildDesignRuntimeSrcdoc({
      entryFile: nestedEntryFile,
      files: [
        nestedEntryFile,
        {
          name: 'app.jsx',
          path: 'pages/app.jsx',
          mime: 'text/javascript',
          contents: 'function NestedApp() { return <main>Nested</main>; }',
        },
      ],
      editBridge: false,
    });

    expect(doc).toContain('type="text/babel" data-vd-source="pages/app.jsx"');
    expect(doc).toContain('function NestedApp()');
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
          <script src="custom:runtime-source"></script>
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
    expect(doc).toContain('src="custom:runtime-source"');
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

  it('inlines same-project scripts with empty contents', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        ...entryFile,
        contents: '<!doctype html><html><body><script type="text/babel" src="empty.jsx"></script></body></html>',
      },
      files: [
        entryFile,
        {
          name: 'empty.jsx',
          path: 'empty.jsx',
          mime: 'text/javascript',
          contents: '',
        },
      ],
      editBridge: false,
    });
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    const script = parsed.querySelector('script[data-vd-source="empty.jsx"]');

    expect(script).not.toBeNull();
    expect(script?.hasAttribute('src')).toBe(false);
    expect(script?.hasAttribute('data-vd-missing-source')).toBe(false);
    expect(script?.textContent).toBe('');
  });

  it('inlines same-project scripts with query strings and fragments', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        ...entryFile,
        contents:
          '<!doctype html><html><body><script type="text/babel" src="./app.jsx?v=1#module"></script></body></html>',
      },
      files,
      editBridge: false,
    });
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    const script = parsed.querySelector('script[data-vd-source="app.jsx"]');

    expect(script).not.toBeNull();
    expect(script?.hasAttribute('src')).toBe(false);
    expect(script?.hasAttribute('data-vd-missing-source')).toBe(false);
    expect(script?.textContent).toContain('function App()');
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

  it('passes comment bridge through to the runtime preview srcdoc', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile,
      files,
      editBridge: false,
      commentBridge: true,
    });

    expect(doc).toContain('data-vd-source="app.jsx"');
    expect(doc).toContain(CANVAS_COMMENT_BRIDGE_ATTR);
    expect(doc).toContain('vd-comment-mode');
    expect(doc).not.toContain('data-vd-edit-bridge');
  });

  it('passes snapshot bridge through to the runtime preview srcdoc', () => {
    const doc = buildDesignRuntimeSrcdoc({
      entryFile,
      files,
      editBridge: false,
      snapshotBridge: true,
    });

    expect(doc).toContain('data-vd-source="app.jsx"');
    expect(doc).toContain('data-vd-preview-snapshot-bridge');
    expect(doc).toContain('vd-preview-snapshot-result');
    expect(new DOMParser().parseFromString(doc, 'text/html').querySelector('[data-vd-edit-bridge]')).toBeNull();
  });

  it('injects the design runtime tweak bootstrap before inlined runtime source files', () => {
    const tweakFiles = [
      entryFile,
      {
        name: 'app.jsx',
        path: 'app.jsx',
        mime: 'text/javascript',
        contents: `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primaryColor": "#F26B3F"
}/*EDITMODE-END*/;
function App() { const [t] = useVDTweaks(TWEAK_DEFAULTS); return <main>{t.primaryColor}</main>; }`,
      },
    ];

    const doc = buildDesignRuntimeSrcdoc({
      entryFile: {
        ...entryFile,
        contents: '<!doctype html><html><body><script type="text/babel" src="app.jsx"></script></body></html>',
      },
      files: tweakFiles,
      editBridge: false,
    });

    expect(doc).toContain('data-vd-design-runtime-bridge');
    expect(doc).toContain('window.VibeDesignRuntime');
    expect(doc).toContain('vd-design-runtime-ready');
    expect(doc).toContain('"sourcePath":"app.jsx"');
    expect(doc.indexOf('data-vd-design-runtime-bridge')).toBeLessThan(doc.indexOf('data-vd-source="app.jsx"'));
  });
});
