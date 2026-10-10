'use strict';
// Keyword / highlight rules: pure decision functions, no DOM, no storage.

const analytics = require('./analytics.js');

const MAX_KEYWORD_LENGTH = 60;

function normalizeKeyword(keyword) {
  if (typeof keyword !== 'string') return '';
  return keyword.trim().slice(0, MAX_KEYWORD_LENGTH);
}

function matchKeywords(text, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return [];
  const lower = String(text || '').toLowerCase();
  const matched = [];
  for (const kw of keywords) {
    const k = normalizeKeyword(kw);
    if (k && lower.includes(k.toLowerCase())) matched.push(k);
  }
  return matched;
}

// Priority: exclude (collapse) > include (highlight) > show.
function evaluateFilter(post, settings) {
  const filters = (settings && settings.filters) || {};
  const text = post && post.text;
  const exclude = matchKeywords(text, filters.excludeKeywords);
  if (exclude.length) return { action: 'collapse', matched: exclude };
  const include = matchKeywords(text, filters.includeKeywords);
  if (include.length) return { action: 'highlight', matched: include };
  return { action: 'show', matched: [] };
}

function evaluateHighlight(post, rules) {
  if (!rules || rules.enabled !== true) return { triggered: false, reason: 'disabled' };
  const metrics = post && post.metrics;
  const engagement = analytics.calculateEngagement(metrics);
  if (engagement === null) return { triggered: false, reason: 'unknown' };
  if (!Number.isSafeInteger(metrics.views) || metrics.views < rules.minViews) return { triggered: false, reason: 'below-min-views' };
  if (engagement < rules.threshold) return { triggered: false, reason: 'below-threshold' };
  return { triggered: true, reason: 'engagement', engagement, views: metrics.views };
}

module.exports = { normalizeKeyword, matchKeywords, evaluateFilter, evaluateHighlight };
