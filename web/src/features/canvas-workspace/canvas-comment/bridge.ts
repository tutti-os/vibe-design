import { CANVAS_EDIT_RUNTIME_ID_ATTR, CANVAS_EDIT_SOURCE_PATH_ATTR } from '../canvas-edit/bridge';

export const CANVAS_COMMENT_BRIDGE_ATTR = 'data-vd-comment-bridge';
export const CANVAS_COMMENT_TARGET_ID_ATTR = 'data-vd-id';
export const CANVAS_COMMENT_SOURCE_PATH_ATTR = CANVAS_EDIT_SOURCE_PATH_ATTR;
export const CANVAS_COMMENT_RUNTIME_ID_ATTR = CANVAS_EDIT_RUNTIME_ID_ATTR;
export const CANVAS_COMMENT_HOST_NODE_SELECTOR =
  `[${CANVAS_COMMENT_BRIDGE_ATTR}],[data-vd-comment-owned],[data-vd-comment-pod-layer],[data-vd-preview-size-bridge],[data-vd-preview-scrollbar],[data-vd-edit-overlay-layer],[data-vd-edit-overlay]`;
export const CANVAS_COMMENT_EXCLUDED_TARGET_SELECTOR = 'script,style,meta,link,title,head,noscript,template';

export function buildCanvasCommentBridge(enabled: boolean): string {
  return `<script ${CANVAS_COMMENT_BRIDGE_ATTR}>(() => {
  const targetIdAttr = 'data-vd-id';
  const sourcePathAttr = 'data-vd-source-path';
  const runtimeIdAttr = 'data-vd-runtime-id';
  const commentBridgeAttr = 'data-vd-comment-bridge';
  const commentOwnedAttr = 'data-vd-comment-owned';
  const podLayerSelector = '[data-vd-comment-pod-layer]';
  const hostSelector = '[' + commentBridgeAttr + '],[' + commentOwnedAttr + '],' + podLayerSelector + ',[data-vd-preview-size-bridge],[data-vd-preview-scrollbar],[data-vd-edit-overlay-layer],[data-vd-edit-overlay]';
  const excludedTargetSelector = 'script,style,meta,link,title,head,noscript,template';
  const maxTargetCount = 500;
  const maxCandidateScanCount = 2500;
  let commentModeEnabled = ${JSON.stringify(enabled)};
  let commentMode = 'picker';
  let activeTargetId = null;
  let activeSelector = null;
  let hoverTargetId = null;
  let activeStroke = null;
  let strokeLayer = null;
  let strokePath = null;
  let strokeBox = null;
  let pickerDragStart = null;
  let suppressNextPickerClick = false;
  let targetFrameRequest = null;
  const pickerDragThreshold = 4;

  function postMessage(message) {
    window.parent.postMessage(message, '*');
  }

  function isHostNode(element) {
    return element.matches(hostSelector) || !!element.closest(podLayerSelector);
  }

  function isEligibleTargetNode(element) {
    return !isHostNode(element) && !element.matches(excludedTargetSelector) && isVisibleTargetNode(element);
  }

  function isVisibleTargetNode(element) {
    if (element.hasAttribute('hidden')) {
      return false;
    }
    const computedStyle = window.getComputedStyle(element);
    if (
      computedStyle.display === 'none'
      || computedStyle.visibility === 'hidden'
      || computedStyle.visibility === 'collapse'
      || computedStyle.opacity === '0'
    ) {
      return false;
    }
    let ancestor = element.parentElement;
    while (ancestor) {
      if (ancestor.hasAttribute('hidden')) {
        return false;
      }
      const ancestorStyle = window.getComputedStyle(ancestor);
      if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || ancestorStyle.visibility === 'collapse') {
        return false;
      }
      ancestor = ancestor.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || (element.textContent || '').trim().length > 0;
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
    const explicitId = element.getAttribute(targetIdAttr);
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

  function cssIdent(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/(^-?\\d)|[^a-zA-Z0-9_-]/g, (match, leadingDigit) => {
      if (leadingDigit) {
        const prefix = match.startsWith('-') ? '-' : '';
        const digit = match.startsWith('-') ? match.slice(1) : match;
        return prefix + '\\\\' + digit.charCodeAt(0).toString(16) + ' ';
      }
      return '\\\\' + match;
    });
  }

  function classListForElement(element) {
    return Array.from(element.classList || []);
  }

  function selectorForElement(element) {
    const tagName = element.localName.toLowerCase();
    const elementId = element.getAttribute('id');
    const idSelector = elementId && elementId.trim() ? '#' + cssIdent(elementId.trim()) : '';
    const classSelector = classListForElement(element).map((className) => '.' + cssIdent(className)).join('');
    return tagName + idSelector + classSelector;
  }

  function labelForElement(element) {
    const text = (element.textContent || '').trim().replace(/\\s+/g, ' ');
    const ariaLabel = element.getAttribute('aria-label');
    const alt = element.getAttribute('alt');
    const title = element.getAttribute('title');
    const label = text || ariaLabel || alt || title || element.localName.toLowerCase();
    return label.slice(0, 80);
  }

  function textForElement(element) {
    return (element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
  }

  function cleanHtmlHintNode(element) {
    element.removeAttribute(runtimeIdAttr);
    Array.from(element.querySelectorAll('[' + runtimeIdAttr + ']')).forEach((child) => {
      child.removeAttribute(runtimeIdAttr);
    });
  }

  function htmlHintForElement(element) {
    const clone = element.cloneNode(true);
    if (!(clone instanceof Element)) {
      return (element.outerHTML || '').slice(0, 240);
    }
    cleanHtmlHintNode(clone);
    return (clone.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 240);
  }

  function positionForElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: roundNumber(rect.x + pageScrollX()),
      y: roundNumber(rect.y + pageScrollY()),
      width: roundNumber(rect.width),
      height: roundNumber(rect.height)
    };
  }

  function pageScrollX() {
    return window.scrollX || window.pageXOffset || 0;
  }

  function pageScrollY() {
    return window.scrollY || window.pageYOffset || 0;
  }

  function roundNumber(value) {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  function pointFromEvent(event) {
    return {
      x: roundNumber(event.clientX + pageScrollX()),
      y: roundNumber(event.clientY + pageScrollY())
    };
  }

  function styleForElement(element) {
    const computedStyle = window.getComputedStyle(element);
    const style = {};
    [
      'color',
      'backgroundColor',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'textAlign',
      'fontFamily',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderRadius'
    ].forEach((name) => {
      const value = computedStyle[name];
      if (value) {
        style[name] = value;
      }
    });
    return style;
  }

  function targetSnapshotForElement(element, hoverPoint) {
    const snapshot = {
      targetId: stableIdForElement(element),
      selector: selectorForElement(element),
      label: labelForElement(element),
      text: textForElement(element),
      position: positionForElement(element),
      htmlHint: htmlHintForElement(element),
      style: styleForElement(element)
    };
    if (hoverPoint) {
      snapshot.hoverPoint = hoverPoint;
    }
    return snapshot;
  }

  function candidateTreeWalker() {
    const root = document.body || document.documentElement;
    if (!root) {
      return null;
    }
    return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  }

  function allTargets() {
    const targets = [];
    const walker = candidateTreeWalker();
    let scannedCount = 0;
    if (!walker) {
      return targets;
    }
    while (targets.length < maxTargetCount && scannedCount < maxCandidateScanCount) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }
      scannedCount += 1;
      if (!(node instanceof Element) || isHostNode(node) || node.matches(excludedTargetSelector)) {
        continue;
      }
      if (!isVisibleTargetNode(node)) {
        continue;
      }
      targets.push(targetSnapshotForElement(node));
    }
    return targets;
  }

  function emitTargets() {
    if (!commentModeEnabled) {
      return;
    }
    postMessage({ type: 'vd-comment-targets', targets: allTargets() });
  }

  function scheduleTargets() {
    if (!commentModeEnabled || targetFrameRequest !== null) {
      return;
    }
    targetFrameRequest = window.requestAnimationFrame(() => {
      targetFrameRequest = null;
      emitTargets();
    });
  }

  function scheduleTargetsFromMutations(records) {
    if (
      records
      && records.length > 0
      && records.every(isIgnoredMutationRecord)
    ) {
      return;
    }
    scheduleTargets();
  }

  function isIgnoredMutationRecord(record) {
    if (record.type === 'attributes') {
      return record.attributeName === runtimeIdAttr || isBridgeOwnedNode(record.target);
    }
    if (record.type === 'childList') {
      const addedNodes = Array.from(record.addedNodes || []);
      const removedNodes = Array.from(record.removedNodes || []);
      const changedNodes = addedNodes.concat(removedNodes);
      return changedNodes.length > 0 && changedNodes.every(isBridgeOwnedNode);
    }
    return false;
  }

  function isBridgeOwnedNode(node) {
    if (!(node instanceof Element)) {
      return false;
    }
    return isHostNode(node);
  }

  function findCandidateElement(predicate) {
    const walker = candidateTreeWalker();
    let scannedCount = 0;
    if (!walker) {
      return null;
    }
    while (scannedCount < maxCandidateScanCount) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }
      scannedCount += 1;
      if (!(node instanceof Element) || isHostNode(node) || node.matches(excludedTargetSelector)) {
        continue;
      }
      if (!isVisibleTargetNode(node)) {
        continue;
      }
      if (predicate(node)) {
        return node;
      }
    }
    return null;
  }

  function targetElementFromEvent(event) {
    if (!commentModeEnabled || !(event.target instanceof Element)) {
      return null;
    }
    const element = event.target.closest('body *');
    if (!element || !isEligibleTargetNode(element)) {
      return null;
    }
    return element;
  }

  function elementMatchesTargetId(element, id) {
    return element.getAttribute(targetIdAttr) === id
      || element.getAttribute(sourcePathAttr) === id
      || element.getAttribute(runtimeIdAttr) === id
      || element.getAttribute('id') === id
      || (typeof id === 'string' && id.includes('>') && stableIdForElement(element) === id);
  }

  function elementForTargetId(id) {
    if (!id || typeof id !== 'string') {
      return null;
    }
    return findCandidateElement((element) => elementMatchesTargetId(element, id));
  }

  function elementForSelector(selector) {
    if (!selector || typeof selector !== 'string') {
      return null;
    }
    try {
      const element = document.querySelector(selector);
      return element && isEligibleTargetNode(element) ? element : null;
    } catch (_) {
      return null;
    }
  }

  function emitHover(event) {
    if (commentMode !== 'picker') {
      return;
    }
    const element = targetElementFromEvent(event);
    if (!element) {
      return;
    }
    const target = targetSnapshotForElement(element, pointFromEvent(event));
    hoverTargetId = target.targetId;
    postMessage({ type: 'vd-comment-hover', target });
  }

  function emitLeave(event) {
    if (commentMode !== 'picker') {
      return;
    }
    const element = targetElementFromEvent(event);
    if (!element) {
      return;
    }
    const target = targetSnapshotForElement(element, pointFromEvent(event));
    if (hoverTargetId === target.targetId) {
      hoverTargetId = null;
    }
    postMessage({ type: 'vd-comment-leave', target });
  }

  function selectPickerTarget(event) {
    if (!commentModeEnabled) {
      return;
    }
    // While marking, every click is intercepted so the underlying HTML never runs its
    // native behavior (link navigation, button handlers, label/checkbox toggles, ...).
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (commentMode !== 'picker') {
      return;
    }
    if (suppressNextPickerClick) {
      suppressNextPickerClick = false;
      return;
    }
    const element = targetElementFromEvent(event);
    if (!element) {
      return;
    }
    const target = targetSnapshotForElement(element, pointFromEvent(event));
    activeTargetId = target.targetId;
    activeSelector = target.selector;
    postMessage({ type: 'vd-comment-select', target });
    postMessage({ type: 'vd-comment-active-target-update', targetId: activeTargetId, selector: activeSelector, target });
  }

  function pointDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function ensureStrokeLayer() {
    if (strokeLayer) {
      return strokeLayer;
    }
    strokeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    strokeLayer.setAttribute(commentOwnedAttr, 'pod-layer');
    strokeLayer.setAttribute('data-vd-comment-pod-layer', 'true');
    strokeLayer.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;overflow:visible;');
    document.body.appendChild(strokeLayer);
    return strokeLayer;
  }

  function drawStroke(points) {
    const layer = ensureStrokeLayer();
    if (strokeBox) {
      strokeBox.remove();
      strokeBox = null;
    }
    if (!strokePath) {
      strokePath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      strokePath.setAttribute(commentOwnedAttr, 'pod-path');
      strokePath.setAttribute('fill', 'none');
      strokePath.setAttribute('stroke', '#0f766e');
      strokePath.setAttribute('stroke-width', '3');
      strokePath.setAttribute('stroke-linecap', 'round');
      strokePath.setAttribute('stroke-linejoin', 'round');
      layer.appendChild(strokePath);
    }
    strokePath.setAttribute('points', points.map((point) => point.x + ',' + point.y).join(' '));
  }

  function drawSelectionBox(points) {
    if (!points || points.length < 2) {
      return;
    }
    const layer = ensureStrokeLayer();
    if (strokePath) {
      strokePath.remove();
      strokePath = null;
    }
    if (!strokeBox) {
      strokeBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      strokeBox.setAttribute(commentOwnedAttr, 'pod-box');
      strokeBox.setAttribute('fill', 'rgba(37, 99, 235, 0.12)');
      strokeBox.setAttribute('stroke', '#2563eb');
      strokeBox.setAttribute('stroke-width', '2');
      strokeBox.setAttribute('stroke-dasharray', '6 4');
      strokeBox.setAttribute('rx', '6');
      layer.appendChild(strokeBox);
    }
    const bounds = boundsForPoints(points);
    strokeBox.setAttribute('x', String(roundNumber(bounds.x)));
    strokeBox.setAttribute('y', String(roundNumber(bounds.y)));
    strokeBox.setAttribute('width', String(roundNumber(bounds.width)));
    strokeBox.setAttribute('height', String(roundNumber(bounds.height)));
  }

  function clearPodStroke() {
    activeStroke = null;
    strokePath = null;
    strokeBox = null;
    if (strokeLayer) {
      strokeLayer.remove();
      strokeLayer = null;
    }
    postMessage({ type: 'vd-comment-pod-clear' });
  }

  function podMembersForStroke(points) {
    if (!points || points.length === 0) {
      return [];
    }
    const bounds = boundsForPoints(points);
    const members = [];
    const walker = candidateTreeWalker();
    let scannedCount = 0;
    if (!walker) {
      return members;
    }
    while (members.length < 50 && scannedCount < maxCandidateScanCount) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }
      scannedCount += 1;
      if (!(node instanceof Element) || isHostNode(node) || node.matches(excludedTargetSelector)) {
        continue;
      }
      if (!isVisibleTargetNode(node) || !rectIntersectsBounds(node.getBoundingClientRect(), bounds)) {
        continue;
      }
      members.push(targetSnapshotForElement(node));
    }
    return members;
  }

  function boundsForPoints(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min.apply(null, xs);
    const right = Math.max.apply(null, xs);
    const top = Math.min.apply(null, ys);
    const bottom = Math.max.apply(null, ys);
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      left,
      right,
      top,
      bottom
    };
  }

  function rectIntersectsBounds(rect, bounds) {
    return rect.right >= bounds.left && rect.left <= bounds.right && rect.bottom >= bounds.top && rect.top <= bounds.bottom;
  }

  function podSnapshotForStroke(points) {
    const bounds = boundsForPoints(points);
    const podMembers = podMembersForStroke(points);
    const label = podMembers.length > 0 ? 'Pod: ' + podMembers.slice(0, 3).map((member) => member.label).join(', ') : 'Pod selection';
    return {
      selectionKind: 'pod',
      targetId: 'pod:' + points.map((point) => point.x + '-' + point.y).join('_'),
      selector: 'pod',
      label,
      text: podMembers.map((member) => member.text).filter(Boolean).join(' ').slice(0, 160),
      position: {
        x: roundNumber(bounds.x),
        y: roundNumber(bounds.y),
        width: roundNumber(bounds.width),
        height: roundNumber(bounds.height)
      },
      htmlHint: podMembers.map((member) => member.htmlHint).join(' ').slice(0, 240),
      memberCount: podMembers.length,
      podMembers
    };
  }

  function handlePodPointerDown(event) {
    if (!commentModeEnabled || (commentMode !== 'pod' && commentMode !== 'picker')) {
      return;
    }
    if (commentMode === 'picker') {
      if (!(event.target instanceof Element) || isHostNode(event.target)) {
        return;
      }
      pickerDragStart = pointFromEvent(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    clearPodStroke();
    activeStroke = [pointFromEvent(event)];
    drawStroke(activeStroke);
    postMessage({ type: 'vd-comment-pod-stroke', points: activeStroke.slice(), phase: 'start' });
  }

  function handlePodPointerMove(event) {
    if (!commentModeEnabled || (commentMode !== 'pod' && commentMode !== 'picker')) {
      return;
    }
    if (commentMode === 'picker') {
      if (!pickerDragStart && !activeStroke) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const point = pointFromEvent(event);
      if (!activeStroke) {
        if (!pickerDragStart || pointDistance(point, pickerDragStart) < pickerDragThreshold) {
          return;
        }
        clearPodStroke();
        activeStroke = [pickerDragStart, point];
        drawSelectionBox(activeStroke);
        postMessage({ type: 'vd-comment-pod-stroke', points: activeStroke.slice(), phase: 'start' });
        return;
      }
      activeStroke = [activeStroke[0], point];
      drawSelectionBox(activeStroke);
      postMessage({ type: 'vd-comment-pod-stroke', points: activeStroke.slice(), phase: 'move' });
      return;
    }
    if (!activeStroke) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    activeStroke.push(pointFromEvent(event));
    drawStroke(activeStroke);
    postMessage({ type: 'vd-comment-pod-stroke', points: activeStroke.slice(), phase: 'move' });
  }

  function handlePodPointerUp(event) {
    if (!commentModeEnabled || (commentMode !== 'pod' && commentMode !== 'picker')) {
      return;
    }
    if (commentMode === 'picker') {
      if (!activeStroke) {
        pickerDragStart = null;
        return;
      }
      suppressNextPickerClick = true;
    } else if (!activeStroke) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (commentMode === 'picker') {
      activeStroke = [activeStroke[0], pointFromEvent(event)];
      drawSelectionBox(activeStroke);
    } else {
      activeStroke.push(pointFromEvent(event));
      drawStroke(activeStroke);
    }
    const points = activeStroke.slice();
    const target = podSnapshotForStroke(points);
    activeTargetId = target.targetId;
    activeSelector = target.selector;
    postMessage({ type: 'vd-comment-pod-stroke', points, phase: 'end' });
    postMessage({ type: 'vd-comment-pod-select', target, points });
    postMessage({ type: 'vd-comment-active-target-update', targetId: activeTargetId, selector: activeSelector, target });
    activeStroke = null;
    pickerDragStart = null;
  }

  function setCommentMode(data) {
    commentModeEnabled = data.enabled === true;
    commentMode = data.mode === 'pod' ? 'pod' : 'picker';
    hoverTargetId = null;
    pickerDragStart = null;
    suppressNextPickerClick = false;
    if (!commentModeEnabled || commentMode !== 'pod') {
      clearPodStroke();
    }
    if (commentModeEnabled) {
      emitTargets();
    }
  }

  function setActiveTarget(data) {
    activeTargetId = typeof data.targetId === 'string' ? data.targetId : null;
    activeSelector = typeof data.selector === 'string' ? data.selector : null;
    const element = elementForTargetId(activeTargetId) || elementForSelector(activeSelector);
    const target = element ? targetSnapshotForElement(element) : null;
    postMessage({ type: 'vd-comment-active-target-update', targetId: activeTargetId, selector: activeSelector, target });
  }

  function blockNativeInteraction(event) {
    if (!commentModeEnabled) {
      return;
    }
    if (event.target instanceof Element && isHostNode(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'vd-comment-mode') {
      setCommentMode(event.data);
      return;
    }
    if (event.data && event.data.type === 'vd-comment-active-target') {
      setActiveTarget(event.data);
    }
  });
  // Suppress every native interaction the underlying HTML would otherwise perform while
  // marking: focusing/typing into fields, opening selects, submitting forms, dragging,
  // context menus and middle/secondary-button activation. Pointer/click/hover events are
  // handled by the picker + pod selection logic above, so they are intentionally excluded.
  [
    'mousedown',
    'mouseup',
    'dblclick',
    'auxclick',
    'contextmenu',
    'keydown',
    'keypress',
    'keyup',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'paste',
    'cut',
    'submit',
    'change',
    'reset',
    'dragstart',
    'dragover',
    'drop',
    'dragend',
  ].forEach((eventName) => {
    document.addEventListener(eventName, blockNativeInteraction, true);
  });
  document.addEventListener('mouseover', emitHover, true);
  document.addEventListener('mousemove', emitHover, true);
  document.addEventListener('mouseout', emitLeave, true);
  document.addEventListener('pointerdown', handlePodPointerDown, true);
  document.addEventListener('pointermove', handlePodPointerMove, true);
  document.addEventListener('pointerup', handlePodPointerUp, true);
  document.addEventListener('click', selectPickerTarget, true);
  window.addEventListener('resize', scheduleTargets);
  window.addEventListener('scroll', scheduleTargets, true);
  if (window.MutationObserver && document.documentElement) {
    new MutationObserver(scheduleTargetsFromMutations).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  }

  if (commentModeEnabled) {
    emitTargets();
  }
})();</script>`;
}
