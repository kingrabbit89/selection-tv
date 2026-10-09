import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest,planImport} from './editorial-handoff.mjs';
import {buildTeleramaHandoff,validateTeleramaReport} from './editorial-telerama-import.mjs';
import {buildProductionPlan} from './editorial-production-plan.mjs';
import {prepareProductionFlow} from './editorial-production-flow.mjs';

const WEEK='2026-S42',FROM='2026-10-10',SHA='a'.repeat(40),PDF='b'.repeat(64);
const observation=(extra={})=>({title:'Known film',date:'2026-10-11',start:'21:00',channel:'Arte',
  source:'Télérama magazine fourni',source_type:'telerama_pdf',source_ref:'sha256:'+PDF,source_url:null,
  checked_at:null,source_independence:null,pdf_page:104,printed_page:104,bbox:[20,50,190,75],...extra});
const report=(extra={})=>({schema_version:1,kind:'telerama_pdf',week:WEEK,range:{from:FROM,to:'2026-10-16'},
  source:{filename:'Telerama.pdf',sha256:PDF,bytes:1000,pages:152,publication_date:'2026-10-07'},
  observations:[observation()],pages:[{pdf_page:104,width:592.44,height:771.02,status:'parsed'}],
  publication_ready:false,coverage_certified:false,...extra});
function context() {
  const research={schema_version:1,week:WEEK,stage:'enrichment',updated_at:'2026-10-09T12:00:00Z',
    remaining:['Achever les réserves','Recouper les diffusions'],remaining_items:[
      {id:'reserves',text:'Achever les réserves',scope:{kind:'global'},blocking:true,closes_when:'Réserves revues'},
      {id:'broadcast',text:'Recouper les diffusions',scope:{kind:'global'},blocking:true,closes_when:'Sources revues'}],
    run_metrics:[{prompt_revision:'historical',stop_reason:'saved'}],verification_records:[],research_dossiers:[],custom:{keep:true}};
  return {week:WEEK,sha:SHA,from:FROM,research,research_source_content:JSON.stringify(research,null,2)+'\n',
    inventory:{week:WEEK,days:[{date:'2026-10-11',items:[{title:'Known film',start:'21:00',channel:'Arte',source_url:'https://official.test/'}]}]},
    coverage:{week:WEEK,full_week_reaudit_completed:false,days:[{primary_scan_complete:false}]},
    works:{works:[{id:'known',title:'Known film',year:2000,director:'Known director'}]},links:{links:{}},
    manifest:{latest:'2026-S41',weeks:[{week:WEEK,status:'draft'}]},currentissue:{week:WEEK,publication_status:'draft',pages:[],personalization:{pools:{}}},historicalissues:[]};
}
const options=ctx=>({from:FROM,base_research_content:ctx.research_source_content,generated_at:'2026-10-09T16:00:00Z'});

test('paper supplement changes only research supplementary sources, keeps exact digest and remains idempotent',()=>{
  const ctx=context(),before=structuredClone(ctx),input=report(),result=buildTeleramaHandoff(ctx,input,options(ctx));
  assert.equal(result.added,true);assert.equal(result.bundle.files.length,1);
  const file=result.bundle.files[0],next=JSON.parse(file.content);
  assert.equal(file.path,'data/research/'+WEEK+'.json');assert.equal(file.base_sha256,digest(ctx.research_source_content));
  assert.equal(file.content_sha256,digest(file.content));assert.equal(file.content_bytes,Buffer.byteLength(file.content));
  const saved=structuredClone(next);delete saved.supplementary_sources;assert.deepEqual(saved,ctx.research);
  assert.deepEqual(next.supplementary_sources[0].report,input);assert.deepEqual(ctx,before);
  const read=p=>p===file.path?ctx.research_source_content:p==='data/manifest.json'?JSON.stringify(ctx.manifest):null;
  assert.equal(planImport(result.bundle,read).length,1);
  assert.throws(()=>planImport(result.bundle,p=>p===file.path?'{}\n':read(p)),/stale file/);
  const again=buildTeleramaHandoff({...ctx,research:next,research_source_content:file.content},report({extracted_at:'2026-10-09T17:00:00Z'}),
    {...options(ctx),base_research_content:file.content});
  assert.equal(again.added,false);assert.equal(again.bundle.files.length,0);
  const changed=report({observations:[observation({start:'21:05'})]});
  assert.throws(()=>buildTeleramaHandoff({...ctx,research:next},changed,{...options(ctx),base_research_content:file.content}),/different extraction/);
});

test('saved paper leads are read at immutable research pointers with original page references and unknown independence',()=>{
  const ctx=context(),imported=buildTeleramaHandoff(ctx,report(),options(ctx));
  ctx.research=JSON.parse(imported.bundle.files[0].content);
  const plan=buildProductionPlan(ctx,{limit:100}),row=plan.queue.find(row=>row.title==='Known film');
  assert.equal(row.observations[0].source_records.length,2);
  const paper=row.observations[0].source_records.find(source=>source.source_type==='telerama_pdf');
  assert.equal(paper.source_url,null);assert.equal(paper.checked_at,null);assert.equal(paper.source_independence,null);
  assert.equal(paper.source_ref,'sha256:'+PDF);assert.equal(paper.pdf_page,104);assert.deepEqual(paper.bbox,[20,50,190,75]);
  assert.equal(paper.provenance.source_sha,SHA);assert.equal(paper.provenance.path,'data/research/'+WEEK+'.json');
  assert.equal(paper.provenance.json_pointer,'/supplementary_sources/0/report/observations/0');
  assert.equal(paper.broadcast_freshness_verified,false);assert.equal(plan.publication_ready,false);
  assert.deepEqual(ctx.research.verification_records,[]);assert.equal(ctx.coverage.full_week_reaudit_completed,false);
});

test('optional prepared input is used without a candidate write, deduplicated after import and can be disabled',()=>{
  const ctx=context(),original=buildProductionPlan(ctx,{limit:100});ctx.prepared_telerama_report=report();
  const prepared=buildProductionPlan(ctx,{limit:100}),row=prepared.queue.find(row=>row.title==='Known film');
  const source=row.observations[0].source_records.find(source=>source.source_type==='telerama_pdf');
  assert.equal(source.provenance.source_sha,SHA);
  assert.equal(source.provenance.path,'data/editorial-inputs/'+WEEK+'/telerama.json');
  assert.equal(source.provenance.json_pointer,'/observations/0');
  assert.deepEqual(buildProductionPlan(ctx,{limit:100,useTelerama:false}),original);
  assert.deepEqual(buildProductionPlan(ctx,{limit:100,useTelerama:false,supplementaryReports:[{report:report()}]}),original);
  const explicit=buildProductionPlan(ctx,{limit:100,supplementaryReports:[{report:report()}]});
  assert.equal(explicit.supplementary_sources.length,1);
  assert.equal(explicit.queue[0].observations[0].source_records.length,2);
  assert.equal(explicit.supplementary_sources[0].provenance.path,'data/editorial-inputs/'+WEEK+'/telerama.json');
  ctx.research=JSON.parse(buildTeleramaHandoff(ctx,report(),options(ctx)).bundle.files[0].content);
  const saved=buildProductionPlan(ctx,{limit:100});assert.equal(saved.supplementary_sources.length,1);
  assert.equal(saved.queue[0].observations[0].source_records.length,2);
  assert.equal(saved.supplementary_sources[0].provenance.path,'data/research/'+WEEK+'.json');
  ctx.prepared_telerama_report=report({observations:[observation({start:'21:05'})]});
  assert.throws(()=>buildProductionPlan(ctx,{limit:100}),/different extraction/);
  ctx.prepared_telerama_report=report();
  assert.throws(()=>buildProductionPlan(ctx,{limit:100,supplementaryReports:[
    {report:report({observations:[observation({title:'Changed film'})]})}]}),/different extraction/);
});

test('optional paper titles expose scoped contradictions and preserve overnight civil dates instead of rewriting the Web inventory',()=>{
  const ctx=context(),before=structuredClone(ctx.inventory);
  const input=report({observations:[observation({title:'Different film'}),observation({date:'2026-10-12',start:'00:20',channel:'France 3',printed_date:'2026-10-11'}),
    observation({date:'2026-10-17',start:'02:00',title:'Last printed night'})]});
  const plan=buildProductionPlan(ctx,{limit:100,supplementaryReports:[{report:input,provenance:{path:'/tmp/pdf-report.json',source_sha:null,json_pointer:''}}]});
  const conflict=plan.queue.find(row=>row.scoped_event_title_conflicts.includes('Different film'));
  assert(conflict.conflicting_requirements.includes('resolve_scoped_event_title_conflict'));
  const night=plan.queue.find(row=>row.scope==='lundi');assert.equal(night.observations[0].date,'2026-10-12');
  assert.equal(night.observations[0].source_records[0].printed_date,'2026-10-11');
  assert.equal(night.observations[0].source_records[0].provenance.source_sha,null);
  assert.equal(plan.warnings.filter(row=>row.reason==='observation_outside_target_week').length,1);
  assert.deepEqual(ctx.inventory,before);
});

test('invalid paper reports and sealed preparation are refused without fake Web URLs or new verification dates',()=>{
  for(const change of [{week:'2026-S43'},{coverage_certified:true},{observations:[observation({source_url:'https://made-up.test/pdf'})]},
    {observations:[observation({source_urls:['https://made-up.test/pdf']})]},{observations:[observation({checked_at:'2026-10-09'})]},
    {observations:[observation({source_independence:true})]},{observations:[observation({pdf_page:153})]},
    {observations:[observation({editorial_intention:true})]},{observations:[observation({scope:{rubrique:'replay-1'}})]},
    {observations:[observation({bbox:[0,0,1000,200]})]},{observations:[observation({date:'2026-10-17',start:'21:00'})]}])
    assert.throws(()=>validateTeleramaReport(report(change),WEEK,FROM));
  for(const sealed of [{stage:'ready'},{editorial_review_completed:true},{editorial_review:{completed:true}}]) {
    const ctx=context();Object.assign(ctx.research,sealed);ctx.research_source_content=JSON.stringify(ctx.research);
    assert.throws(()=>buildTeleramaHandoff(ctx,report(),options(ctx)),/sealed or ready/);
  }
  const ctx=context();assert.throws(()=>buildTeleramaHandoff(ctx,report(),{...options(ctx),base_research_content:'{}'}),/exact base/);
});

test('optional PDF flow creates a research handoff and future saved-report flow requires no PDF parser or network',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'selection-telerama-')),ctx=context(),before=structuredClone(ctx);
  let extracted=0;
  try {
    const result=await prepareProductionFlow({week:WEEK,ref:SHA,outDir:path.join(parent,'first'),teleramaPdf:'/tmp/source.pdf'},
      {readContext:()=>ctx,collect:()=>{throw Error('no Web collection required');},extractPdf:async()=>{extracted++;return report();}});
    assert.equal(extracted,1);assert.equal(result.summary.telerama_import.added,true);
    assert(fs.existsSync(path.join(parent,'first','telerama-handoff.json')));
    assert(!fs.existsSync(path.join(parent,'first','inventory-handoff.json')));
    assert.deepEqual(ctx,before);
    const paper=result.plan.queue.flatMap(row=>row.observations.flatMap(row=>row.source_records)).find(row=>row.source_type==='telerama_pdf');
    assert.equal(paper.provenance.source_sha,null);assert.equal(paper.provenance.path,path.join(parent,'first','telerama-report.json'));
    const saved={...ctx,research:JSON.parse(result.telerama_import.bundle.files[0].content)};
    saved.research_source_content=result.telerama_import.bundle.files[0].content;
    const resumed=await prepareProductionFlow({week:WEEK,ref:SHA,outDir:path.join(parent,'resumed')},
      {readContext:()=>saved,extractPdf:()=>{throw Error('saved supplement must not rerun PDF extraction');}});
    assert.equal(resumed.plan.supplementary_sources.length,1);
    const replay=await prepareProductionFlow({week:WEEK,ref:SHA,outDir:path.join(parent,'replay'),teleramaReport:report()},
      {readContext:()=>saved,extractPdf:()=>{throw Error('provided report must not invoke PDF parser');}});
    assert.equal(replay.summary.telerama_import.added,false);
    assert.equal(replay.plan.queue[0].observations[0].source_records.length,2,'same PDF is joined only once');
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});
