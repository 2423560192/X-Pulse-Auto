'use strict';
// Keep legacy badge settings and the account detail/favorite switches.

const legacy = require('./settings.js');

const DEFAULTS = {
  schemaVersion: 4,
  account: { showRatio: true, showAge: true, showTier: true },
  favorites: { enabled: true }
};

function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
function oneOf(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }

function config(input = {}) {
  const flat = legacy.settings(input); // legacy flat fields keep working unchanged

  const account = { ...DEFAULTS.account };
  const favorites = { ...DEFAULTS.favorites };

  if (input && typeof input === 'object') {
    if (input.account && typeof input.account === 'object') {
      account.showRatio = bool(input.account.showRatio, account.showRatio);
      account.showAge = bool(input.account.showAge, account.showAge);
      account.showTier = bool(input.account.showTier, account.showTier);
    }
    if (input.favorites && typeof input.favorites === 'object') {
      favorites.enabled = bool(input.favorites.enabled, favorites.enabled);
    }
  }

  return { ...flat, schemaVersion: DEFAULTS.schemaVersion, account, favorites };
}

module.exports = { defaults: DEFAULTS, config, bool, oneOf };
