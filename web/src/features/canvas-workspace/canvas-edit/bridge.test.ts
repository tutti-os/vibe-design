// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_EDIT_HOST_NODE_SELECTOR,
  buildCanvasEditBridge,
  canvasEditDomPathForElement,
  canvasEditStableIdForElement,
  isCanvasEditHostNode,
} from './bridge';

describe('canvas edit bridge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses an explicit data-vd-id as the stable element id', () => {
    document.body.innerHTML = '<main><button data-vd-id="hero-cta">Start</button></main>';
    const element = document.querySelector('button');

    expect(element).not.toBeNull();
    expect(canvasEditStableIdForElement(element as Element)).toBe('hero-cta');
  });

  it('uses data-vd-source-path as the stable id when an explicit id is absent', () => {
    document.body.innerHTML = '<main><button data-vd-source-path="src/page.html#cta">Start</button></main>';
    const element = document.querySelector('button');

    expect(element).not.toBeNull();
    expect(canvasEditStableIdForElement(element as Element)).toBe('src/page.html#cta');
  });

  it('builds DOM paths without counting host nodes', () => {
    document.body.innerHTML = `<main>
        <section>
          <script data-vd-edit-bridge></script>
          <style data-vd-edit-bridge-style></style>
          <p>Copy</p>
        </section>
      </main>`;
    const paragraph = document.querySelector('section > p');

    expect(paragraph).not.toBeNull();
    expect(canvasEditDomPathForElement(paragraph as Element)).toBe('html>body>main:nth-of-type(1)>section:nth-of-type(1)>p:nth-of-type(1)');
  });

  it('returns a complete marked script snippet', () => {
    const bridge = buildCanvasEditBridge(true);

    expect(bridge).toMatch(/^<script data-vd-edit-bridge>/);
    expect(bridge).toMatch(/<\/script>$/);
  });

  it('emits design-contract edit targets when edit mode is enabled', () => {
    document.body.innerHTML =
      '<main><script data-vd-edit-bridge data-vd-id="bridge-script"></script><style data-vd-edit-bridge-style data-vd-id="bridge-style"></style><h1 data-vd-id="headline" data-vd-source-path="src/page.html" class="hero-title">Hello</h1></main>';
    const heading = document.querySelector('h1');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(heading).not.toBeNull();
    heading!.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 24,
        width: 120,
        height: 32,
        left: 12,
        top: 24,
        right: 132,
        bottom: 56,
        toJSON: () => ({}),
      }) as DOMRect;

    window.eval(scriptContent(buildCanvasEditBridge(false)));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-edit-mode', enabled: true } }));

    expect(messagesOfType(received, 'vd-edit-targets')).toContainEqual({
      type: 'vd-edit-targets',
      targets: expect.arrayContaining([
        expect.objectContaining({
            id: 'headline',
            kind: 'text',
            label: 'Hello',
            tagName: 'h1',
            className: 'hero-title',
            text: 'Hello',
            rect: { x: 12, y: 24, width: 120, height: 32 },
            fields: { text: 'Hello' },
            attributes: {
              class: 'hero-title',
              'data-vd-id': 'headline',
              'data-vd-source-path': 'src/page.html',
            },
            styles: {},
            isLayoutContainer: false,
            outerHtml: '<h1 data-vd-id="headline" data-vd-source-path="src/page.html" class="hero-title">Hello</h1>',
        }),
      ]),
    });
  });

  it('emits full DOM edit targets with outliner metadata', () => {
    document.body.innerHTML =
      '<main id="app" class="shell"><script data-vd-edit-bridge data-vd-id="bridge-script"></script><style data-vd-edit-bridge-style data-vd-id="bridge-style"></style><section data-vd-id="hero" class="hero panel"><h1 class="hero-title">Hello</h1></section></main>';
    const main = document.querySelector('main');
    const section = document.querySelector('section');
    const heading = document.querySelector('h1');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(main).not.toBeNull();
    expect(section).not.toBeNull();
    expect(heading).not.toBeNull();
    main!.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        left: 0,
        top: 0,
        right: 320,
        bottom: 200,
        toJSON: () => ({}),
      }) as DOMRect;
    section!.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 24,
        width: 120,
        height: 80,
        left: 12,
        top: 24,
        right: 132,
        bottom: 104,
        toJSON: () => ({}),
      }) as DOMRect;
    heading!.getBoundingClientRect = () =>
      ({
        x: 16,
        y: 32,
        width: 90,
        height: 24,
        left: 16,
        top: 32,
        right: 106,
        bottom: 56,
        toJSON: () => ({}),
      }) as DOMRect;

    window.eval(scriptContent(buildCanvasEditBridge(true)));

    const targetMessage = messagesOfType(received, 'vd-edit-targets').at(-1);

    expect(targetMessage).toEqual({
      type: 'vd-edit-targets',
      targets: [
        expect.objectContaining({
          id: 'app',
          tagName: 'main',
          depth: 0,
          classList: ['shell'],
          selector: 'main#app.shell',
          editable: true,
          childCount: 1,
        }),
        expect.objectContaining({
          id: 'hero',
          tagName: 'section',
          parentId: 'app',
          depth: 1,
          classList: ['hero', 'panel'],
          selector: 'section.hero.panel',
          editable: true,
          parentDisplay: 'block',
          childCount: 1,
        }),
        expect.objectContaining({
          id: 'html>body>main:nth-of-type(1)>section:nth-of-type(1)>h1:nth-of-type(1)',
          tagName: 'h1',
          parentId: 'hero',
          depth: 2,
          classList: ['hero-title'],
          selector: 'h1.hero-title',
          editable: true,
          parentDisplay: 'block',
          childCount: 0,
        }),
      ],
    });
  });

  it('emits a full design-contract hover target for source-mappable targets', () => {
    document.body.innerHTML =
      '<main><button data-vd-id="hero-cta" data-vd-source-path="src/page.html" class="primary">Start</button></main>';
    const button = document.querySelector('button');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(button).not.toBeNull();
    button!.getBoundingClientRect = () =>
      ({
        x: 4,
        y: 8,
        width: 64,
        height: 24,
        left: 4,
        top: 8,
        right: 68,
        bottom: 32,
        toJSON: () => ({}),
      }) as DOMRect;

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    button!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    expect(messagesOfType(received, 'vd-edit-hover')).toContainEqual({
      type: 'vd-edit-hover',
      target: expect.objectContaining({
        id: 'hero-cta',
        kind: 'text',
        label: 'Start',
        tagName: 'button',
        className: 'primary',
        text: 'Start',
        rect: { x: 4, y: 8, width: 64, height: 24 },
        fields: { text: 'Start' },
        attributes: {
          class: 'primary',
          'data-vd-id': 'hero-cta',
          'data-vd-source-path': 'src/page.html',
        },
        styles: {},
        isLayoutContainer: false,
        outerHtml: '<button data-vd-id="hero-cta" data-vd-source-path="src/page.html" class="primary">Start</button>',
      }),
    });
  });

  it('omits runtime editing attributes from target attributes and outer html', () => {
    document.body.innerHTML =
      '<main><h1 data-vd-id="headline" data-vd-runtime-id="html>body>h1:nth-of-type(1)" data-vd-edit-selected="true" data-vd-edit-hovered="true" contenteditable="true" class="hero-title">Hello</h1></main>';
    const heading = document.querySelector('h1');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(heading).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    heading!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    expect(messagesOfType(received, 'vd-edit-hover')).toContainEqual({
      type: 'vd-edit-hover',
      target: expect.objectContaining({
        attributes: {
          class: 'hero-title',
          'data-vd-id': 'headline',
        },
        outerHtml: '<h1 data-vd-id="headline" class="hero-title">Hello</h1>',
      }),
    });
  });

  it('emits stable computed style fields for targets', () => {
    document.body.innerHTML = '<main><p data-vd-source-path="src/page.html#lead" style="opacity: 0.5">Lead</p></main>';
    const paragraph = document.querySelector('p');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(paragraph).not.toBeNull();
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if ((element as Element).getAttribute('data-vd-source-path') === 'src/page.html#lead') {
        return {
          backgroundColor: 'rgb(245, 245, 245)',
          color: 'rgb(12, 34, 56)',
          display: 'block',
          fontFamily: 'Georgia',
          fontSize: '18px',
          fontWeight: '700',
          getPropertyValue: (name: string) =>
            ({
              'background-color': 'rgb(245, 245, 245)',
              color: 'rgb(12, 34, 56)',
              'font-family': 'Georgia',
              'font-size': '18px',
              'font-weight': '700',
              'line-height': '24px',
              'border-radius': '12px',
              opacity: '0.5',
              padding: '16px',
              'text-align': 'center',
            })[name] ?? '',
          borderRadius: '12px',
          lineHeight: '24px',
          opacity: '0.5',
          padding: '16px',
          textAlign: 'center',
          visibility: 'visible',
        } as unknown as CSSStyleDeclaration;
      }

      return {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        color: 'canvastext',
        display: 'block',
        fontFamily: '',
        fontSize: '',
        fontWeight: '',
        getPropertyValue: () => '',
        lineHeight: '',
        opacity: '',
        textAlign: '',
        visibility: 'visible',
      } as unknown as CSSStyleDeclaration;
    });

    window.eval(scriptContent(buildCanvasEditBridge(true)));

    expect(messagesOfType(received, 'vd-edit-targets')).toContainEqual({
      type: 'vd-edit-targets',
      targets: expect.arrayContaining([
        expect.objectContaining({
          styles: {
            backgroundColor: 'rgb(245, 245, 245)',
            color: 'rgb(12, 34, 56)',
            fontFamily: 'Georgia',
            fontSize: '18px',
            fontWeight: '700',
            lineHeight: '24px',
            opacity: '0.5',
            padding: '16px',
            borderRadius: '12px',
            textAlign: 'center',
          },
        }),
      ]),
    });
  });

  it('selects text targets on click and starts inline text editing on double click', () => {
    document.body.innerHTML = '<main><h1 data-vd-id="headline" data-vd-source-path="src/page.html">Old title</h1></main>';
    const heading = document.querySelector('h1');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(heading).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const wasNotCanceled = heading!.dispatchEvent(clickEvent);

    expect(wasNotCanceled).toBe(false);
    expect(heading!.hasAttribute('contenteditable')).toBe(false);
    expect(messagesOfType(received, 'vd-edit-select')).toContainEqual({
      type: 'vd-edit-select',
      target: expect.objectContaining({
        id: 'headline',
        kind: 'text',
        tagName: 'h1',
      }),
    });

    const dblClickEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    const wasDoubleClickNotCanceled = heading!.dispatchEvent(dblClickEvent);

    expect(wasDoubleClickNotCanceled).toBe(false);
    expect(heading!.getAttribute('contenteditable')).toBe('true');

    heading!.textContent = 'New title';
    heading!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(messagesOfType(received, 'vd-edit-text-commit')).toContainEqual({
      type: 'vd-edit-text-commit',
      id: 'headline',
      value: 'New title',
    });
  });

  it('selects link targets on click and starts inline text editing on double click', () => {
    document.body.innerHTML = '<main><a data-vd-id="learn-link" href="/learn">Old link</a></main>';
    const link = document.querySelector('a');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(link).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    const wasNotCanceled = link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(wasNotCanceled).toBe(false);
    expect(link!.hasAttribute('contenteditable')).toBe(false);
    expect(messagesOfType(received, 'vd-edit-select')).toContainEqual({
      type: 'vd-edit-select',
      target: expect.objectContaining({
        id: 'learn-link',
        kind: 'link',
        tagName: 'a',
      }),
    });

    const wasDoubleClickNotCanceled = link!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    expect(wasDoubleClickNotCanceled).toBe(false);
    expect(link!.getAttribute('contenteditable')).toBe('true');

    link!.textContent = 'New link';
    link!.dispatchEvent(new FocusEvent('blur'));

    expect(messagesOfType(received, 'vd-edit-text-commit')).toContainEqual({
      type: 'vd-edit-text-commit',
      id: 'learn-link',
      value: 'New link',
    });
  });

  it('emits a full design-contract select target for container targets on click', () => {
    document.body.innerHTML =
      '<main><section data-vd-id="hero-section" data-vd-source-path="src/page.html#hero" class="hero">Hero</section></main>';
    const section = document.querySelector('section');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    section!.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 12,
        width: 80,
        height: 20,
        left: 10,
        top: 12,
        right: 90,
        bottom: 32,
        toJSON: () => ({}),
      }) as DOMRect;

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const wasNotCanceled = section!.dispatchEvent(clickEvent);

    expect(wasNotCanceled).toBe(false);
    expect(messagesOfType(received, 'vd-edit-select')).toContainEqual({
      type: 'vd-edit-select',
      target: expect.objectContaining({
        id: 'hero-section',
        kind: 'container',
        tagName: 'section',
        className: 'hero',
        rect: { x: 10, y: 12, width: 80, height: 20 },
      }),
    });
  });

  it('blocks native iframe pointer handlers in inspect mode while preserving bridge click selection', () => {
    document.body.innerHTML =
      '<main><section data-vd-id="hero-section" data-vd-source-path="src/page.html#hero" class="hero">Hero</section></main>';
    const section = document.querySelector('section');
    const nativePointerDown = vi.fn();
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    section!.addEventListener('pointerdown', nativePointerDown);

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    section!.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const wasNotCanceled = section!.dispatchEvent(clickEvent);

    expect(nativePointerDown).not.toHaveBeenCalled();
    expect(wasNotCanceled).toBe(false);
    expect(messagesOfType(received, 'vd-edit-select')).toContainEqual({
      type: 'vd-edit-select',
      target: expect.objectContaining({
        id: 'hero-section',
        kind: 'container',
      }),
    });
  });

  it('prevents later document capture click handlers from seeing inspect clicks', () => {
    document.body.innerHTML =
      '<main><section data-vd-id="hero-section" data-vd-source-path="src/page.html#hero" class="hero">Hero</section></main>';
    const section = document.querySelector('section');
    const nativeDocumentClick = vi.fn();
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    document.addEventListener('click', nativeDocumentClick, true);
    section!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(nativeDocumentClick).not.toHaveBeenCalled();
    expect(messagesOfType(received, 'vd-edit-select')).toContainEqual({
      type: 'vd-edit-select',
      target: expect.objectContaining({
        id: 'hero-section',
      }),
    });
  });

  it('emits inspect hover while blocking native iframe hover handlers', () => {
    document.body.innerHTML =
      '<main><section data-vd-id="hero-section" data-vd-source-path="src/page.html#hero" class="hero">Hero</section></main>';
    const section = document.querySelector('section');
    const nativeMouseMove = vi.fn();
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    section!.addEventListener('mousemove', nativeMouseMove);

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    section!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));

    expect(nativeMouseMove).not.toHaveBeenCalled();
    expect(messagesOfType(received, 'vd-edit-hover')).toContainEqual({
      type: 'vd-edit-hover',
      target: expect.objectContaining({
        id: 'hero-section',
      }),
    });
  });

  it('emits source-path-only targets and text commits using the source path as the id', () => {
    document.body.innerHTML = '<main><p data-vd-source-path="src/page.html#lead">Old copy</p></main>';
    const paragraph = document.querySelector('p');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(paragraph).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    paragraph!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    paragraph!.textContent = 'New copy';
    paragraph!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(messagesOfType(received, 'vd-edit-targets')).toContainEqual({
      type: 'vd-edit-targets',
      targets: expect.arrayContaining([
        expect.objectContaining({
          id: 'src/page.html#lead',
          attributes: expect.objectContaining({
            'data-vd-source-path': 'src/page.html#lead',
          }),
        }),
      ]),
    });
    expect(messagesOfType(received, 'vd-edit-text-commit')).toContainEqual({
      type: 'vd-edit-text-commit',
      id: 'src/page.html#lead',
      value: 'New copy',
    });
  });

  it('includes hidden display-none source targets as hidden layout containers', () => {
    document.body.innerHTML = '<main><section data-vd-source-path="src/page.html#panel" style="display: none">Panel</section></main>';
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    window.eval(scriptContent(buildCanvasEditBridge(true)));

    expect(messagesOfType(received, 'vd-edit-targets')).toContainEqual({
      type: 'vd-edit-targets',
      targets: expect.arrayContaining([
        expect.objectContaining({
          id: 'src/page.html#panel',
          isHidden: true,
          isLayoutContainer: true,
        }),
      ]),
    });
  });

  it('marks visibility-hidden block containers hidden without treating them as layout containers', () => {
    document.body.innerHTML =
      '<main><section data-vd-source-path="src/page.html#panel" style="visibility: hidden; display: block">Panel</section></main>';
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    window.eval(scriptContent(buildCanvasEditBridge(true)));

    expect(messagesOfType(received, 'vd-edit-targets')).toContainEqual({
      type: 'vd-edit-targets',
      targets: expect.arrayContaining([
        expect.objectContaining({
          id: 'src/page.html#panel',
          isHidden: true,
          isLayoutContainer: false,
        }),
      ]),
    });
  });

  it('renders selected and hovered target overlays without mutating target attributes', () => {
    document.body.innerHTML =
      '<main><h1 data-vd-id="headline">Title</h1><p data-vd-source-path="src/page.html#lead">Copy</p></main>';
    const heading = document.querySelector('h1');
    const paragraph = document.querySelector('p');

    expect(heading).not.toBeNull();
    expect(paragraph).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-edit-selected-target', id: 'headline' } }));

    expect(heading!.hasAttribute('data-vd-edit-selected')).toBe(false);
    expect(paragraph!.hasAttribute('data-vd-edit-selected')).toBe(false);
    expect(document.querySelector('[data-vd-edit-overlay="selected"]')).not.toBeNull();

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'vd-edit-hovered-target', id: 'src/page.html#lead' } }),
    );

    expect(heading!.hasAttribute('data-vd-edit-selected')).toBe(false);
    expect(paragraph!.hasAttribute('data-vd-edit-hovered')).toBe(false);
    expect(document.querySelector('[data-vd-edit-overlay="hovered"]')).not.toBeNull();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-edit-selected-target', id: null } }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-edit-hovered-target', id: null } }));

    expect(heading!.hasAttribute('data-vd-edit-selected')).toBe(false);
    expect(paragraph!.hasAttribute('data-vd-edit-selected')).toBe(false);
    expect(document.querySelector('[data-vd-edit-overlay="selected"]')).toBeNull();
    expect(document.querySelector('[data-vd-edit-overlay="hovered"]')).toBeNull();
  });

  it('applies preview styles from host messages and emits an ack', () => {
    document.body.innerHTML = '<main><h1 data-vd-id="preview-headline" style="color: blue">Title</h1></main>';
    const heading = document.querySelector('h1');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(heading).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'vd-edit-preview-style', id: 'preview-headline', styles: { color: 'red', 'font-size': '24px' } },
      }),
    );

    expect(heading!.style.color).toBe('red');
    expect(heading!.style.fontSize).toBe('24px');
    expect(messagesOfType(received, 'vd-edit-preview-style-applied')).toContainEqual({
      type: 'vd-edit-preview-style-applied',
      id: 'preview-headline',
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'vd-edit-preview-style', id: 'preview-headline', styles: { color: '' } },
      }),
    );

    expect(heading!.style.color).toBe('');

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'vd-edit-preview-style-reset', id: 'preview-headline' } }),
    );

    expect(messagesOfType(received, 'vd-edit-preview-style-applied')).toContainEqual({
      type: 'vd-edit-preview-style-applied',
      id: 'preview-headline',
    });
  });

  it('applies and resets preview text from host messages', () => {
    document.body.innerHTML = '<main><p data-vd-id="preview-copy">Original copy</p></main>';
    const paragraph = document.querySelector('p');

    expect(paragraph).not.toBeNull();

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'vd-edit-preview-text', id: 'preview-copy', value: 'Draft copy' },
      }),
    );

    expect(paragraph!.textContent).toBe('Draft copy');

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'vd-edit-preview-text-reset', id: 'preview-copy' } }),
    );

    expect(paragraph!.textContent).toBe('Original copy');
  });

  it('applies theme preview commands to the document root without emitting edits', () => {
    document.body.innerHTML = '<main><h1 data-vd-id="headline">Title</h1></main>';
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    window.eval(scriptContent(buildCanvasEditBridge(true)));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-edit-theme', theme: 'dark' } }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(messagesOfType(received, 'vd-edit-text-commit')).toEqual([]);

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-edit-theme', theme: 'light' } }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('writes a runtime id when stable id falls back to a DOM path', () => {
    document.body.innerHTML = '<main><p>Copy</p></main>';
    const paragraph = document.querySelector('p');

    expect(paragraph).not.toBeNull();

    const id = canvasEditStableIdForElement(paragraph as Element);

    expect(id).toBe('html>body>main:nth-of-type(1)>p:nth-of-type(1)');
    expect(paragraph!.getAttribute('data-vd-runtime-id')).toBe(id);
    expect(canvasEditStableIdForElement(paragraph as Element)).toBe(id);
  });

  it('detects canvas edit host nodes', () => {
    document.body.innerHTML =
      '<script data-vd-edit-bridge></script><style data-vd-edit-bridge-style></style><div data-vd-preview-scrollbar="track"></div><div data-vd-edit-overlay-layer="true"><div data-vd-edit-overlay="selected"></div></div><p></p>';
    const script = document.querySelector('script');
    const style = document.querySelector('style');
    const scrollbar = document.querySelector('[data-vd-preview-scrollbar]');
    const overlayLayer = document.querySelector('[data-vd-edit-overlay-layer]');
    const overlay = document.querySelector('[data-vd-edit-overlay]');
    const paragraph = document.querySelector('p');

    expect(script).not.toBeNull();
    expect(style).not.toBeNull();
    expect(scrollbar).not.toBeNull();
    expect(overlayLayer).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(paragraph).not.toBeNull();
    expect(CANVAS_EDIT_HOST_NODE_SELECTOR).toBe(
      '[data-vd-edit-bridge],[data-vd-edit-bridge-style],[data-vd-preview-scrollbar],[data-vd-edit-overlay-layer],[data-vd-edit-overlay]',
    );
    expect(isCanvasEditHostNode(script as Element)).toBe(true);
    expect(isCanvasEditHostNode(style as Element)).toBe(true);
    expect(isCanvasEditHostNode(scrollbar as Element)).toBe(true);
    expect(isCanvasEditHostNode(overlayLayer as Element)).toBe(true);
    expect(isCanvasEditHostNode(overlay as Element)).toBe(true);
    expect(isCanvasEditHostNode(paragraph as Element)).toBe(false);
  });
});

function scriptContent(scriptSnippet: string): string {
  const template = document.createElement('template');
  template.innerHTML = scriptSnippet;
  const script = template.content.querySelector('script[data-vd-edit-bridge]');

  expect(script).not.toBeNull();
  return script!.textContent ?? '';
}

function messagesOfType(messages: unknown[], type: string): unknown[] {
  return messages.filter((message) => {
    return typeof message === 'object' && message !== null && 'type' in message && message.type === type;
  });
}
