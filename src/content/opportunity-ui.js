'use strict';

const opportunity = require('../shared/opportunity.js');

function rpc(action, payload = {}) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'xp-opportunity', action, payload }, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error || '商机操作失败'));
    resolve(response.result);
  }));
}

function postIdFromArticle(article) {
  const time = article.querySelector?.('time');
  const dated = time?.closest?.('a[href]');
  const links = dated ? [dated] : article.querySelectorAll?.('a[href]') || [];
  for (const link of links) {
    const match = String(link.getAttribute('href') || '').match(/\/status\/(\d{1,40})(?:[/?#]|$)/);
    if (match) return match[1];
  }
  return '';
}

function pagePostId() {
  return String(location.pathname || '').match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,40})(?:\/|$)/)?.[1] || '';
}

function createOpportunityUI({ state, el }) {
  const shown = new Map();
  let currentPostId = '', rootArticle = null, panel = null, modal = null;
  let records = new Map(), scanBusy = false, attempted = new Set(), scanSignature = '', progress = null, error = '';
  let listOpen = false, generation = 0;
  let activeProductSnapshot = '', activeModel = '', activeEndpoint = '';

  function recordsForPost() { return [...records.values()].filter(r => r.postId === currentPostId && r.productSnapshot === activeProductSnapshot && r.model === activeModel && r.aiEndpoint === activeEndpoint); }
  function band(score) { return score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low'; }
  function visible(r) {
    const setting = state.settings.opportunity?.badgeLevel || 'high';
    return setting === 'all' || (setting === 'medium' && r.opportunityScore >= 60) || r.opportunityScore >= 80;
  }
  function clearMarkers() { for (const marker of shown.values()) marker.remove(); shown.clear(); }
  function closeModal() { modal?.remove(); modal = null; }
  function makeButton(label, click) { const b = el('button', 'xp-opp-button', label); b.type = 'button'; b.addEventListener('click', click); return b; }

  async function changeRecord(rec, patch) {
    try { const next = await rpc('update', { id: rec.id, patch }); records.set(next.id, next); drawPanel(); if (modal) showDetail(next); }
    catch (e) { error = e.message; drawPanel(); }
  }

  function showDetail(rec) {
    closeModal();
    const wrap = el('div', 'xp-opp-modal');
    const card = el('section', 'xp-opp-card');
    const heading = el('h2', '', (rec.authorName || rec.authorHandle || '用户') + ' @' + (rec.authorHandle || 'unknown'));
    card.append(heading, el('p', '', '粉丝 ' + (rec.authorFollowers ?? '未知') + ' · 关注 ' + (rec.authorFollowing ?? '未知')));
    const rows = [
      ['原帖', rec.parentPostText], ['评论', rec.commentText], ['需求类型', rec.opportunityType],
      ['需求', rec.need], ['痛点', rec.painPoint], ['商机强度', rec.opportunityScore],
      ['产品匹配度', rec.productFitScore], ['优先级', rec.priorityScore],
      ['判断依据', rec.evidence], ['匹配理由', rec.fitReason], ['预算信号', rec.budgetSignal],
      ['发现时间', new Date(rec.createdAt).toLocaleString('zh-CN')]
    ];
    for (const [label, value] of rows) {
      const row = el('p', 'xp-opp-detail-row');
      row.append(el('strong', '', label + '：'), el('span', '', String(value ?? '未知')));
      card.append(row);
    }
    const actions = el('div', 'xp-opp-actions');
    actions.append(
      makeButton(rec.favorite ? '取消收藏' : '收藏商机', () => changeRecord(rec, { favorite: !rec.favorite })),
      makeButton('打开评论', () => window.open(rec.commentUrl, '_blank', 'noopener')),
      makeButton('打开用户', () => rec.authorHandle && window.open('https://x.com/' + rec.authorHandle, '_blank', 'noopener')),
      makeButton('关闭', closeModal)
    );
    card.append(actions); wrap.append(card); document.documentElement.append(wrap); modal = wrap;
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
  }

  function drawPanel() {
    if (!panel || !rootArticle) return;
    panel.replaceChildren();
    const top = el('div', 'xp-opp-head');
    top.append(el('strong', '', '商机雷达'));
    const scanLabel = scanBusy ? '正在分析…' : attempted.size ? '分析下一批' : '扫描评论商机';
    const scanButton = makeButton(scanLabel, scan);
    scanButton.disabled = scanBusy;
    top.append(scanButton);
    panel.append(top);
    const list = recordsForPost();
    const high = list.filter(r => r.opportunityScore >= 80).length;
    const medium = list.filter(r => r.opportunityScore >= 60 && r.opportunityScore < 80).length;
    const low = list.filter(r => r.opportunityScore < 60).length;
    const comments = opportunity.commentsForThread([...state.posts.values()], currentPostId);
    panel.append(el('p', 'xp-opp-stats', '已加载评论 ' + comments.length + ' · 发现商机 ' + list.length + '（高 ' + high + ' / 中 ' + medium + ' / 低 ' + low + '）'));
    if (progress) panel.append(el('p', 'xp-opp-stats', '规则初筛 ' + progress.filtered + ' · 已分析 ' + progress.analyzed + ' · 本次 AI 调用 ' + progress.aiCount));
    if (error) panel.append(el('p', 'xp-opp-error', error));
    if (list.length) {
      panel.append(makeButton(listOpen ? '收起商机' : '查看全部商机', () => { listOpen = !listOpen; drawPanel(); }));
      if (listOpen) {
        const box = el('div', 'xp-opp-list');
        for (const rec of list.sort((a, b) => b.priorityScore - a.priorityScore)) {
          box.append(makeButton('@' + (rec.authorHandle || 'unknown') + ' · 商机 ' + rec.opportunityScore + ' · 匹配 ' + rec.productFitScore, () => showDetail(rec)));
        }
        panel.append(box);
      }
    }
  }

  async function load(postId) {
    const targetGeneration = ++generation;
    try {
      const [found, config] = await Promise.all([rpc('list', { postId }), rpc('config')]);
      if (targetGeneration !== generation) return;
      activeProductSnapshot = JSON.stringify(config.product);
      activeModel = config.ai?.model || '';
      activeEndpoint = config.ai?.baseUrl || '';
      for (const rec of found) if (!records.has(rec.id)) records.set(rec.id, rec);
      drawPanel(); render();
    } catch (e) { if (targetGeneration === generation) { error = e.message; drawPanel(); } }
  }

  async function scan() {
    if (scanBusy || !currentPostId) return;
    scanBusy = true; error = ''; drawPanel();
    const scanPostId = currentPostId;
    try {
      await rpc('ready');
      const config = await rpc('config');
      activeProductSnapshot = JSON.stringify(config.product);
      activeModel = config.ai?.model || '';
      activeEndpoint = config.ai?.baseUrl || '';
      const nextSignature = JSON.stringify([config.product, config.ai?.baseUrl, config.ai?.model]);
      if (nextSignature !== scanSignature) { scanSignature = nextSignature; attempted = new Set(); }
      const posts = [...state.posts.values()];
      const root = state.posts.get(currentPostId);
      if (!root?.text) throw new Error('尚未捕获原帖内容，请刷新帖子并等待加载');
      const comments = opportunity.commentsForThread(posts, currentPostId);
      const eligible = comments.filter(p => opportunity.ruleMatch(p.text, config.product));
      const candidateKey = p => JSON.stringify([p.id, p.text, root.text, state.posts.get(p.inReplyToId)?.text || '']);
      const selected = eligible.filter(p => !attempted.has(candidateKey(p))).slice(0, 100);
      if (!selected.length) { error = eligible.length ? '当前已加载的候选评论均已分析' : '当前已加载评论中没有命中需求规则'; return; }
      progress = { filtered: eligible.length, analyzed: 0, aiCount: 0 };
      for (let offset = 0; offset < selected.length; offset += 10) {
        const batch = selected.slice(offset, offset + 10).map(p => {
          const user = state.cache.get(p.authorHandle) || {};
          return {
            comment_id: p.id, post_id: currentPostId, comment: p.text, parent_post: root.text,
            reply_parent: state.posts.get(p.inReplyToId)?.text || '',
            author: { id: p.authorId, handle: p.authorHandle, name: p.authorName,
              followers: user.followers ?? null, following: user.following ?? null }
          };
        });
        const response = await rpc('analyze', { items: batch });
        if (scanPostId !== currentPostId) return;
        for (const result of response.results) {
          for (const [id, rec] of records) if (rec.commentId === result.commentId && rec.productSnapshot === activeProductSnapshot && rec.model === activeModel && rec.aiEndpoint === activeEndpoint) records.delete(id);
          if (result.opportunity) records.set(result.opportunity.id, result.opportunity);
        }
        for (const p of selected.slice(offset, offset + 10)) attempted.add(candidateKey(p));
        progress.analyzed += batch.length;
        progress.aiCount += response.aiCount;
        drawPanel(); render();
      }
    } catch (e) { error = e.message; }
    finally { scanBusy = false; drawPanel(); render(); }
  }

  function render() {
    const id = pagePostId();
    if (id !== currentPostId) {
      currentPostId = id; rootArticle = null; panel?.remove(); panel = null;
      clearMarkers(); closeModal(); records = new Map(); attempted = new Set(); scanSignature = ''; progress = null; error = ''; listOpen = false; activeProductSnapshot = ''; activeModel = ''; activeEndpoint = '';
      if (id) load(id);
    }
    if (!id) { clearMarkers(); panel?.remove(); panel = null; return; }
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const byArticle = new Map();
    for (const article of articles) byArticle.set(article, postIdFromArticle(article));
    const root = [...byArticle].find(([, postId]) => postId === id)?.[0] || null;
    if (root !== rootArticle || (panel && !panel.isConnected)) {
      panel?.remove(); rootArticle = root; panel = null;
      if (root) { panel = el('section', 'xp-opp-panel'); root.append(panel); drawPanel(); }
    }
    const byComment = new Map(recordsForPost().map(r => [r.commentId, r]));
    for (const [article, marker] of shown) {
      if (!article.isConnected || !byComment.has(byArticle.get(article)) || !visible(byComment.get(byArticle.get(article)))) { marker.remove(); shown.delete(article); }
    }
    for (const [article, postId] of byArticle) {
      const rec = byComment.get(postId);
      if (!rec || !visible(rec)) continue;
      const prior = shown.get(article);
      if (prior?.dataset.xpCommentId === postId && prior.isConnected) continue;
      prior?.remove();
      const marker = makeButton('🔥 商机 ' + rec.opportunityScore + ' · 匹配 ' + rec.productFitScore, () => showDetail(rec));
      marker.className = 'xp-opp-marker xp-opp-' + band(rec.opportunityScore);
      marker.dataset.xpCommentId = postId;
      article.append(marker); shown.set(article, marker);
    }
  }

  return { render, postIdFromArticle, scan, reload: () => currentPostId && load(currentPostId) };
}

module.exports = createOpportunityUI;
