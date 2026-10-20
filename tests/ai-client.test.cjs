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

test('reply suggestions send the post with a human-sounding prompt and reject duplicates', async () => {
  const requests = [];
  const replyFetch = async (_url, init) => {
    requests.push(init);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [
      { tone: '共鸣', text: '键帽打油真的看手' }, { tone: '追问', text: '什么轴？手汗重会更快' }
    ] }) } }] }));
  };
  const replies = await ai.suggestReplies(settings, { id: '42', text: '新买的键盘三天就打油了', authorHandle: 'alice' }, replyFetch);
  assert.equal(replies.length, 2);
  assert.equal(replies[1].tone, '追问');
  assert.equal(requests.length, 1);
  const request = JSON.parse(requests[0].body);
  assert.equal(request.messages[0].role, 'system');
  assert.match(request.messages[0].content, /AI 味/);
  assert.match(request.messages[0].content, /不要编造/);
  assert.match(request.messages[1].content, /新买的键盘三天就打油了/);
  assert.equal(requests[0].headers.Authorization, 'Bearer secret');
  const duplicate = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: '收到' }, { text: '收到' }] }) } }] }));
  await assert.rejects(ai.suggestReplies(settings, { id: '42', text: 'x' }, duplicate), /重复/);
});

test('reply suggestions sample warm and rewrite once when clichés slip through', async () => {
  const bodies = [];
  const templated = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const first = [
      { tone: '总结', text: '总的来说，键帽打油是正常现象，建议更换键帽。' },
      { tone: '建议', text: '你可以先检查一下使用习惯。' }
    ];
    const second = [
      { tone: '接梗', text: '三天就油 这手速能去电竞了' },
      { tone: '共鸣', text: '正常 我的也油 已经懒得管' }
    ];
    const content = JSON.stringify({ replies: bodies.length === 1 ? first : second });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
  const replies = await ai.suggestReplies({ ...settings, temperature: .2 }, { id: '1', text: '键盘打油了，正常吗' }, templated);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].temperature, .85);
  assert.match(bodies[1].messages[bodies[1].messages.length - 1].content, /重写/);
  assert.deepEqual(replies.map(x => x.text), ['三天就油 这手速能去电竞了', '正常 我的也油 已经懒得管']);
});
