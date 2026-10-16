const { test } = require('node:test');
const assert = require('node:assert/strict');
const createUI = require('../src/content/opportunity-ui.js');

class Node {
  constructor(tag = 'div', text = '') { this.tag = tag; this.ownText = text; this.className = ''; this.children = []; this.parentElement = null; this.dataset = {}; this.attrs = {}; this.events = {}; this.nodeType = 1; this.style = { values: {}, setProperty(k, v) { this.values[k] = v; } }; }
  get textContent() { return this.ownText + this.children.map(x => x.textContent).join(''); }
  set textContent(v) { this.ownText = v; this.children = []; }
  get isConnected() { return !!(this.root || this.parentElement?.isConnected); }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parentElement = this; this.children.push(n); } }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; } }
  replaceChildren(...nodes) { for (const n of this.children) n.parentElement = null; this.children = []; this.ownText = ''; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] || null; }
  addEventListener(k, fn) { this.events[k] = fn; }
  getBoundingClientRect() { const width = 360, height = 200; return { width, height, left: parseFloat(this.style.values.left) || 622, top: parseFloat(this.style.values.top) || 582 }; }
  querySelector(s) { return s === '[data-testid="tweetText"]' ? this.all().find(x => x.attrs['data-testid'] === 'tweetText') || null : null; }
  all() { return this.children.flatMap(x => [x, ...x.all()]); }
  querySelectorAll(s) { return s === 'a[href]' ? this.all().filter(x => x.tag === 'a' && x.attrs.href) : []; }
}
const el = (tag, cls, text) => { const n = new Node(tag, text); n.className = cls || ''; return n; };
function article(root, id) { const a = new Node('article'), link = new Node('a'); link.setAttribute('href', '/user/status/' + id); a.append(link); root.append(a); return { a, link }; }
function fixture(clusters = [], count = 1) {
  const root = new Node(); root.root = true;
  const original = article(root, '1'), replies = [];
  for (let i = 2; i <= count + 1; i++) replies.push(article(root, String(i)));
  global.location = { href: 'https://x.com/user/status/1', pathname: '/user/status/1' };
  global.document = { documentElement: root, querySelectorAll: () => root.all().filter(x => x.tag === 'article') };
  global.window = { innerWidth: 1000, innerHeight: 800, events: {}, open() {}, addEventListener(k, fn) { this.events[k] = fn; } };
  const calls = [];
  global.chrome = { runtime: { lastError: null, sendMessage(message, callback) {
    calls.push(message);
    if (message.action === 'list') callback({ ok: true, result: clusters });
    else if (message.action === 'ready') callback({ ok: true, result: true });
    else if (message.action === 'config') callback({ ok: true, result: { ai: { baseUrl: 'https://example.com/v1', model: 'm' } } });
    else if (message.action === 'analyze') callback({ ok: true, result: { results: message.payload.items.map(x => ({ postId: x.post_id, clusterId: null })), aiCount: message.payload.items.length, clusters: [] } });
  } } };
  const posts = new Map([['1', { id: '1', text: '原帖正在讨论视频工具' }]]);
  for (let i = 2; i <= count + 1; i++) posts.set(String(i), { id: String(i), text: '每天手动制作视频很费时', inReplyToId: '1', authorHandle: 'creator' });
  const state = { posts, cache: new Map(), settings: { enabled: true } };
  return { root, original, replies, calls, state, ui: createUI({ state, el }) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('demand marker follows article identity during virtualized reuse', async () => {
  const rec = { id: 'need:1', name: '视频批量生产', sourceIds: ['2'], demandCount: 1, opportunityScore: 80, quotes: [] };
  const f = fixture([rec]); f.ui.render(); await tick();
  assert.equal(f.root.all().filter(x => x.className === 'xp-opp-marker').length, 1);
  f.replies[0].link.setAttribute('href', '/user/status/3'); f.ui.render();
  assert.equal(f.root.all().filter(x => x.className === 'xp-opp-marker').length, 0);
  f.replies[0].link.setAttribute('href', '/user/status/2'); f.ui.render();
  assert.equal(f.root.all().filter(x => x.className === 'xp-opp-marker').length, 1);
});

test('radar floats outside the post and can close and reopen', async () => {
  const f = fixture(); f.ui.render(); await tick();
  const panel = f.root.all().find(x => x.className.includes('xp-opp-panel'));
  assert.equal(panel.parentElement, f.root);
  assert.equal(f.original.a.all().includes(panel), false);
  panel.all().find(x => x.className === 'xp-opp-close').events.click();
  assert.equal(panel.isConnected, false);
  const launcher = f.root.all().find(x => x.className === 'xp-opp-launcher');
  assert.ok(launcher);
  launcher.events.click();
  assert.equal(panel.parentElement, f.root);
  assert.equal(launcher.isConnected, false);
});

test('radar can be dragged and stays within viewport', async () => {
  const f = fixture(); f.ui.render(); await tick();
  const panel = f.root.all().find(x => x.className.includes('xp-opp-panel'));
  const head = panel.all().find(x => x.className === 'xp-opp-head');
  head.events.pointerdown({ button: 0, pointerId: 1, target: head, clientX: 650, clientY: 600, preventDefault() {} });
  global.window.events.pointermove({ pointerId: 1, clientX: -1000, clientY: -1000 });
  assert.equal(panel.style.values.left, '8px');
  assert.equal(panel.style.values.top, '8px');
  global.window.events.pointermove({ pointerId: 1, clientX: 3000, clientY: 3000 });
  assert.equal(panel.style.values.left, '632px');
  assert.equal(panel.style.values.top, '592px');
  global.window.events.pointerup({ pointerId: 1 });
});

test('scan is manual, includes posts and replies, and limits one click to 100 discussions in batches of 10', async () => {
  const f = fixture([], 120); f.ui.render(); await tick();
  assert.equal(f.calls.filter(x => x.action === 'analyze').length, 0);
  await f.ui.scan();
  assert.equal(f.calls.filter(x => x.action === 'analyze').length, 10);
  assert.ok(f.calls.filter(x => x.action === 'analyze').every(x => x.payload.items.length === 10));
  await f.ui.scan();
  assert.equal(f.calls.filter(x => x.action === 'analyze').length, 13);
});

test('scan only submits posts observed in this page DOM, not every cached X response', async () => {
  const f = fixture([], 1); f.state.posts.set('999', { id: '999', text: '另一个页面的讨论' });
  f.ui.render(); await tick(); await f.ui.scan();
  const sent = f.calls.filter(x => x.action === 'analyze').flatMap(x => x.payload.items.map(y => y.post_id));
  assert.deepEqual(sent.sort(), ['1', '2']);
});

test('scan includes original post text visible on the page when no X response was cached', async () => {
  const f = fixture([], 0);
  f.state.posts.delete('1');
  const text = new Node('div', '有没有办法自动整理每周客户反馈？');
  text.setAttribute('data-testid', 'tweetText');
  f.original.a.append(text);
  f.ui.render(); await tick(); await f.ui.scan();
  const sent = f.calls.filter(x => x.action === 'analyze').flatMap(x => x.payload.items);
  assert.deepEqual(sent.map(x => x.post_id), ['1']);
  assert.equal(sent[0].text, '有没有办法自动整理每周客户反馈？');
});

test('virtualized posts remain eligible after being observed on the current page', async () => {
  const f = fixture([], 1);
  f.ui.render(); await tick();
  f.replies[0].a.remove();
  await f.ui.scan();
  const sent = f.calls.filter(x => x.action === 'analyze').flatMap(x => x.payload.items.map(y => y.post_id));
  assert.deepEqual(sent.sort(), ['1', '2']);
});

test('navigating away stops further paid batches', async () => {
  const f = fixture([], 25); f.ui.render(); await tick();
  const send = global.chrome.runtime.sendMessage;
  global.chrome.runtime.sendMessage = (message, callback) => {
    send(message, callback);
    if (message.action === 'analyze') global.location.href = 'https://x.com/another/status/99';
  };
  await f.ui.scan();
  assert.equal(f.calls.filter(x => x.action === 'analyze').length, 1);
});
