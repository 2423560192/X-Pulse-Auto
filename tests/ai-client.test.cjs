const {test}=require('node:test');
const assert=require('node:assert/strict');
const ai=require('../src/shared/ai-client.js');

const settings={baseUrl:'https://example.com/v1',apiKey:'secret',model:'model',temperature:.2,timeout:30000};
test('AI endpoint is restricted and host permission pattern is narrow',()=>{
  assert.equal(ai.endpointOf(settings.baseUrl),'https://example.com/v1/chat/completions');
  assert.equal(ai.originPattern(settings.baseUrl),'https://example.com/*');
  assert.equal(ai.originPattern('http://localhost:1234/v1'),'http://localhost/*');
  assert.throws(()=>ai.endpointOf('http://example.com/v1'),/HTTPS/);
  assert.throws(()=>ai.endpointOf('https://user:pass@example.com/v1'),/HTTPS/);
});
test('AI request sends only chat payload to configured endpoint',async()=>{
  let request;
  const fetchImpl=async(url,init)=>{request={url,init};return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}));};
  assert.equal(await ai.requestChat(settings,[{role:'user',content:'ping'}],8,fetchImpl),'OK');
  assert.equal(request.url,'https://example.com/v1/chat/completions');
  assert.equal(request.init.headers.Authorization,'Bearer secret');
  assert.equal(JSON.parse(request.init.body).model,'model');
});
test('AI timeout and HTTP errors are explicit',async()=>{
  await assert.rejects(ai.requestChat({...settings,timeout:5},[],8,(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))),/超时/);
  await assert.rejects(ai.requestChat(settings,[],8,async()=>new Response('bad',{status:503})),/503/);
});
