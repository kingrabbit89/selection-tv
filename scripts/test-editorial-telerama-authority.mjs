import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionPlan} from './editorial-production-plan.mjs';

const WEEK='2026-S42',SHA='a'.repeat(40),PDF='b'.repeat(64);
const authority={provided_telerama_pdf:'authoritative',fields:['title','channel','date','start'],
  scope:'printed_entries_for_target_week',later_official_corrections:'review_and_record',uncovered_scope:'existing_web_checks'};
const observation=(extra={})=>({title:'Un film',date:'2026-10-11',start:'21:00',channel:'Arte',...extra});
const paper=(extra={})=>observation({source:'Télérama fourni',source_type:'telerama_pdf',source_ref:'sha256:'+PDF,
  source_url:null,checked_at:null,source_independence:null,pdf_page:104,bbox:[20,50,190,75],requires_title_review:false,...extra});
const report=(rows=[paper()],hash=PDF)=>({schema_version:1,kind:'telerama_pdf',week:WEEK,
  range:{from:'2026-10-10',to:'2026-10-16'},source:{sha256:hash,filename:'Telerama.pdf',bytes:1000,pages:152},
  observations:rows.map(row=>({...row,source_ref:'sha256:'+hash})),pages:[{pdf_page:104,width:592,height:771}],
  publication_ready:false,coverage_certified:false});
const work=(id='film',extra={})=>({id,title:'Un film',year:2000,director:'Une réalisatrice',...extra});
const context=(extra={})=>({week:WEEK,sha:SHA,from:'2026-10-10',
  editorial_config:{schedule_authority:authority},inventory:{week:WEEK,days:[]},coverage:{week:WEEK,full_week_reaudit_completed:false},
  research:{week:WEEK,remaining:['Revue de couverture'],verification_records:[],research_attempts:[]},
  works:{works:[work()]},links:{links:{}},currentissue:{week:WEEK,pages:[],personalization:{pools:{}}},...extra});
const plan=(ctx,rows=[],options={})=>buildProductionPlan(ctx,{limit:200,observations:rows,...options});

test('authority is opt-in and absent PDF preserves the exact existing plan',()=>{
  const plain=context({editorial_config:{}}),enabled=context();
  assert.deepEqual(plan(enabled,[observation()]),plan(plain,[observation()]));
  enabled.prepared_telerama_report=report();plain.prepared_telerama_report=report();
  assert.equal(plan(plain,[observation()]).schedule_authority,undefined);
  assert(plan(plain,[observation()]).queue[0].dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
  assert.deepEqual(plan(enabled,[observation()],{useTelerama:false}),plan(context(),[observation()]));
});

test('validated saved, prepared and explicitly supplied reports expose bounded PDF references without new facts',()=>{
  for(const location of ['saved','prepared','explicit']) {
    const ctx=context(),input=report([paper({requires_title_review:true})]);let options={};
    if(location==='saved')ctx.research.supplementary_sources=[{kind:'telerama_pdf',report:input}];
    if(location==='prepared')ctx.prepared_telerama_report=input;
    if(location==='explicit')options.supplementaryReports=[{report:input,provenance:{path:'/tmp/paper.json'}}];
    const before=structuredClone(ctx),result=plan(ctx,[observation()],options),row=result.queue[0],reference=row.schedule_authority.references[0];
    assert.deepEqual(result.schedule_authority.fields,['title','channel','date','start']);
    assert.equal(reference.sha256,PDF);assert.equal(reference.pdf_page,104);assert.deepEqual(reference.bbox,[20,50,190,75]);
    assert.equal(reference.provenance.origin,'supplementary_pdf');assert.equal(reference.transcription_review_required,true);
    assert.equal(row.schedule_authority.transcription_review_required,true);
    assert(row.dynamic_requirements.includes('review_telerama_grid_transcription_and_record_source'));
    assert(!row.dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
    assert(row.dynamic_requirements.includes('review_identity_match_and_exact_version'));
    const source=row.observations[0].source_records.find(source=>source.source_type==='telerama_pdf');
    assert.equal(source.source_url,null);assert.equal(source.checked_at,null);assert.equal(source.source_independence,null);
    assert.equal(source.broadcast_freshness_verified,false);assert.equal(result.publication_ready,false);
    assert.deepEqual(result.remaining_requirements,['Revue de couverture']);assert.deepEqual(ctx,before);
  }
});

test('a PDF/Web title disagreement uses an explicit reference preference without choosing a canonical identity',()=>{
  const ctx=context({prepared_telerama_report:report(),works:{works:[work(),work('other',{title:'Autre film'})]}});
  const row=plan(ctx,[observation({title:'Autre film',source_url:'https://guide.test/grid'})]).queue[0];
  assert.equal(row.classification,'conflicted');assert.equal(row.observations.length,2);
  assert(row.conflicting_requirements.includes('review_authoritative_pdf_grid_conflict'));
  assert(!row.conflicting_requirements.includes('resolve_scoped_event_title_conflict'));
  assert(row.conflicting_requirements.includes('resolve_same_title_identity_or_remake'));
  assert.equal(row.schedule_authority.source_preference,'provided_telerama_pdf');
  assert.equal(row.schedule_authority.discrepancies[0].automatic_identity_resolution,false);
  assert.deepEqual(row.canonical_candidates.map(item=>item.work_id).sort(),['film','other']);
});

test('different Web minutes remain observed, without establishing that two slots are the same event',()=>{
  const ctx=context({prepared_telerama_report:report()}),row=plan(ctx,[observation({start:'21:01'})]).queue[0];
  assert.deepEqual(row.observations.map(item=>item.start),['21:01','21:00']);
  assert(row.dynamic_requirements.includes('compare_printed_grid_times'));
  assert(!row.dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
  const discrepancy=row.schedule_authority.discrepancies.find(item=>item.kind==='web_time_differs_for_same_title_day_channel');
  assert.equal(discrepancy.same_event_established,false);assert.equal(discrepancy.source_preference,'provided_telerama_pdf');
  const uncovered=row.schedule_authority.observation_requirements.find(item=>item.start==='21:01');
  assert.equal(uncovered.covered_by_printed_pdf,false);
  assert.deepEqual(uncovered.required_actions,['review_current_broadcast_sources_and_independence']);
  assert.equal(uncovered.requirement_condition,'if_this_uncovered_observation_is_used');
});

test('mixed printed and uncovered broadcasts keep source checks conditional on using each alternative',()=>{
  const ctx=context({prepared_telerama_report:report()}),result=plan(ctx,[observation({start:'23:00'}),observation({date:'2026-10-12'})]);
  const mixed=result.queue.find(row=>row.scope==='dimanche'),uncovered=result.queue.find(row=>row.scope==='lundi');
  assert.equal(mixed.schedule_authority.observation_requirements.filter(item=>!item.covered_by_printed_pdf).length,1);
  assert(mixed.schedule_authority.observation_requirements.find(item=>item.start==='23:00').required_actions.includes('review_current_broadcast_sources_and_independence'));
  assert.equal(uncovered.schedule_authority,undefined);
  assert(uncovered.dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
});

test('two incompatible PDFs require human review with no arbitrary source preference',()=>{
  for(const second of [paper({title:'Autre film'}),paper({start:'21:05'})]) {
    const ctx=context(),row=plan(ctx,[],{supplementaryReports:[{report:report()},{report:report([second],'c'.repeat(64))}]}).queue[0];
    assert.equal(row.classification,'conflicted');assert.equal(row.schedule_authority.status,'conflicting_pdf_grids');
    assert.equal(row.schedule_authority.source_preference,null);
    assert(row.conflicting_requirements.includes('review_conflicting_pdf_grids'));
    assert.equal(row.schedule_authority.references.length,2);
  }
});

test('PDF authority cannot resolve remake or conflicting version identity',()=>{
  const ctx=context({prepared_telerama_report:report(),works:{works:[work('original'),work('remake',{year:2020})]}});
  const row=plan(ctx,[observation({version:'version courte'}),observation({version:'version longue'})]).queue[0];
  assert.equal(row.classification,'conflicted');
  assert(row.conflicting_requirements.includes('resolve_same_title_identity_or_remake'));
  assert(row.conflicting_requirements.includes('resolve_duplicate_slot_version_or_identity_conflict'));
  assert.equal(row.schedule_authority.automatic_identity_resolution,false);
});

test('last printed night keeps Saturday civil date under Friday scope only for the validated PDF',()=>{
  const input=report([paper({date:'2026-10-17',start:'02:00',printed_date:'2026-10-16',grid_date:'2026-10-16',overnight:true})]);
  const ctx=context({prepared_telerama_report:input}),row=plan(ctx).queue[0];
  assert.equal(row.scope,'vendredi');assert.equal(row.observations[0].date,'2026-10-17');
  assert.equal(row.schedule_authority.references[0].grid_date,'2026-10-16');
  assert.equal(row.schedule_authority.references[0].overnight,true);
  assert.equal(row.schedule_authority.references[0].retained_card_day_review_required,true);
  assert.equal(plan(context(),[observation({date:'2026-10-17',start:'02:00'})]).queue_total,0);
  assert.equal(plan(context({editorial_config:{},prepared_telerama_report:input})).queue_total,0);
});

test('wrong-week report is refused and an unvalidated inventory PDF label cannot confer authority',()=>{
  assert.throws(()=>plan(context({prepared_telerama_report:{...report(),week:'2026-S43'}})),/another week/);
  const spoof=paper(),row=plan(context(),[spoof]).queue[0];
  assert.equal(row.schedule_authority,undefined);
  assert(row.dynamic_requirements.includes('review_current_broadcast_sources_and_independence'));
});
