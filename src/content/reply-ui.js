'use strict';
// Reply suggestions: a small chip under each post opens a card with short,
// human-sounding replies the user can copy. The post is re-read from the DOM on
// every click because X recycles article nodes while scrolling.

const context = require('./post-context.js');

const CARD_TITLE = '回复建议';

function rpc(action, payload = {}) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'xp-opportunity', action, payload }, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error || '回复建议操作失败'));
    resolve(response.result);
  }));
}

async function copyToClipboard(text) {
  if (!navigator?.clipboard?.writeText) throw new Error('当前浏览器不支持一键复制，请手动选中文本');
  await navigator.clipboard.writeText(text);
}

function shorten(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max) + '…' : value;
}

function createReplyUI({ state, el }) {
  const chips = new Map(); // article -> button
  let overlay = null, busy = false, error = '', activePost = null, suggestions = [], copiedText = '', token = 0, lastUrl = '';

  const closeCard = () => {
    token++;
    overlay?.remove();
    overlay = null;
    document.removeEventListener?.('keydown', onKeydown);
  };

  function onKeydown(event) {
    if (event.key === 'Escape') closeCard();
  }

  function draw() {
    if (!overlay) return;
    overlay.replaceChildren();
    const card = el('section', 'xp-reply-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', CARD_TITLE);
    const head = el('div', 'xp-reply-head');
    head.append(el('strong', '', CARD_TITLE));
    const close = el('button', 'xp-reply-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭回复建议');
    close.addEventListener('click', closeCard);
    head.append(close);
    card.append(head);

    if (activePost) {
      card.append(el('p', 'xp-reply-context', shorten((activePost.authorHandle ? '@' + activePost.authorHandle + ' · ' : '') + activePost.text, 96)));
    }
    if (error) card.append(el('p', 'xp-reply-error', error));
    if (busy) {
      card.append(el('p', 'xp-reply-status', '正在按原帖的语气想回复…'));
    } else if (suggestions.length) {
      const list = el('div', 'xp-reply-list');
      for (const item of suggestions) {
        const row = el('div', 'xp-reply-item');
        const top = el('div', 'xp-reply-item-head');
        top.append(el('span', 'xp-reply-tone', item.tone || '回复'));
        const copy = el('button', 'xp-reply-copy', copiedText === item.text ? '已复制' : '复制');
        copy.type = 'button';
        copy.addEventListener('click', () => copyOne(item.text));
        top.append(copy);
        row.append(top, el('p', 'xp-reply-text', item.text));
        list.append(row);
      }
      card.append(list);
    }

    const actions = el('div', 'xp-reply-actions');
    const again = el('button', 'xp-reply-button', busy ? '正在生成…' : suggestions.length ? '换一批' : '再试一次');
    again.type = 'button';
    again.disabled = busy;
    again.addEventListener('click', () => { if (activePost) load(activePost, true); });
    const done = el('button', 'xp-reply-button', '关闭');
    done.type = 'button';
    done.addEventListener('click', closeCard);
    actions.append(again, done);
    card.append(actions);
    overlay.append(card);
  }

  async function copyOne(text) {
    try {
      await copyToClipboard(text);
      copiedText = text;
      error = '';
    } catch (e) {
      error = e?.message || String(e);
    }
    draw();
  }

  function open(article) {
    const post = context.readPost(article);
    if (!post) return;
    activePost = post;
    suggestions = [];
    copiedText = '';
    error = '';
    token++;
    if (!overlay) {
      overlay = el('div', 'xp-reply-modal');
      overlay.addEventListener('click', event => { if (event.target === overlay) closeCard(); });
      document.documentElement.append(overlay);
      document.addEventListener?.('keydown', onKeydown);
    }
    load(post, false);
  }

  async function load(post, force) {
    const requestToken = ++token;
    busy = true;
    error = '';
    draw();
    try {
      const result = await rpc('reply', {
        post: { id: post.id, text: post.text, author_handle: post.authorHandle },
        force
      });
      if (requestToken !== token) return;
      suggestions = Array.isArray(result?.replies) ? result.replies : [];
      if (!suggestions.length) throw new Error('AI 没有返回可用的回复，请重试');
      copiedText = '';
    } catch (e) {
      if (requestToken !== token) return;
      suggestions = [];
      error = e?.message || String(e);
    } finally {
      if (requestToken === token) {
        busy = false;
        draw();
      }
    }
  }

  function chipFor(article) {
    let chip = chips.get(article);
    if (!chip) {
      chip = el('button', 'xp-reply-chip', '✦ 想回复');
      chip.type = 'button';
      chip.setAttribute('aria-label', '为这条帖子生成回复建议');
      chip.addEventListener('click', event => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        open(article);
      });
      chips.set(article, chip);
    }
    return chip;
  }

  function render() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (overlay) closeCard();
    }
    const live = new Set();
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      live.add(article);
      if (!context.readPost(article)) {
        chips.get(article)?.remove();
        chips.delete(article);
        continue;
      }
      const chip = chipFor(article);
      if (chip.parentElement !== article) article.append(chip);
    }
    for (const [article, chip] of chips) {
      if (!live.has(article) || !article.isConnected) {
        chip.remove();
        chips.delete(article);
      }
    }
  }

  return { render, open, close: closeCard };
}

module.exports = createReplyUI;
