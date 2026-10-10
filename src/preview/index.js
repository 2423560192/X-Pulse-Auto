'use strict';
// Offline preview only. This module is not part of the shipped extension.

const version = require('../version.js');

const previewListeners = [];
let previewSettings = {};
window.chrome = {
  storage: {
    local: { get: async () => ({ xp_inline_settings: previewSettings }) },
    onChanged: { addListener: fn => previewListeners.push(fn) }
  },
  runtime: { onMessage: { addListener() {} } }
};

document.getElementById('theme').addEventListener('click', () => document.body.classList.toggle('dark'));
document.getElementById('format').addEventListener('change', e => {
  previewSettings = { format: e.target.value };
  for (const fn of previewListeners) fn({ xp_inline_settings: { newValue: previewSettings } }, 'local');
});

document.addEventListener('DOMContentLoaded', () => {
  const rows = [
    ['forest_demo', '林间笔记', 12984, 218, true, true],
    ['dev_demo', '独立开发日记', 9284, 156, false, true],
    ['notes_demo', '知识收藏家', 528000, 812, null, null],
    ['slow_demo', '慢慢积累', 862, 79, null, null],
    ['product_demo', '产品观察', 1530289, 264, null, null]
  ];
  const users = rows.map(([handle, name, count, following, followsYou, youFollow]) => ({
    __typename: 'User',
    core: { screen_name: handle, name, created_at: '2020-04-12T00:00:00Z' },
    relationship_counts: { followers: count, following },
    relationship_perspectives: { followed_by: followsYou, following: youFollow },
    tweet_counts: { tweets: 1324 }
  }));
  window.postMessage({ channel: 'x-pulse:response:v2', version, requestAt: Date.now(), bodyText: JSON.stringify({ data: users }) }, '*');
});

// Run the real content renderer against this preview page. Must come after the fake
// `chrome` above is installed so the content script can bind its storage/runtime listeners.
require('../content/index.js');
