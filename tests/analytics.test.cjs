const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../src/shared/analytics.js');

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
