'use strict';
// Content-script entry / composition root. Owns the shared state and wires
// the cohesive modules together; no cross-module globals are used.

const version = require('../version.js');
const settingsApi = require('../shared/settings.js');
const presentation = require('../shared/presentation.js');
const store = require('../shared/store.js');
const transport = require('../shared/transport.js');
const handle = require('../shared/handle.js');
const dom = require('./dom.js');
const createTooltip = require('./tooltip.js');
const createBadge = require('./badge.js');
const createLayout = require('./layout.js');
const createObserver = require('./observer.js');
const createDiagnostics = require('./diagnostics.js');

const KEY = 'xp_inline_settings';

// Shared mutable state, owned by this composition root.
const state = {
  cache: new Map(),
  placed: new Map(),
  settings: settingsApi.settings(),
  stats: { packets: 0, parsed: 0, accepted: 0, lastError: '', bridgeVersion: '', lastPacket: 0 },
  initialized: false,
  pending: [],
  timer: null,
  observer: null,
  tip: null,
  tipBadge: null,
  hud: null
};

const tooltip = createTooltip({ state, presentation, el: dom.el, theme: dom.theme });
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
    }
    diagnostics.updateHud();
  } catch (error) {
    state.stats.lastError = '页面渲染：' + String(error.message || error).slice(0, 160);
  } finally {
    observer.observe();
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
    state.settings = settingsApi.settings(changes[KEY].newValue);
    if (!state.settings.enabled) state.pending.length = 0;
    tooltip.hide();
    schedule();
  }
});

chrome.runtime.onMessage.addListener((message, _, reply) => {
  if (message?.type === 'xp-status') reply(diagnostics.statusReply());
});

chrome.storage.local.get(KEY).then(data => {
  state.settings = settingsApi.settings(data[KEY]);
  state.initialized = true;
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
