'use strict';
// Post badge / highlight / filter rendering.
// DOM attachment uses well-known X patterns with graceful fallback: when a post id
// cannot be resolved from an article, no badge is inserted (never show wrong data).

const analytics = require('../shared/analytics.js');

function getPostIdFromDOM(article) {
  if (!article || typeof article.querySelectorAll !== 'function') return '';
  for (const a of article.querySelectorAll('a[href]')) {
    const m = String(a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    if (m) return m[1].slice(0, 40);
  }
  return '';
}

function fmt(n) { return n === null ? '—' : n.toLocaleString('en-US'); }

function postBadgeText(post, settings) {
  const postCfg = (settings && settings.post) || {};
  const m = (post && post.metrics) || {};
  let text = '赞 ' + fmt(m.likes) + ' · 转 ' + fmt(m.reposts) + ' · 评 ' + fmt(m.replies) + ' · 看 ' + fmt(m.views);
  if (postCfg.showEngagementRate !== false) {
    const rate = analytics.calculateEngagement(m);
    if (rate !== null) text += ' · 互动 ' + rate.toFixed(2) + '%';
  }
  return text;
}

function renderPostBadge(article, post, settings, el) {
  if ((settings && settings.post && settings.post.enabled) === false) return null;
  const badge = el('span', 'xp-post-badge', postBadgeText(post, settings));
  badge.dataset.xpPostId = post.id;
  article.append(badge);
  return badge;
}

function hasClass(node, cls) { return (' ' + (node.className || '') + ' ').includes(' ' + cls + ' '); }
function addClass(node, cls) { if (!hasClass(node, cls)) node.className = ((node.className || '') + ' ' + cls).trim(); }
function removeClass(node, cls) { node.className = (' ' + (node.className || '') + ' ').replace(' ' + cls + ' ', ' ').trim(); }

function applyHighlight(article) { addClass(article, 'xp-highlight'); }
function clearHighlight(article) { removeClass(article, 'xp-highlight'); }

const collapseButtons = new WeakMap();

function applyCollapse(article, el) {
  addClass(article, 'xp-collapsed');
  if (collapseButtons.has(article)) return;
  const btn = el('button', 'xp-collapse-btn', '已折叠 · 展开');
  btn.type = 'button';
  btn.addEventListener('click', () => clearCollapse(article));
  article.append(btn);
  collapseButtons.set(article, btn);
}

function clearCollapse(article) {
  removeClass(article, 'xp-collapsed');
  const btn = collapseButtons.get(article);
  if (btn) { btn.remove(); collapseButtons.delete(article); }
}

module.exports = { getPostIdFromDOM, postBadgeText, renderPostBadge, applyHighlight, clearHighlight, applyCollapse, clearCollapse };
