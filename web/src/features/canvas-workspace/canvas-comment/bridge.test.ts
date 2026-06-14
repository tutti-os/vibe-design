// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCanvasCommentBridge, CANVAS_COMMENT_BRIDGE_ATTR } from './bridge';

describe('canvas comment bridge', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalMutationObserver = window.MutationObserver;

  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      writable: true,
      value: originalMutationObserver,
    });
  });

  afterEach(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'vd-comment-mode', enabled: false, mode: 'picker' } }),
    );
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    Object.defineProperty(window, 'pageXOffset', { configurable: true, value: 0 });
    Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      writable: true,
      value: originalMutationObserver,
    });
  });

  it('returns a marked script snippet with the comment protocol handlers', () => {
    const bridge = buildCanvasCommentBridge(true);

    expect(bridge).toMatch(new RegExp(`^<script ${CANVAS_COMMENT_BRIDGE_ATTR}>`));
    expect(bridge).toMatch(/<\/script>$/);
    expect(bridge).toContain('vd-comment-mode');
    expect(bridge).toContain('vd-comment-select');
    expect(bridge).toContain('vd-comment-pod-select');
    expect(bridge).toContain('vd-comment-active-target-update');
  });

  it('uses fallback runtime identity for normal DOM target discovery', () => {
    const bridge = buildCanvasCommentBridge(true);

    expect(bridge).toContain('data-vd-runtime-id');
    expect(bridge).toContain('document.createTreeWalker');
  });

  it('emits target snapshots without file paths when picker mode is enabled', () => {
    document.body.innerHTML = '<main><button id="primary" class="cta">Start now</button></main>';
    const button = document.querySelector('button');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(button).not.toBeNull();
    mockRect(button as Element, { x: 8, y: 12, width: 96, height: 28 });

    runBridge(buildCanvasCommentBridge(false));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'vd-comment-mode', enabled: true, mode: 'picker' } }),
    );

    const targetsMessage = messagesOfType(received, 'vd-comment-targets').at(-1) as { targets?: unknown[] } | undefined;
    const buttonTarget = targetsMessage?.targets?.find(
      (target): target is Record<string, unknown> =>
        typeof target === 'object'
        && target !== null
        && 'targetId' in target
        && target.targetId === 'primary',
    );

    expect(buttonTarget).toEqual(
      expect.objectContaining({
        targetId: 'primary',
        selector: 'button#primary.cta',
        label: 'Start now',
        text: 'Start now',
        position: { x: 8, y: 12, width: 96, height: 28 },
        htmlHint: '<button id="primary" class="cta">Start now</button>',
        style: expect.any(Object),
      }),
    );
    expect(buttonTarget).not.toHaveProperty('filePath');
  });

  it('selects an unannotated element with a runtime id and blocks native picker clicks', () => {
    document.body.innerHTML = '<main><section><p>Plain copy</p></section></main>';
    const paragraph = document.querySelector('p');
    const nativeClick = vi.fn();
    const documentClick = vi.fn();
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(paragraph).not.toBeNull();
    mockRect(paragraph as Element, { x: 4, y: 6, width: 120, height: 20 });
    paragraph!.addEventListener('click', nativeClick);

    runBridge(buildCanvasCommentBridge(true));
    document.addEventListener('click', documentClick, true);
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 14, clientY: 18 });
    const wasNotCanceled = paragraph!.dispatchEvent(clickEvent);

    const runtimeId = paragraph!.getAttribute('data-vd-runtime-id');
    expect(wasNotCanceled).toBe(false);
    expect(nativeClick).not.toHaveBeenCalled();
    expect(documentClick).not.toHaveBeenCalled();
    expect(runtimeId).toBe('html>body>main:nth-of-type(1)>section:nth-of-type(1)>p:nth-of-type(1)');
    expect(messagesOfType(received, 'vd-comment-select')).toContainEqual({
      type: 'vd-comment-select',
      target: expect.objectContaining({
        targetId: runtimeId,
        selector: 'p',
        hoverPoint: { x: 14, y: 18 },
      }),
    });
  });

  it('uses picker clicks for elements and picker drags for box selection', () => {
    document.body.innerHTML = '<main><section data-vd-id="card"><h1>Hero</h1><p>Copy</p></section></main>';
    const section = document.querySelector('section');
    const heading = document.querySelector('h1');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    expect(heading).not.toBeNull();
    mockRect(section as Element, { x: 0, y: 0, width: 220, height: 140 });
    mockRect(heading as Element, { x: 10, y: 12, width: 120, height: 32 });

    runBridge(buildCanvasCommentBridge(true));
    heading!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 14 }));
    expect(messagesOfType(received, 'vd-comment-select')).toHaveLength(1);

    received.length = 0;
    section!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 12 }));
    section!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 70, clientY: 80 }));
    const box = document.querySelector('[data-vd-comment-pod-layer] rect');
    expect(box?.getAttribute('x')).toBe('10');
    expect(box?.getAttribute('y')).toBe('12');
    expect(box?.getAttribute('width')).toBe('60');
    expect(box?.getAttribute('height')).toBe('68');
    expect(document.querySelector('[data-vd-comment-pod-layer] polyline')).toBeNull();
    section!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 120, clientY: 132 }));

    expect(messagesOfType(received, 'vd-comment-pod-stroke').length).toBeGreaterThan(0);
    expect(messagesOfType(received, 'vd-comment-pod-select')).toContainEqual({
      type: 'vd-comment-pod-select',
      target: expect.objectContaining({
        selectionKind: 'pod',
        selector: 'pod',
        position: { x: 10, y: 12, width: 110, height: 120 },
      }),
      points: [
        { x: 10, y: 12 },
        { x: 120, y: 132 },
      ],
    });
    expect(messagesOfType(received, 'vd-comment-select')).toEqual([]);
  });

  it('emits page coordinates for scrolled picker selections', () => {
    document.body.innerHTML = '<main><section id="hero">Hero</section></main>';
    const section = document.querySelector('section');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    Object.defineProperty(window, 'scrollX', { configurable: true, value: 120 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
    Object.defineProperty(window, 'pageXOffset', { configurable: true, value: 120 });
    Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 240 });
    expect(section).not.toBeNull();
    mockRect(section as Element, { x: 20, y: 30, width: 320, height: 180 });

    runBridge(buildCanvasCommentBridge(true));
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 32, clientY: 44 });
    section!.dispatchEvent(clickEvent);

    expect(messagesOfType(received, 'vd-comment-select')).toContainEqual({
      type: 'vd-comment-select',
      target: expect.objectContaining({
        targetId: 'hero',
        position: { x: 140, y: 270, width: 320, height: 180 },
        hoverPoint: { x: 152, y: 284 },
      }),
    });
  });

  it('ignores blank picker clicks until a real element is selected', () => {
    document.body.innerHTML = '<main><section id="hero">Hero</section></main>';
    const section = document.querySelector('section');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    mockRect(section as Element, { x: 40, y: 50, width: 120, height: 60 });

    runBridge(buildCanvasCommentBridge(true));
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 18 });
    const wasNotCanceled = document.body.dispatchEvent(clickEvent);

    expect(wasNotCanceled).toBe(false);
    expect(messagesOfType(received, 'vd-comment-select')).toEqual([]);
  });

  it('selects a container when its own background is clicked in picker mode', () => {
    document.body.innerHTML = '<main><section id="hero"><h1>Hero</h1><p>Copy</p></section></main>';
    const section = document.querySelector('section');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    mockRect(section as Element, { x: 0, y: 0, width: 400, height: 280 });

    runBridge(buildCanvasCommentBridge(true));
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 320, clientY: 180 });
    const wasNotCanceled = section!.dispatchEvent(clickEvent);

    expect(wasNotCanceled).toBe(false);
    expect(messagesOfType(received, 'vd-comment-select')).toContainEqual({
      type: 'vd-comment-select',
      target: expect.objectContaining({ targetId: 'hero', selector: 'section#hero' }),
    });
  });

  it('selects interactive nodes while blocking their native click behavior', () => {
    document.body.innerHTML = '<main><button>Native action</button><div contenteditable="true">Edit me</div></main>';
    const button = document.querySelector('button');
    const editable = document.querySelector('[contenteditable]');
    const buttonClick = vi.fn();
    const editableClick = vi.fn();
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(button).not.toBeNull();
    expect(editable).not.toBeNull();
    mockRect(button as Element, { x: 0, y: 0, width: 80, height: 24 });
    mockRect(editable as Element, { x: 0, y: 30, width: 80, height: 24 });
    button!.addEventListener('click', buttonClick);
    editable!.addEventListener('click', editableClick);

    runBridge(buildCanvasCommentBridge(true));
    const buttonWasNotCanceled = button!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 14, clientY: 18 }),
    );
    const editableWasNotCanceled = editable!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 44 }),
    );

    expect(buttonWasNotCanceled).toBe(false);
    expect(editableWasNotCanceled).toBe(false);
    expect(buttonClick).not.toHaveBeenCalled();
    expect(editableClick).not.toHaveBeenCalled();
    const selectedSelectors = messagesOfType(received, 'vd-comment-select').map(
      (message) => (message as { target?: { selector?: string } }).target?.selector,
    );
    expect(selectedSelectors).toContain('button');
    expect(selectedSelectors).toContain('div');
  });

  it('blocks native typing, navigation, focus and form submission while marking', () => {
    document.body.innerHTML =
      '<main><form><input id="field" /><a id="link" href="#go">Go</a><button type="submit">Send</button></form></main>';
    const input = document.querySelector('input');
    const link = document.querySelector('a');
    const form = document.querySelector('form');
    const keydownHandler = vi.fn();
    const beforeInputHandler = vi.fn();
    const mousedownHandler = vi.fn();
    const submitHandler = vi.fn();

    expect(input).not.toBeNull();
    expect(link).not.toBeNull();
    expect(form).not.toBeNull();
    input!.addEventListener('keydown', keydownHandler);
    input!.addEventListener('beforeinput', beforeInputHandler);
    input!.addEventListener('mousedown', mousedownHandler);
    form!.addEventListener('submit', submitHandler);

    runBridge(buildCanvasCommentBridge(true));

    const keydownNotCanceled = input!.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a' }),
    );
    const beforeInputNotCanceled = input!.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'a' }),
    );
    const mousedownNotCanceled = input!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    const submitNotCanceled = form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(keydownNotCanceled).toBe(false);
    expect(beforeInputNotCanceled).toBe(false);
    expect(mousedownNotCanceled).toBe(false);
    expect(submitNotCanceled).toBe(false);
    expect(keydownHandler).not.toHaveBeenCalled();
    expect(beforeInputHandler).not.toHaveBeenCalled();
    expect(mousedownHandler).not.toHaveBeenCalled();
    expect(submitHandler).not.toHaveBeenCalled();
  });

  it('keeps native keyboard and form behavior when comment mode is disabled', () => {
    document.body.innerHTML = '<main><form><input id="field" /></form></main>';
    const input = document.querySelector('input');
    const form = document.querySelector('form');
    const keydownHandler = vi.fn();
    const submitHandler = vi.fn();

    expect(input).not.toBeNull();
    expect(form).not.toBeNull();
    input!.addEventListener('keydown', keydownHandler);
    form!.addEventListener('submit', submitHandler);

    runBridge(buildCanvasCommentBridge(false));

    input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a' }));
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(keydownHandler).toHaveBeenCalledTimes(1);
    expect(submitHandler).toHaveBeenCalledTimes(1);
  });

  it('preserves native click behavior when comment mode is disabled', () => {
    document.body.innerHTML = '<main><button>Native action</button></main>';
    const button = document.querySelector('button');
    const nativeClick = vi.fn();
    const documentClick = vi.fn();
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(button).not.toBeNull();
    mockRect(button as Element, { x: 0, y: 0, width: 80, height: 24 });
    button!.addEventListener('click', nativeClick);

    runBridge(buildCanvasCommentBridge(false));
    document.addEventListener('click', documentClick, true);
    const wasNotCanceled = button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(wasNotCanceled).toBe(true);
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(documentClick).toHaveBeenCalledTimes(1);
    expect(messagesOfType(received, 'vd-comment-select')).toEqual([]);
  });

  it('emits pod stroke and select messages for pointer gestures', () => {
    document.body.innerHTML = '<main><section data-vd-id="card">Card body</section></main>';
    const section = document.querySelector('section');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    mockRect(section as Element, { x: 0, y: 0, width: 120, height: 80 });

    runBridge(buildCanvasCommentBridge(false));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-comment-mode', enabled: true, mode: 'pod' } }));
    section!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 12 }));
    section!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 40, clientY: 42 }));
    section!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 80, clientY: 70 }));

    expect(messagesOfType(received, 'vd-comment-pod-stroke')).toEqual([
      expect.objectContaining({ phase: 'start', points: [{ x: 10, y: 12 }] }),
      expect.objectContaining({
        phase: 'move',
        points: [
          { x: 10, y: 12 },
          { x: 40, y: 42 },
        ],
      }),
      expect.objectContaining({
        phase: 'end',
        points: [
          { x: 10, y: 12 },
          { x: 40, y: 42 },
          { x: 80, y: 70 },
        ],
      }),
    ]);
    expect(messagesOfType(received, 'vd-comment-pod-select')).toContainEqual({
      type: 'vd-comment-pod-select',
      target: expect.objectContaining({
        selectionKind: 'pod',
        selector: 'pod',
        memberCount: expect.any(Number),
      }),
      points: [
        { x: 10, y: 12 },
        { x: 40, y: 42 },
        { x: 80, y: 70 },
      ],
    });
  });

  it('does not rediscover targets from bridge-owned pod overlay mutations while drawing', async () => {
    document.body.innerHTML = '<main><section data-vd-id="card">Card body</section></main>';
    const section = document.querySelector('section');
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    expect(section).not.toBeNull();
    mockRect(section as Element, { x: 0, y: 0, width: 120, height: 80 });

    runBridge(buildCanvasCommentBridge(false));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'vd-comment-mode', enabled: true, mode: 'picker' } }),
    );
    await flushMutationObserver();
    expect(messagesOfType(received, 'vd-comment-targets').length).toBeGreaterThan(0);

    received.length = 0;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'vd-comment-mode', enabled: true, mode: 'pod' } }));
    await flushMutationObserver();
    expect(messagesOfType(received, 'vd-comment-targets').length).toBeGreaterThan(0);

    received.length = 0;
    section!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 12 }));
    section!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 40, clientY: 42 }));
    section!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 80, clientY: 70 }));
    await flushMutationObserver();

    expect(messagesOfType(received, 'vd-comment-pod-stroke').length).toBeGreaterThan(0);
    expect(messagesOfType(received, 'vd-comment-pod-select')).toHaveLength(1);
    expect(messagesOfType(received, 'vd-comment-targets')).toEqual([]);
  });

  it('does not throw when active target selector is invalid', () => {
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };

    document.body.innerHTML = '<main><button id="123-start">Start</button></main>';
    runBridge(buildCanvasCommentBridge(true));

    expect(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'vd-comment-active-target', targetId: null, selector: '#not valid [' },
        }),
      );
    }).not.toThrow();
    expect(messagesOfType(received, 'vd-comment-active-target-update')).toContainEqual({
      type: 'vd-comment-active-target-update',
      targetId: null,
      selector: '#not valid [',
      target: null,
    });
  });

  it('bounds full target scans before expensive visibility and snapshot work', () => {
    document.body.innerHTML = `<main>${Array.from({ length: 520 }, (_, index) => `<button>Item ${index}</button>`).join('')}</main>`;
    const received: unknown[] = [];
    let buttonStyleReads = 0;
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if ((element as Element).localName === 'button') {
        buttonStyleReads += 1;
      }
      return {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderRadius: '',
        color: 'canvastext',
        display: 'block',
        fontFamily: '',
        fontSize: '',
        fontWeight: '',
        lineHeight: '',
        opacity: '1',
        paddingBottom: '',
        paddingLeft: '',
        paddingRight: '',
        paddingTop: '',
        textAlign: '',
        visibility: 'visible',
      } as unknown as CSSStyleDeclaration;
    });
    document.querySelectorAll('button').forEach((button, index) => {
      mockRect(button, { x: 0, y: index * 24, width: 80, height: 20 });
    });

    runBridge(buildCanvasCommentBridge(true));

    const targetsMessage = messagesOfType(received, 'vd-comment-targets').at(-1) as { targets?: unknown[] } | undefined;
    expect(targetsMessage?.targets).toHaveLength(500);
    expect(buttonStyleReads).toBeLessThanOrEqual(1000);
  });

  it('ignores self-authored runtime id mutations when scheduling target refreshes', () => {
    let observerCallback: MutationCallback | null = null;
    const received: unknown[] = [];
    window.parent.postMessage = (message: unknown) => {
      received.push(message);
    };
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      writable: true,
      value: class {
        constructor(callback: MutationCallback) {
          observerCallback = callback;
        }
        observe() {}
      },
    });

    document.body.innerHTML = '<main><p>Copy</p></main>';
    runBridge(buildCanvasCommentBridge(true));
    received.length = 0;
    const paragraph = document.querySelector('p');
    expect(paragraph).not.toBeNull();

    const callback = observerCallback as MutationCallback | null;
    expect(callback).not.toBeNull();
    if (!callback) {
      throw new Error('Expected comment bridge to register a MutationObserver callback.');
    }
    callback(
      [
        {
          type: 'attributes',
          attributeName: 'data-vd-runtime-id',
          target: paragraph as Node,
        } as MutationRecord,
      ],
      {} as MutationObserver,
    );

    expect(messagesOfType(received, 'vd-comment-targets')).toEqual([]);
  });
});

function runBridge(scriptSnippet: string): void {
  const template = document.createElement('template');
  template.innerHTML = scriptSnippet;
  const script = template.content.querySelector(`script[${CANVAS_COMMENT_BRIDGE_ATTR}]`);

  expect(script).not.toBeNull();
  window.eval(script!.textContent ?? '');
}

function mockRect(element: Element, rect: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function messagesOfType(messages: unknown[], type: string): unknown[] {
  return messages.filter((message) => {
    return typeof message === 'object' && message !== null && 'type' in message && message.type === type;
  });
}

async function flushMutationObserver(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}
