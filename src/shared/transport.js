'use strict';
// Message ingress: parse the JSON bridge packet, extract users and posts,
// and feed validated user records into the store.

const core = require('./core.js');
const tweet = require('./tweet.js');
const { accept } = require('./store.js');

function receive(cache, message, now = Date.now()) {
  if (message?.channel !== 'x-pulse:response:v2') throw new Error('消息版本不匹配，请重新加载插件并刷新 X');
  if (typeof message.bodyText !== 'string' || message.bodyText.length > 12000000) throw new Error('响应格式无效或超出大小限制');
  let body;
  try { body = JSON.parse(message.bodyText); } catch { throw new Error('X 响应不是有效 JSON'); }
  const users = core.extractUsers(body);
  const posts = tweet.extractPosts(body);
  const requestAt = message.requestAt;
  // Do not drop all observations because a page-world clock was modified.
  const at = Number.isFinite(requestAt) && requestAt <= now + 5000 && requestAt >= now - 3600000 ? requestAt : now;
  const accepted = accept(cache, users, at, now);
  return { parsed: users.length, accepted, posts };
}

module.exports = { receive };
