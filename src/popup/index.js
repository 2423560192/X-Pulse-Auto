'use strict';
// Settings panel: renders controls, persists changes, polls the active tab,
// and exports favorites to CSV / JSON.

const version = require('../version.js');
const config = require('../shared/config.js');
const favorites = require('../shared/favorites.js');
const exporter = require('../shared/exporter.js');
const attachAIConnection = require('./ai-connection.js');
const mountDemandUI = require('./demand-ui.js');

const KEY = 'xp_inline_settings';
let cfg = config.config();
const error = document.getElementById('error');

function inputValue(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number') return Number(input.value);
  return input.value;
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
}

function paint() {
  for (const input of document.querySelectorAll('[data-key]')) {
    if (input.type === 'checkbox') input.checked = cfg[input.dataset.key];
    else input.value = cfg[input.dataset.key];
  }
  for (const input of document.querySelectorAll('[data-path]')) {
    const v = getPath(cfg, input.dataset.path);
    if (input.type === 'checkbox') input.checked = !!v;
    else if (Array.isArray(v)) input.value = v.join(', ');
    else input.value = v;
  }
  document.getElementById('status').textContent = cfg.enabled ? '自动显示已开启' : '自动显示已暂停';
}

chrome.storage.local.get(KEY).then(data => {
  cfg = config.config(data[KEY]);
  paint();
}).catch(e => { error.textContent = e.message; });

document.addEventListener('change', async e => {
  const input = e.target;
  if (input.dataset.key) cfg[input.dataset.key] = inputValue(input);
  else if (input.dataset.path) {
    let v = inputValue(input);
    if (Array.isArray(getPath(cfg, input.dataset.path))) v = String(v).split(',').map(s => s.trim()).filter(Boolean);
    setPath(cfg, input.dataset.path, v);
  }
  else return;
  cfg = config.config(cfg);
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

async function exportFavorites(kind) {
  try {
    const list = await favorites.listFavorites();
    if (!list.length) { error.textContent = '暂无收藏数据可导出'; return; }
    if (kind === 'csv') exporter.downloadFile(exporter.exportFavoritesCSV(list), 'x-pulse-favorites.csv', 'text/csv;charset=utf-8');
    else exporter.downloadFile(exporter.exportFavoritesJSON(list), 'x-pulse-favorites.json', 'application/json');
    error.textContent = '';
  } catch (e) { error.textContent = '导出失败：' + e.message; }
}

document.getElementById('export-csv').addEventListener('click', () => exportFavorites('csv'));
document.getElementById('export-json').addEventListener('click', () => exportFavorites('json'));

let favList = [];

async function refreshFavorites() {
  try {
    const all = await favorites.listFavorites();
    favList = favorites.sortFavorites(all, 'recent');
    renderFavorites();
  } catch (e) { error.textContent = '加载收藏失败：' + e.message; }
}

function renderFavorites() {
  const listEl = document.getElementById('fav-list');
  const q = document.getElementById('fav-search').value;
  const items = favorites.searchFavorites(favList, q);
  listEl.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'fav-empty';
    li.textContent = q ? '无匹配收藏' : '暂无收藏';
    listEl.append(li);
    return;
  }
  for (const f of items) {
    const li = document.createElement('li');
    li.className = 'fav-item';
    const name = document.createElement('div');
    name.className = 'fav-name';
    name.textContent = (f.name || f.handle) + ' @' + f.handle;
    li.append(name);
    if (f.note) { const n = document.createElement('div'); n.className = 'fav-note'; n.textContent = f.note; li.append(n); }
    if (f.tags && f.tags.length) { const t = document.createElement('div'); t.className = 'fav-tags'; t.textContent = f.tags.join(' · '); li.append(t); }
    const actions = document.createElement('div');
    actions.className = 'fav-actions';
    const noteBtn = document.createElement('button'); noteBtn.type = 'button'; noteBtn.textContent = '备注';
    noteBtn.addEventListener('click', () => editNote(f));
    const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => removeFavorite(f));
    actions.append(noteBtn, delBtn);
    li.append(actions);
    listEl.append(li);
  }
}

async function editNote(f) {
  const note = prompt('备注', f.note || '');
  if (note === null) return;
  try { await favorites.client.update(f.key, { note }); await refreshFavorites(); error.textContent = ''; }
  catch (e) { error.textContent = '保存备注失败：' + e.message; }
}

async function removeFavorite(f) {
  if (!confirm('删除 @' + f.handle + ' 的收藏？')) return;
  try { await favorites.client.remove(f.key); await refreshFavorites(); error.textContent = ''; }
  catch (e) { error.textContent = '删除失败：' + e.message; }
}

document.getElementById('fav-search').addEventListener('input', renderFavorites);
refreshFavorites();

diagnostics();
setInterval(diagnostics, 1500);

function opportunityRpc(action, payload = {}) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'xp-opportunity', action, payload }, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error || '需求机会操作失败'));
    resolve(response.result);
  }));
}
const field = id => document.getElementById(id);
function aiInput() {
  return {
    baseUrl: field('ai-base').value, apiKey: field('ai-key').value, model: field('ai-model').value,
    temperature: Number(field('ai-temperature').value), timeout: Number(field('ai-timeout').value)
  };
}
function paintAI(ai) {
  if (!ai) return;
  field('ai-base').value = ai.baseUrl;
  field('ai-model').value = ai.model;
  field('ai-temperature').value = ai.temperature;
  field('ai-timeout').value = ai.timeout;
  field('ai-key').value = '';
  field('ai-status').textContent = ai.verified ? '连接已测试，可以开始扫描' : ai.hasKey ? '已保存 Key，需测试连接' : '尚未设置 API Key';
}

opportunityRpc('config').then(({ ai }) => paintAI(ai)).catch(e => { error.textContent = e.message; });
field('save-ai').addEventListener('click', async () => {
  try { paintAI(await opportunityRpc('saveAI', { ai: aiInput() })); error.textContent = ''; }
  catch (e) { error.textContent = e.message; }
});
attachAIConnection({
  button: field('test-ai'), status: field('ai-status'), readInput: aiInput,
  requestPermission: details => chrome.permissions.request(details),
  rpc: opportunityRpc, paintAI, clearError: () => { error.textContent = ''; }
});
mountDemandUI({ field, rpc: opportunityRpc, error });
field('scan-page').addEventListener('click', async () => {
  const status = field('scan-page-status');
  status.textContent = '正在启动…';
  try {
    await opportunityRpc('ready');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('没有可扫描的当前标签页');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'xp-scan-page' });
    if (!response?.started) throw new Error('请在 X 页面打开帖子后重试');
    status.textContent = '已启动，请在 X 页面查看进度';
  } catch (e) { status.textContent = e.message; }
});
