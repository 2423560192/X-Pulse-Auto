const {test}=require('node:test');
const assert=require('node:assert/strict');
const store=require('../src/shared/opportunity-store.js');

let data={};
global.chrome={storage:{local:{get:async key=>({[key]:data[key]}),set:async values=>{data={...data,...values};}}}};
const product={enabled:true,name:'视频工具',description:'批量生产视频',problem:'制作太慢',targetUsers:'工作室',capabilities:'批量制作',keywords:['AI视频'],excludeKeywords:[],budget:''};
const ai={baseUrl:'https://example.com/v1',model:'test-model',apiKey:'secret',temperature:.2,timeout:30000};
const input=[{comment_id:'2',post_id:'1',comment:'有没有推荐的 AI 视频工具？',parent_post:'讨论 AI 视频',reply_parent:'',author:{id:'3',handle:'creator',name:'创作者',followers:100,following:10}}];
let calls=0;
const fetchImpl=async(_url,init)=>{
  calls++;
  const body=JSON.parse(init.body);
  const items=JSON.parse(body.messages[1].content).comments;
  const results=items.map(x=>({comment_id:x.comment_id,is_opportunity:true,opportunity_type:'tool_request',intent_score:90,pain_score:70,commercial_score:50,urgency:'high',product_fit_score:88,need:'找视频工具',pain_point:'',budget_signal:'unknown',fit_reason:'符合目标客户',evidence:'推荐的 AI 视频工具',confidence:.9}));
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({results})}}]}));
};
async function setup(){data={};calls=0;await store.saveProduct(product);await store.saveAI(ai);await store.markVerified();}

test('configuration keeps API key local and requires product plus tested AI',async()=>{
  data={};
  await assert.rejects(store.ready(),/产品/);
  await store.saveProduct(product);
  await store.saveAI(ai);
  await assert.rejects(store.ready(),/测试连接/);
  const config=await store.getConfig();
  assert.equal(config.ai.hasKey,true);
  assert.equal('apiKey' in config.ai,false);
  await store.markVerified();
  await store.ready();
});

test('analysis cache, product change, local CRUD and delete',async()=>{
  await setup();
  const first=await store.analyzeBatch(input,fetchImpl);
  assert.equal(first.aiCount,1);assert.equal(calls,1);
  const rec=first.results[0].opportunity;
  assert.equal(rec.authorFollowers,100);
  assert.equal((await store.list('1')).length,1);
  const cached=await store.analyzeBatch(input,fetchImpl);
  assert.equal(cached.aiCount,0);assert.equal(calls,1);
  const updated=await store.update(rec.id,{favorite:true,note:'跟进',tags:'视频,重点'});
  assert.equal(updated.favorite,true);assert.deepEqual(updated.tags,['视频','重点']);
  const changedContext=await store.analyzeBatch([{...input[0],parent_post:'更新后的讨论 AI 视频'}],fetchImpl);
  assert.equal(changedContext.aiCount,1);assert.equal(calls,2);
  assert.equal((await store.list()).length,1);
  assert.equal(changedContext.results[0].opportunity.favorite,true);
  await store.saveProduct({...product,name:'新产品'});
  const changed=await store.analyzeBatch(input,fetchImpl);
  assert.equal(changed.aiCount,1);assert.equal(calls,3);
  assert.notEqual(changed.results[0].opportunity.id,rec.id);
  assert.equal(await store.remove(changedContext.results[0].opportunity.id),true);
  assert.equal((await store.list()).length,1);
});

test('invalid batch limits and comment IDs are rejected before AI calls',async()=>{
  await setup();
  await assert.rejects(store.analyzeBatch([],fetchImpl),/1 至 10/);
  await assert.rejects(store.analyzeBatch(Array(11).fill(input[0]),fetchImpl),/1 至 10/);
  await assert.rejects(store.analyzeBatch([{...input[0],comment_id:'bad'}],fetchImpl),/评论数据/);
  assert.equal(calls,0);
});
