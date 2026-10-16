'use strict';
// PostRecord parsing: extracts normalized tweet records from X GraphQL payloads.
// Pure, no DOM; the DOM-to-post-id association lives in the content layer.

const core = require('./core.js');

function authorOf(raw) {
  const result = raw.core?.user_results?.result;
  return {
    authorId: String(result?.rest_id || raw.legacy?.user_id_str || raw.user_id_str || '').slice(0, 40),
    authorHandle: core.normalizeHandle(result?.legacy?.screen_name || raw.legacy?.screen_name || raw.author?.screen_name)
  };
}

function normalizePost(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.rest_id || raw.id_str || raw.id || '').slice(0, 40);
  if (!id) return null;
  const legacy = raw.legacy || {};
  const { authorId, authorHandle } = authorOf(raw);
  const author = raw.core?.user_results?.result;
  const inReplyToId = String(legacy.in_reply_to_status_id_str || raw.in_reply_to_status_id_str || raw.referenced_tweets?.find?.(x => x.type === 'replied_to')?.id || '').slice(0, 40);
  const conversationId = String(legacy.conversation_id_str || raw.conversation_id_str || raw.conversation_id || '').slice(0, 40);
  return {
    id,
    authorId,
    authorHandle,
    authorName: String(author?.core?.name || author?.legacy?.name || authorHandle).slice(0, 100),
    inReplyToId,
    conversationId,
    isReply: !!inReplyToId,
    isQuote: !!(legacy.is_quote_status || raw.quoted_status_result || legacy.quoted_status),
    text: String(legacy.full_text || legacy.text || raw.full_text || raw.text || '').slice(0, 4000),
    createdAt: String(legacy.created_at || raw.created_at || '').slice(0, 100)
  };
}

function isTweetNode(node) {
  if (node.__typename === 'Tweet') return true;
  const legacy = node.legacy;
  return !!legacy && (typeof legacy.full_text === 'string' || typeof legacy.text === 'string');
}

function extractPosts(json) {
  const queue = [json], found = new Map(), seen = new WeakSet();
  let examined = 0;
  while (queue.length && examined++ < 50000) {
    const node = queue.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (isTweetNode(node)) {
      const post = normalizePost(node);
      if (post && !found.has(post.id)) found.set(post.id, post);
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
  }
  return [...found.values()].slice(0, 500);
}

module.exports = { extractPosts, normalizePost };
