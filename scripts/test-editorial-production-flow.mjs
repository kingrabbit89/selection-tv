import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {issueStart, officialSourcePlan, prepareProductionFlow, parseCli} from './editorial-production-flow.mjs';

function fixture() {
  return {week:'2026-S42',sha:'a'.repeat(40),
    inventory:{week:'2026-S42',days:[{date:'2026-10-10',items:[{title:'Saved film',start:'20:50',channel:'Arte',source:'Saved guide',source_url:'https://www.arte.tv/fr/guide/20261010/'}]}]},
    research:{week:'2026-S42',remaining:['Complete reserves and coverage'],verification_records:[],research_dossiers:[]},
    coverage:{week:'2026-S42',full_week_reaudit_completed:false,days:[{date:'2026-10-10',primary_scan_complete:false,independent_crosscheck_complete:false,editorial_reminder_complete:false}]},
    works:{works:[{id:'saved-film',title:'Saved film',year:2000,director:'Saved director'}]},
    links:{links:{'Saved film':{imdb:'https://www.imdb.com/title/tt0000001/'}}},
    issue:{week:'2026-S42',publication_status:'draft',pages:[],personalization:{pools:{}}},historicalIssues:[]};
}
function directory() {const parent=fs.mkdtempSync(path.join(os.tmpdir(),'selection-production-flow-'));return {parent,out:path.join(parent,'batch')};}

test('saved inventory prepares a concrete immutable batch without any new network or certification', async () => {
  const {parent,out}=directory(),context=fixture(),snapshot=structuredClone(context);
  try {
    const result=await prepareProductionFlow({week:context.week,ref:'moving',outDir:out},
      {readContext:()=>context,collect:()=>{throw new Error('saved inventory must not trigger a fetch');}});
    assert.equal(result.summary.source_mode,'saved_inventory');
    assert.equal(result.plan.source_sha,context.sha);
    assert.equal(result.plan.publication_ready,false);
    assert(result.plan.queue.some(row=>row.title==='Saved film'));
    const written=JSON.parse(fs.readFileSync(path.join(out,'work-batch.json'),'utf8'));
    assert.deepEqual(written,JSON.parse(JSON.stringify(result.plan)));
    assert.deepEqual(context,snapshot,'preparation does not edit issue/catalogue/coverage/research');
    await assert.rejects(prepareProductionFlow({week:context.week,ref:context.sha,outDir:out},{readContext:()=>context}),/must be new/);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});

test('collected observations join the same SHA batch while failed sources and original dates remain visible', async () => {
  const {parent,out}=directory(),context=fixture(),snapshot=structuredClone(context);
  context.inventory_source_content=JSON.stringify(context.inventory,null,2)+'\n';
  const report={schema_version:1,publication_ready:false,coverage_certified:false,
    observations:[{date:'2026-10-11',title:'New film',start:'00:20',channel:'France 3',source:'Official captured guide',source_url:'https://www.francetvpro.fr/grille/france-3/10-10-2026/10-10-2026'}],
    source_results:[{id:'official',status:'parsed',observations_count:1,evidence:{fetched_at:'2026-10-08T18:00:00Z'}},{id:'unavailable',status:'failed',observations_count:0}]};
  Object.assign(report.source_results[0],{url:report.observations[0].source_url,channel:'France 3',observations:report.observations});
  const expectedContext=structuredClone(context);
  try {
    const result=await prepareProductionFlow({week:context.week,ref:context.sha,outDir:out,
      sourcePlan:officialSourcePlan(context.week)},{readContext:()=>context,collect:async()=>report});
    assert(result.plan.queue.some(row=>row.title==='New film'));
    assert.equal(result.summary.source_mode,'collected_explicit_sources');
    assert.equal(result.summary.collected_observations,1);
    assert.equal(result.summary.source_results[1].status,'failed');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'source-report.json'),'utf8')),report);
    assert.equal(result.source_report.source_results[0].evidence.fetched_at,'2026-10-08T18:00:00Z');
    assert.equal(result.summary.inventory_import.added_observations,1);
    assert(fs.existsSync(path.join(out,'inventory-handoff.json')));
    assert(result.plan.source_capture.source_results.some(row=>row.status==='failed'));
    assert.deepEqual(context,expectedContext);
    assert.equal(result.plan.publication_ready,false);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});

test('cross-week sources are rejected before fetching and invalid CLI never turns into implicit collection', async () => {
  const {parent,out}=directory(),context=fixture();let fetched=false;
  try {
    await assert.rejects(prepareProductionFlow({week:context.week,ref:context.sha,outDir:out,
      sourcePlan:{week:context.week,sources:[{date:'2026-10-17'}]}},{readContext:()=>context,collect:()=>{fetched=true;}}),/page date/);
    assert.equal(fetched,false);assert.equal(fs.existsSync(out),false);
    await assert.rejects(prepareProductionFlow({week:context.week,ref:context.sha,outDir:out,
      sourcePlan:{sources:[{adapter:'arte-guide-html',date:'2026-10-03'}]}},{readContext:()=>context,collect:()=>{fetched=true;}}),/page date/);
    assert.equal(fetched,false);
    assert.equal(issueStart('2026-S42'),'2026-10-10');
    assert.throws(()=>issueStart('2026-S00'),/invalid issue week/);
    assert.throws(()=>parseCli(['2026-S42','--ref','abc']),/--ref and --out-dir/);
    assert.throws(()=>parseCli(['2026-S42','--unknown','x']),/unknown flag/);
    const official=officialSourcePlan(context.week);
    assert.equal(official.sources.length,16);
    assert.equal(official.sources[0].date,'2026-10-09','first early night needs the preceding guide');
    assert.equal(official.sources.at(-1).url,'https://www.francetvpro.fr/grille-xml/france-5/10-10-2026');
    assert.equal(official.sources[8].date,'2026-10-03','first FranceTVPro early night needs the preceding weekly XML');
    await assert.rejects(prepareProductionFlow({week:context.week,ref:context.sha,outDir:out,refresh:true},{readContext:()=>context}),/explicit collection/);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});
