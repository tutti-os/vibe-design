import { buildCanvasCommentBridge } from '../canvas-comment/bridge';
import { CANVAS_EDIT_SOURCE_PATH_ATTR, buildCanvasEditBridge, isCanvasEditHostNode } from '../canvas-edit/bridge';

export interface BuildPreviewSrcdocOptions {
  editBridge: boolean;
  sizeBridge?: boolean;
  navigationBasePath?: string;
  commentBridge?: boolean;
  snapshotBridge?: boolean;
}

export function buildPreviewSrcdoc(html: string, options: BuildPreviewSrcdocOptions): string {
  let documentHtml = isFullHtmlDocument(html) ? html : wrapHtmlFragment(html);

  if (options.editBridge) {
    documentHtml = annotateEditableSourcePaths(documentHtml);
    documentHtml = injectBeforeHeadEnd(documentHtml, canvasEditBridgeStyle());
  }

  if (options.sizeBridge) {
    documentHtml = injectBeforeHeadEnd(documentHtml, canvasPreviewScrollbarStyle());
    documentHtml = injectBeforeBodyEnd(documentHtml, canvasPreviewSizeBridge());
    documentHtml = injectBeforeBodyEnd(documentHtml, canvasPreviewScrollbarBridge());
  }

  if (options.navigationBasePath) {
    documentHtml = injectBeforeBodyEnd(documentHtml, canvasPreviewNavigationBridge());
  }

  if (options.commentBridge) {
    documentHtml = injectBeforeBodyEnd(documentHtml, buildCanvasCommentBridge(true));
  }

  if (options.snapshotBridge) {
    documentHtml = injectBeforeBodyEnd(documentHtml, canvasPreviewSnapshotBridge());
  }

  if (!options.editBridge) {
    return documentHtml;
  }

  return injectBeforeBodyEnd(documentHtml, buildCanvasEditBridge(true));
}

function isFullHtmlDocument(html: string): boolean {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function wrapHtmlFragment(html: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;
}

function canvasEditBridgeStyle(): string {
  return `<style data-vd-edit-bridge-style>
    [data-vd-edit-overlay-layer="true"] { position: absolute; inset: 0; pointer-events: none; z-index: 2147483647; }
    [data-vd-edit-overlay] { position: absolute; box-sizing: border-box; pointer-events: none; border-radius: 2px; }
    [data-vd-edit-overlay="selected"] { border: 2px solid #0f766e; }
    [data-vd-edit-overlay="hovered"] { border: 1px dashed #0f766e; }
  </style>`;
}

function canvasPreviewScrollbarStyle(): string {
  return `<style data-vd-preview-scrollbar>
    html {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    html::-webkit-scrollbar,
    body::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    [data-vd-preview-scrollbar="track"] {
      position: fixed;
      top: 6px;
      right: 5px;
      bottom: 6px;
      width: 12px;
      z-index: 2147483000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    [data-vd-preview-scrollbar="track"][data-visible="true"] {
      opacity: 1;
      pointer-events: auto;
    }

    [data-vd-preview-scrollbar="thumb"] {
      position: absolute;
      right: 2px;
      top: 0;
      width: 7px;
      min-height: 34px;
      border-radius: 999px;
      background: rgba(69, 66, 59, 0.28);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.38);
      cursor: grab;
      transition: background 120ms ease, width 120ms ease, right 120ms ease;
    }

    [data-vd-preview-scrollbar="track"]:hover [data-vd-preview-scrollbar="thumb"],
    [data-vd-preview-scrollbar="thumb"][data-dragging="true"] {
      right: 1px;
      width: 9px;
      background: rgba(69, 66, 59, 0.42);
    }

    [data-vd-preview-scrollbar="thumb"][data-dragging="true"] {
      cursor: grabbing;
    }
  </style>`;
}

function canvasPreviewSizeBridge(): string {
  return `<script data-vd-preview-size-bridge>
(function () {
  var scheduled = false;
  var measurementExcludedSelector = [
    '[data-vd-preview-size-bridge]',
    '[data-vd-preview-scrollbar]',
    '[data-vd-preview-snapshot-bridge]',
    '[data-vd-comment-bridge]',
    '[data-vd-comment-owned]',
    '[data-vd-comment-pod-layer]',
    '[data-vd-edit-bridge]',
    '[data-vd-edit-bridge-style]',
    '[data-vd-edit-overlay-layer]',
    '[data-vd-edit-overlay]'
  ].join(',');

  function measure() {
    scheduled = false;
    var root = document.documentElement;
    var body = document.body;
    var width = Math.max(window.innerWidth || 0, root.scrollWidth || 0, root.offsetWidth || 0, body ? body.scrollWidth || 0 : 0, body ? body.offsetWidth || 0 : 0);
    var height = Math.max(window.innerHeight || 0, root.scrollHeight || 0, root.offsetHeight || 0, body ? body.scrollHeight || 0 : 0, body ? body.offsetHeight || 0 : 0);
    var nodes = body ? body.querySelectorAll('*') : [];

    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.matches && node.matches(measurementExcludedSelector)) continue;
      var rect = node.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      width = Math.max(width, Math.ceil(rect.right + window.scrollX));
      height = Math.max(height, Math.ceil(rect.bottom + window.scrollY));
    }

    window.parent.postMessage({ type: 'vd-preview-size', width: width, height: height }, '*');
  }

  function scheduleMeasure() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(measure);
  }

  window.addEventListener('load', scheduleMeasure);
  window.addEventListener('resize', scheduleMeasure);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleMeasure).catch(function () {});
  }
  if (window.MutationObserver && document.documentElement) {
    new MutationObserver(scheduleMeasure).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  }
  window.setTimeout(scheduleMeasure, 50);
  window.setTimeout(scheduleMeasure, 300);
  scheduleMeasure();
})();
</script>`;
}

function canvasPreviewScrollbarBridge(): string {
  return `<script data-vd-preview-scrollbar>
(function () {
  var track = null;
  var thumb = null;
  var dragging = false;
  var dragOffset = 0;
  var scheduled = false;

  function maxScroll() {
    var root = document.documentElement;
    var body = document.body;
    var scrollHeight = Math.max(root.scrollHeight || 0, body ? body.scrollHeight || 0 : 0);
    var viewportHeight = window.innerHeight || root.clientHeight || 1;
    return Math.max(0, scrollHeight - viewportHeight);
  }

  function ensureNodes() {
    if (track && thumb) return;

    track = document.createElement('div');
    track.setAttribute('data-vd-preview-scrollbar', 'track');
    track.setAttribute('aria-hidden', 'true');

    thumb = document.createElement('div');
    thumb.setAttribute('data-vd-preview-scrollbar', 'thumb');
    track.appendChild(thumb);
    document.body.appendChild(track);

    thumb.addEventListener('pointerdown', startDrag);
    track.addEventListener('pointerdown', jumpToPoint);
  }

  function update() {
    scheduled = false;
    ensureNodes();
    if (!track || !thumb) return;

    var available = track.clientHeight || Math.max(1, window.innerHeight - 12);
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    var scrollable = maxScroll();
    if (scrollable <= 1) {
      track.removeAttribute('data-visible');
      return;
    }

    var documentHeight = viewportHeight + scrollable;
    var thumbHeight = Math.max(34, Math.round((viewportHeight / documentHeight) * available));
    var travel = Math.max(1, available - thumbHeight);
    var progress = Math.min(1, Math.max(0, (window.scrollY || window.pageYOffset || 0) / scrollable));
    thumb.style.height = thumbHeight + 'px';
    thumb.style.transform = 'translateY(' + Math.round(progress * travel) + 'px)';
    track.setAttribute('data-visible', 'true');
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(update);
  }

  function scrollToThumbPosition(clientY) {
    if (!track || !thumb) return;
    var rect = track.getBoundingClientRect();
    var thumbHeight = thumb.offsetHeight || 34;
    var travel = Math.max(1, rect.height - thumbHeight);
    var top = Math.min(travel, Math.max(0, clientY - rect.top - dragOffset));
    var nextScroll = (top / travel) * maxScroll();
    window.scrollTo({ top: nextScroll, behavior: 'auto' });
  }

  function startDrag(event) {
    if (!thumb) return;
    dragging = true;
    var thumbRect = thumb.getBoundingClientRect();
    dragOffset = event.clientY - thumbRect.top;
    thumb.setAttribute('data-dragging', 'true');
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function jumpToPoint(event) {
    if (event.target === thumb) return;
    if (!thumb) return;
    dragOffset = Math.round((thumb.offsetHeight || 34) / 2);
    scrollToThumbPosition(event.clientY);
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePointerMove(event) {
    if (!dragging) return;
    scrollToThumbPosition(event.clientY);
    event.preventDefault();
  }

  function stopDrag(event) {
    if (!dragging) return;
    dragging = false;
    if (thumb) {
      thumb.removeAttribute('data-dragging');
      if (typeof thumb.releasePointerCapture === 'function') {
        try {
          thumb.releasePointerCapture(event.pointerId);
        } catch (error) {}
      }
    }
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
  window.addEventListener('load', scheduleUpdate);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleUpdate).catch(function () {});
  }
  if (window.ResizeObserver && document.documentElement) {
    new ResizeObserver(scheduleUpdate).observe(document.documentElement);
  }
  if (window.MutationObserver && document.documentElement) {
    new MutationObserver(scheduleUpdate).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  }

  window.setTimeout(scheduleUpdate, 50);
  window.setTimeout(scheduleUpdate, 300);
  scheduleUpdate();
})();
</script>`;
}

function canvasPreviewNavigationBridge(): string {
  return `<script data-vd-preview-navigation-bridge>
(function () {
  function closestAnchor(target) {
    var current = target;
    while (current && current !== document) {
      if (current.tagName && String(current.tagName).toLowerCase() === 'a' && current.hasAttribute('href')) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) {
      return;
    }

    var anchor = closestAnchor(event.target);
    if (!anchor) return;

    event.preventDefault();
  }, true);
})();
</script>`;
}

function canvasPreviewSnapshotBridge(): string {
  return `<script data-vd-preview-snapshot-bridge>
(function () {
  var bridgeOwnedSelector = [
    '[data-vd-preview-size-bridge]',
    '[data-vd-preview-scrollbar]',
    '[data-vd-preview-snapshot-bridge]',
    '[data-vd-comment-bridge]',
    '[data-vd-comment-owned]',
    '[data-vd-comment-pod-layer]',
    '[data-vd-edit-bridge]',
    '[data-vd-edit-bridge-style]',
    '[data-vd-edit-overlay-layer]',
    '[data-vd-edit-overlay]'
  ].join(',');

  function removeBridgeOwnedNodes(root) {
    if (!root || !root.querySelectorAll) return;
    Array.from(root.querySelectorAll(bridgeOwnedSelector)).forEach(function (node) {
      node.remove();
    });
  }

  function snapshotSize() {
    var root = document.documentElement;
    var body = document.body;
    var viewportWidth = Math.max(1, Math.round(window.innerWidth || root.clientWidth || 1));
    var viewportHeight = Math.max(1, Math.round(window.innerHeight || root.clientHeight || 1));
    return {
      width: Math.max(viewportWidth, Math.round(root.scrollWidth || 0), Math.round(root.offsetWidth || 0), body ? Math.round(body.scrollWidth || 0) : 0, body ? Math.round(body.offsetWidth || 0) : 0),
      height: Math.max(viewportHeight, Math.round(root.scrollHeight || 0), Math.round(root.offsetHeight || 0), body ? Math.round(body.scrollHeight || 0) : 0, body ? Math.round(body.offsetHeight || 0) : 0)
    };
  }

  function encodeSvg(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function serializeViewport() {
    var size = snapshotSize();
    var root = document.documentElement;
    var clone = root.cloneNode(true);
    if (clone instanceof Element) {
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    }
    removeBridgeOwnedNodes(clone);

    var serializedHtml = new XMLSerializer().serializeToString(clone);
    var contentWidth = size.width;
    var contentHeight = size.height;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size.width + '" height="' + size.height + '" viewBox="0 0 ' + size.width + ' ' + size.height + '">' +
      '<foreignObject x="0" y="0" width="' + size.width + '" height="' + size.height + '">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + size.width + 'px;height:' + size.height + 'px;overflow:hidden;background:white;">' +
          '<div style="width:' + contentWidth + 'px;min-height:' + contentHeight + 'px;transform:translate(0px,0px);transform-origin:top left;">' +
            serializedHtml +
          '</div>' +
        '</div>' +
      '</foreignObject>' +
    '</svg>';

    return {
      dataUrl: encodeSvg(svg),
      width: size.width,
      height: size.height
    };
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'vd-preview-snapshot') {
      return;
    }

    try {
      var result = serializeViewport();
      window.parent.postMessage({
        type: 'vd-preview-snapshot-result',
        id: data.id,
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height
      }, '*');
    } catch (error) {
      window.parent.postMessage({
        type: 'vd-preview-snapshot-result',
        id: data.id,
        error: error && error.message ? String(error.message).slice(0, 120) : 'Snapshot failed',
        dataUrl: null,
        width: 0,
        height: 0
      }, '*');
    }
  });
})();
</script>`;
}

function injectBeforeHeadEnd(doc: string, snippet: string): string {
  return doc.includes('</head>') ? doc.replace('</head>', () => `${snippet}</head>`) : `${snippet}${doc}`;
}

function injectBeforeBodyEnd(doc: string, snippet: string): string {
  return doc.includes('</body>') ? doc.replace('</body>', () => `${snippet}</body>`) : `${doc}${snippet}`;
}

function annotateEditableSourcePaths(documentHtml: string): string {
  if (typeof DOMParser === 'undefined') {
    return documentHtml;
  }

  const parsedDocument = new DOMParser().parseFromString(documentHtml, 'text/html');
  annotateElementChildren(parsedDocument.body, []);

  return `${doctypeForDocument(documentHtml)}${parsedDocument.documentElement.outerHTML}`;
}

function annotateElementChildren(parent: Element, parentPath: number[]): void {
  Array.from(parent.children)
    .filter((element) => !isCanvasEditHostNode(element))
    .forEach((element, index) => {
      const elementPath = [...parentPath, index];

      if (isEditableSourcePathTarget(element) && !hasCanvasEditIdentity(element)) {
        element.setAttribute(CANVAS_EDIT_SOURCE_PATH_ATTR, `path-${elementPath.join('-')}`);
      }

      annotateElementChildren(element, elementPath);
    });
}

function isEditableSourcePathTarget(element: Element): boolean {
  return !['script', 'style', 'template', 'noscript'].includes(element.localName.toLowerCase());
}

function hasCanvasEditIdentity(element: Element): boolean {
  return element.hasAttribute('data-vd-id') || element.hasAttribute(CANVAS_EDIT_SOURCE_PATH_ATTR);
}

function doctypeForDocument(documentHtml: string): string {
  return documentHtml.trimStart().toLowerCase().startsWith('<!doctype') ? '<!doctype html>' : '';
}
