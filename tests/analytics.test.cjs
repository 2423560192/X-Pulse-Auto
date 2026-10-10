const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../src/shared/analytics.js');

const m=(likes,replies,reposts,quotes,views)=>({likes,replies,reposts,quotes,views});

test('engagement rate',()=>{
  assert.ok(Math.abs(A.calculateEngagement(m(50,20,20,10,10000))-1.0)<1e-9);
  assert.ok(Math.abs(A.calculateEngagement(m(100,40,40,20,10000))-2.0)<1e-9);
  assert.equal(A.calculateEngagement(m(10,0,0,0,0)),null); // views 0
  assert.equal(A.calculateEngagement({likes:null,replies:0,reposts:0,quotes:0,views:100}),null);
  assert.equal(A.calculateEngagement({likes:'1.2万',replies:0,reposts:0,quotes:0,views:100}),null);
});
test('engagement can exceed 100%',()=>{
  assert.ok(A.calculateEngagement({likes:200,replies:0,reposts:0,quotes:0,views:100})>100);
});
test('follower ratio',()=>{
  assert.equal(A.getFollowerRatio({followers:1000,following:100}),10);
  assert.equal(A.getFollowerRatio({followers:1000,following:0}),null);
  assert.equal(A.getFollowerRatio({followers:null,following:100}),null);
});
test('account age uses calendar months',()=>{
  const now=new Date('2026-10-10T00:00:00Z').getTime();
  const three=A.getAccountAge({createdAt:'2023-10-10T00:00:00Z'},now);
  assert.equal(three.years,3);assert.equal(three.months,0);
  const fiveThree=A.getAccountAge({createdAt:'2021-07-10T00:00:00Z'},now);
  assert.equal(fiveThree.years,5);assert.equal(fiveThree.months,3);
  assert.equal(A.getAccountAge({createdAt:''},now),null);
  assert.equal(A.getAccountAge({createdAt:new Date(now+100000).toISOString()},now),null);
});
