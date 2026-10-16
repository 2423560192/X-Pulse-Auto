'use strict';
// All records and analysis cache remain in extension-local storage.

const opportunity = require('./opportunity.js');
const aiClient = require('./ai-client.js');
const core = require('./core.js');

const KEYS = { product: 'xp_v3_product', ai: 'xp_v3_ai', records: 'xp_v3_opportunities', cache: 'xp_v3_analysis' };
const clean = (value, max = 1000) => String(value || '').trim().slice(0, max);
const words = value => Array.isArray(value) ? value.map(x => clean(x, 60)).filter(Boolean).slice(0, 50) : String(value || '').split(/[,，\n]/).map(x => clean(x, 60)).filter(Boolean).slice(0, 50);

function hash(text) {
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

async function read(key, fallback) {
  const data = await chrome.storage.local.get(key);
  return data[key] ?? fallback;
}
async function write(key, value) { await chrome.storage.local.set({ [key]: value }); }

async function getConfig() {
  const [product, ai] = await Promise.all([read(KEYS.product, null), read(KEYS.ai, null)]);
  const publicAi = ai ? { baseUrl: ai.baseUrl, model: ai.model, temperature: ai.temperature, timeout: ai.timeout, hasKey: !!ai.apiKey, verified: !!ai.verified } : null;
  return { product, ai: publicAi };
}

async function saveProduct(input) {
  const product = {
    enabled: input?.enabled === true,
    name: clean(input?.name, 100), description: clean(input?.description), problem: clean(input?.problem),
    targetUsers: clean(input?.targetUsers), capabilities: clean(input?.capabilities),
    keywords: words(input?.keywords), excludeKeywords: words(input?.excludeKeywords), budget: clean(input?.budget, 200)
  };
  if (product.enabled && !opportunity.validProduct(product)) throw new Error('请填写产品名称、简介、解决的问题、目标客户和核心能力');
  await write(KEYS.product, product);
  return product;
}

async function saveAI(input) {
  const prior = await read(KEYS.ai, null);
  const baseUrl = clean(input?.baseUrl, 500);
  aiClient.endpointOf(baseUrl);
  const model = clean(input?.model, 100);
  const apiKey = clean(input?.apiKey, 500) || prior?.apiKey || '';
  if (!model || !apiKey) throw new Error('请填写 Model 和 API Key');
  const temperature = Number(input?.temperature);
  const timeout = Number(input?.timeout);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Temperature 必须在 0 到 2 之间');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) throw new Error('Timeout 必须在 1000 到 120000 毫秒之间');
  const verified = !!(prior?.verified && prior.baseUrl === baseUrl && prior.model === model && prior.apiKey === apiKey && prior.temperature === temperature && prior.timeout === timeout);
  await write(KEYS.ai, { baseUrl, model, apiKey, temperature, timeout, verified });
  return { baseUrl, model, temperature, timeout, hasKey: true, verified };
}

async function markVerified() {
  const ai = await read(KEYS.ai, null);
  if (!ai) throw new Error('请先保存 AI 设置');
  await write(KEYS.ai, { ...ai, verified: true });
}

async function ready() {
  const product = await read(KEYS.product, null);
  const ai = await read(KEYS.ai, null);
  if (!opportunity.validProduct(product)) throw new Error('请先在插件中填写并启用「我的产品」');
  if (!ai?.verified || !ai.apiKey) throw new Error('请先在插件中配置 AI 并测试连接');
  return { product, ai };
}

async function list(postId) {
  const all = await read(KEYS.records, []);
  return (Array.isArray(all) ? all : []).filter(x => !postId || x.postId === postId);
}

async function update(id, patch) {
  const all = await list();
  const index = all.findIndex(x => x.id === id);
  if (index < 0) throw new Error('商机不存在');
  const next = { ...all[index] };
  if (typeof patch.favorite === 'boolean') next.favorite = patch.favorite;
  if (typeof patch.note === 'string') next.note = clean(patch.note, 2000);
  if (patch.tags !== undefined) next.tags = words(patch.tags);
  next.updatedAt = Date.now();
  all[index] = next;
  await write(KEYS.records, all);
  return next;
}

async function remove(id) {
  const all = await list();
  const item = all.find(x => x.id === id);
  if (!item) return false;
  await write(KEYS.records, all.filter(x => x.id !== id));
  const cache = await read(KEYS.cache, {});
  if (item.cacheKey && cache[item.cacheKey]?.signature === item.signature) {
    delete cache[item.cacheKey];
    await write(KEYS.cache, cache);
  }
  return true;
}

async function analyzeBatch(input, fetchImpl = fetch) {
  const { product, ai } = await ready();
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) throw new Error('每批只能分析 1 至 10 条评论');
  const items = input.map(x => {
    if (!/^\d{1,40}$/.test(String(x.comment_id)) || !/^\d{1,40}$/.test(String(x.post_id)) || typeof x.comment !== 'string' || !x.comment.trim() || x.comment.length > 4000) throw new Error('评论数据无效');
    return {
      comment_id: x.comment_id, post_id: x.post_id,
      comment: clean(x.comment, 4000), parent_post: clean(x.parent_post, 4000), reply_parent: clean(x.reply_parent, 4000),
      author: { id: clean(x.author?.id, 40), handle: core.normalizeHandle(x.author?.handle), name: clean(x.author?.name, 100), followers: Number.isSafeInteger(x.author?.followers) && x.author.followers >= 0 ? x.author.followers : null, following: Number.isSafeInteger(x.author?.following) && x.author.following >= 0 ? x.author.following : null }
    };
  });
  const cache = await read(KEYS.cache, {});
  const pending = [], results = [];
  for (const item of items) {
    const sig = opportunity.signature({ id: item.comment_id, text: item.comment, parentPost: item.parent_post, replyParent: item.reply_parent }, product, ai.model, ai.baseUrl);
    const key = hash(sig);
    item.signature = sig; item.cacheKey = key;
    if (cache[key]?.signature === sig) results.push({ item, result: cache[key].result, fromCache: true });
    else pending.push(item);
  }
  if (pending.length) {
    const analyzed = await aiClient.analyze(ai, product, pending, fetchImpl);
    for (const result of analyzed) {
      const item = pending.find(x => x.comment_id === result.comment_id);
      cache[item.cacheKey] = { signature: item.signature, result };
      results.push({ item, result, fromCache: false });
    }
    await write(KEYS.cache, cache);
  }
  const all = await list();
  const output = [];
  const profileKey = hash(JSON.stringify([product, ai.model, ai.baseUrl]));
  let changedRecords = false;
  for (const { item, result, fromCache } of results) {
    if (!result.is_opportunity || result.opportunityScore < 40) {
      const oldIndex = all.findIndex(x => x.commentId === item.comment_id && x.profileKey === profileKey);
      if (oldIndex >= 0) { all.splice(oldIndex, 1); changedRecords = true; }
      output.push({ commentId: item.comment_id, opportunity: null, fromCache }); continue;
    }
    const id = item.comment_id + ':' + item.cacheKey;
    const index = all.findIndex(x => x.commentId === item.comment_id && x.profileKey === profileKey);
    const prior = index >= 0 ? all[index] : null;
    const now = Date.now();
    const rec = {
      id, cacheKey: item.cacheKey, signature: item.signature, commentId: item.comment_id, postId: item.post_id,
      commentText: item.comment, parentPostText: item.parent_post, authorId: item.author.id,
      authorHandle: item.author.handle, authorName: item.author.name, authorFollowers: item.author.followers, authorFollowing: item.author.following,
      commentUrl: 'https://x.com/' + (item.author.handle || 'i') + '/status/' + item.comment_id,
      productName: product.name, productSnapshot: JSON.stringify(product), profileKey, model: ai.model, aiEndpoint: ai.baseUrl,
      opportunityType: result.opportunity_type, intentScore: result.intent_score, painScore: result.pain_score,
      commercialScore: result.commercial_score, urgency: result.urgency, opportunityScore: result.opportunityScore,
      productFitScore: result.product_fit_score, priorityScore: result.priorityScore,
      need: result.need, painPoint: result.pain_point, budgetSignal: result.budget_signal,
      fitReason: result.fit_reason, evidence: result.evidence, confidence: result.confidence,
      favorite: prior?.favorite || false, note: prior?.note || '', tags: prior?.tags || [],
      analyzedAt: now, createdAt: prior?.createdAt || now, updatedAt: now
    };
    if (index >= 0) all[index] = rec; else all.push(rec);
    changedRecords = true;
    output.push({ commentId: item.comment_id, opportunity: rec, fromCache });
  }
  if (changedRecords) await write(KEYS.records, all);
  return { results: output, aiCount: pending.length };
}

module.exports = { KEYS, hash, getConfig, saveProduct, saveAI, markVerified, ready, list, update, remove, analyzeBatch };
