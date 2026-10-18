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
  let savedAI = null;
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ version: '4.0.0', packets: 0, parsed: 0, users: 0, badges: 0 }) },
    runtime: { lastError: null, sendMessage(message, reply) {
      if (message.type === 'xp-favorite') reply({ ok: true, result: [] });
      else if (message.action === 'config') reply({ ok: true, result: { ai: savedAI } });
      else if (message.action === 'saveAI') {
        savedAI = { ...message.payload.ai, hasKey: !!message.payload.ai.apiKey, verified: false };
        reply({ ok: true, result: savedAI });
      } else reply({ ok: true, result: [] });
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
  assert.equal(get('ai-status').textContent, '尚未保存 AI 设置');
  get('ai-base').value = 'https://example.com/v1';
  get('ai-model').value = '';
  get('ai-temperature').value = '0.2';
  get('ai-timeout').value = '30000';
  get('ai-base').events.input();
  await get('save-ai').events.click();
  assert.match(get('ai-status').textContent, /API URL 已保存/);
  assert.equal(savedAI.baseUrl, 'https://example.com/v1');

  const reopenedElements = new Map();
  const reopenedField = id => {
    if (!reopenedElements.has(id)) reopenedElements.set(id, new Element(id));
    return reopenedElements.get(id);
  };
  reopenedField('opp-view').value = 'discovered';
  reopenedField('opp-sort').value = 'score';
  const reopenedDocument = { ...document, getElementById: reopenedField };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/popup.bundle.js'), 'utf8'), { ...context, document: reopenedDocument });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reopenedField('ai-base').value, 'https://example.com/v1');
  assert.match(reopenedField('ai-status').textContent, /API URL 已保存/);

  get('ai-key').value = 'secret';
  get('ai-model').value = 'test-model';
  get('ai-temperature').value = '0.2';
  get('ai-timeout').value = '30000';
  await get('save-ai').events.click();
  assert.match(get('ai-status').textContent, /已保存.*测试连接/);
  assert.equal(get('ai-status').dataset.state, 'success');
  assert.equal(get('ai-key').value, '');
  assert.equal(savedAI.apiKey, 'secret');
});
