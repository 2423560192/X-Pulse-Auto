const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/shared/exporter.js');

const favs=[
  {handle:'creator',name:'Example Creator',userId:'123456',tags:['AI','创业'],note:'经常分享 AI 工具',addedAt:Date.UTC(2026,9,10),updatedAt:Date.UTC(2026,9,10)},
  {handle:'evil',name:'=cmd()',userId:'2',tags:[],note:'comma, quote " and\nnewline',addedAt:Date.UTC(2026,9,10),updatedAt:Date.UTC(2026,9,10)}
];

test('CSV keeps Chinese and escapes quotes/commas/newlines',()=>{
  const csv=E.exportFavoritesCSV(favs);
  assert.ok(csv.includes('经常分享 AI 工具'));
  assert.ok(csv.includes('"comma, quote "" and'));
});
test('CSV guards formula injection and uses BOM',()=>{
  const csv=E.exportFavoritesCSV(favs);
  assert.ok(csv.includes("'=cmd()"));
  assert.ok(csv.startsWith('\uFEFF'));
});
test('JSON round-trips and is parseable',()=>{
  const parsed=JSON.parse(E.exportFavoritesJSON(favs));
  assert.equal(parsed.schemaVersion,2);
  assert.equal(parsed.favorites.length,2);
});
test('export does not mutate input',()=>{
  const before=JSON.stringify(favs);
  E.exportFavoritesCSV(favs);E.exportFavoritesJSON(favs);
  assert.equal(JSON.stringify(favs),before);
});
test('no data yields header only / empty favorites',()=>{
  assert.deepEqual(JSON.parse(E.exportFavoritesJSON([])).favorites,[]);
  assert.equal(E.exportFavoritesCSV([]).trim().split('\r\n').length,1);
});
