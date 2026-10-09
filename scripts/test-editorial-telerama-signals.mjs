import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateTeleramaEditorial,joinTeleramaEditorial} from './editorial-telerama-signals.mjs';
import {buildProductionPlan} from './editorial-production-plan.mjs';
import {prepareProductionFlow,parseCli} from './editorial-production-flow.mjs';
const week='2026-S42',from='2026-10-10',sha='a'.repeat(40),pdf='b'.repeat(64);
const row=(extra={})=>({id:'review-1',title:'A film',date:from,grid_date:from,start:'21:00',channel:'Arte',programme_kind:'Film',
  in_daily_review_pages:true,native_rating:{glyph_code:'u',label:'Très bien',t_count:3},author:'A critic',review_summary:'A strong atmosphere with some reservations.',
  summary_reviewed:true,summary_reviewed_at:'2026-10-09T16:00:00Z',summary_basis:'Paraphrase after reading the supplied PDF.',
  pdf_page:99,printed_page:99,bbox:[10,40,200,80],requires_title_review:true,source_ref:'sha256:'+pdf,source_url:null,checked_at:null,...extra});
const report=(extra={})=>({schema_version:1,kind:'telerama_editorial',week,range:{from,to:'2026-10-16'},
  source:{filename:'Magazine.pdf',sha256:pdf,bytes:1000,pages:152,publication_date:'2026-10-07'},
  reviews:[row()],pages:[{pdf_page:99,width:592,height:771}],publication_ready:false,coverage_certified:false,...extra});
const context=()=>({week,sha,from,research:{remaining:['Research'],shortlist:{entries:[]}},
  inventory:{days:[{date:from,items:[{title:'A film',start:'21:00',channel:'Arte'}]}]},works:{works:[]},links:{links:{}},
  manifest:{weeks:[{week,from}]},currentissue:{pages:[]},historicalissues:[]});

test('native publisher opinion joins exact title and civil slot without changing facts, queue order or choice',()=>{
  const ctx=context(),original=buildProductionPlan(ctx,{limit:40}),before=structuredClone(ctx);
  const plan=buildProductionPlan({...ctx,prepared_telerama_editorial:report()},{limit:40});
  assert.deepEqual(ctx,before);assert.equal(plan.queue[0].id,original.queue[0].id);
  const signal=plan.queue[0].editorial_signals[0];assert.equal(signal.native_rating.t_count,3);
  assert.equal(signal.publisher,'Télérama');assert.equal(signal.source_publication_date,'2026-10-07');
  assert.equal(signal.checked_at,null);assert.equal(signal.source_independence,null);assert.equal(signal.identity_verified,false);
  assert.equal(signal.selection_decision,false);assert.equal(signal.provenance.source_sha,sha);
  assert.equal(signal.provenance.path,'data/editorial-inputs/'+week+'/telerama-editorial.json');
  assert.equal(signal.provenance.json_pointer,'/reviews/0');assert.equal(plan.automatic_selection,false);
  assert.deepEqual(plan.queue[0].observations,original.queue[0].observations);
  assert.deepEqual(plan.queue[0].cached_metadata,original.queue[0].cached_metadata);
});

test('another title, day or channel remains unmatched rather than inheriting a review',()=>{
  for(const changed of [{title:'A remake'},{date:'2026-10-11',grid_date:'2026-10-11'},{channel:'France 3'},{start:'22:00'}]){
    const plan=buildProductionPlan({...context(),prepared_telerama_editorial:report({reviews:[row(changed)]})});
    assert.equal(plan.editorial_review_summary.unmatched_reviews,1);assert(!plan.queue[0].editorial_signals);
    assert.equal(plan.editorial_review_candidates[0].match_basis,'unmatched_review_to_reconcile');
  }
});

test('low marks remain visible, missing summaries remain missing and disabling all paper restores the baseline',()=>{
  const ctx=context(),original=buildProductionPlan(ctx);
  const paper=report({reviews:[row({native_rating:{glyph_code:'t',label:'Bof',t_count:1},review_summary:null,summary_reviewed:false})]});
  ctx.prepared_telerama_editorial=paper;
  const plan=buildProductionPlan(ctx);assert.equal(plan.editorial_review_candidates[0].native_rating.label,'Bof');
  assert.equal(plan.editorial_review_summary.reviewed_summaries,0);
  assert.deepEqual(buildProductionPlan(ctx,{useTelerama:false,editorialReports:[{report:paper}]}),original);
});

test('duplicate inputs join once while another extraction of the same PDF requires review',()=>{
  const ctx={...context(),prepared_telerama_editorial:report()};
  const plan=buildProductionPlan(ctx,{editorialReports:[{report:report(),provenance:{source_sha:null,path:'/tmp/report.json'}}]});
  assert.equal(plan.editorial_review_candidates.length,1);assert.equal(plan.queue[0].editorial_signals.length,1);
  assert.equal(plan.editorial_review_candidates[0].provenance.source_sha,sha);
  assert.throws(()=>buildProductionPlan(ctx,{editorialReports:[{report:report({reviews:[row({author:'Another critic'})]})}]}),/different editorial extraction/);
});

test('cross-week reviews, invented scores/URLs/capture dates, unreviewed paraphrases and article bodies are refused',()=>{
  for(const changed of [{week:'2026-S43'},{publication_ready:true},{coverage_certified:true},{article_body:'Full article'},
    {reviews:[row({native_rating:{glyph_code:'u',label:'Très bien',t_count:9}})]},{reviews:[row({imdb:8})]},
    {reviews:[row({source_url:'https://made-up.test'})]},{reviews:[row({checked_at:'2026-10-09'})]},
    {reviews:[row({summary_reviewed:false})]},{reviews:[row({review_summary:'x'.repeat(701)})]},
    {reviews:[row({review_text:'Full article'})]},{reviews:[row({date:'2026-10-17'})]},{reviews:[row({grid_date:'2026-10-11'})]},
    {reviews:[row({source_ref:'sha256:'+'c'.repeat(64)})]},{reviews:[row({bbox:[10,40,999,80]})]}])
    assert.throws(()=>validateTeleramaEditorial(report(changed),week,from));
});

test('explicit reviewed editorial input flows to the saved batch with local provenance and no candidate writes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telerama-signals-')),ctx=context(),before=structuredClone(ctx);
  try{
    const result=await prepareProductionFlow({week,ref:sha,outDir:path.join(dir,'batch'),teleramaEditorial:report()},{readContext:()=>ctx});
    assert.deepEqual(ctx,before);assert.equal(result.summary.editorial_review.reviewed_summaries,1);
    assert(fs.existsSync(path.join(dir,'batch','telerama-editorial.json')));
    assert.equal(result.plan.queue[0].editorial_signals[0].provenance.source_sha,null);
    assert(!fs.existsSync(path.join(dir,'batch','telerama-handoff.json')));
    assert.throws(()=>parseCli([week,'--ref',sha,'--out-dir',path.join(dir,'x'),'--telerama-editorial']),/missing value/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
