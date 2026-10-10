const {test}=require('node:test');
const assert=require('node:assert/strict');

let storage={};
let listener=null;
function reset(){ storage={}; }

global.chrome={
  alarms:{clear:async()=>{}},
  storage:{local:{get:async()=>({...storage}),set:async(v)=>{storage={...storage,...v};},remove:async()=>{}}},
  runtime:{onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}},lastError:null}
};
require('../src/background.js');

function send(action, payload){
  return new Promise(resolve=>{
    const ret=listener({type:'xp-favorite',action,payload},{},resolve);
    assert.equal(ret,true);
  });
}

test('concurrent favorite writes are serialized without losing updates',async()=>{
  reset();
  await Promise.all([1,2,3,4,5].map(i=>send('save',{favorite:{userId:String(i),handle:'u'+i}})));
  const list=await send('list');
  assert.equal(list.ok,true);
  assert.equal(list.result.length,5);
});
test('isFavorited reflects state after save',async()=>{
  reset();
  await send('save',{favorite:{userId:'1',handle:'a'}});
  const r=await send('isFavorited',{user:{id:'1'}});
  assert.equal(r.ok,true);
  assert.equal(r.result,true);
});
test('unknown action reports error',async()=>{
  reset();
  const r=await send('nope',{});
  assert.equal(r.ok,false);
});
