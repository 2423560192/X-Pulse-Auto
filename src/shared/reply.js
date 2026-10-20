'use strict';
// Reply suggestions: validate AI output into short, copy-ready human replies.

const MAX_REPLIES = 4;
const MAX_LENGTH = 280;

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  let text = collapse(value)
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^["“「『]/.test(text) && /["”」』]$/.test(text)) text = text.slice(1, -1).trim();
  return text;
}

function cleanTone(value) {
  const tone = cleanText(value).replace(/[：:].*$/, '').trim();
  return tone.slice(0, 10) || '回复';
}

function validate(parsed) {
  if (!parsed || !Array.isArray(parsed.replies) || parsed.replies.length < 1 || parsed.replies.length > MAX_REPLIES) {
    throw new Error('AI 返回的回复数量无效');
  }
  const seen = new Set(), replies = [];
  for (const raw of parsed.replies) {
    if (typeof raw?.text !== 'string') throw new Error('AI 回复缺少文本');
    const text = cleanText(raw.text);
    if (text.length < 2 || text.length > MAX_LENGTH) throw new Error('AI 回复长度无效');
    if (/https?:\/\//i.test(text)) throw new Error('AI 回复不应包含链接');
    if (/[\p{Script=Han}]/u.test(text) && text.length > 160) throw new Error('AI 回复过长，不像随手回复');
    const key = text.replace(/[\s\p{P}\p{S}]+/gu, '').toLocaleLowerCase();
    if (!key || seen.has(key)) throw new Error('AI 返回了重复的回复');
    seen.add(key);
    replies.push({ tone: cleanTone(raw.tone), text });
  }
  return { replies };
}

// Phrases that immediately make a reply read like machine-written copy.
// Validation stays soft (a reply is still usable); ai-client triggers one rewrite
// when any of these slips through.
const TEMPLATE = /总的来说|值得注意|首先|其次|综上|此外|不得不说|确实如此|换句话说|不难发现|希望(?:对你|能)有(?:所)?帮助|让我们一起|作为一个|从这个角度|需要指出|需要注意的是|——/;
const TEMPLATE_EN = /\bas an ai\b|\bi hope this helps\b|\bfeel free to\b|\bhere are\b/i;

function looksTemplated(replies) {
  if (!Array.isArray(replies) || !replies.length) return false;
  if (replies.some(x => TEMPLATE.test(x.text) || TEMPLATE_EN.test(x.text))) return true;
  // All long and fully punctuated: written language, not a one-second phone reply.
  return replies.length >= 2 && replies.every(x => x.text.length > 25 && /[。！]$/.test(x.text));
}

module.exports = { validate, cleanText, looksTemplated, MAX_REPLIES, MAX_LENGTH };
