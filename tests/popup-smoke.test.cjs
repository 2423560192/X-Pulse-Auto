const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(id = '') { this.id = id; this.textContent = ''; this.value = ''; this.checked = false; this.dataset = {}; this.children = []; this.events = {}; }
  addEventListener(type, fn) { this.events[type] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

test('built popup starts with demand discovery and AI controls without stale product elements', async () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  get('opp-view').value = 'discovered'; get('opp-sort').value = 'score';
  const document = { getElementById: get, querySelectorAll: () => [], addEventListener() {}, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ version: '4.0.0', packets: 0, parsed: 0, users: 0, badges: 0 }) },
    runtime: { lastError: null, sendMessage(message, reply) {
      if (message.type === 'xp-favorite') reply({ ok: true, result: [] });
      else reply({ ok: true, result: message.action === 'config' ? { ai: null } : [] });
    } },
    permissions: { request: async () => true }
  };
  const context = { document, chrome, setInterval() {}, URL, Date, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/popup.bundle.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof get('test-ai').events.click, 'function');
  assert.equal(typeof get('opp-refresh').events.click, 'function');
  assert.equal(get('opp-list').children[0].textContent, '暂无需求机会；请在 X 页面手动扫描');
  assert.equal(elements.has('product-name'), false);
});
