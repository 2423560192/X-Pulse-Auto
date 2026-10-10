'use strict';
// Pure parsing/validation: no DOM, no storage, no side effects.
// Extracts and normalizes user records from X response payloads.

const reserved = new Set(['home','explore','notifications','messages','settings','search','i','compose','login','logout','signup','intent','tos','privacy']);

function normalizeHandle(input) {
  let value = String(input || '').trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      if (!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)) return '';
      value = u.pathname.split('/').filter(Boolean)[0] || '';
    } catch { return ''; }
  }
  value = value.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(value) && !reserved.has(value) ? value : '';
}

function safeAvatar(input) {
  try { const u = new URL(input); return u.protocol === 'https:' && u.hostname === 'pbs.twimg.com' ? u.href : ''; }
  catch { return ''; }
}

function readCount(value) {
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function extractUsers(json) {
  const queue = [json], found = new Map(), seen = new WeakSet();
  let examined = 0;
  while (queue.length && examined++ < 50000) {
    const node = queue.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const handle = normalizeHandle(node.core?.screen_name || node.legacy?.screen_name || node.screen_name || node.username);
    const followers = readCount(node.relationship_counts?.followers ?? node.relationship_counts?.followers_count ?? node.legacy?.followers_count ?? node.public_metrics?.followers_count ?? node.followers_count);
    if (handle && followers !== null) {
      const prior = found.get(handle);
      const nullableInt = readCount;
      const relationship = node.relationship_perspectives || node.legacy || {};
      const item = {
        handle, followers,
        id: String(node.rest_id || node.id_str || node.id || '').slice(0,40),
        name: String(node.core?.name || node.legacy?.name || node.name || handle).slice(0,100),
        avatar: safeAvatar(node.avatar?.image_url || node.legacy?.profile_image_url_https || node.profile_image_url_https || node.profile_image_url),
        following: nullableInt(node.relationship_counts?.following ?? node.relationship_counts?.following_count ?? node.legacy?.friends_count ?? node.public_metrics?.following_count ?? node.friends_count),
        posts: nullableInt(node.tweet_counts?.tweets ?? node.legacy?.statuses_count ?? node.public_metrics?.tweet_count),
        createdAt: String(node.core?.created_at || node.legacy?.created_at || '').slice(0,64),
        followsYou: typeof relationship.followed_by === 'boolean' ? relationship.followed_by : null,
        youFollow: typeof relationship.following === 'boolean' ? relationship.following : null
      };
      // A nested legacy object must not erase richer fields on its parent User.
      if (!prior) found.set(handle, item);
      else for (const [k, v] of Object.entries(item)) if ((prior[k] === null || prior[k] === '') && v !== null && v !== '') prior[k] = v;
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
  }
  return [...found.values()].slice(0,300);
}

function validateSample(sample, now = Date.now()) {
  if (!sample || typeof sample !== 'object' || !normalizeHandle(sample.handle)) return null;
  if (!Number.isSafeInteger(sample.followers) || sample.followers < 0) return null;
  if (!Number.isFinite(sample.observedAt) || sample.observedAt > now + 5000 || sample.observedAt < now - 3600000) return null;
  return {
    id: typeof sample.id === 'string' ? sample.id.slice(0, 40) : '',
    handle: normalizeHandle(sample.handle),
    followers: sample.followers,
    observedAt: sample.observedAt,
    name: String(sample.name || sample.handle).slice(0, 100),
    avatar: safeAvatar(sample.avatar)
  };
}

module.exports = { normalizeHandle, safeAvatar, readCount, extractUsers, validateSample };
