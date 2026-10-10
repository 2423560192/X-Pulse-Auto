const {test}=require('node:test');
const assert=require('node:assert/strict');
const config=require('../src/shared/config.js');

test('defaults and legacy flat fields',()=>{
  const c=config.config();
  assert.equal(c.schemaVersion,2);
  assert.equal(c.enabled,true);   // legacy flat
  assert.equal(c.layout,'auto');  // legacy flat
  assert.equal(c.account.showFollowers,true);
  assert.equal(c.post.rateThreshold,2);
  assert.equal(c.filters.mode,'highlight');
});
test('nested groups validate types and clamp ranges',()=>{
  const c=config.config({account:{showRatio:'yes'},post:{rateThreshold:9999,minViews:-5},filters:{mode:'oops'}});
  assert.equal(c.account.showRatio,true);       // fallback
  assert.equal(c.post.rateThreshold,1000);      // clamped
  assert.equal(c.post.minViews,0);              // clamped
  assert.equal(c.filters.mode,'highlight');     // fallback
});
test('keyword trim, dedupe and length cap',()=>{
  const c=config.config({filters:{includeKeywords:[' AI ','AI','AI','x'.repeat(100)]}});
  assert.deepEqual(c.filters.includeKeywords,['AI','x'.repeat(60)]);
});
test('unknown fields are not copied through',()=>{
  const c=config.config({hacker:'x',account:{showFollowers:false}});
  assert.equal('hacker' in c,false);
  assert.equal(c.account.showFollowers,false);
});
