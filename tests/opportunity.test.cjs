const {test}=require('node:test');
const assert=require('node:assert/strict');
const o=require('../src/shared/opportunity.js');

test('need rules match requests and reject chatter and advertisements',()=>{
  for(const text of ['求推荐AI工具','有没有API','多少钱','制作太麻烦了']) assert.equal(o.ruleMatch(text),true,text);
  for(const text of ['哈哈哈哈','666','😂😂😂','私信领取免费工具']) assert.equal(o.ruleMatch(text),false,text);
  assert.equal(o.ruleMatch('求推荐AI工具',{excludeKeywords:['AI工具']}),false);
});

test('thread selection includes direct and nested replies, excluding quote and unrelated posts',()=>{
  const posts=[
    {id:'1',isReply:false},
    {id:'2',isReply:true,inReplyToId:'1',conversationId:'1',observedAt:2},
    {id:'3',isReply:true,inReplyToId:'2',conversationId:'',observedAt:3},
    {id:'4',isReply:true,inReplyToId:'9',conversationId:'9'},
    {id:'5',isReply:true,inReplyToId:'1',conversationId:'1',isQuote:true},
    {id:'6',isReply:true,inReplyToId:'77',conversationId:''}
  ];
  assert.deepEqual(o.commentsForThread(posts,'1').map(x=>x.id),['2','3']);
});

test('product validation requires core fields when enabled',()=>{
  const p={enabled:true,name:'x',description:'a',problem:'b',targetUsers:'c',capabilities:'d'};
  assert.equal(o.validProduct(p),true);
  assert.equal(o.validProduct({...p,capabilities:''}),false);
  assert.equal(o.validProduct({...p,enabled:false}),false);
});

const item={comment_id:'2',comment:'有没有推荐的 AI 工具？',parent_post:'原帖',reply_parent:''};
const result={comment_id:'2',is_opportunity:true,opportunity_type:'tool_request',intent_score:90,pain_score:80,commercial_score:60,urgency:'high',product_fit_score:85,need:'找工具',pain_point:'',budget_signal:'unknown',fit_reason:'匹配',evidence:'推荐的 AI 工具',confidence:.9};

test('AI results are validated and scored locally',()=>{
  const parsed=o.validateBatch({results:[result]},[item]);
  assert.equal(parsed[0].opportunityScore,83);
  assert.equal(parsed[0].priorityScore,83.8);
  assert.deepEqual(o.parseAI('```json\n{"results":[]}\n```'),{results:[]});
});

test('AI rejects missing fields, wrong types, invalid scores, duplicate IDs and invented evidence',()=>{
  assert.throws(()=>o.validateBatch({results:[{...result,product_fit_score:101}]},[item]),/分数/);
  assert.throws(()=>o.validateBatch({results:[{...result,need:undefined}]},[item]),/字段/);
  assert.throws(()=>o.validateBatch({results:[{...result,evidence:'我愿意付费'}]},[item]),/依据/);
  assert.throws(()=>o.validateBatch({results:[{...result,urgency:'soon'}]},[item]),/紧迫/);
  assert.throws(()=>o.validateBatch({results:[{...result,budget_signal:'愿意付费'}]},[item]),/预算/);
  assert.throws(()=>o.validateBatch({results:[result,result]},[item]),/数量/);
  assert.throws(()=>o.parseAI('not json'),/JSON/);
});
