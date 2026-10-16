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
    if (!response.ok) throw new Error('AI 接口返回 HTTP ' + response.status);
    const body = await response.text();
    if (body.length > 250000) throw new Error('AI 响应过大');
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new Error('AI 接口响应格式无效'); }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('AI 接口未返回文本');
    return content;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 请求超时');
    throw error;
  } finally { clearTimeout(timeout); }
}

const SYSTEM = [
  '你是 X 评论商机分析器。只输出 JSON 对象 {"results":[...]}，逐条对应输入 comment_id，不得遗漏或重复。',
  '只根据原帖、回复上下文、评论和产品资料判断，不得编造预算、购买意愿或未出现的事实。粉丝数不能单独决定商机分数。',
  '每项包含 comment_id,is_opportunity,opportunity_type,intent_score,pain_score,commercial_score,urgency,product_fit_score,need,pain_point,budget_signal,fit_reason,evidence,confidence。',
  '分数为 0-100 数字；urgency 为 high/medium/low/unknown；confidence 为 0-1。budget_signal 未明确提到时写 unknown。',
  'evidence 必须逐字摘录自该评论或提供的原帖/回复上下文；没有商机时 is_opportunity=false、opportunity_type=not_opportunity、evidence 可为空。',
  'opportunity_type 只用 tool_request,solution_request,api_request,purchase_intent,service_request,pain_point,outsourcing,collaboration,recommendation,other,not_opportunity。'
].join('\n');

async function analyze(settings, product, items, fetchImpl = fetch) {
  const payload = items.map(x => ({ comment_id: x.comment_id, parent_post: x.parent_post, reply_parent: x.reply_parent || '', comment: x.comment, author: x.author }));
  const prompt = JSON.stringify({ product, comments: payload });
  const response = await requestChat(settings, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], Math.min(8000, 800 + items.length * 550), fetchImpl);
  return opportunity.validateBatch(opportunity.parseAI(response), payload);
}

async function testConnection(settings, fetchImpl = fetch) {
  const content = await requestChat(settings, [{ role: 'user', content: 'Reply with OK.' }], 8, fetchImpl);
  if (!content.trim()) throw new Error('AI 连接测试未返回内容');
  return true;
}

module.exports = { endpointOf, originPattern, requestChat, analyze, testConnection };
