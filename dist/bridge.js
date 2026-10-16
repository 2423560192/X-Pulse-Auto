(() => {
  'use strict';
  // Page-world observer: never reads cookies, request headers, bodies or credentials.
  // Only whitelisted field names are forwarded; everything else (cookies, tokens,
  // emails, DMs) is stripped before crossing into the isolated world.
  const VERSION = '3.0.0';
  const channel = 'x-pulse:response:v2';

  const ALLOWED_FIELDS = new Set([
    // graphql plumbing / structural containers
    'data', 'user', 'users', 'result', 'results', 'tweet', 'tweets', 'post', 'posts',
    'item', 'items', 'entry', 'entries', 'content', 'itemContent', 'tweet_results',
    'user_results', 'timeline', 'timeline_v2', 'instructions', 'instruction',
    // 各场景 GraphQL 响应的外层容器：首页 / 搜索 / 推文详情 / 通知 / 列表 / 书签等
    'home', 'home_timeline_urt', 'home_timeline_v2', 'search_by_raw_query', 'search_timeline',
    'tweetResult', 'threaded_conversation_with_injections_v2', 'conversation_timeline',
    'notifications', 'notification_timeline', 'bookmark_timeline_v2', 'favorited_tweets_urt',
    'user_tweets', 'user_tweets_and_replies', 'media_timeline', 'list', 'lists',
    'globalObjects', 'communityResults',
    // 时间线条目结构（不含任何凭证字段）
    'entryId', 'entry_id_to_replace', 'sortIndex', 'cursorType', 'value', 'responseObjects',
    'moduleItems', 'entryType', 'itemType', 'displayType', 'tweetDisplayType', 'quoted_status_result',
    // identity
    '__typename', 'core', 'legacy', 'rest_id', 'id_str', 'id', 'screen_name', 'username', 'name', 'created_at',
    // user metrics
    'followers', 'followers_count', 'following', 'following_count', 'friends_count',
    'statuses_count', 'tweet_count', 'listed_count', 'media_count',
    // nested user metric holders
    'relationship_counts', 'public_metrics', 'relationship_perspectives', 'followed_by',
    'tweet_counts', 'tweets', 'count', 'avatar', 'image_url',
    'profile_image_url_https', 'profile_image_url',
    // tweet text + author
    'full_text', 'text', 'author', 'user_id_str', 'description',
    'in_reply_to_status_id_str', 'conversation_id_str', 'conversation_id',
    'referenced_tweets', 'type', 'is_quote_status',
    // relationship flags
    'following', 'blocking', 'muting'
  ]);

  function filterValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(filterValue);
    const out = {};
    for (const key of Object.keys(value)) {
      if (ALLOWED_FIELDS.has(key)) out[key] = filterValue(value[key]);
    }
    return out;
  }

  function isDataURL(value) {
    try {
      const u = new URL(value, location.href);
      return ['x.com','twitter.com','api.x.com','api.twitter.com'].includes(u.hostname) &&
        /\/(?:i\/api\/)?(?:graphql|1\.1|2)\//.test(u.pathname);
    } catch { return false; }
  }

  function report(body, at) {
    try {
      // Parse user/post fields in the extension's isolated world, not X's JavaScript world.
      // Plain JSON transport avoids sharing page-world objects or helpers.
      const bodyText = JSON.stringify(filterValue(body));
      if (bodyText.length <= 12000000) window.postMessage({channel,bodyText,requestAt:at,version:VERSION}, location.origin);
    } catch { /* The host page must remain unaffected. */ }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const at = Date.now();
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    const result = Reflect.apply(originalFetch, this, args);
    if (isDataURL(url)) result.then(response => {
      if (!response.ok) return;
      try { response.clone().json().then(body => report(body, at)).catch(() => {}); } catch {}
    }).catch(() => {});
    return result;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requests.set(this, {observe: isDataURL(url)});
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (requests.get(this)?.observe) {
      const at = Date.now();
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;
        try {
          if (this.responseType === 'json') report(this.response, at);
          else if (this.responseType === '' || this.responseType === 'text') report(JSON.parse(this.responseText), at);
        } catch {}
      }, {once: true});
    }
    return Reflect.apply(send, this, args);
  };
})();
