'use strict';

const opportunity = require('./opportunity.js');

function endpointOf(base) {
  let url;
  try { url = new URL(String(base || '').trim()); } catch { throw new Error('API Base URL 无效'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('AI 地址必须是 HTTPS 或本机 HTTP');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
  return url.href;
}

function originPattern(base) {
  const url = new URL(endpointOf(base));
  return url.protocol + '//' + url.hostname + '/*';
}

async function requestChat(settings, messages, maxTokens, fetchImpl = fetch) {
  const endpoint = endpointOf(settings.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeout || 30000);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
      body: JSON.stringify({ model: settings.model, temperature: settings.temperature, max_tokens: maxTokens, messages }),
      signal: controller.signal
    });
    const body = await response.text();
    if (body.length > 250000) throw new Error('AI 响应过大');
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      if (!response.ok) throw new Error('AI 接口返回 HTTP ' + response.status + '，响应不是 JSON');
      throw new Error('AI 接口响应格式无效（不是 JSON）');
    }
    const detail = value => String(value || '').replaceAll(settings.apiKey || '\0', '[已隐藏]').replace(/\s+/g, ' ').slice(0, 180);
    const serviceError = parsed?.error;
    if (!response.ok || serviceError) {
      const message = detail(typeof serviceError === 'string' ? serviceError : serviceError?.message);
      const code = detail(serviceError?.code || serviceError?.type);
      throw new Error('AI 接口返回 HTTP ' + response.status + (code ? '（' + code + '）' : '') + (message ? '：' + message : ''));
    }
    const choice = parsed?.choices?.[0];
    const rawContent = choice?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent
      : Array.isArray(rawContent) ? rawContent.map(x => typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '').join('')
      : typeof choice?.text === 'string' ? choice.text : parsed?.output_text;
    if (typeof content !== 'string' || !content.trim()) {
      const reason = detail(choice?.finish_reason);
      const used = parsed?.usage?.completion_tokens;
      const reasoning = parsed?.usage?.completion_tokens_details?.reasoning_tokens;
      const refusal = detail(choice?.message?.refusal);
      const facts = [reason && '结束原因 ' + reason, Number.isFinite(used) && '输出 token ' + used,
        Number.isFinite(reasoning) && '其中推理 token ' + reasoning].filter(Boolean);
      const hint = reason === 'length' ? '输出额度已耗尽，可换用非推理模型或提高模型输出上限'
        : refusal ? '模型拒绝：' + refusal : !choice ? '响应缺少 choices[0]，请检查接口是否兼容 Chat Completions'
          : '请检查模型是否支持 Chat Completions 文本输出';
      throw new Error('AI 接口返回空内容' + (facts.length ? '（' + facts.join('，') + '）' : '') + '；' + hint);
    }
    return content;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 请求超时');
    throw error;
  } finally { clearTimeout(timeout); }
}

const SYSTEM = [
  '你是 X 讨论需求雷达。目标是从真实原话判断人们需要解决什么问题，以及可能做什么产品或服务；不寻找某个已有产品的客户。只输出 JSON 对象 {"results":[...]}，每个 post_id 恰好一项。',
  '逐条判断原帖和评论本身的真实需求，并结合可用的父帖上下文。原帖也可能直接表达需求。普通闲聊、广告、转述别人的需求、纯新闻和没有具体问题的泛泛感慨应标记 is_demand=false。不能仅凭关键词判断。',
  '有需求时，输出 post_id,is_demand,cluster_id,cluster_name,demand_type,need,pain_point,target_users,current_solution,solution_evidence,need_evidence,payment_evidence,demand_strength,pain_score,payment_score,competition_level,competition_evidence,directions。',
  'cluster_id 只可用 existing_clusters 中确实语义相同的 ID；新主题用空字符串，同一批相同新主题使用完全相同的 cluster_name。cluster_name 是简短、中性的需求名称，不是产品名。',
  'demand_type 只用 tool_request,service_request,solution_search,pain_point,repetitive_work,payment_intent,other。三个分数为 0-100 数字。',
  'need_evidence 必须逐字摘录自该帖子本身。仅明确提到付款、预算、价格、采购等时填写 payment_evidence（逐字摘录帖子），否则置空且 payment_score=0。',
  '当前方案只有在帖子或父帖明确提到时才填写，并提供逐字 solution_evidence；否则两字段置空。competition_level 只能依据讨论中明确提到的替代方案/竞争工具判断并提供逐字 competition_evidence，否则为 unknown 且证据为空。不得声称完成市场调查。',
  'directions 给出 1-3 个可卖的产品或服务方向，避免虚构已存在的能力；其他不确定字段用空字符串。不是需求时只输出 post_id 和 is_demand=false。'
].join('\n');

async function analyze(settings, items, clusters = [], fetchImpl = fetch) {
  const payload = items.map(x => ({ post_id: x.post_id, text: x.text, parent_text: x.parent_text || '', created_at: x.created_at || '' }));
  const existing = clusters.map(x => ({ id: x.id, name: x.name, pain_points: x.painPoints?.slice(0, 2) || [] })).slice(0, 200);
  const prompt = JSON.stringify({ discussions: payload, existing_clusters: existing });
  const response = await requestChat(settings, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], Math.min(10000, 900 + items.length * 850), fetchImpl);
  return opportunity.validateBatch(opportunity.parseAI(response), payload, existing);
}

async function testConnection(settings, fetchImpl = fetch) {
  await requestChat(settings, [{ role: 'user', content: '请只回复 OK。' }], 512, fetchImpl);
  return true;
}

module.exports = { endpointOf, originPattern, requestChat, analyze, testConnection };
