import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {preflightCommitFiles} from './github-weekly-api.mjs';

export const digest = text => text === null ? null : createHash('sha256').update(text).digest('hex');
export const MAX_CHECKPOINT_OUTPUT_BYTES = 32 * 1024 * 1024;
export function allowedPaths(week) {
  assert.match(week, /^\d{4}-S\d{2}$/);
  return new Set(['data/works.json','data/links.json','data/releases.json','data/manifest.json',
    ...['inventory','coverage','weeks','radar-reserves','research'].map(p=>`data/${p}/${week}.json`),
    `semaines/${week}/index.html`]);
}
export function validateBundle(bundle) {
  assert.equal(bundle.schema_version,1);
  assert.match(bundle.week,/^\d{4}-S\d{2}$/);
  assert.match(bundle.base_sha,/^[a-f0-9]{40}$/);
  assert(['inventory','enrichment','ready'].includes(bundle.stage),'invalid stage');
  assert(Array.isArray(bundle.remaining),'remaining must describe unfinished work');
  assert(bundle.remaining.every(x=>typeof x==='string'&&x.trim()),'invalid remaining item');
  if(bundle.stage==='ready')assert.equal(bundle.remaining.length,0,'ready cannot have unfinished work');
  assert(Array.isArray(bundle.files)&&bundle.files.length>0&&bundle.files.length<=10,'invalid file count');
  const seen=new Set(), allowed=allowedPaths(bundle.week);
  for(const file of bundle.files){
    assert(allowed.has(file.path),'path not allowed: '+file.path);
    assert(!seen.has(file.path),'duplicate path');seen.add(file.path);
    assert(file.base_sha256===null||/^[a-f0-9]{64}$/.test(file.base_sha256),'invalid base digest');
    assert(typeof file.content==='string'&&Buffer.byteLength(file.content)<12*1024*1024,'invalid/oversize content');
  }
  preflightCommitFiles(bundle.files);
  return bundle;
}
export function planImport(bundle,read){
  validateBundle(bundle);
  const changes=[];
  for(const file of bundle.files){
    const existing=read(file.path);
    if(existing===file.content)continue; // Exact re-import is idempotent.
    assert.equal(digest(existing),file.base_sha256,'stale file, reconcile before importing: '+file.path);
    changes.push(file);
  }
  const manifestPath='data/manifest.json';
  const before=JSON.parse(read(manifestPath));
  const after=JSON.parse(bundle.files.find(f=>f.path===manifestPath)?.content||read(manifestPath));
  assert.equal(after.latest,before.latest,'handoff cannot advance latest');
  const previous=before.weeks.find(w=>w.week===bundle.week);
  assert(previous?.status!=='published','cannot import into a published week');
  // Preserve every other issue and every manifest field except target entry and updated.
  const withoutTarget=m=>{const copy=structuredClone(m);delete copy.updated;copy.weeks=copy.weeks.filter(w=>w.week!==bundle.week);return copy;};
  assert.deepEqual(withoutTarget(after),withoutTarget(before),'handoff changed another issue or manifest configuration');
  const entry=after.weeks.find(w=>w.week===bundle.week);
  if(entry)assert.equal(entry.status,'draft');
  const weekFile=bundle.files.find(f=>f.path===`data/weeks/${bundle.week}.json`);
  if(weekFile){const week=JSON.parse(weekFile.content);assert.equal(week.week,bundle.week);assert.equal(week.publication_status,'draft');}
  return changes;
}
function gitRead(ref,p){
  const options={encoding:'utf8',maxBuffer:MAX_CHECKPOINT_OUTPUT_BYTES,stdio:['ignore','pipe','pipe']};
  // Only an absent path is optional. Invalid refs, corrupt objects and a
  // bounded-buffer failure must not become a false base_sha256:null.
  if(!execFileSync('git',['ls-tree','-z',ref,'--',p],options).length)return null;
  return execFileSync('git',['show',`${ref}:${p}`],options);
}
function main(){
  const [command,...args]=process.argv.slice(2);
  if(command==='export'){
    const [week,base,out,stage='inventory']=args;
    assert(out,'Usage: export WEEK BASE_SHA OUTPUT [inventory|enrichment|ready]');
    assert.match(base,/^[a-f0-9]{40}$/);
    const files=[...allowedPaths(week)].filter(p=>fs.existsSync(p)).map(p=>{
      const content=fs.readFileSync(p,'utf8');
      return {path:p,base_sha256:digest(gitRead(base,p)),content,content_sha256:digest(content),content_bytes:Buffer.byteLength(content,'utf8')};
    }).filter(f=>digest(f.content)!==f.base_sha256);
    const progress=fs.existsSync(`data/research/${week}.json`)?JSON.parse(fs.readFileSync(`data/research/${week}.json`)):{};
    const bundle={schema_version:1,week,base_sha:base,stage,remaining:progress.remaining||['Reprendre la recherche et vérifier les critères éditoriaux.'],files};
    validateBundle(bundle);fs.writeFileSync(out,JSON.stringify(bundle,null,2)+'\n');console.log(out);
  }else if(command==='apply'||command==='check'){
    const raw=fs.readFileSync(args[0],'utf8'),bundle=JSON.parse(raw);
    const changes=planImport(bundle,p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):null);
    if(command==='apply')for(const f of changes){fs.mkdirSync(path.dirname(f.path),{recursive:true});fs.writeFileSync(f.path,f.content);}
    console.log(`${changes.length} file(s) ${command==='apply'?'imported':'validated'}; publication unchanged.`);
    if(command==='check')console.log(JSON.stringify({bundle_bytes:Buffer.byteLength(raw,'utf8'),bundle_sha256:digest(raw),
      files:preflightCommitFiles(bundle.files).fingerprints}));
  }else throw Error('Usage: editorial-handoff.mjs export|check|apply ...');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
