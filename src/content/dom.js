'use strict';
// Small DOM helpers shared by the content-script modules.

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function theme() {
  let node = document.body;
  while (node) {
    const c = getComputedStyle(node).backgroundColor;
    const m = c.match(/[\d.]+/g);
    if (m && m.length >= 3 && (m.length < 4 || +m[3] > 0)) return +m[0] * .299 + +m[1] * .587 + +m[2] * .114 < 128 ? 'dark' : 'light';
    node = node.parentElement;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function owned(node) {
  const n = node.nodeType === 1 ? node : node.parentElement;
  return !!n?.closest?.('.xp-badge,.xp-badge-line,.xp-post-badge,#xp-inline-tip,#xp-inline-hud');
}

module.exports = { el, theme, owned };
