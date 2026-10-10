const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/shared/core.js');
const settings = require('../src/shared/settings.js');
const presentation = require('../src/shared/presentation.js');
const store = require('../src/shared/store.js');
const transport = require('../src/shared/transport.js');
const handle = require('../src/shared/handle.js');

test('new relationship_counts fields take precedence over legacy values', () => {
  const u = C.extractUsers({__typename:'User',core:{screen_name:'Alice',name:'Alice',created_at:'2020-01-01'},legacy:{followers_count:12,friends_count:2},relationship_counts:{followers:12984,following:108},tweet_counts:{tweets:321},relationship_perspectives:{followed_by:true,following:true}})[0];
  assert.equal(u.count,12984);assert.equal(u.following,108);assert.equal(u.posts,321);assert.equal(presentation.relation(u),'互关');
});
test('legacy nested user cannot erase new-format fields', () => {
  const u = C.extractUsers({core:{screen_name:'alice'},legacy:{screen_name:'alice',followers_count:12},relationship_counts:{followers:14,following:20},relationship_perspectives:{followed_by:true}})[0];
  assert.equal(u.count,14);assert.equal(u.following,20);assert.equal(u.followsYou,true);
});
test('missing follower count is not invented as zero; missing following stays unknown', () => {
  assert.equal(C.extractUsers({core:{screen_name:'alice'},relationship_counts:{following:8}}).length,0);
  const u = C.extractUsers({core:{screen_name:'alice'},relationship_counts:{followers:0}})[0];assert.equal(u.count,0);assert.equal(u.following,null);
});
test('compact formatting does not round across unit boundaries', () => {
  assert.equal(presentation.format(9999),'9,999');assert.equal(presentation.format(10000),'1万');assert.equal(presentation.format(12984),'1.29万');assert.equal(presentation.format(99999999),'9,999.99万');assert.equal(presentation.format(100000000),'1亿');assert.equal(presentation.format(12984,'exact'),'12,984');
});
test('stale packets cannot overwrite newer values; cap page memory', () => {
  const m = new Map(), now = Date.now();assert.equal(store.accept(m,[{handle:'alice',count:3}],now,now),1);
  store.accept(m,[{handle:'alice',count:2}],now-1000,now);assert.equal(m.get('alice').count,3);
  for(let i=0;i<3001;i++)store.accept(m,[{handle:'u'+i,count:1}],now,now);
  assert.equal(m.size,3000);
});
test('full signature includes handle even when two people have identical metrics', () => {
  assert.notEqual(store.signature({handle:'alice',count:8},settings.defaults),store.signature({handle:'bob',count:8},settings.defaults));
});
test('handle resolver matches exact profile link text and ignores tweet URLs', () => {
  const links = [['/home','Home'],['/bob/status/1','@bob'],['https://evil.test/bob','@bob'],['/Alice','@ALICE']].map(([href,textContent])=>({textContent,getAttribute:()=>href}));
  assert.equal(handle.handleOf({querySelectorAll:()=>links}),'alice');
});
test('settings and untrusted message values validated', () => {
  assert.equal(settings.settings({layout:'oops',format:'oops',enabled:'no'}).enabled,true);
  assert.equal(settings.settings({layout:'oops'}).layout,'auto');
  assert.equal(store.accept(new Map(),[{handle:'alice',count:-1}],Date.now()),0);
});
test('raw response transport parses inside isolated module and accepts valid user', () => {
  const cache = new Map(), now = Date.now();
  const packet = {channel:'x-pulse:response:v2',requestAt:now,bodyText:JSON.stringify({data:{user:{result:{core:{screen_name:'alice'},relationship_counts:{followers:'1234'}}}}})};
  const result = transport.receive(cache,packet,now);assert.equal(result.parsed,1);assert.equal(result.accepted,1);assert.equal(cache.get('alice').count,1234);
});
test('modified page-world clock does not discard every observation', () => {
  const cache = new Map(), now = Date.now();
  transport.receive(cache,{channel:'x-pulse:response:v2',requestAt:0,bodyText:JSON.stringify({screen_name:'alice',followers_count:7})},now);
  assert.equal(cache.get('alice').at,now);assert.equal(cache.get('alice').count,7);
});
test('malformed transport reports explicit error, not silent zero users', () => {
  assert.throws(()=>transport.receive(new Map(),{channel:'x-pulse:response:v2',bodyText:'bad json'}),/JSON/);
  assert.throws(()=>transport.receive(new Map(),{channel:'old'}),/消息版本/);
});
