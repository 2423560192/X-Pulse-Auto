'use strict';
// Pure presentation helpers: number formatting, color tier, relationship label.

function format(n, mode = 'compact') {
  if (mode === 'exact' || n < 10000) return n.toLocaleString('en-US');
  // Floor avoids displaying 999,999 as 100万 or 99,999,999 as 1亿.
  const unit = n >= 1e8 ? 1e8 : 1e4, value = Math.floor(n / unit * 100) / 100;
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 }) + (unit === 1e8 ? '亿' : '万');
}

function tier(n) { return n >= 1e6 ? 4 : n >= 1e5 ? 3 : n >= 1e4 ? 2 : n >= 1e3 ? 1 : 0; }

function tierLabel(n) { return n >= 1e6 ? '百万粉' : n >= 1e5 ? '十万粉' : n >= 1e4 ? '万粉' : n >= 1e3 ? '千粉' : '未满千粉'; }

function relation(u) { return u.followsYou === true ? (u.youFollow === true ? '互关' : '关注了你') : ''; }

module.exports = { format, tier, tierLabel, relation };
