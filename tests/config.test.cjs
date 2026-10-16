const {test}=require('node:test');
const assert=require('node:assert/strict');
const config=require('../src/shared/config.js');

test('defaults and legacy flat fields',()=>{
  const c=config.config();
  assert.equal(c.schemaVersion,4);
  assert.equal(c.enabled,true);   // legacy flat
  assert.equal(c.layout,'auto');  // legacy flat
  assert.equal(c.account.showRatio,true);
  assert.equal('opportunity' in c,false);
});
test('old V2 post and filter settings are ignored',()=>{
  const c=config.config({account:{showRatio:'yes'},post:{enabled:true},filters:{enabled:true},opportunity:{badgeLevel:'medium'}});
  assert.equal(c.account.showRatio,true);
  assert.equal('opportunity' in c,false);
  assert.equal('post' in c,false);
  assert.equal('filters' in c,false);
});
test('old per-comment score setting is ignored',()=>{
  assert.equal('opportunity' in config.config({opportunity:{badgeLevel:'invalid'}}),false);
});
test('unknown fields are not copied through',()=>{
  const c=config.config({hacker:'x',account:{showFollowers:false}});
  assert.equal('hacker' in c,false);
  assert.equal('showFollowers' in c.account,false);
});
