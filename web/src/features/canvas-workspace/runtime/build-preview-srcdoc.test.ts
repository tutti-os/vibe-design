// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CANVAS_COMMENT_BRIDGE_ATTR } from '../canvas-comment/bridge';
import { buildPreviewSrcdoc } from './build-preview-srcdoc';

describe('buildPreviewSrcdoc', () => {
  it('wraps fragments in a full document shell', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', { editBridge: false });

    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<html>');
    expect(doc).toContain('<head>');
    expect(doc).toContain('<meta charset="utf-8" />');
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(doc).toContain('<body><main><h1 data-vd-id="hero">Hero</h1></main></body>');
  });

  it('preserves full documents and injects the edit bridge when enabled', () => {
    const fullDocument =
      '<!doctype html><html><head><title>Canvas</title></head><body><main data-vd-id="hero">Hero</main></body></html>';

    const doc = buildPreviewSrcdoc(fullDocument, { editBridge: true });

    expect(doc).toContain('<!doctype html><html><head><title>Canvas</title>');
    expect(doc).toContain('<body><main data-vd-id="hero">Hero</main>');
    expect(doc.match(/<!doctype html>/g)).toHaveLength(1);
    expect(doc.match(/<html>/g)).toHaveLength(1);
    expect(doc.indexOf('data-vd-edit-bridge-style')).toBeLessThan(doc.indexOf('</head>'));
    expect(doc.indexOf('<script data-vd-edit-bridge')).toBeGreaterThan(doc.indexOf('<body>'));
    expect(doc.indexOf('<script data-vd-edit-bridge')).toBeLessThan(doc.indexOf('</body>'));
  });

  it('injects bridge style before head close and bridge script before body close', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-source-path="path-0-0">Hero</h1></main>', {
      editBridge: true,
    });

    expect(doc).toContain('data-vd-edit-bridge-style');
    expect(doc).toContain('data-vd-edit-bridge');
    expect(doc.indexOf('data-vd-edit-bridge-style')).toBeLessThan(doc.indexOf('</head>'));
    expect(doc.indexOf('<script data-vd-edit-bridge')).toBeGreaterThan(doc.indexOf('<body>'));
    expect(doc.indexOf('<script data-vd-edit-bridge')).toBeLessThan(doc.indexOf('</body>'));
  });

  it('annotates unmarked editable elements in fragments before injecting the bridge', () => {
    const doc = buildPreviewSrcdoc('<main><h1>Hero</h1><p>Lead</p></main>', {
      editBridge: true,
    });
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    const heading = parsed.querySelector('h1');
    const paragraph = parsed.querySelector('p');
    const bridgeScript = parsed.querySelector('script[data-vd-edit-bridge]');

    expect(heading?.getAttribute('data-vd-source-path')).toBe('path-0-0');
    expect(paragraph?.getAttribute('data-vd-source-path')).toBe('path-0-1');
    expect(bridgeScript?.hasAttribute('data-vd-source-path')).toBe(false);
  });

  it('preserves explicit ids and existing source paths when annotating full documents', () => {
    const fullDocument =
      '<!doctype html><html><head><title>Canvas</title></head><body><main><h1 data-vd-id="headline">Hero</h1><p data-vd-source-path="authored-path">Lead</p><p>More</p></main></body></html>';

    const doc = buildPreviewSrcdoc(fullDocument, { editBridge: true });
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    const heading = parsed.querySelector('h1');
    const paragraphs = parsed.querySelectorAll('p');

    expect(heading?.getAttribute('data-vd-id')).toBe('headline');
    expect(heading?.hasAttribute('data-vd-source-path')).toBe(false);
    expect(paragraphs[0]?.getAttribute('data-vd-source-path')).toBe('authored-path');
    expect(paragraphs[1]?.getAttribute('data-vd-source-path')).toBe('path-0-2');
  });

  it('does not inject bridge script or style when edit bridge is disabled', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', { editBridge: false });

    expect(doc).not.toContain('data-vd-edit-bridge-style');
    expect(doc).not.toContain('data-vd-edit-bridge');
  });

  it('injects the preview size bridge before body close when requested', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', {
      editBridge: false,
      sizeBridge: true,
    });

    expect(doc).toContain('data-vd-preview-scrollbar');
    expect(doc).toContain('scrollbar-width: none');
    expect(doc).toContain('html::-webkit-scrollbar');
    expect(doc).toContain('window.scrollTo({ top: nextScroll');
    expect(doc).toContain('data-vd-preview-size-bridge');
    expect(doc).toContain('vd-preview-size');
    expect(doc).toContain('[data-vd-edit-overlay-layer]');
    expect(doc).toContain('[data-vd-edit-overlay]');
    expect(doc).toContain('[data-vd-comment-owned]');
    expect(doc.indexOf('<style data-vd-preview-scrollbar')).toBeLessThan(doc.indexOf('</head>'));
    expect(doc.indexOf('<script data-vd-preview-size-bridge')).toBeGreaterThan(doc.indexOf('<body>'));
    expect(doc.indexOf('<script data-vd-preview-size-bridge')).toBeLessThan(doc.indexOf('</body>'));
    expect(doc.indexOf('<script data-vd-preview-scrollbar')).toBeGreaterThan(
      doc.indexOf('<script data-vd-preview-size-bridge'),
    );
    expect(doc.indexOf('<script data-vd-preview-scrollbar')).toBeLessThan(doc.indexOf('</body>'));
  });

  it('does not inject the manual preview scrollbar when size measurements are disabled', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', {
      editBridge: false,
    });

    expect(doc).not.toContain('data-vd-preview-scrollbar');
  });

  it('injects the comment bridge without injecting the edit bridge when edit bridge is disabled', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', {
      editBridge: false,
      commentBridge: true,
    });

    expect(doc).toContain(CANVAS_COMMENT_BRIDGE_ATTR);
    expect(doc).toContain('vd-comment-mode');
    expect(doc).not.toContain('data-vd-edit-bridge-style');
    expect(doc).not.toContain('data-vd-edit-bridge');
    expect(doc).not.toContain('\\</body>');
    expect(doc.indexOf(`<script ${CANVAS_COMMENT_BRIDGE_ATTR}`)).toBeGreaterThan(doc.indexOf('<body>'));
    expect(doc.indexOf(`<script ${CANVAS_COMMENT_BRIDGE_ATTR}`)).toBeLessThan(doc.indexOf('</body>'));
  });

  it('supports comment bridge with size bridge and edit bridge combinations', () => {
    const sizeAndCommentDoc = buildPreviewSrcdoc('<main><h1>Hero</h1></main>', {
      editBridge: false,
      sizeBridge: true,
      commentBridge: true,
    });
    const allBridgesDoc = buildPreviewSrcdoc('<main><h1>Hero</h1></main>', {
      editBridge: true,
      sizeBridge: true,
      commentBridge: true,
    });

    expect(sizeAndCommentDoc).toContain('data-vd-preview-size-bridge');
    expect(sizeAndCommentDoc).toContain(CANVAS_COMMENT_BRIDGE_ATTR);
    expect(new DOMParser().parseFromString(sizeAndCommentDoc, 'text/html').querySelector('[data-vd-edit-bridge]')).toBeNull();
    expect(
      new DOMParser().parseFromString(sizeAndCommentDoc, 'text/html').querySelector('[data-vd-edit-bridge-style]'),
    ).toBeNull();
    expect(allBridgesDoc).toContain('data-vd-preview-size-bridge');
    expect(allBridgesDoc).toContain(CANVAS_COMMENT_BRIDGE_ATTR);
    expect(allBridgesDoc).toContain('data-vd-edit-bridge');
  });

  it('injects the snapshot bridge when requested', () => {
    const doc = buildPreviewSrcdoc('<main><h1 data-vd-id="hero">Hero</h1></main>', {
      editBridge: false,
      snapshotBridge: true,
    });

    expect(doc).toContain('data-vd-preview-snapshot-bridge');
    expect(doc).toContain('vd-preview-snapshot');
    expect(doc).toContain('vd-preview-snapshot-result');
    expect(doc).toContain('foreignObject');
    expect(doc).toContain('data:image/svg+xml');
    expect(doc.indexOf('<script data-vd-preview-snapshot-bridge')).toBeGreaterThan(doc.indexOf('<body>'));
    expect(doc.indexOf('<script data-vd-preview-snapshot-bridge')).toBeLessThan(doc.indexOf('</body>'));
  });

  it('blocks every iframe anchor click without posting host navigation requests', () => {
    const postMessage = vi.fn();
    const preview = buildExecutableNavigationBridgeDocument(
      [
        '<a id="relative-link" href="about.html">Relative</a>',
        '<a id="external-link" href="https://example.com">External</a>',
        '<a id="hash-link" href="#details">Hash</a>',
        '<a id="target-link" href="about.html" target="_blank">Target</a>',
        '<a id="download-link" href="asset.pdf" download>Download</a>',
      ].join(''),
      postMessage,
    );

    [
      'relative-link',
      'external-link',
      'hash-link',
      'target-link',
      'download-link',
    ].forEach((id) => {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      preview.document.getElementById(id)?.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    expect(postMessage).not.toHaveBeenCalled();
    preview.cleanup();
  });

  it('injects bridges in size, scrollbar, comment, snapshot, edit order', () => {
    const doc = buildPreviewSrcdoc('<main><h1>Hero</h1></main>', {
      editBridge: true,
      sizeBridge: true,
      commentBridge: true,
      snapshotBridge: true,
    });

    expect(doc.indexOf('<script data-vd-preview-size-bridge')).toBeLessThan(
      doc.indexOf('<script data-vd-preview-scrollbar'),
    );
    expect(doc.indexOf('<script data-vd-preview-scrollbar')).toBeLessThan(
      doc.indexOf(`<script ${CANVAS_COMMENT_BRIDGE_ATTR}`),
    );
    expect(doc.indexOf(`<script ${CANVAS_COMMENT_BRIDGE_ATTR}`)).toBeLessThan(
      doc.indexOf('<script data-vd-preview-snapshot-bridge'),
    );
    expect(doc.indexOf('<script data-vd-preview-snapshot-bridge')).toBeLessThan(
      doc.indexOf('<script data-vd-edit-bridge'),
    );
  });

  it('posts an encoded SVG snapshot result from the injected snapshot bridge', () => {
    const postMessage = vi.fn();
    const preview = buildExecutableSnapshotBridgeDocument(
      '<main data-vd-id="hero">Hero</main><script data-vd-preview-size-bridge>window.__bad = true;</script><div data-vd-preview-scrollbar="track"><div data-vd-preview-scrollbar="thumb"></div></div><div data-vd-comment-owned="overlay">Overlay</div>',
      postMessage,
    );

    preview.window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'vd-preview-snapshot', id: 'snapshot-1' },
      }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vd-preview-snapshot-result',
        id: 'snapshot-1',
        width: expect.any(Number),
        height: expect.any(Number),
        dataUrl: expect.stringMatching(/^data:image\/svg\+xml;charset=utf-8,/),
      }),
      '*',
    );

    const [message] = postMessage.mock.calls[0] ?? [];
    const encodedSvg = String(message.dataUrl).replace('data:image/svg+xml;charset=utf-8,', '');
    const svg = decodeURIComponent(encodedSvg);

    expect(message.width).toBeGreaterThan(0);
    expect(message.height).toBeGreaterThan(0);
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('data-vd-id="hero"');
    expect(svg).not.toContain('data-vd-preview-size-bridge');
    expect(svg).not.toContain('data-vd-preview-scrollbar');
    expect(svg).not.toContain('data-vd-preview-snapshot-bridge');
    expect(svg).not.toContain('data-vd-comment-owned');
    preview.cleanup();
  });

  it('captures the target document at its original scroll size instead of the visible viewport', () => {
    const postMessage = vi.fn();
    const preview = buildExecutableSnapshotBridgeDocument(
      '<main data-vd-id="hero" style="width:1600px;height:1400px">Hero</main>',
      postMessage,
    );

    Object.defineProperty(preview.window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(preview.window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(preview.window, 'scrollX', { configurable: true, value: 120 });
    Object.defineProperty(preview.window, 'scrollY', { configurable: true, value: 240 });
    Object.defineProperty(preview.document.documentElement, 'scrollWidth', { configurable: true, value: 1600 });
    Object.defineProperty(preview.document.documentElement, 'scrollHeight', { configurable: true, value: 1400 });

    preview.window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'vd-preview-snapshot', id: 'snapshot-full-size' },
      }),
    );

    const [message] = postMessage.mock.calls[0] ?? [];
    const encodedSvg = String(message.dataUrl).replace('data:image/svg+xml;charset=utf-8,', '');
    const svg = decodeURIComponent(encodedSvg);

    expect(message).toMatchObject({
      type: 'vd-preview-snapshot-result',
      id: 'snapshot-full-size',
      width: 1600,
      height: 1400,
    });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1400" viewBox="0 0 1600 1400">');
    expect(svg).toContain('style="width:1600px;height:1400px;overflow:hidden;background:white;"');
    expect(svg).toContain('transform:translate(0px,0px)');
    preview.cleanup();
  });

  it('posts a stable snapshot error result when serialization fails', () => {
    const postMessage = vi.fn();
    const preview = buildExecutableSnapshotBridgeDocument('<main data-vd-id="hero">Hero</main>', postMessage);

    class ThrowingXmlSerializer {
      serializeToString() {
        throw new Error('serialize failed');
      }
    }
    Object.defineProperty(preview.window, 'XMLSerializer', { configurable: true, value: ThrowingXmlSerializer });

    preview.window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'vd-preview-snapshot', id: 'snapshot-failure' },
      }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'vd-preview-snapshot-result',
        id: 'snapshot-failure',
        error: 'serialize failed',
        dataUrl: null,
        width: 0,
        height: 0,
      },
      '*',
    );
    preview.cleanup();
  });
});

function buildExecutableSnapshotBridgeDocument(html: string, postMessage: ReturnType<typeof vi.fn>) {
  const doc = buildPreviewSrcdoc(html, { editBridge: false, snapshotBridge: true });
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;

  if (!frameWindow || !frameDocument) {
    throw new Error('Expected jsdom to create an iframe window and document');
  }

  frameDocument.open();
  frameDocument.write(doc);
  frameDocument.close();

  const script = frameDocument.querySelector<HTMLScriptElement>('script[data-vd-preview-snapshot-bridge]');

  if (!script?.textContent) {
    throw new Error('Expected snapshot bridge script to be injected');
  }

  Object.defineProperty(frameWindow, 'parent', {
    configurable: true,
    value: { postMessage },
  });
  (frameWindow as unknown as { eval: (source: string) => unknown }).eval(script.textContent);

  return {
    window: frameWindow,
    document: frameDocument,
    cleanup: () => frame.remove(),
  };
}

function buildExecutableNavigationBridgeDocument(html: string, postMessage: ReturnType<typeof vi.fn>) {
  const doc = buildPreviewSrcdoc(html, { editBridge: false, navigationBasePath: 'index.html' });
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;

  if (!frameWindow || !frameDocument) {
    throw new Error('Expected jsdom to create an iframe window and document');
  }

  frameDocument.open();
  frameDocument.write(doc);
  frameDocument.close();

  const script = frameDocument.querySelector<HTMLScriptElement>('script[data-vd-preview-navigation-bridge]');

  if (!script?.textContent) {
    throw new Error('Expected navigation bridge script to be injected');
  }

  Object.defineProperty(frameWindow, 'parent', {
    configurable: true,
    value: { postMessage },
  });
  (frameWindow as unknown as { eval: (source: string) => unknown }).eval(script.textContent);

  return {
    window: frameWindow,
    document: frameDocument,
    cleanup: () => frame.remove(),
  };
}
