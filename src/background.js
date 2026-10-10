'use strict';
// Service worker: install cleanup + serialized favorites writes.
// Serves as the single write entry so multiple tabs cannot race each other (D5).

const favorites = require('./shared/favorites.js');

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.alarms?.clear) chrome.alarms.clear('x-pulse-poll').catch(() => {});
  chrome.storage.local.remove('monitor');
});

let queue = Promise.resolve();
const MUTATING = new Set(['save', 'update', 'delete']);

function enqueue(task) {
  const p = queue.then(task);
  queue = p.then(() => undefined, () => undefined);
  return p;
}

function dispatch(action, payload) {
  switch (action) {
    case 'list': return favorites.listFavorites();
    case 'get': return favorites.getFavorite(payload.key);
    case 'save': return favorites.saveFavorite(payload.favorite);
    case 'update': return favorites.updateFavorite(payload.key, payload.patch);
    case 'delete': return favorites.deleteFavorite(payload.key);
    case 'isFavorited': return favorites.isFavorited(payload.user);
    default: return Promise.reject(new Error('未知收藏操作'));
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'xp-favorite') return undefined;
  const task = () => dispatch(message.action, message.payload || {});
  const p = MUTATING.has(message.action) ? enqueue(task) : task();
  p.then(result => sendResponse({ ok: true, result }))
    .catch(err => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async response
});
