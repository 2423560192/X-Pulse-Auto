'use strict';
// Service worker: install cleanup + serialized favorites writes.
// Serves as the single write entry so multiple tabs cannot race each other (D5).

const favorites = require('./shared/favorites.js');
const opportunities = require('./shared/opportunity-store.js');
const aiClient = require('./shared/ai-client.js');

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

async function dispatchOpportunity(action, payload) {
  switch (action) {
    case 'config': return opportunities.getConfig();
    case 'saveAI': return opportunities.saveAI(payload.ai);
    case 'ready': { await opportunities.ready(); return true; }
    case 'testAI': {
      const ai = (await chrome.storage.local.get(opportunities.KEYS.ai))[opportunities.KEYS.ai];
      if (!ai?.apiKey) throw new Error('请先保存 AI 设置');
      const granted = await chrome.permissions.contains({ origins: [aiClient.originPattern(ai.baseUrl)] });
      if (!granted) throw new Error('未获得 AI 服务域名权限');
      await aiClient.testConnection(ai);
      await opportunities.markVerified();
      return true;
    }
    case 'list': return opportunities.list();
    case 'pool': return opportunities.pool();
    case 'addToPool': return opportunities.addToPool(payload.id);
    case 'update': return opportunities.update(payload.id, payload.patch || {});
    case 'remove': return opportunities.remove(payload.id);
    case 'analyze': {
      const { ai } = await opportunities.ready();
      const granted = await chrome.permissions.contains({ origins: [aiClient.originPattern(ai.baseUrl)] });
      if (!granted) throw new Error('AI 服务域名权限已失效，请重新测试连接');
      return opportunities.analyzeBatch(payload.items);
    }
    default: throw new Error('未知需求机会操作');
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'xp-opportunity') return undefined;
  const task = () => dispatchOpportunity(message.action, message.payload || {});
  const p = ['saveAI', 'testAI', 'addToPool', 'update', 'remove', 'analyze'].includes(message.action) ? enqueue(task) : task();
  p.then(result => sendResponse({ ok: true, result }))
    .catch(err => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
