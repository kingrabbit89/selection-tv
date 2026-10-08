import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {validationContext, checkoutBase} from './validation-context.mjs';
import {allowedPaths, digest} from './editorial-handoff.mjs';

const week='2026-S42', branch='auto/'+week, today='2026-10-08';
const manifest=JSON.stringify({latest:'2026-S41',weeks:[{week:'2026-S41',status:'published'}]});
test('PR checkout uses its actual base parent, not a stale event base',()=>{
  const old='a'.repeat(40),current='b'.repeat(40),head='c'.repeat(40);
  const git=()=>`${'d'.repeat(40)} ${current} ${head}\n`;
  assert.equal(checkoutBase(old,'refs/pull/33/merge',head,git),current);
  assert.equal(checkoutBase(old,'refs/heads/main',head,git),old);
  assert.throws(()=>checkoutBase(old,'refs/pull/33/merge',old,git),/candidate head/);
  assert.throws(()=>checkoutBase(old,'refs/pull/33/merge',head,()=>`${head} ${old}`),/two parents/);
});
function fixture() {
  const progress={schema_version:1,week,stage:'inventory',remaining:['Vérifier les sources.']};
  const inventory={week,days:[{date:'2026-10-10',items:[{title:'Film',channel:'Arte',start:'00:30',source_url:'https://www.arte.tv/fr/guide/20261010/'}],channel_counts:{Arte:1}}]};
  const files={'data/manifest.json':manifest,[`data/research/${week}.json`]:JSON.stringify(progress),[`data/inventory/${week}.json`]:JSON.stringify(inventory)};
  const base=p=>p==='data/manifest.json'?manifest:null;
  const resolve=()=>validationContext(branch,p=>files[p]??null,base,Object.keys(files).filter(p=>p!=='data/manifest.json'),today);
  return {files,progress,inventory,resolve,save(){files[`data/research/${week}.json`]=JSON.stringify(progress);files[`data/inventory/${week}.json`]=JSON.stringify(inventory);}};
}
test('partial preparation tests published issue without declaring candidate complete',()=>{
  const f=fixture();assert.deepEqual(f.resolve(),{mode:'preparation',week,stage:'inventory',remaining:f.progress.remaining});
  f.progress.stage='enrichment';f.save();assert.equal(f.resolve().mode,'preparation');
});
test('missing checkpoint keeps full candidate validation',()=>{
  assert.deepEqual(validationContext(branch,()=>null,()=>null,[],today),{mode:'candidate',week});
  assert.deepEqual(validationContext('fix/example',()=>null,()=>null,[],today),{mode:'published'});
});
test('preparation cannot conceal code changes, deletion or a publication transition',()=>{
  const f=fixture();
  assert.throws(()=>validationContext(branch,p=>f.files[p]??null,()=>null,['scripts/weekly-publisher.mjs'],today),/code/);
  const inv=`data/inventory/${week}.json`;delete f.files[inv];assert.throws(()=>validationContext(branch,p=>f.files[p]??null,()=>null,[inv],today),/delete/);
  f.files[inv]=JSON.stringify(f.inventory);
  f.files['data/manifest.json']=JSON.stringify({latest:week,weeks:[]});
  assert.throws(()=>validationContext(branch,p=>f.files[p]??null,p=>p==='data/manifest.json'?manifest:null,Object.keys(f.files),today),/latest/);
});
test('wrong week/date, stale cycle, false review and incorrect counts fail preparation',()=>{
  for(const mutate of [f=>f.progress.week='2026-S43',f=>f.progress.remaining=[],f=>f.progress.editorial_review_completed=true,f=>f.progress.editorial_review={completed:true},f=>f.progress.stage='unknown',f=>f.inventory.days[0].date='2026-10-17',f=>f.inventory.days[0].channel_counts.Arte=2,f=>f.inventory.days[0].items[0].start='24:30']){
    const f=fixture();mutate(f);f.save();assert.throws(f.resolve);
  }
  const f=fixture();assert.throws(()=>validationContext(branch,p=>f.files[p]??null,()=>null,[], '2026-10-15'),/current cycle/);
});
test('ready requires all exact reviewed deliverables; incomplete or stale review fails',()=>{
  const f=fixture();f.progress.stage='ready';f.progress.remaining=[];f.save();assert.throws(f.resolve);
  f.progress.editorial_review_completed=true;
  for(const p of allowedPaths(week))if(!p.includes('/research/'))f.files[p]='content';
  f.progress.reviewed_files=Object.fromEntries([...allowedPaths(week)].filter(p=>!p.includes('/research/')).map(p=>[p,digest(f.files[p])]));
  f.files[`data/research/${week}.json`]=JSON.stringify(f.progress);
  assert.equal(f.resolve().mode,'candidate');
  f.files[`data/weeks/${week}.json`]='changed';assert.throws(f.resolve,/stale/);
});
test('required merge check rejects preparation, independently of browser success',()=>{
  const script=path.resolve('scripts/validation-context.mjs');
  const bad=spawnSync(process.execPath,[script,'--require-ready'],{encoding:'utf8',env:{...process.env,SELECTION_TV_PREPARATION_WEEK:week}});
  assert.notEqual(bad.status,0);assert.match(bad.stderr,/Publication blocked/);
  const env={...process.env};delete env.SELECTION_TV_PREPARATION_WEEK;
  const good=spawnSync(process.execPath,[script,'--require-ready'],{encoding:'utf8',env});assert.equal(good.status,0);
});
test('CLI writes preparation context without candidate preview and leaves files unchanged',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tv-context-'));
  try {
    const f=fixture();
    execFileSync('git',['init','-q'],{cwd:dir});
    const write=p=>{fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),f.files[p]);};
    write('data/manifest.json');execFileSync('git',['add','.'],{cwd:dir});
    execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','base'],{cwd:dir});
    const base=execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
    for(const p of Object.keys(f.files))write(p);
    execFileSync('git',['add','.'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','checkpoint'],{cwd:dir});
    const envFile=path.join(dir,'env');
    const env={...process.env,GITHUB_HEAD_REF:branch,BASE_SHA:base,SELECTION_TV_TODAY:today,GITHUB_ENV:envFile};delete env.GITHUB_STEP_SUMMARY;delete env.GITHUB_REF;delete env.CANDIDATE_HEAD_SHA;
    execFileSync(process.execPath,[path.resolve('scripts/validation-context.mjs')],{cwd:dir,env});
    assert.equal(fs.readFileSync(envFile,'utf8'),`SELECTION_TV_PREPARATION_WEEK=${week}\n`);
    assert.equal(fs.readFileSync(path.join(dir,'data/manifest.json'),'utf8'),manifest);
    const candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
    execFileSync('git',['checkout','-qb','advanced-main',base],{cwd:dir});
    fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
    fs.writeFileSync(path.join(dir,'scripts/new-main-policy.mjs'),'// Main changed after PR opened.\n');
    execFileSync('git',['add','.'],{cwd:dir});
    execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','advance main'],{cwd:dir});
    execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.com','merge','--no-ff',candidate,'-m','synthetic PR merge'],{cwd:dir});
    fs.writeFileSync(envFile,'');
    execFileSync(process.execPath,[path.resolve('scripts/validation-context.mjs')],{cwd:dir,env:{...env,GITHUB_REF:'refs/pull/33/merge',CANDIDATE_HEAD_SHA:candidate}});
    assert.equal(fs.readFileSync(envFile,'utf8'),`SELECTION_TV_PREPARATION_WEEK=${week}\n`);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
