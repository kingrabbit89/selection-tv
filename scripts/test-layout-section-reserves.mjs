import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the actual browser gate callback with a fixture of already-paginated
// live nodes. Real Chromium CI still proves the generated issue's geometry.
const validator=fs.readFileSync(new URL('./validate-layout.mjs',import.meta.url),'utf8');
const marker='const sectionReserveState=await page.evaluate(()=>{';
const start=validator.indexOf(marker)+marker.length;
assert(start>=marker.length,'section reserve gate callback must exist');
const end=validator.indexOf('\n   });',start);
assert(end>start,'section reserve gate callback must end');
const callback='(()=>{'+validator.slice(start,end)+'\n})()';
const card=(type,{replacement=false,hidden=false,display='block',visibility='visible',width=100,height=100}={})=>({
  className:type+(replacement?' replacement-generated':'')+(hidden?' seen-hidden':''),
  classList:{contains:value=>(value==='replacement-generated'&&replacement)||(value==='seen-hidden'&&hidden)},
  style:{display,visibility},getBoundingClientRect:()=>({width,height})
});
const page=(id,cards=[],summary='')=>({id,
  querySelectorAll:selector=>cards.filter(c=>c.className.split(' ').includes(selector.replace('article.',''))),
  querySelector:selector=>selector==='.reserve-summary'&&summary?{textContent:summary}:null
});
function inspect(originals,continuations={}){
  const result=vm.runInNewContext(callback,{
    document:{getElementById:id=>originals[id]||null,
      querySelectorAll:selector=>continuations[selector.match(/data-layout-source="([^"]+)"/)?.[1]]||[]},
    getComputedStyle:el=>el.style
  });
  return JSON.parse(JSON.stringify(result));
}

test('live continuation cards and moved reserve summaries belong to the same section',()=>{
  const rv=page('rendezvous-1',[card('week-card'),...Array.from({length:3},()=>card('week-card',{replacement:true}))]);
  const rvNext=page('rendezvous-1-suite-maquette-1',[card('week-card',{replacement:true})],'4 remplacées par la réserve éditoriale');
  const ph=page('sorties-physiques',[card('release-card',{replacement:true})]);
  const phNext=page('sorties-physiques-suite-maquette-1',[card('release-card',{replacement:true})],'2 remplacées par la réserve éditoriale');
  const result=inspect({'rendezvous-1':rv,'sorties-physiques':ph},{'rendezvous-1':[rvNext],'sorties-physiques':[phNext]});
  assert.equal(result.missing,false);
  assert.equal(result.rendezvousVisible,5);assert.equal(result.rendezvousReplacements,4);
  assert.equal(result.physicalVisible,2);assert.equal(result.physicalReplacements,2);
  assert.equal(result.rendezvousSummary,'4 remplacées par la réserve éditoriale');
  assert.equal(result.physicalSummary,'2 remplacées par la réserve éditoriale');
  assert.deepEqual(result.rendezvousPages,['rendezvous-1','rendezvous-1-suite-maquette-1']);
  assert.deepEqual(result.physicalReplacementTypes,['release-card replacement-generated','release-card replacement-generated']);
});

test('continuations retain all checks excluding hidden, invisible and zero-sized cards',()=>{
  const rv=page('rendezvous-1',[card('week-card')]);
  const ph=page('sorties-physiques',[card('release-card')]);
  const hidden=page('rendezvous-1-suite-maquette-1',[
    card('week-card',{replacement:true,hidden:true}),card('week-card',{display:'none'}),
    card('week-card',{visibility:'hidden'}),card('week-card',{width:0}),card('week-card',{height:0})
  ]);
  const result=inspect({'rendezvous-1':rv,'sorties-physiques':ph},{'rendezvous-1':[hidden]});
  assert.equal(result.rendezvousVisible,1);assert.equal(result.rendezvousReplacements,0);
  assert.equal(result.physicalVisible,1);
});

test('ordinary one-page sections preserve their existing counts and summaries',()=>{
  const result=inspect({
    'rendezvous-1':page('rendezvous-1',[card('week-card'),card('week-card',{replacement:true})],'1 remplacées par la réserve éditoriale'),
    'sorties-physiques':page('sorties-physiques',[card('release-card',{replacement:true})],'1 remplacées par la réserve éditoriale')
  });
  assert.equal(result.rendezvousVisible,2);assert.equal(result.rendezvousReplacements,1);
  assert.equal(result.physicalVisible,1);assert.equal(result.physicalReplacements,1);
  assert.equal(result.rendezvousSummary,'1 remplacées par la réserve éditoriale');
  assert.deepEqual(result.rendezvousPages,['rendezvous-1']);
});

test('a missing original section cannot be concealed by an orphan continuation',()=>{
  assert.deepEqual(inspect({'sorties-physiques':page('sorties-physiques')},
    {'rendezvous-1':[page('rendezvous-1-suite-maquette-1',[card('week-card')])]}),{missing:true});
});
