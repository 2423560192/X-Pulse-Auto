'use strict';
// AI judges meaning; local code validates claims and aggregates observed evidence.

const TYPES = new Set(['tool_request', 'service_request', 'solution_search', 'pain_point', 'repetitive_work', 'payment_intent', 'other']);
const COMPETITION = new Set(['high', 'medium', 'low', 'unknown']);
const TRIVIAL = /^(?:哈+|哈哈+|确实|赞|支持|第一|6+|牛|👍+|😂+|🤣+|🔥+|yes|ok|thanks)$/i;
const SPAM = /加群|私信领取|点击链接|免费领|airdrop|giveaway|dm me/i;
const MONEY = /预算|价格|多少钱|付费|给钱|花钱|购买|买|采购|报价|收费|订阅|pay|paid|buy|purchase|budget|price|cost|hire|spend|bucks|dollars|\$|¥|￥/i;

function scanCandidate(text) {
  const value = String(text || '').trim();
  return value.length >= 4 && !TRIVIAL.test(value) && !SPAM.test(value) && /[\p{L}\p{N}]/u.test(value);
}

function parseAI(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('AI 返回的不是有效 JSON'); }
}

function validateBatch(parsed, items, clusters = []) {
  if (!parsed || !Array.isArray(parsed.results) || parsed.results.length !== items.length) throw new Error('AI 返回数量与请求不符');
  const requested = new Map(items.map(x => [String(x.post_id), x]));
  const existing = new Set(clusters.map(x => x.id));
  const seen = new Set();
  return parsed.results.map(raw => {
    const id = raw?.post_id;
    if (typeof id !== 'string' || !requested.has(id) || seen.has(id)) throw new Error('AI 返回缺失或重复的帖子 ID');
    seen.add(id);
    if (typeof raw.is_demand !== 'boolean') throw new Error('AI 缺少需求判断');
    if (!raw.is_demand) return { post_id: id, is_demand: false };
    if (!TYPES.has(raw.demand_type)) throw new Error('AI 需求类型无效');
    if (typeof raw.cluster_id !== 'string' || (raw.cluster_id && !existing.has(raw.cluster_id))) throw new Error('AI 聚类 ID 无效');
    for (const field of ['cluster_name', 'need', 'pain_point', 'target_users', 'current_solution', 'solution_evidence', 'need_evidence', 'payment_evidence', 'competition_evidence']) {
      if (typeof raw[field] !== 'string' || raw[field].length > 500) throw new Error('AI 字段无效：' + field);
    }
    if (raw.cluster_name.length > 100) throw new Error('需求名称过长');
    if (!raw.cluster_name.trim() || !raw.need.trim() || !raw.need_evidence.trim()) throw new Error('AI 需求缺少名称或原话证据');
    const source = requested.get(id);
    if (!source.text.includes(raw.need_evidence)) throw new Error('需求证据不在帖子原文中');
    if (raw.payment_evidence && (!source.text.includes(raw.payment_evidence) || !MONEY.test(raw.payment_evidence))) throw new Error('付费信号缺少原文依据');
    if (raw.solution_evidence && ![source.text, source.parent_text || ''].some(x => x.includes(raw.solution_evidence))) throw new Error('现有方案证据不在讨论中');
    if (raw.current_solution && !raw.solution_evidence) throw new Error('现有方案缺少证据');
    if (!COMPETITION.has(raw.competition_level)) throw new Error('竞争程度无效');
    if (raw.competition_level !== 'unknown' && (!raw.competition_evidence || ![source.text, source.parent_text || ''].some(x => x.includes(raw.competition_evidence)))) throw new Error('竞争判断缺少讨论证据');
    if (!Array.isArray(raw.directions) || raw.directions.length < 1 || raw.directions.length > 3 || raw.directions.some(x => typeof x !== 'string' || !x.trim() || x.length > 100)) throw new Error('可能方向无效');
    for (const field of ['demand_strength', 'pain_score', 'payment_score']) {
      if (!Number.isFinite(raw[field]) || raw[field] < 0 || raw[field] > 100) throw new Error('AI 分数无效：' + field);
    }
    if (!raw.payment_evidence && raw.payment_score !== 0) throw new Error('无付费证据时付费分数必须为 0');
    return { ...raw, cluster_name: raw.cluster_name.trim(), directions: raw.directions.map(x => x.trim()) };
  });
}

function normalizeName(value) { return String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); }
const average = (items, key) => items.length ? Math.round(items.reduce((sum, x) => sum + x[key], 0) / items.length) : 0;
function unique(values, limit) { return [...new Set(values.map(x => String(x || '').trim()).filter(Boolean))].slice(0, limit); }

function trendOf(items) {
  const dates = items.map(x => Date.parse(x.createdAt || '')).filter(Number.isFinite);
  if (dates.length < 5 || Math.max(...dates) - Math.min(...dates) < 14 * 86400000) return '样本不足';
  const end = Math.max(...dates);
  const recent = dates.filter(x => x > end - 7 * 86400000).length;
  const prior = dates.filter(x => x <= end - 7 * 86400000 && x > end - 14 * 86400000).length;
  if (!prior) return '样本不足';
  return '已扫描样本：' + (recent > prior * 1.2 ? '上升' : recent < prior * .8 ? '下降' : '持平') + '（近 7 天 ' + recent + ' / 前 7 天 ' + prior + '）';
}

function summarizeCluster(meta, items, previous = {}) {
  const demandCount = items.length;
  const demandStrength = average(items, 'demandStrength');
  const painScore = average(items, 'painScore');
  const paymentSignalCount = items.filter(x => x.paymentEvidence).length;
  const paymentScore = average(items, 'paymentScore');
  const frequencyScore = Math.round(Math.min(100, Math.log2(demandCount + 1) / Math.log2(20) * 100));
  const competition = items.find(x => x.competitionLevel !== 'unknown' && x.competitionEvidence);
  const competitionLevel = competition?.competitionLevel || 'unknown';
  const competitionGap = { high: 20, medium: 50, low: 80, unknown: 50 }[competitionLevel];
  const opportunityScore = Math.round(demandStrength * .35 + frequencyScore * .2 + painScore * .2 + paymentScore * .2 + competitionGap * .05);
  const verdict = demandCount < 3 ? '初步线索，继续收集样本' : opportunityScore >= 70 ? '这个需求值得关注' : opportunityScore >= 50 ? '值得持续观察' : '暂缓投入';
  return {
    ...meta, name: meta.name || items[0]?.clusterName || '未命名需求', demandCount, paymentSignalCount,
    demandStrength, painScore, paymentScore, frequencyScore, opportunityScore, verdict,
    competitionLevel, competitionEvidence: competition?.competitionEvidence || '',
    painPoints: unique(items.map(x => x.painPoint), 4), targetUsers: unique(items.map(x => x.targetUsers), 4),
    currentSolutions: unique(items.map(x => x.currentSolution), 4),
    possibleDirections: unique(items.flatMap(x => x.directions), 5),
    quotes: items.slice().sort((a, b) => b.demandStrength - a.demandStrength).slice(0, 3).map(x => ({ text: x.needEvidence, url: x.url, postId: x.postId })),
    sourceIds: items.map(x => x.postId), trend: trendOf(items),
    inPool: !!previous.inPool, favorite: !!previous.favorite, note: previous.note || '', tags: previous.tags || [],
    firstSeenAt: previous.firstSeenAt || Date.now(), updatedAt: Date.now()
  };
}

module.exports = { scanCandidate, parseAI, validateBatch, normalizeName, summarizeCluster, trendOf };
