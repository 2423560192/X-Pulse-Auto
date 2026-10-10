const {test}=require('node:test');
const assert=require('node:assert/strict');

let store={};
let sent=[];
global.chrome={
  storage:{local:{get:async()=>({...store}),set:async(v)=>{store={...store,...v};}}},
  runtime:{sendMessage:(msg,cb)=>{sent.push(msg);cb({ok:true,result:null});},lastError:null}
};
const F=require('../src/shared/favorites.js');

test('save dedupes by user id key and persists',async()=>{
  store={};
  const a=await F.saveFavorite({userId:'123456',handle:'creator',name:'C',tags:['AI'],note:'hi'});
  assert.equal(a.key,'uid:123456');
  const b=await F.saveFavorite({userId:'123456',handle:'creator',note:'updated'});
  assert.equal((await F.listFavorites()).length,1);
  assert.equal(b.note,'updated');
  assert.equal(b.addedAt,a.addedAt);
});
test('fallback key by handle when no id',async()=>{
  store={};
  const a=await F.saveFavorite({handle:'creator'});
  assert.equal(a.key,'handle:creator');
});
test('update and delete',async()=>{
  store={};
  await F.saveFavorite({userId:'1',handle:'a'});
  const u=await F.updateFavorite('uid:1',{note:'n'});
  assert.equal(u.note,'n');
  assert.equal(await F.deleteFavorite('uid:1'),true);
  assert.equal((await F.listFavorites()).length,0);
});
test('isFavorited reflects state',async()=>{
  store={};
  await F.saveFavorite({userId:'1',handle:'a'});
  assert.equal(await F.isFavorited({id:'1'}),true);
  assert.equal(await F.isFavorited({id:'2'}),false);
});
test('missing key throws',async()=>{
  store={};
  await assert.rejects(F.saveFavorite({}),/收藏键/);
});
test('searchFavorites matches handle/name/note/tags',()=>{
  const list=[
    {key:'a',handle:'alice',name:'Alice',note:'AI 工具',tags:['创业']},
    {key:'b',handle:'bob',name:'Bob',note:'摄影',tags:[]}
  ];
  assert.equal(F.searchFavorites(list,'alice').length,1);
  assert.equal(F.searchFavorites(list,'AI').length,1);
  assert.equal(F.searchFavorites(list,'创业').length,1);
  assert.equal(F.searchFavorites(list,'zzz').length,0);
  assert.equal(F.searchFavorites(list,'').length,2);
});
test('sortFavorites by recency or name',()=>{
  const list=[{key:'a',handle:'a',addedAt:1},{key:'b',handle:'b',addedAt:2}];
  assert.deepEqual(F.sortFavorites(list,'recent').map(f=>f.key),['b','a']);
  assert.deepEqual(F.sortFavorites(list,'name').map(f=>f.key),['a','b']);
});
test('client routes writes through background messages',async()=>{
  sent=[];
  await F.client.save({userId:'1',handle:'a'});
  assert.equal(sent[0].type,'xp-favorite');
  assert.equal(sent[0].action,'save');
  assert.equal(sent[0].payload.favorite.handle,'a');
});
