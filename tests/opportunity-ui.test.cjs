const {test}=require('node:test');
const assert=require('node:assert/strict');
const createUI=require('../src/content/opportunity-ui.js');

class Node {
  constructor(tag='div',text=''){this.tag=tag;this.ownText=text;this.className='';this.children=[];this.parentElement=null;this.dataset={};this.attrs={};this.events={};this.nodeType=1;}
  get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
  set textContent(v){this.ownText=v;this.children=[];}
  get isConnected(){return !!(this.root||this.parentElement?.isConnected);}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
  replaceChildren(...nodes){for(const n of this.children)n.parentElement=null;this.children=[];this.ownText='';this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]||null;}
  addEventListener(k,fn){this.events[k]=fn;}
  querySelector(){return null;}
  all(){return this.children.flatMap(x=>[x,...x.all()]);}
  querySelectorAll(s){return s==='a[href]'?this.all().filter(x=>x.tag==='a'&&x.attrs.href):[];}
}
const el=(tag,cls,text)=>{const n=new Node(tag,text);n.className=cls||'';return n;};
function article(root,id){const a=new Node('article'),link=new Node('a');link.setAttribute('href','/user/status/'+id);a.append(link);root.append(a);return {a,link};}
function fixture(records=[],count=1){
  const root=new Node();root.root=true;
  const original=article(root,'1');
  const replies=[];
  for(let i=2;i<=count+1;i++)replies.push(article(root,String(i)));
  global.location={pathname:'/user/status/1'};
  global.document={documentElement:root,querySelectorAll:()=>root.all().filter(x=>x.tag==='article')};
  global.window={open(){}};
  const calls=[];
  global.chrome={runtime:{lastError:null,sendMessage(message,callback){calls.push(message);
    if(message.action==='list')callback({ok:true,result:records});
    else if(message.action==='ready')callback({ok:true,result:true});
    else if(message.action==='config')callback({ok:true,result:{product:{enabled:true,name:'x'},ai:{baseUrl:'https://example.com/v1',model:'m'}}});
    else if(message.action==='analyze')callback({ok:true,result:{results:message.payload.items.map(x=>({commentId:x.comment_id,opportunity:null,fromCache:false})),aiCount:message.payload.items.length}});
  }}};
  const posts=new Map([['1',{id:'1',text:'原帖'}]]);
  for(let i=2;i<=count+1;i++)posts.set(String(i),{id:String(i),text:'求推荐AI工具',isReply:true,inReplyToId:'1',conversationId:'1',authorHandle:'creator',authorId:'10',authorName:'创作者'});
  const state={posts,cache:new Map(),settings:{enabled:true,opportunity:{badgeLevel:'high'}}};
  return {root,original,replies,calls,state,ui:createUI({state,el})};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('comment marker follows article identity during virtualized reuse',async()=>{
  const rec={id:'r',postId:'1',commentId:'2',opportunityScore:90,productFitScore:88,priorityScore:89,productSnapshot:JSON.stringify({enabled:true,name:'x'}),model:'m',aiEndpoint:'https://example.com/v1'};
  const f=fixture([rec]);f.ui.render();await tick();
  assert.equal(f.root.all().filter(x=>x.className.startsWith('xp-opp-marker')).length,1);
  f.replies[0].link.setAttribute('href','/user/status/3');f.ui.render();
  assert.equal(f.root.all().filter(x=>x.className.startsWith('xp-opp-marker')).length,0);
  f.replies[0].link.setAttribute('href','/user/status/2');f.ui.render();
  assert.equal(f.root.all().filter(x=>x.className.startsWith('xp-opp-marker')).length,1);
});

test('scan is manual, batches ten candidates and stops at one hundred per click',async()=>{
  const f=fixture([],120);f.ui.render();await tick();
  assert.equal(f.calls.filter(x=>x.action==='analyze').length,0);
  await f.ui.scan();
  assert.equal(f.calls.filter(x=>x.action==='analyze').length,10);
  assert.ok(f.calls.filter(x=>x.action==='analyze').every(x=>x.payload.items.length===10));
  await f.ui.scan();
  assert.equal(f.calls.filter(x=>x.action==='analyze').length,12);
});
