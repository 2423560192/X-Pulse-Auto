'use strict';
// Account favorites + notes, persisted in chrome.storage.local.
// Async CRUD. Prefer a stable user id as the key; fall back to normalized handle.

const STORAGE_KEY = 'xp_v2_favorites';

function keyOf(user) {
  const id = user && (user.id || user.userId);
  if (id && typeof id === 'string' && id) return 'uid:' + id;
  if (user && typeof user.handle === 'string' && user.handle) return 'handle:' + user.handle;
  return null;
}

async function readAll() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function writeAll(list) {
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}

async function listFavorites() {
  return readAll();
}

async function getFavorite(key) {
  const all = await readAll();
  return all.find(f => f.key === key) || null;
}

async function saveFavorite(favorite) {
  const key = favorite.key || keyOf(favorite);
  if (!key) throw new Error('无法确定收藏键（缺少用户 ID 或 handle）');
  const all = await readAll();
  const existing = all.find(f => f.key === key);
  const now = Date.now();
  const record = {
    ...favorite,
    key,
    handle: favorite.handle || '',
    name: favorite.name || '',
    tags: Array.isArray(favorite.tags) ? favorite.tags : [],
    note: typeof favorite.note === 'string' ? favorite.note : '',
    addedAt: existing ? existing.addedAt : now,
    updatedAt: now
  };
  const next = existing ? all.map(f => (f.key === key ? record : f)) : [...all, record];
  await writeAll(next);
  return record;
}

async function updateFavorite(key, patch) {
  const all = await readAll();
  const existing = all.find(f => f.key === key);
  if (!existing) throw new Error('收藏不存在');
  const record = { ...existing, ...patch, key, updatedAt: Date.now() };
  await writeAll(all.map(f => (f.key === key ? record : f)));
  return record;
}

async function deleteFavorite(key) {
  const all = await readAll();
  const next = all.filter(f => f.key !== key);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

async function isFavorited(user) {
  const key = keyOf(user);
  if (!key) return false;
  return !!(await getFavorite(key));
}

function searchFavorites(list, query) {
  if (!Array.isArray(list)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(f => {
    const hay = [f.handle, f.name, f.note, ...(f.tags || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function sortFavorites(list, order = 'recent') {
  if (!Array.isArray(list)) return [];
  const copy = list.slice();
  if (order === 'name') copy.sort((a, b) => String(a.handle || '').localeCompare(String(b.handle || '')));
  else copy.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return copy;
}

function rpc(action, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'xp-favorite', action, payload }, response => {
      const err = chrome.runtime.lastError;
      if (err) { reject(new Error(err.message)); return; }
      if (response && response.ok) resolve(response.result);
      else reject(new Error((response && response.error) || '收藏操作失败'));
    });
  });
}

// Message-based client: routes writes through the background service worker (single writer).
const client = {
  list: () => rpc('list'),
  get: key => rpc('get', { key }),
  save: favorite => rpc('save', { favorite }),
  update: (key, patch) => rpc('update', { key, patch }),
  remove: key => rpc('delete', { key }),
  isFavorited: user => rpc('isFavorited', { user })
};

module.exports = { STORAGE_KEY, keyOf, listFavorites, getFavorite, saveFavorite, updateFavorite, deleteFavorite, isFavorited, searchFavorites, sortFavorites, client };
