import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceInventoryHandoff} from './editorial-source-import.mjs';
import {digest,planImport} from './editorial-handoff.mjs';

const url='https://www.francetvpro.fr/grille-xml/france-3/10-10-2026';
const observation=(title,date='2026-10-11',start='00:20')=>({title,date,start,channel:'France 3',source:'Official guide observation',source_url:url});
const fixture=()=>({week:'2026-S42',sha:'a'.repeat(40),research:{stage:'enrichment',remaining:['Recoupement indépendant et réserves']},
  inventory:{schema_version:1,week:'2026-S42',range:'saved range',note:'Saved limitations',updated_at:'2026-10-08',days:[
    {date:'2026-10-11',status:'partial',primary_scan_complete:false,custom:{review:'unchanged'},channels_scanned:['France 3'],source_pages:['https://old.test/'],
      channel_sources:{'France 3':['https://old.test/']},channel_counts:{'France 3':1},items:[{...observation('Hôtel du Nord'),date:undefined,source_url:'https://old.test/',verification_status:'version_verified',custom:'Keep saved evidence'}]}
  ]}});
const report=observations=>({schema_version:1,observations,source_results:[{id:'official',url,channel:'France 3',status:'parsed',observations,
  evidence:{fetched_at:'2026-10-08T12:00:00Z',sha256:'b'.repeat(64)}}]});
const options=context=>({from:'2026-10-10',base_inventory_content:JSON.stringify(context.inventory,null,2)+'\n',generated_at:'2026-10-09T15:00:00Z'});

test('source import deduplicates, retains title conflicts and overnight dates without replacing saved facts or certifying coverage',()=>{
  const context=fixture();context.inventory=JSON.parse(JSON.stringify(context.inventory));
  const snapshot=structuredClone(context),opts=options(context);
  const input=report([observation('Hôtel du Nord'),observation('Cinéma de minuit'),observation('Another film','2026-10-11','21:00'),
    observation('Another film','2026-10-11','21:00'),observation('Outside next night','2026-10-17','03:55')]);
  const result=buildSourceInventoryHandoff(context,input,opts);
  assert.equal(result.report.added_observations,1);assert.equal(result.report.duplicate_observations,2);
  assert.equal(result.report.excluded_observations,1);assert.equal(result.report.conflicting_events.length,1);
  assert.deepEqual(result.inventory.days[0].items[0],context.inventory.days[0].items[0]);
  assert.deepEqual(result.inventory.days[0].custom,{review:'unchanged'});
  assert.equal(result.inventory.days[0].primary_scan_complete,false);
  assert.equal(result.inventory.days[0].channel_counts['France 3'],2);
  assert.equal(result.inventory.days[0].items.some(row=>row.title==='Cinéma de minuit'),false);
  assert.equal(result.report.source_dates[0].fetched_at,'2026-10-08T12:00:00Z');
  assert.equal(result.report.publication_ready,false);assert.equal(result.report.coverage_certified,false);
  assert.deepEqual(result.bundle.remaining,context.research.remaining);
  assert.equal(result.bundle.files[0].base_sha256,digest(opts.base_inventory_content));
  assert.deepEqual(context,snapshot);
  const second=buildSourceInventoryHandoff({...context,inventory:result.inventory},input,{...opts,base_inventory_content:JSON.stringify(result.inventory,null,2)+'\n'});
  assert.equal(second.bundle.files.length,0,'replaying the same observations is idempotent');
});

test('inventory handoff keeps the exact original digest and existing import rejects a changed base',()=>{
  const context=fixture();context.inventory=JSON.parse(JSON.stringify(context.inventory));const opts=options(context);
  const result=buildSourceInventoryHandoff(context,report([observation('New film','2026-10-12','21:00')]),opts);
  const path='data/inventory/2026-S42.json';
  const manifest=JSON.stringify({latest:'2026-S41',weeks:[{week:'2026-S42',status:'draft'}]});
  const readBase=name=>name===path?opts.base_inventory_content:name==='data/manifest.json'?manifest:null;
  assert.equal(planImport(result.bundle,readBase).length,1);
  assert.throws(()=>planImport(result.bundle,name=>name===path?'{}\n':readBase(name)),/stale file/i);
  assert.throws(()=>buildSourceInventoryHandoff(context,report([]),{...opts,base_inventory_content:'{}'}),/match exact base/);
});

test('unparsed or mislabeled observations never enter the handoff and initial inventory leaves review requirements open',()=>{
  const context={week:'2026-S42',sha:'a'.repeat(40),inventory:null,research:{stage:'inventory',remaining:['Collecter les sept jours','Sélectionner et vérifier les cartes']}};
  const opts={from:'2026-10-10',base_inventory_content:null,generated_at:'2026-10-09T15:00:00Z'};
  const item=observation('New work','2026-10-10','20:50');
  const result=buildSourceInventoryHandoff(context,report([item]),opts);
  assert.equal(result.bundle.files[0].base_sha256,null);
  assert.equal(result.inventory.days[0].status,'partial');
  assert.equal(result.inventory.full_week_reaudit_completed,undefined);
  assert.deepEqual(result.bundle.remaining,context.research.remaining);
  const failed=report([item]);failed.source_results[0].status='unparsed';
  assert.throws(()=>buildSourceInventoryHandoff(context,failed,opts),/parsed source result/);
  const stale=report([item]);stale.source_results[0].status='stale';
  const skipped=buildSourceInventoryHandoff(context,stale,opts);
  assert.equal(skipped.bundle.files.length,0);
  assert.equal(skipped.report.excluded[0].reason,'stale_source_after_failed_refresh');
  assert.throws(()=>buildSourceInventoryHandoff(context,report([{...item,channel:'France 2'}]),opts),/parsed source result/);
});
