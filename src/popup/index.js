'use strict';
// Settings panel: renders controls, persists changes, and polls the active tab's status.

const version = require('../version.js');
const settingsApi = require('../shared/settings.js');

const KEY = 'xp_inline_settings';
let cfg = settingsApi.settings();
const error = document.getElementById('error');

function paint() {
  for (const input of document.querySelectorAll('[data-key]')) {
    if (input.type === 'checkbox') input.checked = cfg[input.dataset.key];
    else input.value = cfg[input.dataset.key];
  }
  document.getElementById('status').textContent = cfg.enabled ? '自动显示已开启' : '自动显示已暂停';
}

chrome.storage.local.get(KEY).then(data => {
  cfg = settingsApi.settings(data[KEY]);
  paint();
}).catch(e => { error.textContent = e.message; });

document.addEventListener('change', async e => {
  const input = e.target;
  if (!input.dataset.key) return;
  cfg[input.dataset.key] = input.type === 'checkbox' ? input.checked : input.value;
  cfg = settingsApi.settings(cfg);
  try {
    await chrome.storage.local.set({ [KEY]: cfg });
    error.textContent = '';
    paint();
  } catch (e) { error.textContent = e.message; }
});

async function diagnostics() {
  const output = document.getElementById('diagnostic');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'xp-status' });
    if (status.version !== version) {
      output.textContent = '当前 X 页面仍在运行旧版脚本。请刷新所有 X 页面。';
      return;
    }
    output.textContent = '当前页面：' + status.packets + ' 个响应 / ' + status.parsed + ' 次用户解析 / ' + status.users + ' 个用户 / ' + status.badges + ' 个徽标';
    if (status.lastError) output.textContent += '\n错误：' + status.lastError;
    else if (status.packets > 0 && status.parsed === 0) output.textContent += '\n已收到响应，但尚未找到粉丝字段。请滚动加载新推文。';
    else if (status.users > 0 && status.badges === 0) output.textContent += '\n用户数据已获取，暂未匹配到页面位置。';
  } catch {
    output.textContent = '在 X 页面打开此面板可查看采集状态。未出现徽标时，先刷新 X。';
  }
}

diagnostics();
setInterval(diagnostics, 1500);
