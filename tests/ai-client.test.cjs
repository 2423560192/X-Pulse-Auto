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

test('connection probe allows reasoning output and explains an empty response', async () => {
  let sent;
  const empty = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 512, completion_tokens_details: { reasoning_tokens: 512 } } }));
  };
  await assert.rejects(ai.testConnection(settings, empty), /结束原因 length.*输出 token 512.*推理 token 512.*额度已耗尽/);
  assert.equal(sent.max_tokens, 512);
});

test('connection error includes safe provider detail and does not expose API key', async () => {
  const denied = async () => new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'Model unavailable for secret' } }), { status: 404 });
  await assert.rejects(ai.testConnection(settings, denied), /HTTP 404（model_not_found）：Model unavailable for \[已隐藏\]/);
});

test('common text content arrays are accepted', async () => {
  const chunks = async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'OK' }] } }] }));
  assert.equal(await ai.testConnection(settings, chunks), true);
});

test('malformed text parts cannot mark a connection verified', async () => {
  const malformed = async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ text: { unexpected: true } }] } }] }));
  await assert.rejects(ai.testConnection(settings, malformed), /空内容/);
});
