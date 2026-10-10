'use strict';
// Service worker: only cleans up the former monitor alarm on upgrade.
// v1.1 never opens or reloads tabs.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.alarms?.clear) chrome.alarms.clear('x-pulse-poll').catch(() => {});
  chrome.storage.local.remove('monitor');
});
