'use strict';
// V2 settings: legacy flat fields + nested groups, with type validation,
// clamping, keyword normalization, and old->new field migration.

const legacy = require('./settings.js');

const DEFAULTS = {
  schemaVersion: 2,
  account: { showFollowers: true, showRatio: true, showAge: true, showTier: true },
  post: { enabled: true, showEngagementRate: true, highlightHighEngagement: false, rateThreshold: 2, minViews: 1000 },
  filters: { enabled: false, mode: 'highlight', includeKeywords: [], excludeKeywords: [] },
  favorites: { enabled: true }
};

const MAX_KEYWORDS = 200;
const MAX_KEYWORD_LENGTH = 60;

function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
function number(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function oneOf(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function keywords(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const k = item.trim().slice(0, MAX_KEYWORD_LENGTH);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

function config(input = {}) {
  const flat = legacy.settings(input); // legacy flat fields keep working unchanged

  const account = { ...DEFAULTS.account };
  const post = { ...DEFAULTS.post };
  const filters = { ...DEFAULTS.filters };
  const favorites = { ...DEFAULTS.favorites };

  if (input && typeof input === 'object') {
    if (input.account && typeof input.account === 'object') {
      account.showFollowers = bool(input.account.showFollowers, account.showFollowers);
      account.showRatio = bool(input.account.showRatio, account.showRatio);
      account.showAge = bool(input.account.showAge, account.showAge);
      account.showTier = bool(input.account.showTier, account.showTier);
    }
    if (input.post && typeof input.post === 'object') {
      post.enabled = bool(input.post.enabled, post.enabled);
      post.showEngagementRate = bool(input.post.showEngagementRate, post.showEngagementRate);
      post.highlightHighEngagement = bool(input.post.highlightHighEngagement, post.highlightHighEngagement);
      post.rateThreshold = number(input.post.rateThreshold, post.rateThreshold, 0, 1000);
      post.minViews = number(input.post.minViews, post.minViews, 0, Number.MAX_SAFE_INTEGER);
    }
    if (input.filters && typeof input.filters === 'object') {
      filters.enabled = bool(input.filters.enabled, filters.enabled);
      filters.mode = oneOf(input.filters.mode, ['highlight', 'collapse'], filters.mode);
      filters.includeKeywords = keywords(input.filters.includeKeywords);
      filters.excludeKeywords = keywords(input.filters.excludeKeywords);
    }
    if (input.favorites && typeof input.favorites === 'object') {
      favorites.enabled = bool(input.favorites.enabled, favorites.enabled);
    }
  }

  return { ...flat, schemaVersion: DEFAULTS.schemaVersion, account, post, filters, favorites };
}

module.exports = { defaults: DEFAULTS, config, bool, number, oneOf, keywords };
