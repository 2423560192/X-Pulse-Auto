'use strict';
// In-memory user-record store: sanitize a record, merge batches into a cache,
// and compute a render signature for change detection.

const core = require('./core.js');
const { settings } = require('./settings.js');

function sanitize(u, at, now = Date.now()) {
  const base = core.validateSample({ ...u, at }, now);
  if (!base) return null;
  const num = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
  return {
    ...base,
    following: num(u.following),
    posts: num(u.posts),
    createdAt: typeof u.createdAt === 'string' ? u.createdAt.slice(0,64) : '',
    followsYou: typeof u.followsYou === 'boolean' ? u.followsYou : null,
    youFollow: typeof u.youFollow === 'boolean' ? u.youFollow : null
  };
}

function accept(cache, batch, at, now = Date.now()) {
  if (!Array.isArray(batch) || batch.length > 300) return 0;
  let changed = 0;
  for (const raw of batch) {
    const u = sanitize(raw, at, now);
    if (!u) continue;
    const old = cache.get(u.handle);
    if (old && old.at >= u.at) continue;
    cache.delete(u.handle);
    cache.set(u.handle, u);
    changed++;
  }
  while (cache.size > 3000) cache.delete(cache.keys().next().value);
  return changed;
}

function signature(u, s, compact) {
  return JSON.stringify([u.handle, u.count, u.following, u.posts, u.followsYou, u.youFollow, settings(s), !!compact]);
}

module.exports = { sanitize, accept, signature };
