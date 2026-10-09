import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionPlan} from './editorial-production-plan.mjs';

const WEEK='2026-S42',SHA='a'.repeat(40),PDF='b'.repeat(64),FROM='2026-10-10';
const policy={mode:'official_or_reviewed_concordance',from_week:WEEK,fields:['title','channel','date','start'],
  minimum_distinct_guides:2,known_shared_feed:'single_reference',unknown_feed_provenance:'record_without_blocking_concordance',
  official_corrections:'take_precedence',coverage_review:'dated_grid_comparison',source_independence:'record_separately'};
const source=(publisher,url,extra={})=>({title:'Un film',date:FROM,start:'21:00',channel:'Arte',publisher,source_url:url,
  checked_at:'2026-10-09T16:00:00Z',page_date:FROM,actually_read:true,source_independence:null,...extra});
const context=(extra={})=>({week:WEEK,sha:SHA,from:FROM,editorial_config:{web_schedule_evidence:policy},
  research:{week:WEEK,remaining:['Revue réelle de couverture'],verification_records:[],research_attempts:[]},
  inventory:{week:WEEK,days:[]},coverage:{week:WEEK,full_week_reaudit_completed:false,days:[{independent_scan_complete:false}]},
  works:{works:[{id:'film',title:'Un film',year:2000,director:'Director'}]},links:{links:{}},
  currentissue:{week:WEEK,pages:[],personalization:{pools:{}}},...extra});
const plan=(ctx,observations=[],extra={})=>buildProductionPlan(ctx,{observations,limit:200,...extra});

test('the Web route works without PDF and remains active when Telerama is disabled',()=>{
  const ctx=context(),rows=[source('First guide','https://first.test/grid')];
  const result=plan(ctx,rows,{useTelerama:false}),item=result.queue[0];
  assert.equal(result.web_schedule_evidence.mode,'official_or_reviewed_concordance');
  assert(item.dynamic_requirements.includes('review_current_web_broadcast_evidence'));
  assert(!item.dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
  assert.equal(item.web_broadcast_review.bounded_failure_action,'replace_with_verified_alternative_after_bounded_research');
  assert.equal(item.web_broadcast_review.observations[0].requirement_condition,'if_selected_or_scoped_omission_review');
});

test('without policy or before its effective week the historical plan is exactly preserved',()=>{
  const ctx=context({editorial_config:{}}),rows=[source('A guide','https://first.test/grid')],original=plan(ctx,rows);
  assert.equal(original.web_schedule_evidence,undefined);
  assert(original.queue[0].dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
  const future=context({editorial_config:{web_schedule_evidence:{...policy,from_week:'2026-S43'}}});
  assert.deepEqual(plan(future,rows),original);
});

test('two dated concordant guides with unknown upstream expose the reviewed route without demanding a metadata inquiry',()=>{
  const ctx=context(),before=structuredClone(ctx),rows=[source('Publisher one','https://first.test/grid'),source('Publisher two','https://second.test/grid')];
  const input=structuredClone(rows),result=plan(ctx,rows),review=result.queue[0].web_broadcast_review,slot=review.observations[0];
  assert.equal(slot.declared_guide_reference_count,2);assert(slot.route_candidates.includes('reviewed_concordant_guides'));
  assert.equal(slot.upstream_provenance_requirement,'record_unknown_without_blocking_reviewed_concordance');
  assert.equal(slot.automatically_verified,false);
  assert(slot.saved_references.every(reference=>reference.source_independence===null));
  assert.deepEqual(result.remaining_requirements,ctx.research.remaining);assert.equal(result.publication_ready,false);
  assert.deepEqual(ctx,before);assert.deepEqual(rows,input);
});

test('known shared feed counts as one reference and the same publisher never counts twice',()=>{
  const shared={shared_feed_key:'feed-A',shared_feed_evidence:'Saved explicit distributor feed identification'};
  for(const rows of [
    [source('Publisher one','https://first.test/grid',shared),source('Publisher two','https://second.test/grid',shared)],
    [source('Publisher one','https://first.test/grid',shared),source('Publisher one','https://other-domain.test/grid')],
    [source('Publisher one','https://first.test/grid',shared),source('Publisher one','https://second.test/grid',
      {shared_feed_key:'feed-B',shared_feed_evidence:'Other documented feed'})]
  ]){
    const slot=plan(context(),rows).queue[0].web_broadcast_review.observations[0];
    assert.equal(slot.declared_guide_reference_count,1);assert(!slot.route_candidates.includes('reviewed_concordant_guides'));
  }
});

test('publisher and shared-feed links are merged transitively without counting duplicate references',()=>{
  const feed={shared_feed_key:'feed-A',shared_feed_evidence:'Saved feed provenance'};
  const slot=plan(context(),[source('P1','https://first.test',feed),source('P2','https://second.test',feed),
    source('P2','https://third.test'),source('P3','https://fourth.test')]).queue[0].web_broadcast_review.observations[0];
  assert.equal(slot.declared_guide_reference_count,2);
  assert.deepEqual(slot.declared_guide_reference_groups[0].publishers,['P1','P2']);
  assert.equal(slot.declared_guide_reference_groups[0].references.length,3);
});

test('official evidence permits an exact-event review including demonstrably linked pieces, without automatic certification',()=>{
  const row=plan(context(),[source('Arte','https://www.arte.tv/fr/guide',{source_role:'official'})]).queue[0];
  const review=row.web_broadcast_review,slot=review.observations[0];
  assert(slot.route_candidates.includes('exact_official_event_review'));assert.equal(slot.declared_guide_reference_count,0);
  assert.equal(review.accepted_routes[0].pieces,'one_exact_event_or_demonstrably_linked_official_pieces');
  assert.equal(review.official_corrections,'take_precedence_and_record_actual_correction');
  assert.equal(slot.automatically_verified,false);assert.equal(row.canonical_candidates[0].identity_status,'saved_catalogue_lead_needs_confirmation');
});

test('undated URLs, multiple domains and an undeclared publisher cannot establish concordance',()=>{
  for(const rows of [[source('P1','https://first.test',{checked_at:null}),source('P2','https://second.test',{checked_at:null})],
    [source(null,'https://first.test'),source(null,'https://second.test')],
    [source('Same publisher','https://first.test'),source('Same publisher','https://second.test')]]){
    const slot=plan(context(),rows).queue[0].web_broadcast_review.observations[0];
    assert(!slot.route_candidates.includes('reviewed_concordant_guides'));assert.equal(slot.automatically_verified,false);
  }
});

test('real title and version conflicts stay open under the new concordance policy',()=>{
  const result=plan(context(),[source('P1','https://first.test',{version:'short cut'}),source('P2','https://second.test',{version:'long cut'}),
    source('P3','https://third.test',{title:'Different title'})]),row=result.queue[0];
  assert.equal(row.classification,'conflicted');assert(row.conflicting_requirements.includes('resolve_scoped_event_title_conflict'));
  assert(row.conflicting_requirements.includes('resolve_duplicate_slot_version_or_identity_conflict'));
  assert.equal(row.observations.length,2);assert.equal(result.publication_ready,false);
});

test('coverage requires real dated comparisons over all days, channels and nights without fabricating independence',()=>{
  const ctx=context(),before=structuredClone(ctx),result=plan(ctx,[source('P1','https://first.test')]),coverage=result.queue[0].web_broadcast_review.coverage_review;
  assert.equal(coverage.scope,'all_days_required_channels_and_overnights');assert.equal(coverage.compare,'inventory_against_actual_dated_grid');
  assert.equal(coverage.other_guide,'use_when_accessible');assert.equal(coverage.independent_flag,'false_when_provenance_unknown');
  assert.equal(coverage.full_week_completed,'only_after_actual_editorial_review');
  assert.deepEqual(ctx,before);assert.equal(result.web_schedule_evidence.source_independence_inferred,false);
});

test('optional PDF keeps authority while alternative uncovered Web slots receive the new conditional route',()=>{
  const ctx=context({editorial_config:{web_schedule_evidence:policy,schedule_authority:{provided_telerama_pdf:'authoritative',
    fields:['title','channel','date','start'],scope:'printed_entries_for_target_week',later_official_corrections:'review_and_record',uncovered_scope:'existing_web_checks'}}});
  ctx.prepared_telerama_report={schema_version:1,kind:'telerama_pdf',week:WEEK,range:{from:FROM,to:'2026-10-16'},
    source:{sha256:PDF,filename:'Magazine.pdf',bytes:1000,pages:152},pages:[{pdf_page:99,width:592,height:771}],
    observations:[{title:'Un film',date:FROM,start:'21:00',channel:'Arte',source:'Provided Télérama',source_type:'telerama_pdf',
      source_ref:'sha256:'+PDF,source_url:null,checked_at:null,source_independence:null,pdf_page:99,bbox:[10,40,200,80]}],
    publication_ready:false,coverage_certified:false};
  const row=plan(ctx,[source('P1','https://first.test',{start:'21:01'})]).queue[0];
  assert(row.dynamic_requirements.includes('review_telerama_grid_transcription_and_record_source'));
  assert(!row.dynamic_requirements.includes('review_current_web_broadcast_evidence'));
  const uncovered=row.schedule_authority.observation_requirements.find(item=>item.start==='21:01');
  assert.deepEqual(uncovered.required_actions,['review_current_web_broadcast_evidence']);
  assert.equal(row.web_broadcast_review.observations.length,1);assert.equal(row.web_broadcast_review.observations[0].start,'21:01');
  assert.equal(row.web_broadcast_review.observations[0].requirement_condition,'if_this_uncovered_observation_is_used_or_scoped_omission_review');
  assert.equal(row.schedule_authority.source_preference,'provided_telerama_pdf');
  const webOnly=plan(ctx,[source('P1','https://first.test')],{useTelerama:false});
  assert.equal(webOnly.schedule_authority,undefined);assert(webOnly.queue[0].dynamic_requirements.includes('review_current_web_broadcast_evidence'));
});
