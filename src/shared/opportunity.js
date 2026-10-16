'use strict';
// Pure rules, reply selection, AI result validation, and deterministic scoring.

const TYPES = new Set(['tool_request', 'solution_request', 'api_request', 'purchase_intent', 'service_request', 'pain_point', 'outsourcing', 'collaboration', 'recommendation', 'other', 'not_opportunity']);
const NEED = /有没有|求推荐|推荐一下|什么工具|有什么工具|找一个|寻找|求一个|哪里有|谁能|有没有人做|需要|求助|怎么解决|looking for|recommend|need a|any tool|how can i/i;
const TOOL = /工具|软件|平台|saas|api|插件|系统|自动化|ai|app|service|integration/i;
const PAIN = /太麻烦|效率低|人工|耗时|不会|做不出来|成本高|太贵|一直失败|很难|痛点|费时|slow|expensive|struggling|difficult/i;
const COMMERCIAL = /多少钱|价格|购买|付费|收费|报价|预算|采购|合作|外包|付钱|pay|buy|price|budget|hire/i;
const TRIVIAL = /^(?:哈+|确实|赞|支持|第一|6+|牛|牛逼|👍+|😂+|🤣+|🔥+)$/i;

function ruleMatch(text, product = {}) {
  const value = String(text || '').trim();
  if (!value || value.length < 2 || TRIVIAL.test(value) || !/[\p{L}\p{N}]/u.test(value)) return false;
  if (/加群|私信领取|点击链接|免费领|airdrop|giveaway|dm me/i.test(value)) return false;
  const excluded = Array.isArray(product.excludeKeywords) ? product.excludeKeywords : [];
  if (excluded.some(k => k && value.toLowerCase().includes(String(k).toLowerCase()))) return false;
  return NEED.test(value) || PAIN.test(value) || COMMERCIAL.test(value) || (TOOL.test(value) && /求|找|需要|推荐|有没有|can|need|looking/i.test(value));
}

function belongsToThread(post, rootId, byId) {
  if (!post?.isReply || post.isQuote || post.id === rootId) return false;
  if (post.conversationId === rootId) return true;
  const visited = new Set([post.id]);
  let parentId = post.inReplyToId;
  for (let depth = 0; parentId && depth < 30; depth++) {
    if (parentId === rootId) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    parentId = byId.get(parentId)?.inReplyToId;
  }
  return false;
}

function commentsForThread(posts, rootId) {
  const byId = new Map(posts.map(p => [p.id, p]));
  return posts.filter(p => belongsToThread(p, rootId, byId)).sort((a, b) => (a.observedAt || 0) - (b.observedAt || 0));
}

function validProduct(p) {
  return !!(p && p.enabled && ['name', 'description', 'problem', 'targetUsers', 'capabilities'].every(k => typeof p[k] === 'string' && p[k].trim()));
}

function signature(comment, product, model, endpoint) {
  return JSON.stringify([comment.id, comment.text, comment.parentPost || '', comment.replyParent || '', product, model, endpoint]);
}

function parseAI(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('AI 返回的不是有效 JSON'); }
}

function score(result) {
  const urgency = { high: 100, medium: 50, low: 0, unknown: 0 }[result.urgency];
  const opportunityScore = Math.round(result.intent_score * .4 + result.pain_score * .25 + result.commercial_score * .2 + urgency * .15);
  const priorityScore = Math.round((opportunityScore * .6 + result.product_fit_score * .4) * 10) / 10;
  return { opportunityScore, priorityScore };
}

function validateResult(raw, requested) {
  if (!raw || typeof raw !== 'object' || typeof raw.comment_id !== 'string' || !requested.has(raw.comment_id)) throw new Error('AI 结果缺少对应评论 ID');
  if (typeof raw.is_opportunity !== 'boolean' || !TYPES.has(raw.opportunity_type)) throw new Error('AI 商机类型无效');
  for (const field of ['intent_score', 'pain_score', 'commercial_score', 'product_fit_score']) {
    if (!Number.isFinite(raw[field]) || raw[field] < 0 || raw[field] > 100) throw new Error('AI 分数无效：' + field);
  }
  if (!['high', 'medium', 'low', 'unknown'].includes(raw.urgency)) throw new Error('AI 紧迫度无效');
  if (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw new Error('AI 置信度无效');
  for (const field of ['need', 'pain_point', 'budget_signal', 'fit_reason', 'evidence']) {
    if (typeof raw[field] !== 'string' || raw[field].length > 1000) throw new Error('AI 字段无效：' + field);
  }
  const source = requested.get(raw.comment_id);
  if (!raw.is_opportunity && raw.opportunity_type !== 'not_opportunity') throw new Error('AI 非商机类型矛盾');
  if (raw.is_opportunity && (!raw.need.trim() || !raw.fit_reason.trim())) throw new Error('AI 商机缺少需求或匹配理由');
  if (raw.is_opportunity && (!raw.evidence.trim() || ![source.comment, source.parent_post, source.reply_parent || ''].some(t => t.includes(raw.evidence)))) throw new Error('AI 判断依据不在原文中');
  if (raw.is_opportunity && raw.opportunity_type === 'not_opportunity') throw new Error('AI 商机类型矛盾');
  if (raw.budget_signal.toLowerCase() !== 'unknown' && !/预算|价格|多少钱|付费|购买|买|采购|报价|收费|pay|buy|budget|price|cost/i.test(source.comment)) throw new Error('评论没有明确预算或付费信号');
  return { ...raw, ...score(raw) };
}

function validateBatch(parsed, items) {
  if (!parsed || !Array.isArray(parsed.results)) throw new Error('AI 缺少 results 数组');
  const requested = new Map(items.map(x => [x.comment_id, x]));
  if (parsed.results.length !== items.length) throw new Error('AI 返回数量与请求不符');
  const seen = new Set();
  return parsed.results.map(raw => {
    const result = validateResult(raw, requested);
    if (seen.has(result.comment_id)) throw new Error('AI 返回重复评论');
    seen.add(result.comment_id);
    return result;
  });
}

module.exports = { ruleMatch, belongsToThread, commentsForThread, validProduct, signature, parseAI, score, validateResult, validateBatch, TYPES };
