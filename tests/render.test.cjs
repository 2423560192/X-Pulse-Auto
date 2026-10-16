// Mock DOM integration: exercises the real content script, including virtualized rows.
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
// Core/lens modules are bundled privately into dist/content.bundle.js; nothing is preloaded here.
class Node {
  constructor(tag='div',text=''){this.tag=tag;this.nodeType=1;this.ownText=text;this.children=[];this.parentElement=null;this.dataset={};this.style={};this.attrs={};this.events={};this.clientWidth=500;this.scrollWidth=100;this.className='';this.hidden=false;}
  get textContent(){return this.ownText+this.children.map(n=>n.textContent).join('');}set textContent(t){this.ownText=t;this.children=[];}
  get isConnected(){return this.root===true||!!this.parentElement?.isConnected;}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  after(node){node.remove();const p=this.parentElement;node.parentElement=p;p.children.splice(p.children.indexOf(this)+1,0,node);}
  remove(){const p=this.parentElement;if(p){p.children=p.children.filter(n=>n!==this);this.parentElement=null;}}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.ownText='';this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]||null;}
  addEventListener(k,f){this.events[k]=f;}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  all(){return this.children.flatMap(n=>[n,...n.all()]);}
  querySelectorAll(s){if(s==='a[href]')return this.all().filter(n=>n.tag==='a'&&n.attrs.href);if(s==='*')return this.all();return [];}
  querySelector(s){return s==='[data-testid="User-Name"]'?this.all().find(n=>n.attrs['data-testid']==='User-Name')||null:null;}
  closest(s){let n=this;while(n){if(s==='[data-testid="sidebarColumn"]'&&n.attrs['data-testid']==='sidebarColumn')return n;n=n.parentElement;}return null;}
  getBoundingClientRect(){return{left:10,top:10,bottom:30};}get offsetWidth(){return 270;}get offsetHeight(){return 250;}
}
async function fixture(){
  const root=new Node();root.root=true;const body=new Node();root.append(body);
  const document={documentElement:root,body,createElement:t=>new Node(t),createTextNode:t=>new Node('#text',t),addEventListener(){},querySelectorAll(s){return root.all().filter(n=>s.startsWith('article')?n.tweetName:s==='[data-testid="UserCell"]'?n.cell:false);}};
  const events={},timers=[];let storageChanged,mutation,statusListener;
  const ctx={URL,document,window:{addEventListener:(type,fn)=>events[type]=fn},location:{origin:'https://x.com'},innerWidth:1280,innerHeight:900,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){}},
    getComputedStyle:()=>({display:'block',flexDirection:'column',backgroundColor:'rgb(255,255,255)'}),matchMedia:()=>({matches:false}),
    chrome:{storage:{local:{get:async()=>({})},onChanged:{addListener:fn=>storageChanged=fn}},runtime:{onMessage:{addListener:fn=>statusListener=fn}}}};
  // Execute the actual manifest entry with NO preloaded XPulseCore / XPulseLens.
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/content.bundle.js'),'utf8'),ctx);
  await Promise.resolve();await Promise.resolve();
  function flush(){let limit=10;while(timers.length&&limit--)timers.shift()();}
  function row(handle,cell=false){const n=new Node();n.tweetName=!cell;n.cell=cell;const a=new Node('a','@'+handle);a.setAttribute('href','/'+handle);n.append(a);body.append(n);return{n,a};}
  function rawPacket(body,at=Date.now()){events.message({source:ctx.window,origin:'https://x.com',data:{channel:'x-pulse:response:v2',bodyText:JSON.stringify(body),requestAt:at,version:'1.1.1'}});flush();}
  function packet(users,at=Date.now()){
    rawPacket({data:users.map(u=>({__typename:'User',core:{screen_name:u.handle,name:u.name,created_at:u.createdAt},relationship_counts:{followers:u.count,following:u.following},tweet_counts:{tweets:u.posts},relationship_perspectives:{following:u.youFollow,followed_by:u.followsYou}}))},at);
  }
  function change(){mutation([{target:body}]);flush();}
  const badges=()=>root.all().filter(n=>n.className==='xp-badge');
  function message(data){events.message({source:ctx.window,origin:'https://x.com',data});flush();}
  function status(){let value;statusListener({type:'xp-status'},{},s=>value=s);return value;}
  return{root,body,row,packet,rawPacket,message,status,change,badges,flush,settings:s=>{storageChanged({xp_inline_settings:{newValue:s}},'local');flush();}};
}
test('auto decorates all known users, with no manual account selection',async()=>{
  const f=await fixture();f.row('alice');f.row('bob',true);f.packet([{handle:'alice',count:12984},{handle:'bob',count:0}]);assert.equal(f.badges().length,2);assert.match(f.badges()[0].textContent,/1.29万/);assert.match(f.badges()[1].textContent,/0/);
});
test('virtualized row reused for unknown account removes stale badge',async()=>{
  const f=await fixture(),r=f.row('alice');f.packet([{handle:'alice',count:18}]);assert.equal(f.badges().length,1);
  r.a.setAttribute('href','/bob');r.a.textContent='@bob';f.change();assert.equal(f.badges().length,0);
});
test('virtualized row switches identity even when counts match',async()=>{
  const f=await fixture(),r=f.row('alice');f.packet([{handle:'alice',count:18},{handle:'bob',count:18}]);
  r.a.setAttribute('href','/bob');r.a.textContent='@bob';f.change();assert.equal(f.badges()[0].dataset.xpHandle,'bob');
});
test('rerender never duplicates badges; updates existing user count',async()=>{
  const f=await fixture();f.row('alice');const at=Date.now();f.packet([{handle:'alice',count:18}],at);f.change();f.change();assert.equal(f.badges().length,1);
  f.packet([{handle:'alice',count:19}],at+1);assert.equal(f.badges().length,1);assert.match(f.badges()[0].textContent,/19/);
});
test('toggle hides and restores without deleting host content; disconnected rows cleaned',async()=>{
  const f=await fixture(),r=f.row('alice');f.packet([{handle:'alice',count:18}]);f.settings({enabled:false});assert.equal(f.badges().length,0);assert.equal(r.a.textContent,'@alice');f.settings({enabled:true});assert.equal(f.badges().length,1);r.n.remove();f.change();assert.equal(f.badges().length,0);
});
test('safe tooltip never interprets profile name as HTML',async()=>{
  const f=await fixture();f.row('alice');f.packet([{handle:'alice',count:18,name:'<img onerror=alert(1)>',following:0}]);f.badges()[0].events.mouseenter();
  const tip=f.root.all().find(n=>n.id==='xp-inline-tip');assert.match(tip.textContent,/<img onerror=alert\(1\)>/);assert.equal(tip.all().some(n=>n.tag==='img'),false);
});
test('reported undefined core regression: manifest bundle needs no global modules',async()=>{
  const manifest=JSON.parse(fs.readFileSync(require.resolve('../dist/manifest.json'),'utf8'));
  assert.deepEqual(manifest.content_scripts.find(x=>x.world==='ISOLATED').js,['content.bundle.js']);
  const f=await fixture();f.row('alice');f.rawPacket({data:{user:{result:{core:{screen_name:'alice'},relationship_counts:{followers:1234}}}}});
  const s=f.status();assert.equal(s.users,1);assert.equal(s.badges,1);assert.equal(s.lastError,'');assert.equal(s.parsed,1);
});
test('bridge fetch to isolated bundle to badge works across separate VM contexts',async()=>{
  const f=await fixture();f.row('alice');
  class XHR{open(){}send(){}}
  const response=new Response(JSON.stringify({data:{user:{result:{core:{screen_name:'alice'},relationship_counts:{followers:7654}}}}}));
  const page={URL,Date,XMLHttpRequest:XHR,location:{href:'https://x.com/home',origin:'https://x.com'},window:{fetch:()=>Promise.resolve(response),postMessage:data=>f.message(structuredClone(data))}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/bridge.js'),'utf8'),page);
  assert.equal(await page.window.fetch('/i/api/graphql/id/HomeTimeline'),response);
  await new Promise(resolve=>setImmediate(resolve));f.flush();
  assert.equal(f.status().users,1);assert.equal(f.status().lastError,'');assert.match(f.badges()[0].textContent,/7,654/);
});
test('diagnostic preserves exception cause and next good response recovers',async()=>{
  const f=await fixture();f.row('alice');f.message({channel:'x-pulse:response:v2',version:'1.1.1',bodyText:'invalid',requestAt:Date.now()});
  assert.match(f.status().lastError,/JSON/);f.packet([{handle:'alice',count:2}]);assert.equal(f.status().lastError,'');assert.equal(f.badges().length,1);
});
test('removed V2 post badge is not rendered',async()=>{
  const f=await fixture();const r=f.row('alice');r.a.setAttribute('href','/alice/status/123456');
  f.rawPacket({data:{tweet:{__typename:'Tweet',rest_id:'123456',legacy:{full_text:'hi',favorite_count:100,reply_count:10,retweet_count:20,quote_count:5},views:{count:10000}}}});
  const badge=f.root.all().find(n=>n.className==='xp-post-badge');
  assert.equal(badge,undefined);
});
