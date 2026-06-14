import type { EditableNode } from './types';

export const CANVAS_EDIT_SOURCE_PATH_ATTR = 'data-vd-source-path';
export const CANVAS_EDIT_RUNTIME_ID_ATTR = 'data-vd-runtime-id';
export const CANVAS_EDIT_DISCOVERY_SELECTOR = `[data-vd-id],[${CANVAS_EDIT_SOURCE_PATH_ATTR}],[${CANVAS_EDIT_RUNTIME_ID_ATTR}]`;
export const CANVAS_EDIT_HOST_NODE_SELECTOR =
  '[data-vd-edit-bridge],[data-vd-edit-bridge-style],[data-vd-preview-scrollbar],[data-vd-edit-overlay-layer],[data-vd-edit-overlay]';
export const CANVAS_EDIT_EXCLUDED_TARGET_SELECTOR = 'script,style,meta,link,title,head,noscript,template';

export function isCanvasEditHostNode(element: Element): boolean {
  return element.matches(CANVAS_EDIT_HOST_NODE_SELECTOR);
}

export function canvasEditDomPathForElement(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    if (!isCanvasEditHostNode(current)) {
      const tagName = current.localName.toLowerCase();
      if (tagName === 'html' || tagName === 'body') {
        segments.unshift(tagName);
      } else {
        segments.unshift(`${tagName}:nth-of-type(${elementTypeIndex(current)})`);
      }
    }
    current = current.parentElement;
  }

  return segments.join('>');
}

export function canvasEditStableIdForElement(element: Element): string {
  const explicitId = element.getAttribute('data-vd-id');
  if (explicitId && explicitId.trim()) {
    return explicitId;
  }

  const sourcePath = element.getAttribute(CANVAS_EDIT_SOURCE_PATH_ATTR);
  if (sourcePath && sourcePath.trim()) {
    return sourcePath;
  }

  const runtimeId = element.getAttribute(CANVAS_EDIT_RUNTIME_ID_ATTR);
  if (runtimeId && runtimeId.trim()) {
    return runtimeId;
  }

  const elementId = element.getAttribute('id');
  if (elementId && elementId.trim()) {
    return elementId;
  }

  const fallbackId = canvasEditDomPathForElement(element);
  element.setAttribute(CANVAS_EDIT_RUNTIME_ID_ATTR, fallbackId);
  return fallbackId;
}

export function buildCanvasEditBridge(enabled: boolean): string {
  return `<script data-vd-edit-bridge>(() => {
  const sourcePathAttr = 'data-vd-source-path';
  const runtimeIdAttr = 'data-vd-runtime-id';
  const overlayLayerAttr = 'data-vd-edit-overlay-layer';
  const overlayAttr = 'data-vd-edit-overlay';
  const previewTextOriginalKey = '__vdPreviewTextOriginal';
  const discoverySelector = '[data-vd-id],[' + sourcePathAttr + '],[' + runtimeIdAttr + ']';
  const hostSelector = '[data-vd-edit-bridge],[data-vd-edit-bridge-style],[data-vd-preview-scrollbar],[' + overlayLayerAttr + '],[' + overlayAttr + ']';
  const excludedTargetSelector = 'script,style,meta,link,title,head,noscript,template';
  let editModeEnabled = ${JSON.stringify(enabled)};
  let editingState = null;
  let previewTextState = null;
  let previewStyleState = null;
  let selectedTargetId = null;
  let hoveredTargetId = null;
  let overlayFrameRequest = null;
  const nativeInteractionBlockEvents = [
    'pointerdown',
    'pointerup',
    'pointermove',
    'mousedown',
    'mouseup',
    'mouseover',
    'mouseout',
    'mouseenter',
    'mouseleave',
    'mousemove',
    'contextmenu',
    'touchstart',
    'touchend'
  ];

  function isHostNode(element) {
    return element.matches(hostSelector);
  }

  function isEligibleTargetNode(element) {
    return !isHostNode(element) && !element.matches(excludedTargetSelector);
  }

  function elementTypeIndex(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (!isHostNode(sibling) && sibling.localName === element.localName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function domPathForElement(element) {
    const segments = [];
    let current = element;
    while (current) {
      if (!isHostNode(current)) {
        const tagName = current.localName.toLowerCase();
        segments.unshift(tagName === 'html' || tagName === 'body' ? tagName : tagName + ':nth-of-type(' + elementTypeIndex(current) + ')');
      }
      current = current.parentElement;
    }
    return segments.join('>');
  }

  function stableIdForElement(element) {
    const explicitId = element.getAttribute('data-vd-id');
    if (explicitId && explicitId.trim()) {
      return explicitId;
    }
    const sourcePath = element.getAttribute(sourcePathAttr);
    if (sourcePath && sourcePath.trim()) {
      return sourcePath;
    }
    const runtimeId = element.getAttribute(runtimeIdAttr);
    if (runtimeId && runtimeId.trim()) {
      return runtimeId;
    }
    const elementId = element.getAttribute('id');
    if (elementId && elementId.trim()) {
      return elementId;
    }
    const fallbackId = domPathForElement(element);
    element.setAttribute(runtimeIdAttr, fallbackId);
    return fallbackId;
  }

  function classListForElement(element) {
    return Array.from(element.classList || []);
  }

  function selectorForElement(element) {
    const tagName = element.localName.toLowerCase();
    const elementId = element.getAttribute('id');
    const idSelector = elementId && elementId.trim() ? '#' + elementId.trim() : '';
    const classSelector = classListForElement(element).map((className) => '.' + className).join('');
    return tagName + idSelector + classSelector;
  }

  function parentTargetForElement(element) {
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      if (isEligibleTargetNode(parent)) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function depthForElement(element) {
    let depth = 0;
    let parent = parentTargetForElement(element);
    while (parent) {
      depth += 1;
      parent = parentTargetForElement(parent);
    }
    return depth;
  }

  function childCountForElement(element) {
    return Array.from(element.children).filter(isEligibleTargetNode).length;
  }

  function kindForElement(element) {
    const tagName = element.localName.toLowerCase();
    if (tagName === 'img') {
      return 'image';
    }
    if (tagName === 'a') {
      return 'link';
    }
    if (isLayoutContainerElement(element)) {
      return 'container';
    }
    return 'text';
  }

  function isLayoutContainerElement(element) {
    return ['article', 'aside', 'body', 'div', 'footer', 'header', 'main', 'nav', 'section'].includes(element.localName.toLowerCase());
  }

  function ownDisplayHiddenStateForElement(element, computedStyle) {
    return element.hasAttribute('hidden') || computedStyle.display === 'none';
  }

  function hasHiddenAncestor(element) {
    let ancestor = element.parentElement;
    while (ancestor) {
      if (ancestor.hasAttribute('hidden') || window.getComputedStyle(ancestor).display === 'none') {
        return true;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  function hiddenStateForElement(element, computedStyle) {
    return computedStyle.visibility === 'hidden'
      || computedStyle.visibility === 'collapse'
      || ownDisplayHiddenStateForElement(element, computedStyle)
      || hasHiddenAncestor(element);
  }

  function layoutContainerStateForElement(element, computedStyle) {
    return computedStyle.display.includes('flex')
      || computedStyle.display.includes('grid')
      || (isLayoutContainerElement(element) && ownDisplayHiddenStateForElement(element, computedStyle));
  }

  function labelForElement(element) {
    const text = (element.textContent || '').trim();
    const ariaLabel = element.getAttribute('aria-label');
    const alt = element.getAttribute('alt');
    const label = text || ariaLabel || alt || element.localName.toLowerCase();
    return label.slice(0, 80);
  }

  function attributesForElement(element) {
    return Array.from(element.attributes).reduce((attributes, attribute) => {
      if (!isPayloadAttribute(attribute.name)) {
        return attributes;
      }
      attributes[attribute.name] = attribute.value;
      return attributes;
    }, {});
  }

  function isPayloadAttribute(name) {
    return name !== runtimeIdAttr
      && name !== 'contenteditable'
      && !name.startsWith('data-vd-edit-');
  }

  function cleanPayloadElement(element) {
    Array.from(element.attributes).forEach((attribute) => {
      if (!isPayloadAttribute(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    });
  }

  function outerHtmlForElement(element) {
    const clone = element.cloneNode(true);
    if (!(clone instanceof Element)) {
      return element.outerHTML || '';
    }
    cleanPayloadElement(clone);
    clone.querySelectorAll('*').forEach(cleanPayloadElement);
    return clone.outerHTML || '';
  }

  function stylesForElement(element, computedStyle) {
    const styles = {};
    const styleFields = [
      ['fontSize', 'font-size'],
      ['color', 'color'],
      ['backgroundColor', 'background-color'],
      ['backgroundImage', 'background-image'],
      ['opacity', 'opacity'],
      ['fontFamily', 'font-family'],
      ['fontWeight', 'font-weight'],
      ['textAlign', 'text-align'],
      ['lineHeight', 'line-height'],
      ['letterSpacing', 'letter-spacing'],
      ['padding', 'padding'],
      ['paddingTop', 'padding-top'],
      ['paddingRight', 'padding-right'],
      ['paddingBottom', 'padding-bottom'],
      ['paddingLeft', 'padding-left'],
      ['marginTop', 'margin-top'],
      ['marginRight', 'margin-right'],
      ['marginBottom', 'margin-bottom'],
      ['marginLeft', 'margin-left'],
      ['borderRadius', 'border-radius'],
      ['radiusTopLeft', 'border-top-left-radius'],
      ['radiusTopRight', 'border-top-right-radius'],
      ['radiusBottomRight', 'border-bottom-right-radius'],
      ['radiusBottomLeft', 'border-bottom-left-radius'],
      ['borderWidth', 'border-width'],
      ['borderStyle', 'border-style'],
      ['borderColor', 'border-color'],
      ['boxShadow', 'box-shadow'],
      ['transform', 'transform'],
      ['positionX', 'left'],
      ['positionY', 'top'],
      ['positionZ', 'z-index'],
      ['width', 'width'],
      ['height', 'height'],
      ['objectFit', 'object-fit'],
      ['objectPosition', 'object-position']
    ];
    const baselineStyles = baselineStylesForElement(element, styleFields);
    styleFields.forEach(([fieldName, cssName]) => {
      const computedValue = computedStyle[fieldName] || computedStyle.getPropertyValue(cssName);
      const baselineValue = baselineStyles[fieldName];
      const inlineValue = element.style ? element.style[fieldName] || element.style.getPropertyValue(cssName) : '';
      const value = computedValue || inlineValue;
      if (value && (inlineValue || value !== baselineValue)) {
        styles[fieldName] = value;
      }
    });
    return styles;
  }

  function baselineStylesForElement(element, styleFields) {
    const baseline = document.createElement(element.localName);
    document.body.appendChild(baseline);
    const baselineStyle = window.getComputedStyle(baseline);
    const styles = {};
    styleFields.forEach(([fieldName, cssName]) => {
      styles[fieldName] = baselineStyle[fieldName] || baselineStyle.getPropertyValue(cssName);
    });
    baseline.remove();
    return styles;
  }

  function targetForElement(element) {
    const rect = element.getBoundingClientRect();
    const text = (element.textContent || '').trim();
    const computedStyle = window.getComputedStyle(element);
    const parentTarget = parentTargetForElement(element);
    const isLayoutContainer = layoutContainerStateForElement(element, computedStyle);
    const isHidden = hiddenStateForElement(element, computedStyle);
    return {
      id: stableIdForElement(element),
      kind: kindForElement(element),
      label: labelForElement(element),
      tagName: element.localName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className : '',
      text,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      fields: { text },
      attributes: attributesForElement(element),
      styles: stylesForElement(element, computedStyle),
      isLayoutContainer,
      ...(isHidden ? { isHidden } : {}),
      outerHtml: outerHtmlForElement(element),
      ...(parentTarget ? { parentId: stableIdForElement(parentTarget) } : {}),
      depth: depthForElement(element),
      classList: classListForElement(element),
      selector: selectorForElement(element),
      editable: true,
      ...(parentTarget ? { parentDisplay: window.getComputedStyle(parentTarget).display } : {}),
      childCount: childCountForElement(element)
    };
  }

  function editableElementFromEvent(event) {
    if (!editModeEnabled || !(event.target instanceof Element)) {
      return null;
    }
    const element = event.target.closest('body *');
    if (!element || !isEligibleTargetNode(element)) {
      return null;
    }
    return element;
  }

  function isEventInsideActiveTextEdit(event) {
    return !!editingState
      && event.target instanceof Node
      && editingState.element.contains(event.target);
  }

  function blockNativeInteraction(event) {
    if (!editModeEnabled || isEventInsideActiveTextEdit(event)) {
      return;
    }
    if (event.type === 'contextmenu') {
      event.preventDefault();
    }
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function postMessage(message) {
    window.parent.postMessage(message, '*');
  }

  function elementMatchesTargetId(element, id) {
    return element.getAttribute('data-vd-id') === id
      || element.getAttribute(sourcePathAttr) === id
      || element.getAttribute(runtimeIdAttr) === id
      || element.getAttribute('id') === id
      || (id.includes('>') && stableIdForElement(element) === id);
  }

  function elementForTargetId(id) {
    if (!id || typeof id !== 'string') {
      return null;
    }
    const candidates = Array.from(document.body ? document.body.querySelectorAll('*') : document.querySelectorAll(discoverySelector))
      .filter(isEligibleTargetNode);
    return candidates.find((element) => elementMatchesTargetId(element, id)) || null;
  }

  function emitTargets() {
    if (!editModeEnabled) {
      return;
    }
    const targets = Array.from(document.body ? document.body.querySelectorAll('*') : document.querySelectorAll(discoverySelector))
      .filter(isEligibleTargetNode)
      .slice(0, 5000)
      .map(targetForElement);
    postMessage({ type: 'vd-edit-targets', targets });
  }

  function emitHover(event) {
    const element = editableElementFromEvent(event);
    if (!element) {
      return;
    }
    postMessage({ type: 'vd-edit-hover', target: targetForElement(element) });
  }

  function handleClick(event) {
    const element = editableElementFromEvent(event);
    if (!element) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    postMessage({ type: 'vd-edit-select', target: targetForElement(element) });
  }

  function isTextEditableElement(element) {
    const kind = kindForElement(element);
    return kind === 'text' || kind === 'link';
  }

  function startTextEdit(event, targetElement) {
    const element = targetElement || editableElementFromEvent(event);
    if (!element || !isTextEditableElement(element)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (editingState && editingState.element === element) {
      return;
    }

    if (editingState) {
      finishTextEdit(true);
    }

    const originalText = (element.textContent || '').trim();
    const blurHandler = () => finishTextEdit(true);
    editingState = {
      element,
      id: stableIdForElement(element),
      originalText,
      blurHandler
    };
    element.setAttribute('contenteditable', 'true');
    element.focus();
    element.addEventListener('blur', blurHandler);
  }

  function finishTextEdit(shouldCommit) {
    if (!editingState) {
      return;
    }
    const state = editingState;
    editingState = null;
    state.element.removeEventListener('blur', state.blurHandler);
    state.element.removeAttribute('contenteditable');

    const value = (state.element.textContent || '').trim();
    if (shouldCommit && value !== state.originalText) {
      postMessage({ type: 'vd-edit-text-commit', id: state.id, value });
    }
  }

  function handleTextEditKeydown(event) {
    if (!editingState) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      finishTextEdit(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      editingState.element.textContent = editingState.originalText;
      finishTextEdit(false);
    }
  }

  function setSelectedTarget(id) {
    selectedTargetId = typeof id === 'string' ? id : null;
    renderOverlay('selected', selectedTargetId);
    renderOverlay('hovered', hoveredTargetId && hoveredTargetId !== selectedTargetId ? hoveredTargetId : null);
  }

  function setHoveredTarget(id) {
    hoveredTargetId = typeof id === 'string' ? id : null;
    renderOverlay('hovered', hoveredTargetId && hoveredTargetId !== selectedTargetId ? hoveredTargetId : null);
  }

  function ensureOverlayLayer() {
    let layer = document.querySelector('[' + overlayLayerAttr + '="true"]');
    if (!layer) {
      layer = document.createElement('div');
      layer.setAttribute(overlayLayerAttr, 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  function overlayForKind(kind) {
    const layer = ensureOverlayLayer();
    let overlay = layer.querySelector('[' + overlayAttr + '="' + kind + '"]');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute(overlayAttr, kind);
      layer.appendChild(overlay);
    }
    return overlay;
  }

  function removeOverlay(kind) {
    const overlay = document.querySelector('[' + overlayAttr + '="' + kind + '"]');
    if (overlay) {
      overlay.remove();
    }
  }

  function renderOverlay(kind, id) {
    const element = elementForTargetId(id);
    if (!element) {
      removeOverlay(kind);
      return;
    }

    const rect = element.getBoundingClientRect();
    const overlay = overlayForKind(kind);
    overlay.style.left = (rect.left + window.scrollX) + 'px';
    overlay.style.top = (rect.top + window.scrollY) + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  function renderActiveOverlays() {
    renderOverlay('selected', selectedTargetId);
    renderOverlay('hovered', hoveredTargetId && hoveredTargetId !== selectedTargetId ? hoveredTargetId : null);
  }

  function scheduleOverlayRender() {
    if (overlayFrameRequest !== null) {
      return;
    }
    overlayFrameRequest = window.requestAnimationFrame(() => {
      overlayFrameRequest = null;
      renderActiveOverlays();
    });
  }

  function applyPreviewStyle(id, styles) {
    const element = elementForTargetId(id);
    if (!element || !styles || typeof styles !== 'object' || Array.isArray(styles)) {
      return;
    }
    if (previewStyleState && previewStyleState.id !== id) {
      resetPreviewStyle(previewStyleState.id);
    }
    if (!previewStyleState || previewStyleState.id !== id) {
      previewStyleState = { id, originalInlineStyles: {} };
    }
    Object.keys(styles).forEach((name) => {
      const value = styles[name];
      if (typeof value !== 'string') {
        return;
      }
      if (!(name in previewStyleState.originalInlineStyles)) {
        previewStyleState.originalInlineStyles[name] = element.style.getPropertyValue(name);
      }
      if (value === '') {
        element.style.removeProperty(name);
      } else {
        element.style.setProperty(name, value);
      }
    });
    postMessage({ type: 'vd-edit-preview-style-applied', id });
  }

  function applyPreviewText(id, value) {
    const element = elementForTargetId(id);
    if (!element || typeof value !== 'string') {
      return;
    }
    if (previewTextState && previewTextState.id !== id) {
      resetPreviewText(previewTextState.id);
    }
    if (!Object.prototype.hasOwnProperty.call(element, previewTextOriginalKey)) {
      element[previewTextOriginalKey] = element.textContent || '';
    }
    if (!previewTextState || previewTextState.id !== id) {
      previewTextState = { id, element };
    }
    element.textContent = value;
    emitTargets();
    scheduleOverlayRender();
  }

  function resetPreviewText(id) {
    if (!previewTextState || previewTextState.id !== id) {
      return;
    }
    const element = previewTextState.element && previewTextState.element.isConnected
      ? previewTextState.element
      : elementForTargetId(id);
    if (element) {
      element.textContent = typeof element[previewTextOriginalKey] === 'string'
        ? element[previewTextOriginalKey]
        : '';
      emitTargets();
      scheduleOverlayRender();
    }
    previewTextState = null;
  }

  function resetPreviewStyle(id) {
    if (!previewStyleState || previewStyleState.id !== id) {
      return;
    }
    const element = elementForTargetId(id);
    if (element) {
      Object.keys(previewStyleState.originalInlineStyles).forEach((name) => {
        const originalValue = previewStyleState.originalInlineStyles[name];
        if (originalValue) {
          element.style.setProperty(name, originalValue);
        } else {
          element.style.removeProperty(name);
        }
      });
    }
    previewStyleState = null;
    postMessage({ type: 'vd-edit-preview-style-applied', id });
  }

  function applyThemePreview(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', normalizedTheme);
    document.documentElement.classList.toggle('dark', normalizedTheme === 'dark');
  }

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'vd-edit-mode') {
      editModeEnabled = event.data.enabled === true;
      if (editModeEnabled) {
        emitTargets();
      }
      return;
    }
    if (event.data && event.data.type === 'vd-edit-selected-target') {
      setSelectedTarget(event.data.id);
      return;
    }
    if (event.data && event.data.type === 'vd-edit-hovered-target') {
      setHoveredTarget(event.data.id);
      return;
    }
    if (event.data && event.data.type === 'vd-edit-preview-style') {
      applyPreviewStyle(event.data.id, event.data.styles);
      return;
    }
    if (event.data && event.data.type === 'vd-edit-preview-style-reset') {
      resetPreviewStyle(event.data.id);
      return;
    }
    if (event.data && event.data.type === 'vd-edit-preview-text') {
      applyPreviewText(event.data.id, event.data.value);
      return;
    }
    if (event.data && event.data.type === 'vd-edit-preview-text-reset') {
      resetPreviewText(event.data.id);
      return;
    }
    if (event.data && event.data.type === 'vd-edit-theme') {
      applyThemePreview(event.data.theme);
    }
  });
  document.addEventListener('mouseover', emitHover, true);
  document.addEventListener('mousemove', emitHover, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('dblclick', startTextEdit, true);
  document.addEventListener('keydown', handleTextEditKeydown, true);
  window.addEventListener('resize', scheduleOverlayRender);
  window.addEventListener('scroll', scheduleOverlayRender, true);
  nativeInteractionBlockEvents.forEach((eventName) => {
    document.addEventListener(eventName, blockNativeInteraction, true);
  });

  if (editModeEnabled) {
    emitTargets();
  }
})();</script>`;
}

function elementTypeIndex(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;

  while (sibling) {
    if (!isCanvasEditHostNode(sibling) && sibling.localName === element.localName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }

  return index;
}
