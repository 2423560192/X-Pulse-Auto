'use strict';
// DOM -> post context readers shared by the content-script features.
// X virtualizes rows, so callers must re-read the article on every use instead
// of caching the post text against a DOM node.

function postIdOf(article) {
  const dated = article.querySelector?.('time')?.closest?.('a[href]');
  const links = dated ? [dated] : article.querySelectorAll?.('a[href]') || [];
  for (const link of links) {
    const match = String(link.getAttribute('href') || '').match(/\/status\/(\d{1,40})(?:[/?#]|$)/);
    if (match) return match[1];
  }
  return '';
}

function authorHandleOf(article) {
  const nameBlock = article.querySelector?.('[data-testid="User-Name"]');
  const links = nameBlock?.querySelectorAll?.('a[href]') || [];
  for (const link of links) {
    const match = String(link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (match) return match[1];
  }
  return '';
}

function textOf(article) {
  const node = article.querySelector?.('[data-testid="tweetText"]');
  return String(node?.innerText || node?.textContent || '').trim().slice(0, 4000);
}

function readPost(article) {
  const text = textOf(article);
  if (!text) return null;
  const id = postIdOf(article);
  if (!id) return null;
  return { id, text, authorHandle: authorHandleOf(article) };
}

module.exports = { postIdOf, authorHandleOf, textOf, readPost };
