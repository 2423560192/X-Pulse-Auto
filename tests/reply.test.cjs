const { test } = require('node:test');
const assert = require('node:assert/strict');
const reply = require('../src/shared/reply.js');

test('accepts short replies and normalizes markdown, quotes and tone labels', () => {
  const out = reply.validate({ replies: [
    { tone: '共鸣', text: ' **键帽打油真的看手**，我上一把也是三天就油了 ' },
    { tone: '追问：', text: '什么轴？手汗重的话打油会更快' },
    { tone: '', text: '“这键盘是让你盘出包浆来了”' }
  ] });
  assert.equal(out.replies.length, 3);
  assert.equal(out.replies[0].text, '键帽打油真的看手，我上一把也是三天就油了');
  assert.equal(out.replies[1].tone, '追问');
  assert.equal(out.replies[2].tone, '回复');
  assert.equal(out.replies[2].text, '这键盘是让你盘出包浆来了');
});

test('rejects malformed, empty, oversized, linked or duplicated reply batches', () => {
  assert.throws(() => reply.validate(null), /数量/);
  assert.throws(() => reply.validate({ replies: [] }), /数量/);
  assert.throws(() => reply.validate({ replies: Array(5).fill({ text: '收到' }) }), /数量/);
  assert.throws(() => reply.validate({ replies: [{ text: ' ' }] }), /长度|文本/);
  assert.throws(() => reply.validate({ replies: [{ text: 'x'.repeat(281) }] }), /长度/);
  assert.throws(() => reply.validate({ replies: [{ text: '收到' }, { text: '收到' }] }), /重复/);
  assert.throws(() => reply.validate({ replies: [{ text: '看这里 https://example.com' }] }), /链接/);
  assert.throws(() => reply.validate({ replies: [{ tone: '共鸣' }] }), /文本/);
  assert.throws(() => reply.validate({ replies: [{ text: '中文'.repeat(100) }] }), /过长/);
  assert.equal(reply.cleanText('  **好**  '), '好');
  assert.equal(reply.MAX_LENGTH, 280);
});

test('templated replies are flagged so the caller can rewrite once', () => {
  assert.equal(reply.looksTemplated([{ text: '总的来说，这很正常' }, { text: '建议你换个键帽' }]), true);
  assert.equal(reply.looksTemplated([{ text: '希望对你有所帮助' }]), true);
  assert.equal(reply.looksTemplated([{ text: 'as an AI language model I think so' }]), true);
  assert.equal(reply.looksTemplated([
    { text: '这是一段非常完整、语气平稳而且没有任何口语感的书面表达，还用了完整标点。' },
    { text: '这是另一段同样工整、同样书面、同样不像随手打字的完整句子，也用了标点。' }
  ]), true);
  assert.equal(reply.looksTemplated([{ text: '三天就油 这手速能去电竞了' }, { text: '正常 我的也油' }]), false);
  assert.equal(reply.looksTemplated([]), false);
});
