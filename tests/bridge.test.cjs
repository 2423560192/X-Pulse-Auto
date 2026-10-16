const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const C=require('../src/shared/core.js');
function fixture(fetchImpl){
  const messages=[];class XHR{open(){}send(){}addEventListener(type,callback){this.callback=callback;}}
  const context={XPulseCore:C,URL,Date,WeakMap,XMLHttpRequest:XHR,location:{href:'https://x.com/home',origin:'https://x.com'},window:{fetch:fetchImpl,postMessage:(m)=>messages.push(m)}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/bridge.js'),'utf8'),context);return{...context,messages};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('fetch response remains readable and identical; JSON transported to isolated parser',async()=>{
  const response=new Response(JSON.stringify({data:{user:{legacy:{screen_name:'demo',followers_count:100}}}}));
  const f=fixture(()=>Promise.resolve(response));const result=await f.window.fetch('https://x.com/i/api/graphql/id/UserByScreenName');
  assert.equal(result,response);assert.equal((await result.json()).data.user.legacy.followers_count,100);await settle();
  assert.equal(f.messages[0].channel,'x-pulse:response:v2');assert.equal(C.extractUsers(JSON.parse(f.messages[0].bodyText))[0].followers,100);
});
test('unrelated network responses are never parsed',async()=>{
  let reads=0;const f=fixture(()=>Promise.resolve({ok:true,clone(){reads++;return {json:async()=>({})};}}));
  await f.window.fetch('https://evil.test/2/users');await settle();assert.equal(reads,0);
});
test('fetch errors propagate; observer does not break host page',async()=>{
  const f=fixture(()=>Promise.reject(new Error('offline')));await assert.rejects(f.window.fetch('https://x.com/i/api/graphql/id/UserByScreenName'),/offline/);
});
test('field whitelist strips private fields before forwarding',async()=>{
  const response=new Response(JSON.stringify({data:{user:{legacy:{screen_name:'demo',followers_count:100,cookie:'secret',email:'x@y.z'}}},cookie:'topsecret',token:'t',text:'dm body'}));
  const f=fixture(()=>Promise.resolve(response));
  await f.window.fetch('https://x.com/i/api/graphql/id/UserByScreenName');
  await settle();
  const forwarded=JSON.parse(f.messages[0].bodyText);
  assert.equal(JSON.stringify(forwarded).includes('secret'),false);
  assert.equal(JSON.stringify(forwarded).includes('topsecret'),false);
  assert.equal('token' in forwarded,false);
  assert.equal(forwarded.data.user.legacy.followers_count,100);
  assert.equal(forwarded.data.user.legacy.screen_name,'demo');
});
test('field whitelist preserves reply relationships but strips credentials',async()=>{
  const response=new Response(JSON.stringify({data:{tweet:{__typename:'Tweet',rest_id:'2',legacy:{full_text:'求推荐工具',in_reply_to_status_id_str:'1',conversation_id_str:'1',authorization:'secret'}}}}));
  const f=fixture(()=>Promise.resolve(response));
  await f.window.fetch('https://x.com/i/api/graphql/id/TweetDetail');await settle();
  const forwarded=JSON.parse(f.messages[0].bodyText).data.tweet.legacy;
  assert.equal(forwarded.in_reply_to_status_id_str,'1');
  assert.equal(forwarded.conversation_id_str,'1');
  assert.equal('authorization' in forwarded,false);
});
test('XHR handles JSON responses and malformed text safely',()=>{
  const f=fixture(()=>{});const xhr=new f.XMLHttpRequest();xhr.open('GET','/i/api/graphql/id/UserByScreenName');xhr.send();xhr.status=200;xhr.responseType='json';xhr.response={core:{screen_name:'demo'},legacy:{followers_count:0}};xhr.callback();assert.equal(C.extractUsers(JSON.parse(f.messages[0].bodyText))[0].followers,0);
  xhr.responseType='text';xhr.responseText='not json';assert.doesNotThrow(()=>xhr.callback());
});
