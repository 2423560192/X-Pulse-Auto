const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/shared/core.js');
test('handles: username, @name and allowed URLs only',()=>{
  for(const value of ['@aChai','achai','https://x.com/AChai','https://twitter.com/achai/']) assert.equal(C.normalizeHandle(value),'achai');
  for(const value of ['home','@','hello world','https://evil.test/achai','<script>','a'.repeat(16)]) assert.equal(C.normalizeHandle(value),'');
});
test('legacy and modern GraphQL user schemas; exact integer including zero',()=>{
  const payload={data:{user:{result:{__typename:'User',rest_id:'12',legacy:{screen_name:'ACHAI',name:'阿柴',followers_count:0}}}},other:{__typename:'User',core:{screen_name:'demo',name:'Demo'},avatar:{image_url:'https://pbs.twimg.com/profile_images/a.jpg'},legacy:{followers_count:12984}}};
  const users=C.extractUsers(payload);assert.equal(users.length,2);assert.equal(users.find(x=>x.handle==='achai').count,0);assert.equal(users.find(x=>x.handle==='demo').count,12984);
});
test('v2 schema supported; approximate counts not accepted',()=>{
  assert.equal(C.extractUsers({username:'a',public_metrics:{followers_count:42}})[0].count,42);
  assert.equal(C.extractUsers({screen_name:'a',followers_count:'12.9K'}).length,0);
});
test('integer strings accepted without treating abbreviations or missing values as counts',()=>{
  assert.equal(C.extractUsers({core:{screen_name:'demo'},relationship_counts:{followers:'12345'}})[0].count,12345);
  for(const value of ['',null,undefined,'1.2万','1e6','-1','Infinity','9007199254740992'])assert.equal(C.readCount(value),null);
});
test('no confusing likes with followers, no secrets in emitted record',()=>{
  const users=C.extractUsers({screen_name:'demo',followers_count:88,cookie:'secret',text:'private',favorite_count:999});
  assert.equal(users[0].count,88);assert.equal(JSON.stringify(users).includes('secret'),false);assert.equal('text' in users[0],false);
  assert.equal(C.extractUsers({screen_name:'demo',favorite_count:999}).length,0);
});
test('cycles and malformed payloads are safe',()=>{
  const a={};a.self=a;assert.deepEqual(C.extractUsers(a),[]);assert.deepEqual(C.extractUsers(null),[]);
});
test('avatars restricted to HTTPS X image CDN',()=>{
  for(const s of ['javascript:alert(1)','https://evil.test/a','http://pbs.twimg.com/a']) assert.equal(C.safeAvatar(s),'');
});
test('invalid, negative and stale/future samples rejected',()=>{
  const at=Date.now();const s={handle:'demo',count:10,at};assert.ok(C.validateSample(s,at));
  for(const patch of [{count:-1},{count:NaN},{count:1.5},{at:at+10000},{at:at-3700000},{handle:'home'}]) assert.equal(C.validateSample({...s,...patch},at),null);
});
