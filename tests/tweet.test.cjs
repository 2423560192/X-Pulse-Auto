const {test}=require('node:test');
const assert=require('node:assert/strict');
const tweet=require('../src/shared/tweet.js');

function sampleTweet(id='111'){
  return {__typename:'Tweet',rest_id:id,legacy:{full_text:'分享一个 AI 工作流',favorite_count:100,reply_count:10,retweet_count:20,quote_count:5},views:{count:10000},core:{user_results:{result:{__typename:'User',rest_id:'222',legacy:{screen_name:'creator'}}}}};
}

test('normalizes a tweet payload with text and author',()=>{
  const posts=tweet.extractPosts({data:[sampleTweet()]});
  assert.equal(posts.length,1);
  const p=posts[0];
  assert.equal(p.id,'111');assert.equal(p.authorId,'222');assert.equal(p.authorHandle,'creator');
  assert.equal(p.text,'分享一个 AI 工作流');
  assert.equal('metrics' in p,false);
});
test('old engagement metrics are not carried into the post record',()=>{
  const raw=sampleTweet();
  assert.equal('metrics' in tweet.normalizePost(raw),false);
});
test('dedupes by id; outer and quoted tweets stay separate records',()=>{
  const outer=sampleTweet('outer');outer.legacy.quoted_status=sampleTweet('inner');
  const posts=tweet.extractPosts({data:[outer]});
  assert.deepEqual(posts.map(p=>p.id).sort(),['inner','outer']);
});
test('nodes without a post id are ignored',()=>{
  assert.deepEqual(tweet.extractPosts({data:{user:{legacy:{screen_name:'demo',followers_count:5}}}}),[]);
});
test('text falls back to legacy.text and is truncated',()=>{
  const raw={__typename:'Tweet',rest_id:'x',legacy:{full_text:undefined,text:'hi'},views:{count:1}};
  assert.equal(tweet.normalizePost(raw).text,'hi');
  const long=tweet.normalizePost({__typename:'Tweet',rest_id:'x',legacy:{full_text:'a'.repeat(9000)},views:{count:1}});
  assert.equal(long.text.length,4000);
});
test('reply metadata distinguishes direct replies, nested replies and quotes',()=>{
  const direct=sampleTweet('22');direct.legacy.in_reply_to_status_id_str='11';direct.legacy.conversation_id_str='11';
  const nested=sampleTweet('33');nested.legacy.in_reply_to_status_id_str='22';nested.legacy.conversation_id_str='11';
  const quote=sampleTweet('44');quote.legacy.in_reply_to_status_id_str='11';quote.legacy.conversation_id_str='11';quote.legacy.is_quote_status=true;
  const posts=tweet.extractPosts({data:[direct,nested,quote]});
  assert.equal(posts.find(x=>x.id==='22').isReply,true);
  assert.equal(posts.find(x=>x.id==='33').inReplyToId,'22');
  assert.equal(posts.find(x=>x.id==='33').conversationId,'11');
  assert.equal(posts.find(x=>x.id==='44').isQuote,true);
});
