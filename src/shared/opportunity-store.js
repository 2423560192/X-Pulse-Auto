'use strict';
// Local evidence, AI cache, demand clusters, and user-confirmed opportunity pool.

const demand = require('./opportunity.js');
const aiClient = require('./ai-client.js');
const core = require('./core.js');

const KEYS = { ai: 'xp_v3_ai', discoveries: 'xp_v4_discoveries', clusters: 'xp_v4_clusters', cache: 'xp_v4_analysis', replies: 'xp_v4_replies' };
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const words = value => Array.isArray(value) ? value.map(x => clean(x, 60)).filter(Boolean).slice(0, 30) : String(value || '').split(/[,，\n]/).map(x => clean(x, 60)).filter(Boolean).slice(0, 30);

function hash(text) {
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489917); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
async function read(key, fallback) { const data = await chrome.storage.local.get(key); return data[key] ?? fallback; }
async function write(key, value) { await chrome.storage.local.set({ [key]: value }); }

async function getConfig() {
  const ai = await read(KEYS.ai, null);
  return { ai: ai ? { baseUrl: ai.baseUrl, model: ai.model, temperature: ai.temperature, timeout: ai.timeout, hasKey: !!ai.apiKey, verified: !!ai.verified } : null };
}
async function saveAI(input) {
  const prior = await read(KEYS.ai, null);
  const baseUrl = clean(input?.baseUrl, 500);
  aiClient.endpointOf(baseUrl);
  const model = clean(input?.model, 100), apiKey = clean(input?.apiKey, 500) || prior?.apiKey || '';
  const temperature = Number(input?.temperature), timeout = Number(input?.timeout);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Temperature 必须在 0 到 2 之间');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) throw new Error('Timeout 必须在 1000 到 120000 毫秒之间');
  const verified = !!(prior?.verified && prior.baseUrl === baseUrl && prior.model === model && prior.apiKey === apiKey && prior.temperature === temperature && prior.timeout === timeout);
  await write(KEYS.ai, { baseUrl, model, apiKey, temperature, timeout, verified });
  return { baseUrl, model, temperature, timeout, hasKey: !!apiKey, verified };
}
async function markVerified() {
  const ai = await read(KEYS.ai, null);
  if (!ai) throw new Error('请先保存 AI 设置');
  await write(KEYS.ai, { ...ai, verified: true });
}
async function ready() {
  const ai = await read(KEYS.ai, null);
  if (!ai?.verified || !ai.apiKey || !ai.model) throw new Error('请先在插件中配置 AI 并测试连接');
  return { ai };
}

async function list() { const all = await read(KEYS.clusters, []); return Array.isArray(all) ? all : []; }
async function pool() { return (await list()).filter(x => x.inPool); }
async function addToPool(id) {
  const all = await list(), rec = all.find(x => x.id === id);
  if (!rec) throw new Error('需求机会不存在');
  rec.inPool = true; rec.updatedAt = Date.now();
  await write(KEYS.clusters, all);
  return rec;
}
async function update(id, patch) {
  const all = await list(), rec = all.find(x => x.id === id);
  if (!rec?.inPool) throw new Error('请先将需求加入机会池');
  if (typeof patch.favorite === 'boolean') rec.favorite = patch.favorite;
  if (typeof patch.note === 'string') rec.note = clean(patch.note, 2000);
  if (patch.tags !== undefined) rec.tags = words(patch.tags);
  rec.updatedAt = Date.now();
  await write(KEYS.clusters, all);
  return rec;
}
async function remove(id) {
  const all = await list(), rec = all.find(x => x.id === id);
  if (!rec?.inPool) return false;
  rec.inPool = false; rec.updatedAt = Date.now();
  await write(KEYS.clusters, all);
  return true;
}

function normalizeInput(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) throw new Error('每批只能分析 1 至 10 条讨论');
  const seen = new Set();
  return input.map(x => {
    const id = String(x?.post_id || '');
    if (!/^\d{1,40}$/.test(id) || seen.has(id) || typeof x.text !== 'string' || !x.text.trim() || x.text.length > 4000) throw new Error('帖子数据无效或重复');
    seen.add(id);
    return { post_id: id, text: clean(x.text, 4000), parent_text: clean(x.parent_text, 4000),
      created_at: clean(x.created_at, 100), author_handle: core.normalizeHandle(x.author_handle) };
  });
}

function rebuild(discoveries, previous) {
  const byId = new Map(previous.map(x => [x.id, x]));
  const groups = new Map();
  for (const rec of discoveries) {
    if (!groups.has(rec.clusterId)) groups.set(rec.clusterId, []);
    groups.get(rec.clusterId).push(rec);
  }
  const result = [];
  for (const [id, items] of groups) {
    const prior = byId.get(id);
    result.push(demand.summarizeCluster({ id, name: prior?.name || items[0].clusterName }, items, prior));
  }
  return result.sort((a, b) => b.opportunityScore - a.opportunityScore);
}

async function analyzeBatch(input, fetchImpl = fetch) {
  const { ai } = await ready();
  const items = normalizeInput(input);
  const cache = await read(KEYS.cache, {});
  const previous = await list();
  const pending = [], analyzed = [];
  for (const item of items) {
    const signature = JSON.stringify(['demand-v1', item.post_id, item.text, item.parent_text, ai.model, ai.baseUrl]);
    const key = hash(signature);
    if (cache[key]?.signature === signature) analyzed.push({ item, result: cache[key].result, fromCache: true });
    else pending.push({ ...item, key, signature });
  }
  if (pending.length) {
    const response = await aiClient.analyze(ai, pending, previous, fetchImpl);
    for (const result of response) {
      const item = pending.find(x => x.post_id === result.post_id);
      cache[item.key] = { signature: item.signature, result };
      analyzed.push({ item, result, fromCache: false });
    }
    const keys = Object.keys(cache);
    while (keys.length > 3000) delete cache[keys.shift()];
    await write(KEYS.cache, cache);
  }
  const discoveries = await read(KEYS.discoveries, []);
  const all = Array.isArray(discoveries) ? discoveries : [];
  const byName = new Map(previous.map(x => [demand.normalizeName(x.name), x.id]));
  const clusterIds = new Set(previous.map(x => x.id));
  const output = [];
  for (const { item, result, fromCache } of analyzed) {
    const priorIndex = all.findIndex(x => x.postId === item.post_id);
    if (priorIndex >= 0) all.splice(priorIndex, 1);
    if (!result.is_demand) { output.push({ postId: item.post_id, clusterId: null, fromCache }); continue; }
    const normalized = demand.normalizeName(result.cluster_name);
    const clusterId = clusterIds.has(result.cluster_id) ? result.cluster_id : byName.get(normalized) || 'need:' + hash(normalized);
    clusterIds.add(clusterId); byName.set(normalized, clusterId);
    const rec = {
      postId: item.post_id, clusterId, clusterName: result.cluster_name, demandType: result.demand_type,
      need: result.need, painPoint: result.pain_point, targetUsers: result.target_users,
      currentSolution: result.current_solution, needEvidence: result.need_evidence,
      paymentEvidence: result.payment_evidence, competitionLevel: result.competition_level,
      competitionEvidence: result.competition_evidence, directions: result.directions,
      demandStrength: result.demand_strength, painScore: result.pain_score, paymentScore: result.payment_score,
      createdAt: item.created_at, url: 'https://x.com/' + (item.author_handle || 'i') + '/status/' + item.post_id,
      analyzedAt: Date.now()
    };
    all.push(rec);
    output.push({ postId: item.post_id, clusterId, fromCache });
  }
  // Cap local history; never persist non-demand text or a full X response.
  while (all.length > 2000) all.shift();
  await write(KEYS.discoveries, all);
  const clusters = rebuild(all, previous);
  await write(KEYS.clusters, clusters);
  return { results: output, aiCount: pending.length, clusters: clusters.filter(x => output.some(y => y.clusterId === x.id)) };
}

function normalizeReplyPost(input) {
  const id = String(input?.id || '');
  if (!/^\d{1,40}$/.test(id)) throw new Error('帖子 ID 无效');
  const text = clean(input?.text, 4000);
  if (text.length < 2) throw new Error('帖子内容为空，无法生成回复');
  return { id, text, authorHandle: core.normalizeHandle(input?.author_handle) };
}

async function suggestReplies(input, force = false, fetchImpl = fetch) {
  const { ai } = await ready();
  const post = normalizeReplyPost(input);
  const signature = JSON.stringify(['reply-v1', post.id, post.text, post.authorHandle, ai.model, ai.baseUrl]);
  const key = hash(signature);
  const stored = await read(KEYS.replies, {});
  const cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const cached = cache[key];
  if (!force && cached?.signature === signature && Array.isArray(cached.replies) && cached.replies.length) {
    return { replies: cached.replies, fromCache: true };
  }
  const replies = await aiClient.suggestReplies(ai, post, fetchImpl);
  cache[key] = { signature, replies, at: Date.now() };
  const keys = Object.keys(cache);
  while (keys.length > 200) delete cache[keys.shift()];
  await write(KEYS.replies, cache);
  return { replies, fromCache: false };
}

module.exports = { KEYS, hash, getConfig, saveAI, markVerified, ready, list, pool, addToPool, update, remove, normalizeInput, rebuild, analyzeBatch, normalizeReplyPost, suggestReplies };
