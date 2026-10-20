'use strict';

const demand = require('../shared/opportunity.js');
const context = require('./post-context.js');

function rpc(action, payload = {}) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'xp-opportunity', action, payload }, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error || '需求机会操作失败'));
    resolve(response.result);
  }));
}

function createOpportunityUI({ state, el }) {
  const markers = new Map(), clusters = new Map();
  let panel = null, launcher = null, modal = null, busy = false, closed = false, drag = null;
  let position = null, attempted = new Set(), scanSignature = '', progress = null, error = '', lastUrl = '';
  const seenPageIds = new Set(), seenDomPosts = new Map();
  const button = (label, click) => { const b = el('button', 'xp-opp-button', label); b.type = 'button'; b.addEventListener('click', click); return b; };
  const clearMarkers = () => { for (const marker of markers.values()) marker.remove(); markers.clear(); };
  const closeModal = () => { modal?.remove(); modal = null; };

  function placePanel(left, top) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, left));
    const y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, top));
    position = { left: x, top: y };
    panel.style.setProperty('left', x + 'px', 'important');
    panel.style.setProperty('top', y + 'px', 'important');
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
  }

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest?.('button')) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    panel.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  window.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    placePanel(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  const stopDrag = event => { if (drag && event.pointerId === drag.pointerId) drag = null; };
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
  window.addEventListener('resize', () => { if (position && panel?.isConnected) placePanel(position.left, position.top); });

  function articles() {
    const found = [...document.querySelectorAll('article[data-testid="tweet"]')].map(article => ({ article, id: context.postIdOf(article) })).filter(x => x.id);
    for (const { article, id } of found) {
      seenPageIds.add(id);
      const text = context.textOf(article);
      if (text) seenDomPosts.set(id, { id, text });
    }
    return found;
  }
  function observedPost(id) {
    const cached = state.posts.get(id), visible = seenDomPosts.get(id);
    return cached?.text ? cached : visible ? { ...cached, ...visible } : undefined;
  }
  function pagePosts() {
    return [...seenPageIds].map(observedPost).filter(post => post?.text);
  }
  function pageClusters() {
    return [...clusters.values()].filter(x => x.sourceIds?.some(id => seenPageIds.has(id))).sort((a, b) => b.opportunityScore - a.opportunityScore);
  }
  function row(card, label, value) {
    const p = el('p', 'xp-opp-detail-row');
    p.append(el('strong', '', label + '：'), el('span', '', String(value || '未观察到')));
    card.append(p);
  }
  function showDetail(cluster) {
    closeModal();
    const wrap = el('div', 'xp-opp-modal'), card = el('section', 'xp-opp-card');
    card.append(el('h2', '', cluster.name));
    row(card, '出现次数', cluster.demandCount);
    row(card, '付费信号', cluster.paymentSignalCount);
    row(card, '需求强度 / 机会评分', cluster.demandStrength + ' / ' + cluster.opportunityScore);
    row(card, '判断', cluster.verdict);
    row(card, '用户痛点', (cluster.painPoints || []).join('；'));
    row(card, '目标用户', (cluster.targetUsers || []).join('；'));
    row(card, '需求趋势', cluster.trend);
    row(card, '当前解决方案', (cluster.currentSolutions || []).join('；'));
    row(card, '竞争线索', cluster.competitionLevel === 'unknown' ? '讨论样本不足' : cluster.competitionLevel + ' · ' + cluster.competitionEvidence);
    row(card, '可能可以做 / 卖', (cluster.possibleDirections || []).join('；'));
    row(card, '典型原话', (cluster.quotes || []).map(x => '“' + x.text + '”').join('；'));
    const actions = el('div', 'xp-opp-actions');
    if (!cluster.inPool) actions.append(button('加入机会池', async () => {
      try { const updated = await rpc('addToPool', { id: cluster.id }); clusters.set(updated.id, updated); showDetail(updated); drawPanel(); }
      catch (e) { error = e.message; drawPanel(); }
    }));
    else actions.append(el('span', '', '已加入机会池'));
    if (cluster.quotes?.[0]?.url) actions.append(button('打开原讨论', () => window.open(cluster.quotes[0].url, '_blank', 'noopener')));
    actions.append(button('关闭', closeModal));
    card.append(actions); wrap.append(card); document.documentElement.append(wrap); modal = wrap;
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
  }

  function drawPanel() {
    if (!panel) return;
    panel.replaceChildren();
    const top = el('div', 'xp-opp-head');
    top.append(el('strong', '', '需求机会雷达'));
    const close = button('×', () => { closed = true; drag = null; render(); });
    close.className = 'xp-opp-close'; close.setAttribute('aria-label', '关闭需求机会雷达');
    top.append(close); top.addEventListener('pointerdown', startDrag);
    panel.append(top);
    const scanButton = button(busy ? '正在分析…' : attempted.size ? '分析下一批' : '扫描当前页面', scan);
    scanButton.disabled = busy; panel.append(scanButton);
    const posts = pagePosts(), found = pageClusters();
    panel.append(el('p', 'xp-opp-stats', '本页已观察帖子/评论 ' + posts.length + ' · 需求机会 ' + found.length + '（只基于已加载内容）'));
    if (progress) panel.append(el('p', 'xp-opp-stats', '候选 ' + progress.candidates + ' · 已分析 ' + progress.analyzed + ' · 新 AI 分析 ' + progress.aiCount));
    if (error) panel.append(el('p', 'xp-opp-error', error));
    if (found.length) {
      const list = el('div', 'xp-opp-list');
      for (const rec of found) list.append(button(rec.name + ' · ' + rec.demandCount + ' 次 · 机会 ' + rec.opportunityScore + (rec.inPool ? ' ✓' : ''), () => showDetail(rec)));
      panel.append(list);
    }
    if (position && panel.isConnected) placePanel(position.left, position.top);
  }

  async function load() {
    try {
      const found = await rpc('list');
      clusters.clear(); for (const rec of found) clusters.set(rec.id, rec);
      drawPanel(); render();
    } catch (e) { error = e.message; drawPanel(); }
  }

  async function scan() {
    if (busy) return;
    const scanUrl = location.href;
    busy = true; error = ''; drawPanel();
    try {
      await rpc('ready');
      const config = await rpc('config');
      if (location.href !== scanUrl) return;
      const signature = JSON.stringify([config.ai?.baseUrl, config.ai?.model]);
      if (signature !== scanSignature) { scanSignature = signature; attempted = new Set(); }
      articles();
      const posts = pagePosts().filter(p => demand.scanCandidate(p.text));
      const candidateKey = p => JSON.stringify([p.id, p.text, observedPost(p.inReplyToId)?.text || '']);
      const selected = posts.filter(p => !attempted.has(candidateKey(p))).slice(0, 100);
      if (!selected.length) { error = posts.length ? '当前已显示的讨论均已分析；滚动加载更多后再试' : '当前页面没有可分析的讨论'; return; }
      progress = { candidates: posts.length, analyzed: 0, aiCount: 0 };
      for (let offset = 0; offset < selected.length; offset += 10) {
        if (location.href !== scanUrl) return;
        const batchPosts = selected.slice(offset, offset + 10);
        const items = batchPosts.map(p => ({ post_id: p.id, text: p.text,
          parent_text: observedPost(p.inReplyToId)?.text || '', created_at: p.createdAt || '', author_handle: p.authorHandle }));
        const response = await rpc('analyze', { items });
        if (location.href !== scanUrl) return;
        for (const rec of response.clusters) clusters.set(rec.id, rec);
        for (const p of batchPosts) attempted.add(candidateKey(p));
        progress.analyzed += batchPosts.length; progress.aiCount += response.aiCount;
        drawPanel(); render();
      }
      await load();
    } catch (e) { error = e.message; }
    finally { busy = false; drawPanel(); render(); }
  }

  function render() {
    if (location.href !== lastUrl) { lastUrl = location.href; seenPageIds.clear(); seenDomPosts.clear(); attempted = new Set(); progress = null; error = ''; closeModal(); load(); }
    const visible = articles();
    if (!visible.length) { panel?.remove(); launcher?.remove(); clearMarkers(); return; }
    if (!panel) panel = el('section', 'xp-opp-panel xp-opp-floating');
    if (!launcher) {
      launcher = button('需求雷达', () => { closed = false; render(); });
      launcher.className = 'xp-opp-launcher';
      launcher.setAttribute('aria-label', '打开需求机会雷达');
    }
    if (closed) {
      panel.remove();
      if (launcher.parentElement !== document.documentElement) document.documentElement.append(launcher);
    } else {
      launcher.remove();
      if (panel.parentElement !== document.documentElement) document.documentElement.append(panel);
    }
    const byPost = new Map();
    for (const rec of pageClusters()) for (const id of rec.sourceIds) byPost.set(id, rec);
    for (const [article, marker] of markers) {
      const id = context.postIdOf(article);
      if (!article.isConnected || !byPost.has(id) || marker.dataset.xpPostId !== id) { marker.remove(); markers.delete(article); }
    }
    for (const { article, id } of visible) {
      const rec = byPost.get(id);
      if (!rec || markers.has(article)) continue;
      const marker = button('需求：' + rec.name, () => showDetail(rec));
      marker.className = 'xp-opp-marker'; marker.dataset.xpPostId = id;
      article.append(marker); markers.set(article, marker);
    }
    drawPanel();
  }

  return { render, scan, postIdFromArticle: context.postIdOf, reload: load };
}

module.exports = createOpportunityUI;
