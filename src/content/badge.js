'use strict';
// Badge element: builds the follower-count badge and wires its tooltip/focus handlers.

function createBadge({ state, presentation, tooltip, el }) {
  function create(user, compact) {
    const badge = el('span', 'xp-badge');
    badge.dataset.xpHandle = user.handle;
    badge.tabIndex = 0;
    badge.setAttribute('role', 'note');
    badge.setAttribute('aria-label', '@' + user.handle + '，' + presentation.format(user.followers, 'exact') + ' 位粉丝');
    badge.setAttribute('aria-describedby', 'xp-inline-tip');
    const main = el('span', 'xp-count' + (state.settings.tierColors ? ' xp-tier-' + presentation.tier(user.followers) : ''));
    main.append(el('span', 'xp-people'), document.createTextNode(presentation.format(user.followers, state.settings.format)), el('span', 'xp-unit', '粉丝'));
    badge.append(main);
    const rel = presentation.relation(user);
    if (state.settings.showRelation && !compact && rel) badge.append(el('span', 'xp-relation', rel));
    for (const type of ['mouseover', 'mouseout', 'pointerover', 'pointerout', 'mousemove', 'pointermove']) badge.addEventListener(type, e => e.stopPropagation());
    badge.addEventListener('mouseenter', () => tooltip.show(badge));
    badge.addEventListener('mouseleave', () => tooltip.hide());
    badge.addEventListener('focus', () => tooltip.show(badge));
    badge.addEventListener('blur', () => tooltip.hide());
    badge.addEventListener('keydown', e => { if (e.key === 'Escape') { tooltip.hide(); e.stopPropagation(); } });
    badge.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); tooltip.show(badge); });
    return badge;
  }

  return { create };
}

module.exports = createBadge;
