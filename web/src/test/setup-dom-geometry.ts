function emptyClientRects(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as DOMRectList;
}

function zeroClientRect(): DOMRect {
  return new DOMRect(0, 0, 0, 0);
}

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = emptyClientRects;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = zeroClientRect;
  }
}

if (typeof Node !== 'undefined') {
  if (!('getClientRects' in Node.prototype)) {
    Object.defineProperty(Node.prototype, 'getClientRects', {
      configurable: true,
      value: emptyClientRects,
    });
  }
  if (!('getBoundingClientRect' in Node.prototype)) {
    Object.defineProperty(Node.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: zeroClientRect,
    });
  }
}
