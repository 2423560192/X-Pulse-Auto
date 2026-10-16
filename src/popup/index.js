'use strict';
// Settings panel: renders controls, persists changes, polls the active tab,
// and exports favorites to CSV / JSON.

const version = require('../version.js');
const config = require('../shared/config.js');
const favorites = require('../shared/favorites.js');
const exporter = require('../shared/exporter.js');
const attachAIConnection = require('./ai-connection.js');

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
    if (!response?.ok) return reject(new Error(response?.error || '商机操作失败'));
    resolve(response.result);
  }));
}
const field = id => document.getElementById(id);
function productInput() {
  return {
    enabled: field('product-enabled').checked, name: field('product-name').value,
    description: field('product-description').value, problem: field('product-problem').value,
    targetUsers: field('product-target').value, capabilities: field('product-capabilities').value,
    keywords: field('product-keywords').value, excludeKeywords: field('product-exclusions').value,
    budget: field('product-budget').value
  };
}
function aiInput() {
  return {
    baseUrl: field('ai-base').value, apiKey: field('ai-key').value, model: field('ai-model').value,
    temperature: Number(field('ai-temperature').value), timeout: Number(field('ai-timeout').value)
  };
}
function paintProduct(product) {
  if (!product) return;
  field('product-enabled').checked = !!product.enabled;
  for (const [id, value] of [
    ['product-name', product.name], ['product-description', product.description], ['product-problem', product.problem],
    ['product-target', product.targetUsers], ['product-capabilities', product.capabilities],
    ['product-keywords', (product.keywords || []).join(', ')], ['product-exclusions', (product.excludeKeywords || []).join(', ')],
    ['product-budget', product.budget]
  ]) field(id).value = value || '';
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

opportunityRpc('config').then(({ product, ai }) => { paintProduct(product); paintAI(ai); }).catch(e => { error.textContent = e.message; });
field('save-product').addEventListener('click', async () => {
  try { paintProduct(await opportunityRpc('saveProduct', { product: productInput() })); error.textContent = ''; }
  catch (e) { error.textContent = e.message; }
});
field('save-ai').addEventListener('click', async () => {
  try { paintAI(await opportunityRpc('saveAI', { ai: aiInput() })); error.textContent = ''; }
  catch (e) { error.textContent = e.message; }
});
attachAIConnection({
  button: field('test-ai'), status: field('ai-status'), readInput: aiInput,
  requestPermission: details => chrome.permissions.request(details),
  rpc: opportunityRpc, paintAI, clearError: () => { error.textContent = ''; }
});

let opportunityList = [], selectedOpportunity = '';
function filteredOpportunities() {
  const q = field('opp-search').value.trim().toLowerCase();
  const filter = field('opp-filter').value;
  const order = field('opp-sort').value;
  const items = opportunityList.filter(x => {
    if (q && ![x.authorHandle, x.authorName, x.need, x.commentText, x.productName].join(' ').toLowerCase().includes(q)) return false;
    if (filter === 'high' && x.opportunityScore < 80) return false;
    if (filter === 'medium' && (x.opportunityScore < 60 || x.opportunityScore >= 80)) return false;
    if (filter === 'low' && x.opportunityScore >= 60) return false;
    if (!['all', 'high', 'medium', 'low'].includes(filter) && x.opportunityType !== filter) return false;
    return true;
  });
  const get = {
    priority: x => x.priorityScore, recent: x => x.createdAt, followers: x => x.authorFollowers || 0,
    strength: x => x.opportunityScore, fit: x => x.productFitScore
  }[order];
  return items.sort((a, b) => get(b) - get(a));
}
function oppButton(label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; }
function renderOpportunityDetail() {
  const box = field('opp-detail'); box.replaceChildren();
  const rec = opportunityList.find(x => x.id === selectedOpportunity);
  if (!rec) return;
  const heading = document.createElement('strong'); heading.textContent = (rec.authorName || rec.authorHandle) + ' @' + rec.authorHandle; box.append(heading);
  for (const [label, value] of [
    ['粉丝', rec.authorFollowers ?? '未知'], ['关注', rec.authorFollowing ?? '未知'], ['原帖', rec.parentPostText],
    ['评论', rec.commentText], ['类型', rec.opportunityType], ['需求', rec.need], ['痛点', rec.painPoint],
    ['商机强度', rec.opportunityScore], ['产品匹配', rec.productFitScore], ['优先级', rec.priorityScore],
    ['依据', rec.evidence], ['匹配理由', rec.fitReason], ['预算', rec.budgetSignal],
    ['备注', rec.note || '无'], ['标签', (rec.tags || []).join('、') || '无'],
    ['发现时间', new Date(rec.createdAt).toLocaleString('zh-CN')]
  ]) {
    const p = document.createElement('p');
    const strong = document.createElement('strong'); strong.textContent = label + '：';
    p.append(strong, document.createTextNode(String(value ?? ''))); box.append(p);
  }
  const actions = document.createElement('div'); actions.className = 'button-row';
  actions.append(
    oppButton(rec.favorite ? '取消收藏' : '收藏', () => editOpportunity(rec, { favorite: !rec.favorite })),
    oppButton('备注', () => { const note = prompt('商机备注', rec.note || ''); if (note !== null) editOpportunity(rec, { note }); }),
    oppButton('标签', () => { const tags = prompt('标签，逗号分隔', (rec.tags || []).join(', ')); if (tags !== null) editOpportunity(rec, { tags }); }),
    oppButton('打开评论', () => chrome.tabs.create({ url: rec.commentUrl })),
    oppButton('打开用户', () => rec.authorHandle && chrome.tabs.create({ url: 'https://x.com/' + rec.authorHandle })),
    oppButton('删除', () => deleteOpportunity(rec))
  ); box.append(actions);
}
function renderOpportunities() {
  const list = field('opp-list'); list.replaceChildren();
  const items = filteredOpportunities();
  if (!items.length) { const empty = document.createElement('li'); empty.className = 'opp-empty'; empty.textContent = '暂无匹配商机'; list.append(empty); }
  for (const rec of items) {
    const li = document.createElement('li'); li.className = 'opp-item';
    const b = oppButton('@' + (rec.authorHandle || 'unknown') + ' · 商机 ' + rec.opportunityScore + ' · 匹配 ' + rec.productFitScore, () => { selectedOpportunity = rec.id; renderOpportunityDetail(); });
    const snippet = document.createElement('div'); snippet.className = 'opp-snippet'; snippet.textContent = rec.need || rec.commentText;
    li.append(b, snippet); list.append(li);
  }
  renderOpportunityDetail();
}
async function refreshOpportunities() {
  try { opportunityList = await opportunityRpc('list'); renderOpportunities(); }
  catch (e) { error.textContent = e.message; }
}
async function editOpportunity(rec, patch) {
  try { await opportunityRpc('update', { id: rec.id, patch }); await refreshOpportunities(); error.textContent = ''; }
  catch (e) { error.textContent = e.message; }
}
async function deleteOpportunity(rec) {
  if (!confirm('删除这条商机？再次手动扫描时可能重新发现。')) return;
  try { await opportunityRpc('remove', { id: rec.id }); selectedOpportunity = ''; await refreshOpportunities(); error.textContent = ''; }
  catch (e) { error.textContent = e.message; }
}
for (const id of ['opp-search', 'opp-filter', 'opp-sort']) field(id).addEventListener(id === 'opp-search' ? 'input' : 'change', renderOpportunities);
refreshOpportunities();
