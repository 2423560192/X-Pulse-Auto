'use strict';

function mountDemandUI({ field, rpc, error }) {
  let opportunities = [], selectedId = '';
  const button = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; };
  const textRow = (box, label, value) => {
    const p = document.createElement('p'), strong = document.createElement('strong');
    strong.textContent = label + '：';
    p.append(strong, document.createTextNode(String(value ?? '未观察到'))); box.append(p);
  };

  function filtered() {
    const query = field('opp-search').value.trim().toLowerCase();
    const view = field('opp-view').value;
    const sort = field('opp-sort').value;
    return opportunities.filter(x => (view !== 'pool' || x.inPool) &&
      (!query || [x.name, ...(x.painPoints || []), ...(x.targetUsers || []), ...(x.possibleDirections || [])].join(' ').toLowerCase().includes(query)))
      .sort((a, b) => sort === 'count' ? b.demandCount - a.demandCount : sort === 'recent' ? b.updatedAt - a.updatedAt : b.opportunityScore - a.opportunityScore);
  }

  function detail() {
    const box = field('opp-detail'); box.replaceChildren();
    const rec = opportunities.find(x => x.id === selectedId);
    if (!rec) return;
    const title = document.createElement('strong'); title.textContent = rec.name; box.append(title);
    for (const [label, value] of [
      ['出现次数', rec.demandCount], ['付费信号次数', rec.paymentSignalCount],
      ['需求强度', rec.demandStrength], ['频率分', rec.frequencyScore], ['痛点程度', rec.painScore],
      ['付费意愿', rec.paymentScore], ['机会评分', rec.opportunityScore], ['判断', rec.verdict],
      ['典型原话', (rec.quotes || []).map(x => '“' + x.text + '”').join('；')],
      ['用户痛点', (rec.painPoints || []).join('；')], ['目标用户', (rec.targetUsers || []).join('；')],
      ['需求趋势', rec.trend], ['当前解决方案', (rec.currentSolutions || []).join('；')],
      ['竞争线索', rec.competitionLevel === 'unknown' ? '讨论样本不足' : rec.competitionLevel + ' · ' + rec.competitionEvidence],
      ['可能可以做／卖', (rec.possibleDirections || []).join('；')],
      ['备注', rec.note || '无'], ['标签', (rec.tags || []).join('、') || '无']
    ]) textRow(box, label, value);
    const actions = document.createElement('div'); actions.className = 'button-row';
    if (!rec.inPool) actions.append(button('加入机会池', () => change('addToPool', { id: rec.id })));
    else actions.append(
      button(rec.favorite ? '取消收藏' : '收藏', () => change('update', { id: rec.id, patch: { favorite: !rec.favorite } })),
      button('备注', () => { const note = prompt('机会备注', rec.note || ''); if (note !== null) change('update', { id: rec.id, patch: { note } }); }),
      button('标签', () => { const tags = prompt('标签，逗号分隔', (rec.tags || []).join(', ')); if (tags !== null) change('update', { id: rec.id, patch: { tags } }); }),
      button('移出机会池', () => { if (confirm('将此需求移出机会池？发现记录会保留。')) change('remove', { id: rec.id }); })
    );
    for (const [index, quote] of (rec.quotes || []).entries()) if (quote.url) actions.append(button('打开原讨论 ' + (index + 1), () => chrome.tabs.create({ url: quote.url })));
    box.append(actions);
  }

  function render() {
    const list = field('opp-list'); list.replaceChildren();
    const items = filtered();
    if (!items.length) { const li = document.createElement('li'); li.className = 'opp-empty'; li.textContent = field('opp-view').value === 'pool' ? '机会池为空：请先从发现的需求中确认' : '暂无需求机会；请在 X 页面手动扫描'; list.append(li); }
    for (const rec of items) {
      const li = document.createElement('li'); li.className = 'opp-item';
      li.append(button(rec.name + ' · ' + rec.demandCount + ' 次 · 机会 ' + rec.opportunityScore + (rec.inPool ? ' ✓' : ''), () => { selectedId = rec.id; detail(); }));
      const snippet = document.createElement('div'); snippet.className = 'opp-snippet';
      snippet.textContent = '付费信号 ' + rec.paymentSignalCount + ' 次 · ' + (rec.possibleDirections?.[0] || '查看可能方向');
      li.append(snippet); list.append(li);
    }
    detail();
  }

  async function refresh() {
    try { opportunities = await rpc('list'); render(); }
    catch (e) { error.textContent = e.message; }
  }
  async function change(action, payload) {
    try { await rpc(action, payload); error.textContent = ''; await refresh(); }
    catch (e) { error.textContent = e.message; }
  }
  for (const id of ['opp-search', 'opp-view', 'opp-sort']) field(id).addEventListener(id === 'opp-search' ? 'input' : 'change', render);
  field('opp-refresh').addEventListener('click', refresh);
  refresh();
  return { refresh, render };
}

module.exports = mountDemandUI;
