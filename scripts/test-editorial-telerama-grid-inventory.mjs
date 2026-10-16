import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGridInventoryHandoff,printedScope,parseCli} from './editorial-telerama-grid-inventory.mjs';
import {GRID_AUTHORITY_MODE,gridAuthority,itemEvidenceError,sourceDiversityError,coverageAuthorityErrors,inventoryReviewIndex} from './inventory-evidence.mjs';
import {digest,planImport} from './editorial-handoff.mjs';

const sha='e'.repeat(64),ref='sha256:'+sha;
const dates=['2026-10-24','2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
const row=(date,start,channel,title,page,extra={})=>({date,start,channel,channel_printed:channel,title,genre_hint:null,source:'Télérama magazine fourni',
  source_type:'telerama_pdf',source_ref:ref,source_url:null,pdf_page:page,printed_page:page,bbox:[10,20,90,27],grid_date:date,
  overnight:start<'06:00',checked_at:null,source_independence:null,requires_broadcast_confirmation:true,requires_title_review:true,...extra});
function report(extra=[]) {
  const observations=dates.flatMap((date,d)=>[
    row(date,'02:10','TF1',`Nuit TF1 ${d}`,d+1),row(date,'06:30','TF1',`Matin TF1 ${d}`,d+1),row(date,'21:10','TF1',`Soir TF1 ${d}`,d+1),
    row(date,'03:00','Arte',`Nuit Arte ${d}`,d+1),row(date,'07:00','Arte',`Matin Arte ${d}`,d+1),row(date,'20:55','Arte',`Film Arte ${d}`,d+1),
    row(date,'14:00','TMC',`Après-midi TMC ${d}`,d+8),row(date,'21:05','TMC',`Soir TMC ${d}`,d+8),
    row(date,'20:50','Ciné+ Festival',`Film Festival ${d}`,d+1),row(date,'22:30','Ciné+ Festival',`Second film ${d}`,d+1)]);
  return {schema_version:1,kind:'telerama_pdf',week:'2026-S44',range:{from:'2026-10-24',to:'2026-10-30'},
    source:{filename:'telerama.pdf',sha256:sha,bytes:1000,pages:20,publication_date:'2026-10-21'},
    pages:Array.from({length:20},(_,i)=>({pdf_page:i+1,width:592,height:771,status:'grid'})),observations:[...observations,...extra],
    coverage_certified:false,publication_ready:false,scope:'all-programmes',
    warnings:['The first Saturday\'s preceding-night programmes are not supplied by this issue.'],
    parser:{layout:'telerama_six_column_graphik_v1'},summary:{grid_pages:14}};
}
const context=(extra={})=>({week:'2026-S44',sha:'a'.repeat(40),editorial_config:{quality_gates:{telerama_grid_authority_from_week:'2026-S44'}},
  prepared_telerama_report:{week:'2026-S44',source:{sha256:sha}},inventory:null,coverage:null,
  research:{stage:'inventory',remaining:['Sélectionner les choix du jour']},...extra});
const options={generated_at:'2026-10-21T09:00:00Z',base_inventory_content:null,base_coverage_content:null};

test('the printed grid becomes a grid-authority inventory whose rows cite the PDF page and position',()=>{
  const extra=[row('2026-10-24','21:10','TF1','Soir TF1 0',1,{bbox:[11,21,91,28]}),row('2026-10-24','20:55','Arte','Autre titre',1),
    row('2026-10-31','03:00','Arte','Nuit après la semaine',7)];
  const result=buildGridInventoryHandoff(context(),report(extra),options);
  const {inventory,coverage}=result;
  assert.equal(inventory.mode,GRID_AUTHORITY_MODE);
  assert.deepEqual(inventory.days.map(day=>day.date),dates);
  const first=inventory.days[0];
  assert.equal(first.items.length,11,'one exact duplicate is dropped, the conflicting title kept');
  assert.deepEqual(result.report.duplicate_rows.map(value=>value.title),['Soir TF1 0']);
  assert.deepEqual(result.report.slot_conflicts,[{date:'2026-10-24',channel:'Arte',start:'20:55',titles:['Film Arte 0','Autre titre']}]);
  assert.equal(result.report.outside_week,1);
  assert.deepEqual(first.channel_counts,{Arte:4,'Ciné+ Festival':2,TF1:3,TMC:2});
  assert.deepEqual(first.channel_sources.TMC,[ref+'#page=8']);
  assert.deepEqual(first.source_pages,[ref+'#page=1',ref+'#page=8']);
  assert.equal(first.items[0].start,'02:10');
  assert.equal(first.items[0].source_url,undefined,'no Web URL is invented');
  const authority=gridAuthority({week:'2026-S44',inventory,config:context().editorial_config,teleramaInput:context().prepared_telerama_report}).authority;
  for(const day of inventory.days){
    assert.equal(sourceDiversityError(day.source_pages,authority),null);
    for(const item of day.items)assert.equal(itemEvidenceError(item,authority),null);
  }
  assert.equal(coverage.full_week_reaudit_completed,false);
  assert.equal(coverage.grid_inventory.transcription_review,null);
  assert.equal(coverage.grid_inventory.grid_pages,14);
  assert.deepEqual(coverage.days[0].channels_scanned,['Arte','Ciné+ Festival','TF1','TMC']);
  assert.match(coverageAuthorityErrors(coverage,authority,{dates})[0],/transcription_review missing/);
  assert.equal(result.report.publication_ready,false);
  assert.deepEqual(result.bundle.remaining,['Sélectionner les choix du jour']);
  assert.deepEqual(result.bundle.files.map(file=>file.path),['data/inventory/2026-S44.json','data/coverage/2026-S44.json']);
});

test('the printed scope is measured per channel and stated as limits, never as complete coverage',()=>{
  const {coverage}=buildGridInventoryHandoff(context(),report(),options);
  const scope=coverage.grid_inventory.printed_scope;
  assert.equal(scope.TF1.kind,'day_and_night');
  assert.equal(scope.TMC.kind,'partial_day_and_evening');
  assert.equal(scope['Ciné+ Festival'].kind,'evening');
  assert.equal(scope['Ciné+ Festival'].night_days,0);
  const limits=coverage.grid_inventory.limits.join('\n');
  assert.match(limits,/Jour et nuit imprimés : Arte, TF1\./);
  assert.match(limits,/Soirée seulement imprimée : Ciné\+ Festival\./);
  assert.match(limits,/Aucune ligne 00:00–05:59 imprimée : Ciné\+ Festival, TMC\./);
  assert.match(limits,/heures non imprimées ne sont pas relevées/);
  assert.match(limits,/premier samedi/);
  assert.deepEqual(printedScope([]),{});
});

test('the review template, once actually filled, satisfies the sampled transcription gate',()=>{
  const result=buildGridInventoryHandoff(context(),report(),options);
  const template=result.report.transcription_review_template;
  assert.equal(template.reviewed_at,null,'the template is a plan, not a review');
  assert.equal(template.pages_reread.length,7);
  assert.equal(template.sampled_rows.length,35);
  const coverage=structuredClone(result.coverage);
  coverage.grid_inventory.transcription_review={...template,reviewed_at:'2026-10-21T10:00:00Z',method:'Pages relues entières contre l’extraction.',
    sampled_rows:template.sampled_rows.map(value=>({...value,decision:'matches'}))};
  const authority={source_ref:ref};
  assert.deepEqual(coverageAuthorityErrors(coverage,authority,{dates,index:inventoryReviewIndex(result.inventory,authority)}),[]);
});

test('the importer refuses a disabled week, a partial extraction, an unsaved PDF and a sealed checkpoint',()=>{
  assert.throws(()=>buildGridInventoryHandoff(context({editorial_config:{quality_gates:{}}}),report(),options),/not enabled for 2026-S44/);
  assert.throws(()=>buildGridInventoryHandoff(context(),{...report(),scope:'films-docs'},options),/all-programmes/);
  assert.throws(()=>buildGridInventoryHandoff(context({prepared_telerama_report:null}),report(),options),/editorial-inputs\/2026-S44\/telerama\.json/);
  assert.throws(()=>buildGridInventoryHandoff(context({research:{stage:'ready',remaining:[]}}),report(),options),/sealed or ready/);
  assert.throws(()=>buildGridInventoryHandoff(context(),report(),{...options,generated_at:'later'}),/import time/);
});

test('an existing Web inventory is superseded only on request, and a saved grid inventory is never rebuilt over corrections',()=>{
  const web={schema_version:1,week:'2026-S44',mode:'inventory-first — checkpoint partiel',days:[{date:'2026-10-24',items:[{title:'Web',channel:'TF1',start:'21:10',source_url:'https://tv.test/tf1'}]}]};
  const webCoverage={schema_version:1,week:'2026-S44',days:[{date:'2026-10-24',channels_scanned:['W9'],note:'kept'}],full_week_reaudit_completed:true};
  const base={...options,base_inventory_content:JSON.stringify(web,null,2)+'\n',base_coverage_content:JSON.stringify(webCoverage,null,2)+'\n'};
  assert.throws(()=>buildGridInventoryHandoff(context({inventory:web,coverage:webCoverage}),report(),base),/--replace-web-inventory/);
  const replaced=buildGridInventoryHandoff(context({inventory:web,coverage:webCoverage}),report(),{...base,replace_web_inventory:true});
  assert.equal(replaced.report.superseded_web_rows,1);
  assert.deepEqual(replaced.coverage.grid_inventory.superseded_web_inventory,{rows:1,base_sha:'a'.repeat(40)});
  assert.equal(replaced.coverage.full_week_reaudit_completed,false,'the earlier audit no longer matches the inventory');
  assert.deepEqual(replaced.coverage.days[0],{date:'2026-10-24',channels_scanned:['W9','Arte','Ciné+ Festival','TF1','TMC'],note:'kept'});
  assert.equal(replaced.bundle.files[0].base_sha256,digest(base.base_inventory_content));
  assert.throws(()=>buildGridInventoryHandoff(context({inventory:web}),report(),{...base,base_inventory_content:'{}'}),/exact base content/);

  const saved=replaced.inventory,savedCoverage=replaced.coverage;
  const again={...options,base_inventory_content:JSON.stringify(saved,null,2)+'\n',base_coverage_content:JSON.stringify(savedCoverage,null,2)+'\n'};
  const same=buildGridInventoryHandoff(context({inventory:saved,coverage:savedCoverage}),report(),{...again,generated_at:'2026-10-22T09:00:00Z'});
  assert.equal(same.bundle.files.length,0,'the same PDF is idempotent');
  const corrected=structuredClone(saved);corrected.days[0].items[0].title='Nuit TF1 0 (titre relu)';
  assert.throws(()=>buildGridInventoryHandoff(context({inventory:corrected,coverage:savedCoverage}),report(),
    {...again,base_inventory_content:JSON.stringify(corrected,null,2)+'\n'}),/already saved; apply transcription corrections in place/);
});

test('the handoff imports through the ordinary bundle checks without touching another issue',()=>{
  const manifest={latest:'2026-S43',weeks:[{week:'2026-S43',status:'published'},{week:'2026-S44',status:'draft'}]};
  const {bundle}=buildGridInventoryHandoff(context(),report(),options);
  const read=path=>path==='data/manifest.json'?JSON.stringify(manifest):null;
  assert.equal(planImport(bundle,read).length,2);
});

test('the CLI takes either a saved all-programmes report or the PDF',()=>{
  assert.deepEqual(parseCli(['2026-S44','--ref','main','--out-dir','out','--report','grid.json']),{week:'2026-S44',ref:'main',outDir:'out',reportPath:'grid.json'});
  assert.equal(parseCli(['2026-S44','--ref','main','--out-dir','out','--telerama-pdf','t.pdf','--replace-web-inventory']).replaceWebInventory,true);
  assert.throws(()=>parseCli(['2026-S44','--ref','main','--out-dir','out']),/--report or --telerama-pdf/);
  assert.throws(()=>parseCli(['2026-S44','--ref','main','--out-dir','out','--report','a','--telerama-pdf','b']),/--report or --telerama-pdf/);
  assert.throws(()=>parseCli(['2026-S44','--out-dir','out','--report','a']),/--ref and --out-dir/);
});
