import assert from 'node:assert/strict';
import test from 'node:test';
import {buildProductionPlan,productionContextFromGit} from './editorial-production-plan.mjs';

const SHA='a'.repeat(40), WEEK='2026-S42';
const work=(id='film-1962',title='Un film',year=1962)=>({id,title,aliases:[],director:'Une réalisatrice',year,
  country:'France',genre:'Drame',duration:'100 min',image:'https://images.example/exact.jpg',
  ratings:{imdb:'7/10'},ratings_checked:'2026-09-01',links:{imdb:'https://www.imdb.com/title/tt0000001/'}});
const observation=(extra={})=>({title:'Un film',date:'2026-10-10',start:'20:50',channel:'Arte',...extra});
function context(extra={}) {
  return {week:WEEK,sha:SHA,from:'2026-10-10',inventory:{week:WEEK,days:[]},coverage:{week:WEEK},
    research:{week:WEEK,verification_records:[],research_dossiers:[],research_attempts:[],remaining:['Revue finale']},
    works:{works:[work()]},links:{links:{}},currentissue:{week:WEEK,pages:[],personalization:{pools:{}}},
    historicalissues:[],...extra};
}
const plan=(ctx,observations,extra={})=>buildProductionPlan(ctx,{observations,limit:200,...extra});
const row=(report,title='Un film',scope='samedi')=>report.queue.find(item=>item.title===title && item.scope===scope);

test('saved catalogue lead requires identity, current broadcast and editorial review; inputs immutable',()=>{
  const ctx=context(),original=structuredClone(ctx),report=plan(ctx,[observation()]);
  assert.equal(row(report).classification,'reusable_needs_broadcast_review');
  assert.equal(row(report).canonical_candidates[0].identity_status,'saved_catalogue_lead_needs_confirmation');
  assert(row(report).dynamic_requirements.includes('review_identity_match_and_exact_version'));
  assert(row(report).dynamic_requirements.includes('editorial_selection_and_card_review'));
  assert.equal(report.publication_ready,false);assert.equal(report.automatic_selection,false);
  assert.deepEqual(ctx,original);
});

test('exact duplicate broadcasts merge origins; different civil days remain separate',()=>{
  const report=plan(context(),[observation({source_url:'https://official.example',checked_at:'2026-09-01'}),
    observation({source_url:'https://guide.example',checked_at:'2026-10-08'}),
    observation({date:'2026-10-11'})]);
  assert.equal(report.summary.duplicate_slots_removed,1);assert.equal(report.queue_total,2);
  assert.equal(row(report).observations[0].source_records.length,2);
  assert.deepEqual(row(report).observations[0].source_records.map(source=>source.checked_at),['2026-09-01','2026-10-08']);
  assert(row(report,'Un film','dimanche'));assert.equal(row(report).observations[0].source_records[0].source_independence,null);
});

test('canonical aliases merge work/day while preserving exact labelled observations',()=>{
  const saved=work();saved.aliases=['The Film'];
  const report=plan(context({works:{works:[saved]}}),[observation(),observation({title:'The Film'})]);
  assert.equal(report.queue_total,1);assert.equal(row(report).observations.length,2);
  assert.equal(report.summary.duplicate_slots_removed,0);
  assert(!row(report).conflicting_requirements.includes('resolve_scoped_event_title_conflict'));
});

test('same event with generic collection name is one scoped conflict, never a global film alias',()=>{
  const saved=work('hotel-1938','Hôtel du Nord',1938);
  const report=plan(context({works:{works:[saved]}}),[
    observation({title:'Hôtel du Nord',date:'2026-10-11',start:'00:20',channel:'France 3'}),
    observation({title:'Cinéma de minuit',date:'2026-10-11',start:'00:20',channel:'France 3'}),
    observation({title:'Cinéma de minuit',date:'2026-10-12',start:'00:20',channel:'France 3'})]);
  const conflict=report.queue.find(item=>item.scope==='dimanche');
  assert.equal(conflict.classification,'conflicted');assert.equal(conflict.observations.length,2);
  assert(conflict.conflicting_requirements.includes('resolve_scoped_event_title_conflict'));
  assert.deepEqual(conflict.canonical_candidates.map(item=>item.work_id),['hotel-1938']);
  assert.equal(report.queue.find(item=>item.scope==='lundi').canonical_candidates.length,0);
  assert.deepEqual(saved.aliases,[]);
});

test('same-title remakes remain ambiguous and explicit identity isolates saved evidence',()=>{
  const original=work('crime-1962','Un crime dans la tête',1962),remake=work('crime-2004','Un crime dans la tête',2004);
  const ctx=context({works:{works:[original,remake]},research:{week:WEEK,verification_records:[
    {work_id:'crime-2004',fields:['director'],status:'verified',stability:'stable',source_urls:['https://remake.example'],checked_at:'2026-09-01'}]},
    historicalissues:[{entry:{week:'2026-S41',status:'published'},issue:{week:'2026-S41',pages:[],personalization:{pools:{
      'samedi-selection':{target:3,candidates:[{title:'Un crime dans la tête',work_id:'crime-2004',summary:'Wrong remake text'}]}}}}}]});
  let report=plan(ctx,[observation({title:'Un crime dans la tête'})]);
  assert.equal(report.queue[0].classification,'conflicted');assert.equal(report.queue[0].canonical_candidates.length,2);
  assert(report.queue[0].conflicting_requirements.includes('resolve_same_title_identity_or_remake'));
  report=plan(ctx,[observation({title:'Un crime dans la tête',work_id:'crime-1962'})]);
  assert.deepEqual(report.queue[0].canonical_candidates.map(item=>item.work_id),['crime-1962']);
  assert.equal(report.queue[0].saved_verification_records.length,0);
  assert.equal(report.queue[0].saved_texts.length,0);
});

test('duplicate slot identities preserve all canonical candidates and report the conflict',()=>{
  const report=plan(context({works:{works:[work(),work('film-2004','Un film',2004)]}}),[
    observation({work_id:'film-1962'}),observation({work_id:'film-2004'})]);
  assert.equal(report.queue_total,1);
  assert.deepEqual(report.queue[0].canonical_candidates.map(item=>item.work_id).sort(),['film-1962','film-2004']);
  assert(report.queue[0].conflicting_requirements.includes('resolve_duplicate_slot_version_or_identity_conflict'));
});

test('unknown explicit ID and contradictory identity fields cannot silently resolve a work',()=>{
  for(const extra of [{work_id:'missing-id'},{year:2004},{director:'Un autre réalisateur'}]) {
    const report=plan(context(),[observation(extra)]);
    assert.equal(report.queue[0].classification,'conflicted');
    assert(report.queue[0].conflicting_requirements.length>0);
  }
});

test('plural directors/countries are cached without inventing singular fields or conflicting known co-directors',()=>{
  const saved=work();delete saved.director;delete saved.country;saved.directors=['A','B'];saved.countries=['France','Belgique'];
  const ctx=context({works:{works:[saved]}});
  const item=plan(ctx,[observation({director:'B'})]).queue[0];
  assert.equal(item.classification,'reusable_needs_broadcast_review');
  assert.deepEqual(item.cached_facts.find(fact=>fact.field==='director').value,['A','B']);
  assert.deepEqual(item.cached_facts.find(fact=>fact.field==='country').value,['France','Belgique']);
  assert.equal(item.cached_facts.find(fact=>fact.field==='country').provenance.json_pointer,'/works/0/countries');
});

test('scope pagination covers every group once and emits continuation instead of silent truncation',()=>{
  const observations=Array.from({length:5},(_,i)=>observation({title:'Title '+i,start:'20:0'+i}));
  const ctx=context(),first=plan(ctx,observations,{limit:2,scope:'samedi'}),second=plan(ctx,observations,{limit:2,offset:2,scope:'samedi'}),
    last=plan(ctx,observations,{limit:2,offset:4,scope:'samedi'});
  assert.equal(first.queue_total,5);assert.equal(first.next_offset,2);assert.equal(second.next_offset,4);assert.equal(last.next_offset,null);
  assert.equal(new Set([...first.queue,...second.queue,...last.queue].map(item=>item.id)).size,5);
  assert.equal(plan(ctx,observations,{scope:'dimanche'}).queue_total,0);
});

test('stable dated proofs are reusable without pretending a fresh consultation; dynamic evidence stays scoped',()=>{
  const ctx=context({research:{week:WEEK,verification_records:[
    {title:'Un film',fields:['director','year'],stability:'stable',status:'verified',checked_at:'2025-01-01',
      source_urls:['https://identity.example'],applies_to:{week:'2025-S02'}},
    {title:'Un film',fields:['ratings'],stability:'dynamic',status:'verified',checked_at:'2025-01-01',
      source_urls:['https://oldrating.example'],applies_to:{week:'2025-S02'}}]}});
  const item=plan(ctx,[observation()]).queue[0],director=item.cached_facts.find(fact=>fact.field==='director');
  assert.equal(director.evidence[0].checked_at,'2025-01-01');assert.equal(director.evidence[0].provenance.source_sha,SHA);
  assert.equal(item.saved_verification_records.length,1);
  assert(!item.dynamic_requirements.includes('review_saved_field_provenance:director'));
  assert(item.dynamic_requirements.includes('review_current_ratings_or_saved_specific_unavailability'));
  assert.equal(item.cached_facts.find(fact=>fact.field==='ratings').checked_at,'2026-09-01');
});

test('mixed stable record reuses identity fields across old/version scope without applying its duration',()=>{
  const ctx=context({research:{week:WEEK,verification_records:[
    {title:'Un film',fields:['director','year','duration','links'],stability:'stable',status:'verified',
      source_urls:['https://exact-copy.example'],checked_at:'2025-01-01',
      applies_to:{week:'2025-S02',version:'restored cinema version'}}]}});
  const item=plan(ctx,[observation()]).queue[0],record=item.saved_verification_records[0];
  assert.deepEqual(record.fields,['director','year']);
  assert.deepEqual(record.fields_excluded_due_to_scope,['duration','links']);
  assert.equal(record.stable_identity_fields_reused_outside_original_scope,true);
  assert.equal(record.applies_to.version,'restored cinema version');assert.equal(record.checked_at,'2025-01-01');
  assert.equal(item.cached_facts.find(fact=>fact.field==='director').evidence.length,1);
  assert.equal(item.cached_facts.find(fact=>fact.field==='duration').evidence.length,0);
});

test('unverified stable records do not remove per-field provenance work',()=>{
  const ctx=context({research:{week:WEEK,verification_records:[{title:'Un film',fields:['director','year','country','genre'],
    status:'unverified',stability:'stable',source_urls:['https://unverified.example'],checked_at:'2025-01-01'}]}});
  const item=plan(ctx,[observation()]).queue[0];
  for(const field of ['director','year','country','genre'])assert(item.dynamic_requirements.includes('review_saved_field_provenance:'+field));
});

test('empty aliases and unnamed generic grid evidence never expose unrelated field proofs',()=>{
  const saved=work();saved.aliases=[''];
  const ctx=context({works:{works:[saved]},research:{week:WEEK,verification_records:[
    {fields:['year'],status:'verified',stability:'stable',source_urls:['https://generic.example']}] }});
  const item=plan(ctx,[observation()]).queue[0];
  assert.equal(item.saved_verification_records.length,0);
  assert.equal(item.cached_facts.find(fact=>fact.field==='year').evidence.length,0);
});

test('raw new titles require triage, not mandatory enrichment of the entire inventory',()=>{
  const ctx=context();
  const report=plan(ctx,[observation({title:'A title with no existing dossier',start:'22:50'}),observation()]);
  const raw=report.queue.find(item=>item.classification==='new_identity');
  assert.equal(raw.work_stage,'editorial_triage_before_full_enrichment');
  assert.deepEqual(raw.next_actions,['editorial_triage_before_full_enrichment']);
  assert.equal(raw.enrichment_requirements_conditional_on_editorial_selection,true);
  assert.equal(report.queue[0].classification,'reusable_needs_broadcast_review');
});

test('duration/version evidence and pauses are scoped to the exact observation',()=>{
  const ctx=context({research:{week:WEEK,verification_records:[{title:'Un film',fields:['duration'],status:'conflict',
    applies_to:{week:WEEK,date:'2026-10-10',version:'cinema'}}],research_attempts:[
    {id:'pause-1',status:'paused_version',object:{title:'Un film',week:WEEK,date:'2026-10-10',version:'TV'},resume_condition:'Find exact copy'}]}});
  let report=plan(ctx,[observation({version:'cinema'}),observation({date:'2026-10-11',version:'TV'})]);
  assert.equal(row(report).classification,'conflicted');
  assert(row(report).conflicting_requirements.includes('resolve_saved_conflict:duration'));
  assert.equal(row(report,'Un film','dimanche').classification,'reusable_needs_broadcast_review');
  report=plan(ctx,[observation({version:'TV'})]);
  assert.equal(row(report).classification,'paused_scoped');
  assert.equal(row(report).saved_verification_records.length,0);
});

test('an excluded platform offer does not pause all linear broadcasts; partial pause does not stop an entire day',()=>{
  const ctx=context({research:{week:WEEK,research_attempts:[
    {status:'excluded_offer',object:{title:'Un film',platform:'OldPlatform'}},
    {status:'paused_source',object:{title:'Un film',date:'2026-10-10',start:'20:50',channel:'Arte'}}]}});
  const item=plan(ctx,[observation(),observation({start:'23:00'})]).queue[0];
  assert.equal(item.classification,'reusable_needs_broadcast_review');
  assert.equal(item.blocked_observations.length,1);assert.equal(item.observations.length,2);
});

test('partial duplicate version conflict affects its day, preserves unrelated day observations',()=>{
  const report=plan(context(),[observation({version:'52 min'}),observation({version:'54 min'}),observation({date:'2026-10-11',version:'52 min'})]);
  assert.equal(row(report).classification,'conflicted');
  assert.equal(row(report,'Un film','dimanche').classification,'reusable_needs_broadcast_review');
  assert.deepEqual(row(report).observations[0].versions,['52 min','54 min']);
});

test('prior incomplete cards provide provenance and metadata hints without being promoted',()=>{
  const ctx=context({works:{works:[{id:'film-1962',title:'Un film'}]},historicalissues:[
    {entry:{week:'2026-S41',status:'published'},issue:{week:'2026-S41',pages:[],
      personalization:{pools:{'samedi-selection':{target:3,candidates:[{title:'Un film',work_id:'film-1962',year:1962,summary:'An old partial summary'}]}}}}}]});
  const item=plan(ctx,[observation()]).queue[0];
  assert.equal(item.classification,'reusable_needs_broadcast_review');
  assert.equal(item.saved_texts[0].original_week,'2026-S41');assert.equal(item.saved_texts[0].checked_at,null);
  assert.equal(item.saved_texts[0].provenance.json_pointer,'/personalization/pools/samedi-selection/candidates/0/summary');
  assert(item.missing_requirements.includes('find_metadata:director'));
  assert(!item.missing_requirements.includes('find_metadata:year'));
  assert.equal(item.current_cards.length,0);
});

test('HTML entities decoded once for historical exposure; unrelated titles do not inherit exposure or text',()=>{
  const saved=work('apostrophe','L\'Hôtel & ses amis');
  const ctx=context({works:{works:[saved]},historicalissues:[{entry:{week:'2026-S41',short:'S41',status:'published'},
    issue:{week:'2026-S41',pages:[{id:'samedi-selection',html:'<article><H3>L&#39;Hôtel &amp; ses amis</H3><p>Old</p></article>'}],
      personalization:{pools:{}}}}]});
  let item=plan(ctx,[observation({title:saved.title})]).queue[0];
  assert.deepEqual(item.historical_exposure,[{week:'2026-S41',scopes:['public']}]);
  item=plan(ctx,[observation({title:'Un autre hôtel'})]).queue[0];
  assert.equal(item.classification,'new_identity');assert.equal(item.historical_exposure.length,0);assert.equal(item.saved_texts.length,0);
});

test('historical reserve and occurrence fallback have exactly separate exposure scopes',()=>{
  const saved=work();saved.occurrences=[{week:'S40'}];
  const ctx=context({works:{works:[saved]},historicalissues:[
    {entry:{week:'2026-S41',short:'S41',status:'published'},issue:{week:'2026-S41',pages:[],personalization:{pools:{
      'samedi-selection':{target:3,candidates:[{title:'Un film',rank:4}]},
      'replay-1':{target:0,candidates:[{title:'Un autre film',rank:1}]}}}}},
    {entry:{week:'2026-S40',short:'S40',status:'published'},issue:{week:'2026-S40',pages:[]}}]});
  assert.deepEqual(plan(ctx,[observation()]).queue[0].historical_exposure,[
    {week:'2026-S41',scopes:['daily_reserve']},{week:'2026-S40',scopes:['catalogue_occurrence_fallback']}]);
});

test('materialized rows retain review gates and are placed behind actionable work',()=>{
  const ctx=context({currentissue:{week:WEEK,pages:[{id:'samedi-selection',html:'<article class="feature"><h3>Un film</h3></article>'}],
    personalization:{pools:{'samedi-selection':{target:3,candidates:[{title:'Un film',work_id:'film-1962',time:'20:50',channel:'Arte',rank:1}]}}}}});
  const report=plan(ctx,[observation(),observation({title:'Un nouveau film',start:'22:30'})]);
  assert.equal(row(report).classification,'already_materialized');assert.equal(report.queue[0].title,'Un nouveau film');
  assert.equal(report.scope_deficits[0].public_materialized,1);assert.equal(report.scope_deficits[0].missing_public,2);
  assert.equal(row(report).automatic_selection,false);
});

test('empty next week is supported; out-of-week slots retain exclusion counts and proof pointers',()=>{
  const ctx=context({week:'2026-S43',from:undefined,inventory:null,coverage:null,research:null,currentissue:null});
  const report=plan(ctx,[observation(),observation({date:'2026-10-17'})],{
    sourceReport:{retrieval_performed:false,sources:[{source_id:'guide',status:'blocked'}]}});
  assert.deepEqual(report.range,{from:'2026-10-17',to:'2026-10-23'});
  assert.equal(report.summary.excluded_observations,1);assert.equal(report.summary.input_observations,1);
  assert.equal(report.warnings[0].reason,'observation_outside_target_week');
  assert.equal(report.warnings[0].provenance.json_pointer,'/observations/0');
  assert.equal(report.source_capture.retrieval_performed,false);assert.equal(report.source_capture.sources[0].status,'blocked');
});

test('actual collector source_results preserve status, original capture time/hash and gaps without certification',()=>{
  const sourceReport={observed_at:'2026-10-08T01:00:00Z',source_sha:'b'.repeat(40),source_results:[
    {id:'official',url:'https://official.example',status:'parsed',observations_count:12,
      evidence:{fetched_at:'2026-10-07T23:59:59Z',sha256:'c'.repeat(64),mode:'saved_capture'},errors:[],warnings:[]},
    {id:'stale',url:'https://stale.example',status:'stale',observations_count:0,errors:['wrong dates'],warnings:[]},
    {id:'partial',url:'https://partial.example',status:'parsed',observations_count:3,errors:[],warnings:['incomplete day']}]};
  const report=plan(context(),[observation()],{sourceReport});
  assert.equal(report.source_capture.observed_at,sourceReport.observed_at);
  assert.equal(report.source_capture.source_results[0].evidence.fetched_at,'2026-10-07T23:59:59Z');
  assert.equal(report.source_capture.source_results[0].evidence.sha256,'c'.repeat(64));
  assert.equal(report.source_capture.source_sha,'b'.repeat(40));assert.equal(report.source_capture.coverage_certified,false);
  assert.equal(report.source_gaps.length,2);assert.deepEqual(report.source_gaps[0].errors,['wrong dates']);
});

test('saved rubric intentions carry no invented broadcast time and expose only matching rubric shortlist',()=>{
  const ctx=context({research:{week:WEEK,shortlist:{entries:[
    {title:'Un film',scope:{rubrique:'plateformes-gratuites'},status:'consider'},
    {title:'Un film',scope:{day:'samedi'},status:'consider'}]}},
    editorial_config:{quality_gates:{strict_section_targets:{'plateformes-gratuites':2}}}});
  const report=plan(ctx,[]);
  const rubric=row(report,'Un film','plateformes-gratuites');
  assert(rubric);assert.equal(rubric.observations[0].date,null);assert.equal(rubric.observations[0].start,undefined);
  assert.equal(rubric.observations[0].editorial_intention,true);
  assert.equal(rubric.shortlist.length,1);assert.equal(rubric.shortlist[0].scope.rubrique,'plateformes-gratuites');
  assert.equal(row(report).shortlist.length,1);assert.equal(row(report).shortlist[0].scope.day,'samedi');
  assert.equal(report.scope_deficits.find(item=>item.scope==='plateformes-gratuites').missing_public,2);
});

test('compact saved HTML keeps exact immutable pointer and offset without copying long content',()=>{
  const ctx=context({historicalissues:[{entry:{week:'2026-S41',status:'published'},issue:{week:'2026-S41',
    pages:[{id:'samedi-selection',html:'prefix<article><h3>Un film</h3><p>'+('old '.repeat(100))+'</p></article>'}]}}]});
  const item=plan(ctx,[observation()],{compact:true}).queue[0];
  assert.equal(item.saved_texts[0].value_omitted,true);assert.equal(item.saved_texts[0].value,undefined);
  assert.equal(item.saved_texts[0].html_offset,6);assert.equal(item.saved_texts[0].provenance.source_sha,SHA);
});

test('Git context resolves ref once and raw inventory retains original bytes with one read',()=>{
  const calls=[],files={'data/manifest.json':{weeks:[]},'data/works.json':{works:[]},
    ['data/inventory/'+WEEK+'.json']:{week:WEEK,days:[]}};
  const inventoryRaw='{\n  \"week\": \"2026-S42\", \"days\": []\n}\n';
  const runGit=args=>{calls.push(args);if(args[0]==='rev-parse')return SHA+'\n';
    if(args[0]==='ls-tree')return Object.keys(files).join('\n');
    if(args[0]==='show'){assert(args[1].startsWith(SHA+':'));return args[1].includes(':data/inventory/')?inventoryRaw:JSON.stringify(files[args[1].slice(41)]);}
    throw Error('Unexpected command');};
  const ctx=productionContextFromGit(WEEK,'auto/2026-S42','/unused',runGit);
  assert.equal(ctx.sha,SHA);assert.equal(calls.filter(args=>args[0]==='rev-parse').length,1);
  assert.equal(ctx.inventory_source_content,inventoryRaw);
  assert.equal(calls.filter(args=>args[0]==='show' && args[1].includes(':data/inventory/')).length,1);
  assert.equal(ctx.currentissue,null);
  assert.equal(buildProductionPlan(ctx).queue_total,0);
});

test('wrong weeks, invalid target calendar and mutable SHAs are rejected',()=>{
  assert.throws(()=>buildProductionPlan(context({sha:'HEAD'})),/immutable/);
  assert.throws(()=>buildProductionPlan(context({week:'2026-S53',from:'2026-10-10'})),/another week/);
  assert.throws(()=>buildProductionPlan(context({inventory:{week:'2026-S41',days:[]}})),/another week/);
  assert.throws(()=>buildProductionPlan(context(),{limit:0}),/limit/);
  assert.throws(()=>productionContextFromGit(WEEK,'HEAD..old'),/invalid ref/);
});
