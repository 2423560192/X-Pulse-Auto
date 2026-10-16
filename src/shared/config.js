'use strict';
// Keep legacy badge settings and the account detail/favorite switches.

const legacy = require('./settings.js');

const DEFAULTS = {
  schemaVersion: 3,
  account: { showRatio: true, showAge: true, showTier: true },
  favorites: { enabled: true },
  opportunity: { badgeLevel: 'high' }
};

function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
function oneOf(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }

function config(input = {}) {
  const flat = legacy.settings(input); // legacy flat fields keep working unchanged

  const account = { ...DEFAULTS.account };
  const favorites = { ...DEFAULTS.favorites };
  const opportunity = { ...DEFAULTS.opportunity };

  if (input && typeof input === 'object') {
    if (input.account && typeof input.account === 'object') {
      account.showRatio = bool(input.account.showRatio, account.showRatio);
      account.showAge = bool(input.account.showAge, account.showAge);
      account.showTier = bool(input.account.showTier, account.showTier);
    }
    if (input.favorites && typeof input.favorites === 'object') {
      favorites.enabled = bool(input.favorites.enabled, favorites.enabled);
    }
    if (input.opportunity && typeof input.opportunity === 'object') {
      opportunity.badgeLevel = oneOf(input.opportunity.badgeLevel, ['all', 'medium', 'high'], opportunity.badgeLevel);
    }
  }

  return { ...flat, schemaVersion: DEFAULTS.schemaVersion, account, favorites, opportunity };
}

module.exports = { defaults: DEFAULTS, config, bool, oneOf };
