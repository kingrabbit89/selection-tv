import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,MAX_CHECKPOINT_OUTPUT_BYTES} from './editorial-handoff.mjs';
import {github,readContent,MAX_GITHUB_API_OUTPUT_BYTES} from './github-weekly-api.mjs';

const week='2026-S42';
const handoff=fileURLToPath(new URL('./editorial-handoff.mjs',import.meta.url));
const inventoryPath=`data/inventory/${week}.json`;
const repo='checkpoint-fixture/editorial';

function temporary(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'editorial-large-checkpoint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function inventoryText(){
  const days=Array.from({length:7},(_,day)=>({date:`2026-10-${String(10+day).padStart(2,'0')}`,
    source_pages:[`https://guide.fixture.invalid/day/${day}`],channels_scanned:['Arte','France 5'],items:[]}));
  const source='Fixture schedule observation, saved with programme-specific source context. '.repeat(5);
  for(let i=0;i<3500;i++)days[i%7].items.push({title:`Fixture programme ${i}`,channel:i%2?'Arte':'France 5',
    start:`${String(i%24).padStart(2,'0')}:${String(i%60).padStart(2,'0')}`,
    source_url:`https://guide.fixture.invalid/programme/${i}`,source});
  const text=JSON.stringify({schema_version:1,week,mode:'inventory-first',days},null,2)+'\n';
  assert(Buffer.byteLength(text)>1_900_000,'fixture must represent a genuine large JSON inventory');
  assert(Buffer.byteLength(text)<MAX_CHECKPOINT_OUTPUT_BYTES);
  return text;
}
function write(dir,name,content){
  const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
}
function fixture(t,{inventory=true}={}){
  const dir=temporary(t);
  const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--quiet']);
  write(dir,'data/manifest.json',JSON.stringify({latest:'2026-S41',weeks:[{week:'2026-S41',status:'published'},{week,status:'draft'}]})+'\n');
  const original=inventory?inventoryText():null;
  if(original)write(dir,inventoryPath,original);
  git(['add','data']);
  git(['-c','user.name=Checkpoint fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Base checkpoint']);
  return {dir,original,base:git(['rev-parse','HEAD'])};
}
function cli(dir,args){return execFileSync(process.execPath,[handoff,...args],{cwd:dir,encoding:'utf8',maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});}

test('export and check preserve the exact base digest of an inventory above the default child buffer',t=>{
  const {dir,original,base}=fixture(t);
  const changed=original.replace('Fixture programme 0','Fixture programme 0 revised');
  write(dir,inventoryPath,changed);
  const bundlePath=path.join(dir,'handoff.json');
  cli(dir,['export',week,base,bundlePath,'inventory']);
  const bundle=JSON.parse(fs.readFileSync(bundlePath,'utf8'));
  assert.equal(bundle.files.length,1);
  assert.equal(bundle.files[0].path,inventoryPath);
  assert.equal(bundle.files[0].base_sha256,digest(original));
  assert.equal(bundle.files[0].content,changed);
  write(dir,inventoryPath,original);
  assert.match(cli(dir,['check',bundlePath]),/1 file\(s\) validated/);
  assert.equal(fs.readFileSync(path.join(dir,inventoryPath),'utf8'),original,'check must be read-only');
  cli(dir,['apply',bundlePath]);
  assert.equal(fs.readFileSync(path.join(dir,inventoryPath),'utf8'),changed);
});

test('an absent permitted base path remains optional, while an invalid base commit fails',t=>{
  const {dir,base}=fixture(t,{inventory:false});
  const content=inventoryText();write(dir,inventoryPath,content);
  const bundlePath=path.join(dir,'handoff.json');
  cli(dir,['export',week,base,bundlePath,'inventory']);
  assert.equal(JSON.parse(fs.readFileSync(bundlePath,'utf8')).files[0].base_sha256,null);
  fs.unlinkSync(path.join(dir,inventoryPath));
  assert.match(cli(dir,['check',bundlePath]),/1 file\(s\) validated/);
  write(dir,inventoryPath,content);
  const invalid=spawnSync(process.execPath,[handoff,'export',week,'f'.repeat(40),path.join(dir,'invalid.json'),'inventory'],{cwd:dir,encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  assert(!fs.existsSync(path.join(dir,'invalid.json')),'a failed Git read cannot produce an import bundle');
});

function fakeGh(t,routes){
  const dir=temporary(t),routeFile=path.join(dir,'routes.json'),callsFile=path.join(dir,'calls.jsonl');
  fs.writeFileSync(routeFile,JSON.stringify(routes));
  const shim=`#!${process.execPath}\nconst fs=require('node:fs');\nconst endpoint=process.argv[3];\nfs.appendFileSync(process.env.EDITORIAL_CHECKPOINT_CALLS,JSON.stringify(endpoint)+'\\n');\nconst route=JSON.parse(fs.readFileSync(process.env.EDITORIAL_CHECKPOINT_ROUTES,'utf8'))[endpoint];\nif(!route){process.stderr.write('Unexpected fixture endpoint');process.exit(1);}\nif(route.error){process.stderr.write(route.error);process.exit(1);}\nprocess.stdout.write(route.raw===undefined?JSON.stringify(route.value):route.raw);\n`;
  fs.writeFileSync(path.join(dir,'gh'),shim,{mode:0o755});
  const changes={PATH:dir+path.delimiter+process.env.PATH,EDITORIAL_CHECKPOINT_ROUTES:routeFile,EDITORIAL_CHECKPOINT_CALLS:callsFile};
  const previous=Object.fromEntries(Object.keys(changes).map(key=>[key,process.env[key]]));
  Object.assign(process.env,changes);
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  return {api:github(repo),calls:()=>fs.readFileSync(callsFile,'utf8').trim().split('\n').map(JSON.parse)};
}

test('gh child process reads a large base64 blob intact without auth or network',t=>{
  const content=inventoryText();
  const blob='1'.repeat(40),ref='2'.repeat(40);
  const contents=`repos/${repo}/contents/${inventoryPath}?ref=${ref}`,blobEndpoint=`repos/${repo}/git/blobs/${blob}`;
  const {api,calls}=fakeGh(t,{[contents]:{value:{encoding:'none',sha:blob}},
    [blobEndpoint]:{value:{encoding:'base64',sha:blob,size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')}}});
  assert.equal(readContent(api,ref,inventoryPath),content);
  assert.deepEqual(calls(),[contents,blobEndpoint],'the actual readContent fallback must reach the fake gh blob process');
});

test('GitHub API transport stays bounded and preserves API/JSON errors instead of treating them as absent',t=>{
  assert.equal(MAX_GITHUB_API_OUTPUT_BYTES,32*1024*1024);
  assert.equal(MAX_CHECKPOINT_OUTPUT_BYTES,32*1024*1024);
  const ref='2'.repeat(40),base=`repos/${repo}/contents/`;
  const {api}=fakeGh(t,{[base+`missing.json?ref=${ref}`]:{error:'HTTP 404: Not Found'},
    [base+`denied.json?ref=${ref}`]:{error:'HTTP 403: Resource not accessible'},
    [base+`broken.json?ref=${ref}`]:{raw:'{"encoding":'}});
  assert.equal(readContent(api,ref,'missing.json'),null);
  assert.throws(()=>readContent(api,ref,'denied.json'),/Command failed/);
  assert.throws(()=>readContent(api,ref,'broken.json'),SyntaxError);
});
