const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/shared/opportunity-store.js');

let data = {}, calls = 0;
global.chrome = { storage: { local: {
  get: async key => ({ [key]: data[key] }),
  set: async values => { data = { ...data, ...values }; }
} } };
const ai = { baseUrl: 'https://example.com/v1', model: 'model-a', apiKey: 'secret', temperature: .2, timeout: 30000 };
const input = [
  { post_id: '2', text: '有没有 AI 视频批量工具', parent_text: '', created_at: '2026-10-16', author_handle: 'alice' },
  { post_id: '3', text: '每天做几十条视频太累了', parent_text: '', created_at: '2026-10-16', author_handle: 'bob' }
];
const fetchImpl = async (_url, init) => {
  calls++;
  const prompt = JSON.parse(JSON.parse(init.body).messages[1].content);
  assert.equal('product' in prompt, false);
  const existing = prompt.existing_clusters[0];
  const results = prompt.discussions.map(x => ({
    post_id: x.post_id, is_demand: true, cluster_id: existing?.id || '', cluster_name: 'AI 视频批量生产需求',
    demand_type: 'tool_request', need: '批量制作视频', pain_point: '制作耗时', target_users: '视频创作者',
    current_solution: '', solution_evidence: '', need_evidence: x.text,
    payment_evidence: '', demand_strength: 90, pain_score: 80, payment_score: 0,
    competition_level: 'unknown', competition_evidence: '', directions: ['AI 视频批量生产工具']
  }));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results }) } }] }));
};
async function setup() { data = { xp_v3_product: { name: '旧产品' }, xp_v3_opportunities: [{ id: 'old' }] }; calls = 0; await store.saveAI(ai); await store.markVerified(); }

test('AI connection is sufficient; old product configuration remains untouched and hidden from new config', async () => {
  data = {};
  await assert.rejects(store.ready(), /AI/);
  await store.saveAI(ai);
  await assert.rejects(store.ready(), /测试连接/);
  const config = await store.getConfig();
  assert.equal(config.ai.hasKey, true);
  assert.equal('apiKey' in config.ai, false);
  assert.equal('product' in config, false);
  await store.markVerified();
  await store.ready();
});

test('API URL can be saved before Model and API Key and survives a later config read', async () => {
  data = {};
  const saved = await store.saveAI({ baseUrl: 'https://custom.example/v1', model: '', apiKey: '', temperature: .2, timeout: 30000 });
  assert.equal(saved.baseUrl, 'https://custom.example/v1');
  assert.equal(saved.hasKey, false);
  const reopened = await store.getConfig();
  assert.equal(reopened.ai.baseUrl, 'https://custom.example/v1');
  assert.equal(reopened.ai.hasKey, false);
  await assert.rejects(store.ready(), /测试连接/);
  await store.saveAI({ ...ai, baseUrl: 'https://custom.example/v1' });
  assert.equal((await store.getConfig()).ai.baseUrl, 'https://custom.example/v1');
});

test('similar discussions form one demand cluster; only user confirmation enters the pool', async () => {
  await setup();
  const first = await store.analyzeBatch(input, fetchImpl);
  assert.equal(first.aiCount, 2);
  assert.equal(calls, 1);
  const clusters = await store.list();
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].demandCount, 2);
  assert.equal((await store.pool()).length, 0);
  assert.deepEqual(clusters[0].sourceIds.sort(), ['2', '3']);
  const cached = await store.analyzeBatch(input, fetchImpl);
  assert.equal(cached.aiCount, 0);
  assert.equal(calls, 1);
  const third = await store.analyzeBatch([{ post_id: '4', text: '怎么自动做短视频', author_handle: 'carol' }], fetchImpl);
  assert.equal(third.aiCount, 1);
  assert.equal((await store.list())[0].demandCount, 3);
  const id = clusters[0].id;
  await assert.rejects(store.update(id, { note: '先做 MVP' }), /加入机会池/);
  await store.addToPool(id);
  assert.equal((await store.pool()).length, 1);
  await store.update(id, { note: '先做 MVP', tags: '视频,高潜力', favorite: true });
  assert.equal((await store.pool())[0].note, '先做 MVP');
  assert.equal(await store.remove(id), true);
  assert.equal((await store.pool()).length, 0);
  assert.equal((await store.list()).length, 1);
  assert.equal(data.xp_v3_product.name, '旧产品');
  assert.equal(data.xp_v3_opportunities[0].id, 'old');
});

test('model or source context changes invalidate classification cache without duplicating source counts', async () => {
  await setup();
  await store.analyzeBatch([input[0]], fetchImpl);
  await store.analyzeBatch([{ ...input[0], parent_text: '新的原帖上下文' }], fetchImpl);
  assert.equal(calls, 2);
  assert.equal((await store.list())[0].demandCount, 1);
  await store.saveAI({ ...ai, model: 'model-b' });
  await store.markVerified();
  await store.analyzeBatch([input[0]], fetchImpl);
  assert.equal(calls, 3);
  assert.equal((await store.list())[0].demandCount, 1);
});

test('invalid batch sizes and duplicate IDs fail before AI', async () => {
  await setup();
  await assert.rejects(store.analyzeBatch([], fetchImpl), /1 至 10/);
  await assert.rejects(store.analyzeBatch(Array(11).fill(input[0]), fetchImpl), /1 至 10/);
  await assert.rejects(store.analyzeBatch([input[0], input[0]], fetchImpl), /重复/);
  assert.equal(calls, 0);
});

test('reply suggestions validate the post, reuse the cache, and force a fresh batch', async () => {
  await setup();
  const post = { id: '42', text: '新买的机械键盘三天键帽就打油了，这正常吗', author_handle: 'alice' };
  const fetchReply = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [
      { tone: '共鸣', text: '键帽打油真的看手，我上一把也是三天就油了' },
      { tone: '追问', text: '什么轴？手汗重的话打油会更快' },
      { tone: '轻吐槽', text: '这键盘是让你盘出包浆来了' }
    ] }) } }] }));
  };
  const fresh = await store.suggestReplies(post, false, fetchReply);
  assert.equal(fresh.fromCache, false);
  assert.equal(fresh.replies.length, 3);
  assert.equal(calls, 1);
  const cached = await store.suggestReplies(post, false, fetchReply);
  assert.equal(cached.fromCache, true);
  assert.equal(calls, 1);
  const forced = await store.suggestReplies(post, true, fetchReply);
  assert.equal(forced.fromCache, false);
  assert.equal(calls, 2);
  await assert.rejects(store.suggestReplies({ id: 'not-a-post', text: '内容' }, false, fetchReply), /ID/);
  await assert.rejects(store.suggestReplies({ id: '42', text: ' ' }, false, fetchReply), /内容为空/);
  assert.equal(calls, 2);
});
