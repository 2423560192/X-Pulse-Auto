const { test } = require('node:test');
const assert = require('node:assert/strict');
const createReplyUI = require('../src/content/reply-ui.js');

class Node {
  constructor(tag = 'div', text = '') {
    this.tag = tag; this.ownText = text; this.className = ''; this.children = [];
    this.parentElement = null; this.dataset = {}; this.attrs = {}; this.events = {};
    this.nodeType = 1; this.disabled = false;
  }
  get textContent() { return this.ownText + this.children.map(x => x.textContent).join(''); }
  set textContent(v) { this.ownText = v; this.children = []; }
  get isConnected() { return !!(this.root || this.parentElement?.isConnected); }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parentElement = this; this.children.push(n); } }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; } }
  replaceChildren(...nodes) { for (const n of this.children) n.parentElement = null; this.children = []; this.ownText = ''; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { this.events[k] = fn; }
  querySelector(selector) {
    if (selector === '[data-testid="tweetText"]') return this.all().find(x => x.attrs['data-testid'] === 'tweetText') || null;
    if (selector === '[data-testid="User-Name"]') return this.all().find(x => x.attrs['data-testid'] === 'User-Name') || null;
    if (selector === 'time') return null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === 'a[href]') return this.all().filter(x => x.tag === 'a' && x.attrs.href);
    return [];
  }
  all() { return this.children.flatMap(x => [x, ...x.all()]); }
}

const el = (tag, cls, text) => { const n = new Node(tag, text); n.className = cls || ''; return n; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function article(root, { id, text, handle = 'alice' }) {
  const node = new Node('article');
  const link = new Node('a'); link.setAttribute('href', '/' + handle + '/status/' + id); node.append(link);
  const name = new Node('div'); name.setAttribute('data-testid', 'User-Name');
  const profile = new Node('a'); profile.setAttribute('href', '/' + handle); name.append(profile); node.append(name);
  if (text) { const body = new Node('div', text); body.setAttribute('data-testid', 'tweetText'); node.append(body); }
  root.append(node);
  return node;
}

function fixture({ posts = [], fail = false } = {}) {
  const root = new Node(); root.root = true;
  global.location = { href: 'https://x.com/alice/status/1' };
  global.document = {
    documentElement: root,
    querySelectorAll: selector => selector === 'article[data-testid="tweet"]' ? root.all().filter(x => x.tag === 'article') : [],
    addEventListener() {},
    removeEventListener() {}
  };
  const copied = [], calls = [];
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async text => { copied.push(text); } } }, configurable: true });
  global.chrome = { runtime: { lastError: null, sendMessage(message, callback) {
    calls.push(message);
    if (fail) { callback({ ok: false, error: '请先在插件中配置 AI 并测试连接' }); return; }
    const force = !!message.payload?.force;
    callback({ ok: true, result: { fromCache: false, replies: force
      ? [{ tone: '换一批', text: '换个角度说，这个我也遇到过' }]
      : [{ tone: '共鸣', text: '键帽打油真的看手' }, { tone: '追问', text: '什么轴？手汗重会更快' }, { tone: '轻吐槽', text: '这键盘是让你盘出包浆来了' }] } });
  } } };
  const articles = posts.map(post => article(root, post));
  const ui = createReplyUI({ state: { settings: { enabled: true } }, el });
  return { root, articles, calls, copied, ui };
}

const find = (f, cls) => f.root.all().filter(x => x.className === cls);
const click = node => node.events.click({ preventDefault() {}, stopPropagation() {} });

test('every post with text gets one reply chip; image-only posts get none', () => {
  const f = fixture({ posts: [{ id: '1', text: '新买的机械键盘三天键帽就打油了' }, { id: '2', text: '' }] });
  f.ui.render();
  const chips = find(f, 'xp-reply-chip');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].parentElement, f.articles[0]);
  f.ui.render();
  assert.equal(find(f, 'xp-reply-chip').length, 1);
});

test('clicking a chip sends the post context and renders three replies', async () => {
  const f = fixture({ posts: [{ id: '7', text: '新买的机械键盘三天键帽就打油了', handle: 'kbd' }] });
  f.ui.render();
  click(find(f, 'xp-reply-chip')[0]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, 'reply');
  assert.deepEqual(f.calls[0].payload.post, { id: '7', text: '新买的机械键盘三天键帽就打油了', author_handle: 'kbd' });
  assert.match(find(f, 'xp-reply-modal')[0].textContent, /正在按原帖的语气/);
  await tick();
  assert.deepEqual(find(f, 'xp-reply-text').map(x => x.textContent), [
    '键帽打油真的看手', '什么轴？手汗重会更快', '这键盘是让你盘出包浆来了'
  ]);
  assert.deepEqual(find(f, 'xp-reply-tone').map(x => x.textContent), ['共鸣', '追问', '轻吐槽']);
});

test('copy puts the reply on the clipboard and labels the button', async () => {
  const f = fixture({ posts: [{ id: '1', text: '键盘打油了' }] });
  f.ui.render();
  click(find(f, 'xp-reply-chip')[0]);
  await tick();
  click(find(f, 'xp-reply-copy')[0]);
  await tick();
  assert.deepEqual(f.copied, ['键帽打油真的看手']);
  assert.equal(find(f, 'xp-reply-copy')[0].textContent, '已复制');
});

test('a new batch asks the AI again and replaces the suggestions', async () => {
  const f = fixture({ posts: [{ id: '1', text: '键盘打油了' }] });
  f.ui.render();
  click(find(f, 'xp-reply-chip')[0]);
  await tick();
  click(find(f, 'xp-reply-button')[0]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].payload.force, true);
  await tick();
  assert.deepEqual(find(f, 'xp-reply-text').map(x => x.textContent), ['换个角度说，这个我也遇到过']);
});

test('missing AI configuration is reported inside the card and can be retried', async () => {
  const f = fixture({ posts: [{ id: '1', text: '键盘打油了' }], fail: true });
  f.ui.render();
  click(find(f, 'xp-reply-chip')[0]);
  await tick();
  assert.match(find(f, 'xp-reply-error')[0].textContent, /配置 AI/);
  assert.equal(find(f, 'xp-reply-button')[0].textContent, '再试一次');
});

test('the chip always reads the post from the recycled article node', async () => {
  const f = fixture({ posts: [{ id: '1', text: '第一条帖子', handle: 'alice' }] });
  f.ui.render();
  const article = f.articles[0];
  article.querySelectorAll('a[href]')[0].setAttribute('href', '/bob/status/9');
  article.querySelector('[data-testid="tweetText"]').textContent = '换了内容的帖子';
  click(find(f, 'xp-reply-chip')[0]);
  assert.deepEqual(f.calls[0].payload.post, { id: '9', text: '换了内容的帖子', author_handle: 'alice' });
  await tick();
});
