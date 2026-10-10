const {test}=require('node:test');
const assert=require('node:assert/strict');
const renderer=require('../src/content/renderer.js');

class Node {
  constructor(tag='div', cls='', text=''){ this.tag=tag; this.className=cls; this.textContent=text; this.children=[]; this.attrs={}; this.dataset={}; this.parentElement=null; this.isConnected=true; this.events={}; }
  append(...nodes){ for(const n of nodes){ n.parentElement=this; this.children.push(n); } }
  querySelectorAll(s){ return s==='a[href]' ? this.all().filter(n=>n.tag==='a'&&n.attrs.href) : []; }
  setAttribute(k,v){ this.attrs[k]=v; }
  getAttribute(k){ return this.attrs[k]||null; }
  addEventListener(k,fn){ this.events[k]=fn; }
  remove(){ const p=this.parentElement; if(p){ p.children=p.children.filter(n=>n!==this); this.parentElement=null; } }
  all(){ return this.children.flatMap(n=>[n,...n.all()]); }
}
const el=(tag,cls,text)=>new Node(tag,cls,text);

function articleWithStatus(id){
  const article=new Node('article');
  const a=new Node('a'); a.setAttribute('href','/user/status/'+id); article.append(a);
  return article;
}
const post=(likes,views)=>({id:'111',text:'hi',metrics:{likes,replies:0,reposts:0,quotes:0,views}});

test('getPostIdFromDOM extracts the status id from links',()=>{
  assert.equal(renderer.getPostIdFromDOM(articleWithStatus('1234567890')),'1234567890');
  assert.equal(renderer.getPostIdFromDOM(new Node('article')),'');
});
test('postBadgeText formats metrics and engagement',()=>{
  const t=renderer.postBadgeText(post(100,10000),{post:{showEngagementRate:true}});
  assert.ok(t.includes('赞 100'));
  assert.ok(t.includes('1.00%'));
  const noRate=renderer.postBadgeText(post(100,10000),{post:{showEngagementRate:false}});
  assert.ok(!noRate.includes('%'));
});
test('renderPostBadge creates a badge element',()=>{
  const article=articleWithStatus('111');
  const badge=renderer.renderPostBadge(article,post(100,10000),{post:{enabled:true,showEngagementRate:false}},el);
  assert.equal(badge.className,'xp-post-badge');
  assert.equal(badge.dataset.xpPostId,'111');
  assert.equal(article.children.length,2); // the status link + badge
});
test('renderPostBadge respects the disabled switch',()=>{
  assert.equal(renderer.renderPostBadge(articleWithStatus('111'),post(100,10000),{post:{enabled:false}},el),null);
});
test('highlight and collapse classes toggle',()=>{
  const article=new Node('article');
  renderer.applyHighlight(article); assert.ok(article.className.includes('xp-highlight'));
  renderer.clearHighlight(article); assert.ok(!article.className.includes('xp-highlight'));
  renderer.applyCollapse(article, el); assert.ok(article.className.includes('xp-collapsed'));
  const btn=article.children.find(n=>n.className==='xp-collapse-btn');
  assert.ok(btn); assert.ok(btn.textContent.includes('展开'));
  btn.events.click(); // expand
  assert.ok(!article.className.includes('xp-collapsed'));
  assert.equal(article.children.find(n=>n.className==='xp-collapse-btn'),undefined);
});
