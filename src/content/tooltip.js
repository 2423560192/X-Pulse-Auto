'use strict';
// Hover card: builds and positions the account detail tooltip.

function createTooltip({ state, presentation, el, theme }) {
  function hide() {
    if (state.tip) state.tip.hidden = true;
    state.tipBadge = null;
  }

  function detailRow(label, value) {
    const row = el('div', 'xp-tip-row');
    row.append(el('span', '', label), el('strong', '', value));
    return row;
  }

  function position(badge) {
    const r = badge.getBoundingClientRect();
    const w = state.tip.offsetWidth, h = state.tip.offsetHeight;
    state.tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    state.tip.style.top = Math.max(8, r.bottom + h + 8 < innerHeight ? r.bottom + 8 : r.top - h - 8) + 'px';
  }

  function show(badge) {
    if (!state.settings.hoverCard || !state.settings.enabled) return;
    const u = state.cache.get(badge.dataset.xpHandle);
    if (!u) return;
    state.tipBadge = badge;
    if (!state.tip) {
      state.tip = el('div', '');
      state.tip.id = 'xp-inline-tip';
      state.tip.setAttribute('role', 'tooltip');
      document.documentElement.append(state.tip);
    }
    state.tip.dataset.theme = theme();
    state.tip.replaceChildren();
    state.tip.append(
      el('div', 'xp-tip-kicker', 'X PULSE / ACCOUNT'),
      el('div', 'xp-tip-name', u.name || u.handle),
      el('div', 'xp-tip-handle', '@' + u.handle)
    );
    const big = el('div', 'xp-tip-count', presentation.format(u.count, 'exact'));
    big.append(el('span', '', ' 粉丝'));
    state.tip.append(big);
    if (u.following !== null) state.tip.append(detailRow('正在关注', presentation.format(u.following, 'exact')));
    if (u.posts !== null) state.tip.append(detailRow('发布数量', presentation.format(u.posts, 'exact')));
    if (u.following !== null && u.following > 0) state.tip.append(detailRow('粉丝 / 关注比', (u.count / u.following).toLocaleString('en-US', { maximumFractionDigits: 1 })));
    const rel = presentation.relation(u) || (u.youFollow ? '你关注了 TA' : '');
    if (rel) state.tip.append(detailRow('关注关系', rel));
    const created = new Date(u.createdAt);
    if (u.createdAt && Number.isFinite(+created)) state.tip.append(detailRow('加入 X', created.toLocaleDateString('zh-CN')));
    state.tip.append(el('div', 'xp-tip-note', '页面响应采集 · ' + new Date(u.at).toLocaleTimeString('zh-CN', { hour12: false }) + '\n非持续监控，人数以该次响应为准'));
    state.tip.hidden = false;
    position(badge);
  }

  return { hide, show };
}

module.exports = createTooltip;
