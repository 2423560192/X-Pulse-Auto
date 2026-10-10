'use strict';
// Placement: reconciles each page container with its cached user, placing/removing badges.

function createLayout({ state, handle, store, badge, tooltip, el }) {
  function remove(rec) {
    if (state.tipBadge === rec.badge) tooltip.hide();
    rec.badge.remove();
    if (rec.line) rec.line.remove();
  }

  function headerRow(un) {
    const row = un.parentElement?.parentElement?.parentElement;
    const host = row?.parentElement;
    if (!row || !host) return null;
    const rs = getComputedStyle(row), hs = getComputedStyle(host);
    return rs.display === 'flex' && rs.flexDirection === 'row' && hs.flexDirection === 'column' ? row : null;
  }

  function placeBelow(anchor, badgeEl, isCell) {
    const row = !isCell && headerRow(anchor);
    const line = el('div', 'xp-badge-line');
    line.append(badgeEl);
    if (row) row.after(line); else anchor.after(line);
    return line;
  }

  function crowded(anchor, badgeEl) {
    if (anchor.scrollWidth > anchor.clientWidth + 1 && anchor.clientWidth > 0) return true;
    return [...anchor.querySelectorAll('*')].some(n => n !== badgeEl && !badgeEl.contains(n) && n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1);
  }

  function reconcile(container, anchor, isCell) {
    const h = handle.handleOf(container);
    const u = state.cache.get(h);
    const old = state.placed.get(container);
    // X virtualizes rows: a reused DOM element must not retain the previous user's count.
    if (!u || !anchor || !state.settings.enabled) {
      if (old) { remove(old); state.placed.delete(container); }
      return;
    }
    const compact = !!container.closest('[data-testid="sidebarColumn"]');
    const sig = store.signature(u, state.settings, compact);
    if (old && old.sig === sig && old.badge.isConnected && old.anchor === anchor) {
      if (state.tipBadge === old.badge) tooltip.show(old.badge);
      return;
    }
    if (old) remove(old);
    const badgeEl = badge.create(u, compact);
    let line = null;
    if (state.settings.layout === 'below') line = placeBelow(anchor, badgeEl, isCell);
    else { anchor.append(badgeEl); if (state.settings.layout === 'auto' && crowded(anchor, badgeEl)) line = placeBelow(anchor, badgeEl, isCell); }
    state.placed.set(container, { badge: badgeEl, line, sig, anchor });
  }

  function cellAnchor(cell) {
    const name = cell.querySelector('[data-testid="User-Name"]');
    if (name) return name;
    const h = handle.handleOf(cell);
    const link = [...cell.querySelectorAll('a[href]')].find(a => a.textContent.trim().toLowerCase() === '@' + h);
    // Append into the identity block, away from the Follow button and profile link itself.
    return link?.parentElement || null;
  }

  return { remove, reconcile, cellAnchor };
}

module.exports = createLayout;
