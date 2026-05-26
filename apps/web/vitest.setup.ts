if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => {},
  });
}
