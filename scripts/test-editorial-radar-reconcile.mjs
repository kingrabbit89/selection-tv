import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {reconcileRadar,readLocalRadarContext,applyLocalRadar} from './editorial-radar-reconcile.mjs';

const week = '2026-S42';
const config = {radar_popularity:{scan_visible:2,minimum_reserve_candidates:2},radar_1080p:{page_capacity:1,target_visible:2,minimum_total_candidates:4}};
const works = {works:['a','b','c','d','e','f','g','h'].map(id => ({id,title:id.toUpperCase(),year:2000}))};
const card = (work_id,rank,extra = {}) => ({work_id,title:work_id.toUpperCase(),rank,summary:'authored '+work_id,signal:'dated exact signal',proof:{source_url:'https://example.org/'+work_id},...extra});
const html = id => `<article class="radar-card" data-work-id="${id}"><h3>${id.toUpperCase()}</h3></article>`;
const context = () => ({config:structuredClone(config),works:structuredClone(works),
  issue:{week,publication_status:'draft',pages:[{id:'radar-1',html:html('a')},{id:'radar-2',html:html('b')},{id:'radar-torrent',html:html('c')}]},
  radar:{schema_version:1,week,popular_scan:{target:2,candidates:[card('d',1),card('e',2)]},
    popular_deep:{target:2,candidates:[card('c',3),card('d',4),card('f',5),card('f',6),card('g',7)]},
    hd1:{target:1,candidates:[card('a',1),card('b',2),card('h',3)]},hd2:{target:1,candidates:[card('b',1),card('h',2),card('g',3)]}}});

test('preview prunes certain duplicates across reserve lists while preserving primaries, ranks and proof objects', () => {
  const input = context(), original = structuredClone(input), {radar,report} = reconcileRadar(input);
  assert.deepEqual(input,original,'preview must not mutate any input');
  assert.deepEqual(radar.popular_scan,original.radar.popular_scan);
  assert.deepEqual(radar.popular_deep.candidates,[original.radar.popular_deep.candidates[2],original.radar.popular_deep.candidates[4]]);
  assert.deepEqual(radar.hd1.candidates,[original.radar.hd1.candidates[0],original.radar.hd1.candidates[2]]);
  assert.deepEqual(radar.hd2.candidates,[original.radar.hd2.candidates[0],original.radar.hd2.candidates[2]]);
  assert.equal(report.removed.length,5);
  assert.equal(report.deficits.length,0);
  assert.deepEqual(report.removed.find(row => row.work_id === 'd').candidate,original.radar.popular_deep.candidates[1],'removed evidence remains in reviewable report');
  assert.equal(reconcileRadar({...input,radar}).report.changed,false,'second reconciliation is idempotent');
});

test('removing duplicates exposes real reserve deficits without manufacturing a shortage excuse', () => {
  const input = context();
  input.radar.popular_deep.candidates = [card('c',3),card('d',4),card('f',5)];
  input.radar.hd1.shortage_reason = 'Existing sourced limit; must remain verbatim.';
  const {radar,report} = reconcileRadar(input);
  assert.deepEqual(report.deficits.find(row => row.scope === 'popular_deep'),{scope:'popular_deep',actual:1,minimum:2,missing:1,requires_editorial_work:true});
  assert.equal(radar.popular_deep.shortage_reason,undefined);
  assert.equal(radar.hd1.shortage_reason,input.radar.hd1.shortage_reason);
  assert.deepEqual(input.config,config);
});

test('two films with one title remain distinct with explicit IDs; an ambiguous title-only row is retained', () => {
  const input = context();
  input.works.works.push({id:'remake-old',title:'Same title',year:1950},{id:'remake-new',title:'Same title',year:2025});
  input.radar.popular_scan.candidates = [{work_id:'remake-old',title:'Same title'}];
  input.radar.popular_deep.candidates = [{work_id:'remake-new',title:'Same title'},{title:'Same title'}];
  const {radar,report} = reconcileRadar(input);
  assert.deepEqual(radar.popular_deep,input.radar.popular_deep);
  assert(report.unresolved.some(row => row.reason === 'ambiguous_title'));
});

test('title mismatch, unknown canonical ID and conflicting year are preserved as unresolved', () => {
  const input = context();
  input.radar.popular_deep.candidates = [card('d',3,{title:'D different'}),card('unknown',4),card('e',5,{year:2025})];
  const {radar,report} = reconcileRadar(input);
  assert.deepEqual(radar.popular_deep,input.radar.popular_deep);
  for (const reason of ['canonical_title_mismatch','unknown_or_non_unique_work_id','canonical_year_mismatch']) assert(report.unresolved.some(row => row.reason === reason));
});

test('malformed canonical entries cannot make different title-only films look identical', () => {
  const input = context();
  input.works.works = [{title:'Film A'},{title:'Film B'}];
  input.radar.popular_scan.candidates = [{title:'Film A'}];
  input.radar.popular_deep.candidates = [{title:'Film B'}];
  const original = structuredClone(input);
  assert.throws(() => reconcileRadar(input), /nonempty work ID/);
  assert.deepEqual(input, original);
});

test('explicit edition disagreements retain both candidates for review', () => {
  const input = context();
  input.radar.popular_deep.candidates = [card('f',3,{version:'original-cut'}),card('f',4,{version:'directors-cut'})];
  const {radar,report} = reconcileRadar(input);
  assert.deepEqual(radar.popular_deep,input.radar.popular_deep);
  assert(report.conflicts.some(row => row.work_id === 'f' && row.reason === 'conflicting_explicit_versions'));
});

test('a named version cannot be pruned against an unversioned primary or reserve', () => {
  const input = context();
  input.radar.popular_deep.candidates = [card('c',3,{version:'directors-cut'}),card('f',4),card('f',5,{version:'restoration-2026'})];
  const {radar,report} = reconcileRadar(input);
  assert.deepEqual(radar.popular_deep,input.radar.popular_deep);
  assert.equal(report.conflicts.filter(row => row.reason === 'unverified_or_conflicting_version').length,2);
});

test('duplicate own HD reserve is removed; duplicate claimed primaries stay flagged rather than rewritten', () => {
  const input = context();
  input.radar.hd1.candidates = [card('a',1),card('a',2),card('h',3)];
  const result = reconcileRadar(input);
  assert.deepEqual(result.radar.hd1.candidates,[input.radar.hd1.candidates[0],input.radar.hd1.candidates[2]]);
  assert(result.report.removed.some(row => row.reason === 'duplicates_hd_primary_own_page'));
  input.radar.hd2.candidates = [card('a',1),card('g',2)];
  const conflict = reconcileRadar(input);
  assert.deepEqual(conflict.radar.hd2.candidates,input.radar.hd2.candidates);
  assert(conflict.report.conflicts.some(row => row.reason === 'duplicate_hd_primaries'));
});

test('HD page two HTML primaries are authoritative even when absent from persisted pool', () => {
  const input = context();
  input.radar.hd2.candidates = [card('g',2),card('f',3)];
  const {radar,report} = reconcileRadar(input);
  assert.deepEqual(radar.hd1.candidates,[input.radar.hd1.candidates[0],input.radar.hd1.candidates[2]]);
  assert(report.removed.some(row => row.work_id === 'b' && row.reason === 'duplicates_hd_primary_other_page'));
});

function local(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'radar-reconcile-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const data = context();
  const files = {
    [`data/weeks/${week}.json`]:data.issue,[`data/radar-reserves/${week}.json`]:data.radar,
    'data/works.json':data.works,'data/personalization-config.json':data.config,
    'data/manifest.json':{latest:'2026-S41',weeks:[{week:'2026-S41',status:'published'},{week,status:'draft'}]},
    [`data/research/${week}.json`]:{week,stage:'enrichment',remaining:['Review actual sources.']}};
  for (const [name,value] of Object.entries(files)) {
    const filename = path.join(root,name);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,JSON.stringify(value,null,2)+'\n');
  }
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git(['init','-b','staging']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.org','commit','-m','Fixture']);
  return {root,git,files};
}

test('explicit apply changes only local radar and requires exact input and commit hashes', t => {
  const {root,files} = local(t), before = readLocalRadarContext(root,week), result = reconcileRadar(before.values);
  assert.throws(() => applyLocalRadar(before,result,{expected_input_sha:'wrong',expected_base_sha:before.base_sha}),/input SHA/);
  assert.equal(fs.readFileSync(path.join(root,before.radar_path),'utf8'),before.files[before.radar_path]);
  assert.equal(applyLocalRadar(before,result,{expected_input_sha:before.input_sha,expected_base_sha:before.base_sha}),true);
  for (const name of Object.keys(files)) {
    if (name === before.radar_path) continue;
    assert.equal(fs.readFileSync(path.join(root,name),'utf8'),before.files[name],name+' must remain exact');
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,before.radar_path),'utf8')),result.radar);
});

test('apply rejects changed source bytes, changed HEAD, main, published and sealed inputs', t => {
  const {root,git} = local(t), original = readLocalRadarContext(root,week), result = reconcileRadar(original.values);
  const apply = (ctx = original,plan = result) => applyLocalRadar(ctx,plan,{expected_input_sha:ctx.input_sha,expected_base_sha:ctx.base_sha});
  fs.appendFileSync(path.join(root,'data/works.json'),'\n');
  assert.throws(() => apply(),/input changed/);
  fs.writeFileSync(path.join(root,'data/works.json'),original.files['data/works.json']);
  git(['-c','user.name=Test','-c','user.email=test@example.org','commit','--allow-empty','-m','Head moved']);
  assert.throws(() => apply(),/HEAD changed/);
  git(['branch','-m','main']);
  let current = readLocalRadarContext(root,week);
  assert.throws(() => apply(current,reconcileRadar(current.values)),/main\/master/);
  git(['branch','-m','staging']);
  const issueName = `data/weeks/${week}.json`;
  fs.writeFileSync(path.join(root,issueName),JSON.stringify({...original.values.issue,publication_status:'published'}));
  current = readLocalRadarContext(root,week);
  assert.throws(() => apply(current,reconcileRadar(current.values)),/only local draft/);
  fs.writeFileSync(path.join(root,issueName),original.files[issueName]);
  fs.writeFileSync(path.join(root,`data/research/${week}.json`),JSON.stringify({week,stage:'ready',editorial_review_completed:true}));
  current = readLocalRadarContext(root,week);
  assert.throws(() => apply(current,reconcileRadar(current.values)),/sealed editorial review/);
  fs.writeFileSync(path.join(root,`data/research/${week}.json`),JSON.stringify({week,stage:'enrichment',editorial_review:{completed:true}}));
  current = readLocalRadarContext(root,week);
  assert.throws(() => apply(current,reconcileRadar(current.values)),/sealed editorial review/);
});

test('CLI preview is read-only and exact saved plan can be explicitly applied', t => {
  const {root} = local(t), script = new URL('./editorial-radar-reconcile.mjs',import.meta.url).pathname;
  const before = readLocalRadarContext(root,week), plan = path.join(root,'preview.json');
  const preview = JSON.parse(execFileSync(process.execPath,[script,week,'--root',root,'--json',plan],{encoding:'utf8'}));
  assert.equal(preview.mode,'preview');assert.equal(preview.applied,false);
  assert.equal(readLocalRadarContext(root,week).input_sha,before.input_sha);
  const applied = JSON.parse(execFileSync(process.execPath,[script,week,'--root',root,'--apply-plan',plan],{encoding:'utf8'}));
  assert.equal(applied.mode,'local_apply');assert.equal(applied.applied,true);
  assert.throws(() => execFileSync(process.execPath,[script,week,'--root',root,'--apply-plan',plan],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),/preview report|input SHA/);
});
