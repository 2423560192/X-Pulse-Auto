'use strict';
// Hover card: builds and positions the account detail tooltip.

function createTooltip({ state, presentation, analytics, favorite, el, theme }) {
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

  function accountAgeLabel(age) {
    if (age.years > 0) return age.years + '年' + (age.months > 0 ? age.months + '个月' : '');
    return age.months + '个月';
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
    const big = el('div', 'xp-tip-count', presentation.format(u.followers, 'exact'));
    big.append(el('span', '', ' 粉丝'));
    state.tip.append(big);

    const account = state.settings.account || {};
    if (account.showTier && u.followers !== null) state.tip.append(detailRow('粉丝档位', presentation.tierLabel(u.followers)));
    if (u.following !== null) state.tip.append(detailRow('正在关注', presentation.format(u.following, 'exact')));
    if (u.posts !== null) state.tip.append(detailRow('发布数量', presentation.format(u.posts, 'exact')));
    if (account.showRatio) {
      const ratio = analytics.getFollowerRatio(u);
      if (ratio !== null) state.tip.append(detailRow('粉丝 / 关注比', ratio.toLocaleString('en-US', { maximumFractionDigits: 1 })));
    }
    if (account.showAge) {
      const age = analytics.getAccountAge(u);
      if (age !== null) state.tip.append(detailRow('账号年龄', accountAgeLabel(age)));
    }
    const rel = presentation.relation(u) || (u.youFollow ? '你关注了 TA' : '');
    if (rel) state.tip.append(detailRow('关注关系', rel));
    const created = new Date(u.createdAt);
    if (u.createdAt && Number.isFinite(+created)) state.tip.append(detailRow('加入 X', created.toLocaleDateString('zh-CN')));

    // Favorite toggle (XP-07). Only rendered when the message client is available.
    if (favorite && state.settings.favorites?.enabled && favorite.keyOf(u)) {
      const btn = el('button', 'xp-fav-btn', favorite.isFavorited(u) ? '取消收藏' : '收藏');
      btn.type = 'button';
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        btn.disabled = true;
        try {
          await favorite.toggle(u);
          btn.textContent = favorite.isFavorited(u) ? '取消收藏' : '收藏';
        } catch (err) {
          btn.textContent = '操作失败';
        } finally {
          btn.disabled = false;
        }
      });
      state.tip.append(btn);
    }

    state.tip.append(el('div', 'xp-tip-note', '页面响应采集 · ' + new Date(u.observedAt).toLocaleTimeString('zh-CN', { hour12: false }) + '\n非持续监控，人数以该次响应为准'));
    state.tip.hidden = false;
    position(badge);
  }

  return { hide, show };
}

module.exports = createTooltip;
