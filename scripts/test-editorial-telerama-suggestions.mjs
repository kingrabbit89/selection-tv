import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildProductionPlan} from './editorial-production-plan.mjs';
import {prepareProductionFlow} from './editorial-production-flow.mjs';
import {checkShortlist} from './editorial-progress.mjs';

const SHA='a'.repeat(40),PDF='b'.repeat(64),WEEK='2026-S43',FROM='2026-10-17';
const policy={provided_telerama_editorial:'primary_seed',from_week:WEEK,native_rating_min:2,
  priority_order:['Bravo','Très bien','Bien'],other_sources:'complete_and_balance',final_selection:'editorial_review'};
const marks={Bravo:{glyph_code:'i',label:'Bravo',t_count:4},'Très bien':{glyph_code:'u',label:'Très bien',t_count:3},
  Bien:{glyph_code:'y',label:'Bien',t_count:2},Bof:{glyph_code:'t',label:'Bof',t_count:1},Hélas:{glyph_code:'r',label:'Hélas',t_count:null}};
const startFor=title=>String(18+title.charCodeAt(0)%6)+':'+String([...title].reduce((sum,letter)=>sum+letter.charCodeAt(0),0)%60).padStart(2,'0');
const review=(title,mark='Bravo',extra={})=>({id:'review-'+title,title,date:FROM,grid_date:FROM,start:startFor(title),channel:'Arte',
  in_daily_review_pages:true,native_rating:marks[mark],author:'A critic',review_summary:'Reviewed paraphrase of the magazine opinion.',
  summary_reviewed:true,summary_reviewed_at:'2026-10-09T16:00:00Z',summary_basis:'Paraphrase after reading the provided PDF.',
  pdf_page:99,bbox:[10,40,200,80],requires_title_review:false,source_ref:'sha256:'+PDF,source_url:null,checked_at:null,...extra});
const report=(reviews,extra={})=>({schema_version:1,kind:'telerama_editorial',week:WEEK,range:{from:FROM,to:'2026-10-23'},
  source:{filename:'Magazine.pdf',sha256:PDF,bytes:1000,pages:152},reviews,pages:[{pdf_page:99,width:592,height:771}],
  publication_ready:false,coverage_certified:false,...extra});
const work=(title,extra={})=>({id:'work-'+title,title,year:2000,director:'Director',...extra});
const ctx=(titles=[],extra={})=>({week:WEEK,sha:SHA,from:FROM,editorial_config:{initial_suggestions:policy},
  research:{remaining:['Complete coverage'],shortlist:{entries:[]},research_dossiers:[],research_attempts:[]},
  inventory:{week:WEEK,days:[{date:FROM,items:titles.map(title=>({title,start:startFor(title),channel:'Arte'}))}]},
  coverage:{week:WEEK},works:{works:[]},links:{links:{}},currentissue:{week:WEEK,pages:[],personalization:{pools:{}}},...extra});
const plan=context=>buildProductionPlan(context,{limit:200});
const titles=plan=>plan.queue.map(row=>row.title);

test('future policy does not alter S42, absent PDF, absent policy or explicit paper opt-out plans',()=>{
  const context=ctx(['A film']),withoutPolicy={...context,editorial_config:{}};
  assert.deepEqual(plan(context),plan(withoutPolicy));
  const legacyFrom='2026-10-10',legacy={...context,week:'2026-S42',from:legacyFrom,
    inventory:{days:[{date:legacyFrom,items:[{title:'A film',start:'21:00',channel:'Arte'}]}]},coverage:{},currentissue:{pages:[]}};
  legacy.prepared_telerama_editorial=report([review('A film','Bravo',{date:legacyFrom,grid_date:legacyFrom,start:'21:00'})],
    {week:'2026-S42',range:{from:legacyFrom,to:'2026-10-16'}});
  assert.deepEqual(plan(legacy),plan({...legacy,editorial_config:{}}));
  context.prepared_telerama_editorial=report([review('A film')]);
  assert.deepEqual(buildProductionPlan(context,{limit:200,useTelerama:false}),plan(withoutPolicy));
  assert.equal(plan({...context,editorial_config:{}}).initial_editorial_suggestions,undefined);
});

test('positive native opinions seed the initial list and actual queue before uncoted catalogue leads',()=>{
  const context=ctx(['Uncoted canonical','Bien film','Bravo film','Very good film','Bof film','Bad film'],
    {works:{works:[work('Uncoted canonical')]}});
  context.prepared_telerama_editorial=report([review('Bien film','Bien'),review('Very good film','Très bien'),
    review('Bravo film'),review('Bof film','Bof'),review('Bad film','Hélas')]);
  const before=structuredClone(context),result=plan(context);
  assert.deepEqual(titles(result).slice(0,3),['Bravo film','Very good film','Bien film']);
  assert.deepEqual(result.initial_editorial_suggestions.map(row=>row.native_rating.label),['Bravo','Très bien','Bien']);
  assert.equal(result.editorial_review_candidates.length,5);
  assert.equal(result.initial_editorial_suggestions_summary.queue_prioritized,true);
  assert(!result.editorial_review_summary.ordering.includes('queue order and editorial choice remain unchanged'));
  for(const seed of result.initial_editorial_suggestions){
    assert.equal(seed.publisher,'Télérama');assert.equal(seed.summary_reviewed,true);
    assert.equal(seed.identity_verified,false);assert.equal(seed.canonical_identity_verified,false);
    assert.equal(seed.selection_decision,false);assert.equal(seed.final_selection,'editorial_review');
    assert.equal(seed.shortlist_signal.source_ref,'sha256:'+PDF);
    assert.equal(seed.shortlist_signal.provenance.path,`data/editorial-inputs/${WEEK}/telerama-editorial.json`);
    checkShortlist({week:WEEK,shortlist:{entries:[{id:seed.id,title:seed.title,scope:{day:'samedi'},status:'to_research',signals:[seed.shortlist_signal]}]}});
    assert.equal(seed.checked_at,null);assert.equal(seed.source_independence,null);
    assert(!Object.hasOwn(seed,'imdb'));assert(!Object.hasOwn(seed,'senscritique'));assert(!Object.hasOwn(seed,'work_id'));
  }
  assert.equal(result.publication_ready,false);assert.deepEqual(result.remaining_requirements,['Complete coverage']);assert.deepEqual(context,before);
});

test('initial list is complete despite queue pagination and unmatched positive reviews start investigations only',()=>{
  const context=ctx(['A film']),input=report([review('A film','Bien'),review('A different film'),review('Another film','Très bien')]);
  context.prepared_telerama_editorial=input;
  const result=buildProductionPlan(context,{limit:1}),unmatched=result.initial_editorial_suggestions.find(row=>row.title==='A different film');
  assert.equal(result.queue.length,1);assert.equal(result.queue_total,1);assert.equal(result.initial_editorial_suggestions.length,3);
  assert.deepEqual(unmatched.matching_queue_ids,[]);assert.equal(unmatched.next_action,'investigate_title_and_civil_slot');
  assert(!Object.hasOwn(unmatched,'work_id'));assert.equal(result.initial_editorial_suggestions_summary.unmatched_suggestions,2);
});

test('any registered shortlist preserves the existing production order and never restarts initial seeding',()=>{
  for(const status of ['retained','rejected','deferred']){
    const context=ctx(['A canonical','Z seed'],{works:{works:[work('A canonical')]}});
    context.research.shortlist.entries=[{title:'A canonical',status,scope:{day:'samedi'}}];
    context.prepared_telerama_editorial=report([review('Z seed')]);
    const baseline=plan({...context,editorial_config:{}}),result=plan(context);
    assert.deepEqual(titles(result),titles(baseline));assert.equal(result.initial_editorial_suggestions_summary.queue_prioritized,false);
    assert.equal(result.initial_editorial_suggestions_summary.phase,'saved_shortlist_production');
    assert.equal(result.initial_editorial_suggestions[0].next_action,'consult_saved_shortlist_and_remaining_without_restarting_seed');
  }
});

test('paused, materialized and ambiguous groups keep their states without opinion inheritance on remakes',()=>{
  const context=ctx(['Active','Paused','Materialized','Remake'],{works:{works:[work('Materialized'),work('Remake'),work('Remake',{id:'other-remake',year:2020})]}});
  context.research.research_attempts=[{status:'paused_source',title:'Paused',object:{date:FROM,start:startFor('Paused'),channel:'Arte'}}];
  context.currentissue.personalization.pools['samedi-selection']={target:3,candidates:[
    {title:'Materialized',work_id:'work-Materialized',time:startFor('Materialized'),channel:'Arte',rank:1}]};
  context.prepared_telerama_editorial=report([review('Active','Bien'),review('Paused'),review('Materialized'),review('Remake')]);
  const result=plan(context);assert.equal(result.queue[0].title,'Active');
  for(const title of ['Paused','Materialized','Remake']){
    const seed=result.initial_editorial_suggestions.find(row=>row.title===title);
    assert.equal(seed.queue_priority_applied,false);assert.deepEqual(seed.matching_queue_ids,[]);assert(seed.saved_states_preserved.length);
  }
  const remake=result.queue.find(row=>row.title==='Remake');assert.equal(remake.classification,'conflicted');
  assert.equal(remake.editorial_signals,undefined);assert.equal(remake.canonical_candidates.length,2);
  assert(result.editorial_review_candidates.some(row=>row.title==='Remake'));
});

test('minimal saved decisions prevent reopening but another scoped civil broadcast remains eligible',()=>{
  for(const state of ['rejected','excluded','retained','selected','card_drafted']){
    const context=ctx(['A active','Z decided']);
    context.research.research_dossiers=[{title:'Z decided',decision:state,decision_note:'Saved choice'}];
    context.prepared_telerama_editorial=report([review('A active','Bien'),review('Z decided')]);
    const result=plan(context),seed=result.initial_editorial_suggestions.find(row=>row.title==='Z decided');
    assert.equal(result.queue[0].title,'A active');assert.equal(seed.queue_priority_applied,false);
    assert(seed.saved_states_preserved[0].reasons.includes('saved_dossier_decision'));
  }
  const context=ctx(['Z seed']);context.research.research_dossiers=[
    {title:'Z seed',decision:'excluded',applies_to:{date:FROM,start:'23:00',channel:'Arte'}}];
  context.prepared_telerama_editorial=report([review('Z seed')]);
  assert.equal(plan(context).initial_editorial_suggestions[0].queue_priority_applied,true);
});

test('missing paraphrases stay absent and native marks remain opinions rather than vetoes or converted scores',()=>{
  const context=ctx(['Good','Low','Bad']);context.prepared_telerama_editorial=report([
    review('Good','Bien',{review_summary:null,summary_reviewed:false}),review('Low','Bof'),review('Bad','Hélas')]);
  const result=plan(context);assert.equal(result.initial_editorial_suggestions.length,1);
  assert.equal(result.initial_editorial_suggestions[0].review_summary,null);
  assert.equal(result.initial_editorial_suggestions[0].summary_reviewed,false);
  assert(result.queue.some(row=>row.title==='Low'));assert(result.queue.some(row=>row.title==='Bad'));
  assert.equal(result.queue.find(row=>row.title==='Low').editorial_signals[0].native_rating.label,'Bof');
});

test('explicit local opinions produce a visible seed batch with real local pointers and no fake Git shortlist source',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'telerama-initial-')),context=ctx(['A seed']),before=structuredClone(context);
  try{
    const result=await prepareProductionFlow({week:WEEK,ref:SHA,outDir:path.join(directory,'batch'),teleramaEditorial:report([review('A seed')])},
      {readContext:()=>context});
    const seed=result.plan.initial_editorial_suggestions[0];
    assert.equal(seed.provenance.source_sha,null);assert.equal(seed.provenance.path,path.join(directory,'batch','telerama-editorial.json'));
    assert.equal(seed.shortlist_signal,undefined);assert.equal(result.summary.initial_editorial_suggestions.positive_suggestions,1);
    assert.equal(result.summary.initial_editorial_suggestions.suggestions_field,'initial_editorial_suggestions');
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'batch','work-batch.json'),'utf8'));
    assert.equal(saved.initial_editorial_suggestions.length,1);assert.deepEqual(context,before);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
