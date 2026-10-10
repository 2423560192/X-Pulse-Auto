'use strict';
// Content-script entry / composition root. Owns the shared state and wires
// the cohesive modules together; no cross-module globals are used.

const version = require('../version.js');
const config = require('../shared/config.js');
const analytics = require('../shared/analytics.js');
const presentation = require('../shared/presentation.js');
const store = require('../shared/store.js');
const transport = require('../shared/transport.js');
const handle = require('../shared/handle.js');
const favorites = require('../shared/favorites.js');
const rules = require('../shared/rules.js');
const dom = require('./dom.js');
const renderer = require('./renderer.js');
const createTooltip = require('./tooltip.js');
const createBadge = require('./badge.js');
const createLayout = require('./layout.js');
const createObserver = require('./observer.js');
const createDiagnostics = require('./diagnostics.js');

const KEY = 'xp_inline_settings';

// Shared mutable state, owned by this composition root.
const state = {
  cache: new Map(),   // users by handle
  posts: new Map(),   // posts by id (in-memory only, never persisted)
  placed: new Map(),
  settings: config.config(),
  stats: { packets: 0, parsed: 0, accepted: 0, lastError: '', bridgeVersion: '', lastPacket: 0 },
  initialized: false,
  pending: [],
  timer: null,
  observer: null,
  tip: null,
  tipBadge: null,
  hud: null
};

const postPlaced = new Map();
const favoriteKeys = new Set();
const favorite = chrome.runtime?.sendMessage ? {
  keyOf: favorites.keyOf,
  isFavorited: u => favoriteKeys.has(favorites.keyOf(u)),
  toggle: async u => {
    const key = favorites.keyOf(u);
    if (!key) throw new Error('无法确定收藏键');
    if (favoriteKeys.has(key)) {
      await favorites.client.remove(key);
      favoriteKeys.delete(key);
    } else {
      const rec = await favorites.client.save({ userId: u.id, handle: u.handle, name: u.name });
      favoriteKeys.add(rec.key);
    }
  }
} : null;

const tooltip = createTooltip({ state, presentation, analytics, favorite, el: dom.el, theme: dom.theme });
const badge = createBadge({ state, presentation, tooltip, el: dom.el });
const layout = createLayout({ state, handle, store, badge, tooltip, el: dom.el });
const diagnostics = createDiagnostics({ state, version, el: dom.el });

function schedule() {
  if (state.initialized && !state.timer) state.timer = setTimeout(render, 120);
}

function render() {
  state.timer = null;
  if (!state.initialized || !document.documentElement) return;
  state.observer?.disconnect();
  try {
    for (const [container, rec] of state.placed) {
      if (!container.isConnected) { layout.remove(rec); state.placed.delete(container); }
    }
    if (!state.settings.enabled) {
      for (const rec of state.placed.values()) layout.remove(rec);
      state.placed.clear();
      tooltip.hide();
    } else {
      document.querySelectorAll('article[data-testid="tweet"] [data-testid="User-Name"]').forEach(un => layout.reconcile(un, un, false));
      document.querySelectorAll('[data-testid="UserCell"]').forEach(cell => layout.reconcile(cell, layout.cellAnchor(cell), true));
      reconcilePosts();
    }
    diagnostics.updateHud();
  } catch (error) {
    state.stats.lastError = '页面渲染：' + String(error.message || error).slice(0, 160);
  } finally {
    observer.observe();
  }
}

function applyPostDecision(article, post) {
  const postCfg = state.settings.post || {};
  if (postCfg.highlightHighEngagement) {
    const hl = rules.evaluateHighlight(post, { type: 'engagement', threshold: postCfg.rateThreshold, minViews: postCfg.minViews, enabled: true });
    if (hl.triggered) renderer.applyHighlight(article);
    else renderer.clearHighlight(article);
  } else renderer.clearHighlight(article);

  const filters = state.settings.filters || {};
  if (filters.enabled) {
    const decision = rules.evaluateFilter(post, state.settings);
    if (decision.action === 'collapse') renderer.applyCollapse(article, dom.el);
    else renderer.clearCollapse(article);
  } else renderer.clearCollapse(article);
}

function reconcilePosts() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  const seen = new Set();
  for (const article of articles) {
    seen.add(article);
    const id = renderer.getPostIdFromDOM(article);
    const post = id ? state.posts.get(id) : null;
    const old = postPlaced.get(article);
    if (!post) {
      if (old) { old.badge.remove(); postPlaced.delete(article); }
      renderer.clearHighlight(article);
      renderer.clearCollapse(article);
      continue;
    }
    if (old && old.id === post.id && old.badge.isConnected) {
      old.badge.textContent = renderer.postBadgeText(post, state.settings);
    } else {
      if (old) old.badge.remove();
      const badge = renderer.renderPostBadge(article, post, state.settings, dom.el);
      if (badge) postPlaced.set(article, { badge, id: post.id });
    }
    applyPostDecision(article, post);
  }
  for (const [article, rec] of postPlaced) {
    if (!seen.has(article) || !article.isConnected) { rec.badge.remove(); postPlaced.delete(article); }
  }
}

function consume(data) {
  if (!state.settings.enabled) return;
  state.stats.packets++;
  state.stats.lastPacket = Date.now();
  state.stats.bridgeVersion = String(data.version || 'unknown').slice(0, 24);
  try {
    const result = transport.receive(state.cache, data);
    state.stats.parsed += result.parsed;
    state.stats.accepted += result.accepted;
    for (const post of result.posts) state.posts.set(post.id, post);
    while (state.posts.size > 2000) state.posts.delete(state.posts.keys().next().value);
    state.stats.lastError = '';
  } catch (error) {
    state.stats.lastError = String(error.message || error).slice(0, 200);
  }
  schedule();
}

function handleMessage(event) {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'x-pulse:response:v2') return;
  if (!state.initialized) {
    if (state.pending.length >= 10) state.pending.shift();
    state.pending.push(event.data);
    return;
  }
  consume(event.data);
}

const observer = createObserver({ state, owned: dom.owned, schedule });

window.addEventListener('message', handleMessage);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY]) {
    state.settings = config.config(changes[KEY].newValue);
    if (!state.settings.enabled) state.pending.length = 0;
    tooltip.hide();
    schedule();
  }
});

chrome.runtime.onMessage.addListener((message, _, reply) => {
  if (message?.type === 'xp-status') reply(diagnostics.statusReply());
});

chrome.storage.local.get(KEY).then(data => {
  state.settings = config.config(data[KEY]);
  state.initialized = true;
  if (favorite) {
    favorites.client.list().then(list => { for (const f of list) favoriteKeys.add(f.key); }).catch(() => {});
  }
  while (state.pending.length) consume(state.pending.shift());
  schedule();
}).catch(() => {
  state.initialized = true;
  schedule();
});

if (document.documentElement) observer.mount();
else document.addEventListener('DOMContentLoaded', observer.mount, { once: true });

window.addEventListener('scroll', () => tooltip.hide(), { passive: true, capture: true });

let resizeTimer;
window.addEventListener('resize', () => {
  tooltip.hide();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const rec of state.placed.values()) layout.remove(rec);
    state.placed.clear();
    schedule();
  }, 180);
});
