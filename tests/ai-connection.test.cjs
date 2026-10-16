const { test } = require('node:test');
const assert = require('node:assert/strict');
const attachAIConnection = require('../src/popup/ai-connection.js');

const input = { baseUrl: 'https://example.com/v1', model: 'model', apiKey: 'key', timeout: 30000 };

function fixture(overrides = {}) {
  const button = { textContent: '测试连接并授权域名', disabled: false, addEventListener(_type, fn) { this.click = fn; } };
  const status = { textContent: '连接已测试，可以开始扫描', dataset: {} };
  const calls = [];
  attachAIConnection({
    button, status, readInput: () => input,
    requestPermission: details => { calls.push(['permission', details]); return Promise.resolve(true); },
    rpc: async action => { calls.push([action]); return action === 'saveAI' ? { verified: false } : true; },
    paintAI: () => { status.textContent = '已保存 Key，需测试连接'; },
    clearError: () => { calls.push(['clearError']); },
    now: () => new Date('2026-10-16T12:34:56Z'),
    ...overrides
  });
  return { button, status, calls };
}

test('retesting an already verified connection shows progress and a fresh success result', async () => {
  const f = fixture();
  const done = f.button.click();
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /正在申请/);
  assert.deepEqual(f.calls[1], ['permission', { origins: ['https://example.com/*'] }]);
  await done;
  assert.deepEqual(f.calls.slice(2), [['saveAI'], ['testAI']]);
  assert.match(f.status.textContent, /连接测试成功（.*），可以开始扫描/);
  assert.equal(f.status.dataset.state, 'success');
  assert.equal(f.button.disabled, false);
});

test('a refused permission is reported next to the button without an API call', async () => {
  const f = fixture({ requestPermission: () => false });
  await f.button.click();
  assert.match(f.status.textContent, /连接测试失败：未授予 AI 服务域名权限/);
  assert.equal(f.status.dataset.state, 'error');
  assert.equal(f.button.disabled, false);
  assert.equal(f.calls.some(([action]) => action === 'testAI'), false);
});

test('an API error is reported next to the button and the button can retry', async () => {
  let attempts = 0;
  const f = fixture({ rpc: async action => {
    if (action === 'saveAI') return { verified: false };
    attempts++;
    if (attempts === 1) throw new Error('AI 接口返回 HTTP 401');
    return true;
  } });
  await f.button.click();
  assert.match(f.status.textContent, /连接测试失败：AI 接口返回 HTTP 401/);
  assert.equal(f.button.disabled, false);
  await f.button.click();
  assert.equal(attempts, 2);
  assert.equal(f.status.dataset.state, 'success');
});
