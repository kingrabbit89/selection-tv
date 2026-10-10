import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const formatter=read('assets/js/rating-format.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function context(){
  const document={createElement:tag=>({tag,children:[],append(...nodes){this.children.push(...nodes)}})};
  const window={};const ctx=vm.createContext({window,document});
  vm.runInContext(formatter,ctx);return {ctx,window,document};
}
const recorded={imdb:'6,7/10 (5,2 k)',senscritique:'6,5/10',rottentomatoes:'69 % (262 critiques)',allocine_presse:'3,8/5 (31 titres)'};
const links={imdb:'https://www.imdb.com/title/tt0000001/',sc:'https://www.senscritique.com/film/fixture/1',
  rottentomatoes:'https://www.rottentomatoes.com/m/fixture',allocine:'https://www.allocine.fr/film/fixture'};
const expected=['IMDb 6,7/10 (5,2 k)','SensCritique 6,5/10','Rotten Tomatoes 69 % (262 critiques)','AlloCiné presse 3,8/5 (31 titres)'];

test('web badges preserve exact saved scales and counts and keep verified provider links',()=>{
  const {window,document}=context(),box=document.createElement('div');
  window.SelectionTVRatingFormat.appendTo(box,recorded,links);
  assert.deepEqual(plain(box.children.map(p=>p.textContent)),expected);
  assert.deepEqual(plain(box.children.map(p=>p.href)),[links.imdb,links.sc,links.rottentomatoes,links.allocine]);
  assert(box.children.every(p=>p.tag==='a'&&p.target==='_blank'&&p.rel==='noopener'));
  assert(!box.children.some(p=>p.textContent.endsWith('/10/10')||/\)\/10$/.test(p.textContent)));
});

test('web reserves actually render alternate-only reviews instead of dropping their rating box',()=>{
  const {ctx}=context(),source=read('assets/js/seen-filter.js');
  let box;
  Object.assign(ctx,{mergedLinks:()=>links});
  vm.runInContext(source.slice(source.indexOf('function addReserveRatings'),source.indexOf('function saveButton'))+'\nthis.render=addReserveRatings;',ctx);
  const anchor={insertAdjacentElement(_position,node){box=node}};
  ctx.render({querySelector:selector=>selector==='.ratings'?null:anchor,matches:()=>false},
    {title:'Shutter Island',ratings:{rottentomatoes:recorded.rottentomatoes,allocine_presse:recorded.allocine_presse},
      canonical_metadata:{ratings_checked:'2026-10-09'}});
  assert.deepEqual(plain(box.children.filter(p=>p.className?.includes('rating-pill')).map(p=>p.textContent)),expected.slice(2));
  assert.equal(box.children.at(-1).textContent,'relevé 2026-10-09');
});

test('Jellyfin cards use recorded alternate-only reviews and the same score renderer',()=>{
  const {ctx}=context(),source=read('assets/js/jellyfin-bridge.js');
  vm.runInContext(source.slice(source.indexOf('  const ratingBox='),source.indexOf('  const hydrateFromCatalog='))+'\nthis.render=ratingBox;',ctx);
  const full=ctx.render(recorded,links);
  assert.deepEqual(plain(full.children.filter(p=>p.className?.includes('rating-pill')).map(p=>p.textContent)),expected);
  const alternate=ctx.render({rottentomatoes:recorded.rottentomatoes},links);
  assert.equal(alternate.children[0].textContent,expected[2]);
  assert.equal(ctx.render({},links),null);
});

function method(status){
  const labels=['Inventaire','Publication protégée','Choix éditoriaux'];
  const notes=labels.map(label=>({heading:{textContent:label},text:'Ancienne copie en brouillon / S41',
    querySelector(){return this.heading},replaceChildren(heading,node){this.heading=heading;this.text=node.textContent}}));
  const ctx=vm.createContext({document:{querySelectorAll:()=>notes,createTextNode:textContent=>({textContent})}});
  const source=read('assets/js/issue-loader.js');
  vm.runInContext(source.slice(source.indexOf('const hydrateMethodStatus='),source.indexOf("fetch(jsonUrl,{cache:"))+'\nthis.render=hydrateMethodStatus;',ctx);
  ctx.render({publication_status:status});return notes;
}
test('published method uses current state without frozen draft claims or an old public week',()=>{
  const notes=method('published');
  assert.match(notes[1].text,/Ce numéro est publié\./);
  assert(!/brouillon|S41|SHA|non.certifi/i.test(notes.slice(0,2).map(n=>n.text).join(' ')));
  assert.equal(notes[2].text,'Ancienne copie en brouillon / S41','other editorial method notes are preserved');
});
test('draft and old issues receive process copy without claiming a successful publication',()=>{
  assert.match(method('draft')[1].text,/Ce numéro est en préparation\./);
  assert(!method('draft')[1].text.includes('Ce numéro est publié'));
  assert(!method(undefined)[1].text.includes('Ce numéro est publié'));
});
