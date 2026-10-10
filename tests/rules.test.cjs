const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../src/shared/rules.js');

test('keyword matching ignores case',()=>{
  assert.deepEqual(rules.matchKeywords('I use AI Agent daily',['ai agent']),['ai agent']);
  assert.deepEqual(rules.matchKeywords('no match',['ai agent']),[]);
});
test('normalizeKeyword trims and caps length',()=>{
  assert.equal(rules.normalizeKeyword('  AI  '),'AI');
  assert.equal(rules.normalizeKeyword('x'.repeat(100)).length,60);
  assert.equal(rules.normalizeKeyword(123),'');
});
test('filter priority: exclude collapse > include highlight > show',()=>{
  const settings={filters:{includeKeywords:['ai'],excludeKeywords:['giveaway']}};
  assert.equal(rules.evaluateFilter({text:'a giveaway post'},settings).action,'collapse');
  assert.equal(rules.evaluateFilter({text:'about ai'},settings).action,'highlight');
  assert.equal(rules.evaluateFilter({text:'hello'},settings).action,'show');
  assert.equal(rules.evaluateFilter({text:'ai giveaway'},settings).action,'collapse');
});
test('highlight engagement rules',()=>{
  const rule={type:'engagement',threshold:2,minViews:1000,enabled:true};
  const mk=(likes,views)=>({likes,replies:0,reposts:0,quotes:0,views});
  assert.equal(rules.evaluateHighlight({metrics:mk(30,1000)},rule).triggered,true);  // 3% >= 2, views>=1000
  assert.equal(rules.evaluateHighlight({metrics:mk(150,5000)},rule).triggered,true); // 150/5000 = 3%
  assert.equal(rules.evaluateHighlight({metrics:mk(30,500)},rule).triggered,false);  // views < 1000
  assert.equal(rules.evaluateHighlight({metrics:mk(10,5000)},rule).triggered,false); // 1% < 2
  assert.equal(rules.evaluateHighlight({metrics:{likes:null,replies:0,reposts:0,quotes:0,views:5000}},rule).triggered,false);
  assert.equal(rules.evaluateHighlight({metrics:mk(30,5000)},{...rule,enabled:false}).triggered,false);
});
