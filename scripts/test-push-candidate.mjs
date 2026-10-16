import test from 'node:test';
import assert from 'node:assert/strict';
import {pushCandidate,preflight,repositoryFromRemote,gitRunner} from './push-candidate.mjs';
import {allowedPaths,digest} from './editorial-handoff.mjs';
import {manageLease} from './editorial-lease.mjs';

const week='2026-S43',branch='auto/'+week,lock='locks/editorial-'+week,repoName='kingrabbit89/selection-tv';

function leaseApi(existingPR=null){
  const refs={main:'main'},commits={main:{sha:'main',tree:{sha:'tree'}}};let n=0;
  const prs=existingPR?[existingPR]:[],created=[],readied=[];
  const api=(p,method='GET',body)=>{
    if(p===`pulls?state=open&base=main&head=${encodeURIComponent('kingrabbit89:'+branch)}`)return prs;
    if(p==='pulls'&&method==='POST'){assert.equal(body.head,branch);assert.equal(body.base,'main');const pr={number:90+created.length,html_url:'https://github.com/'+repoName+'/pull/90',draft:body.draft};created.push(body);prs.push(pr);return pr;}
    if(p.startsWith('git/ref/heads/')){const key=p.slice(14);if(!refs[key]){const e=Error('missing');e.stderr='HTTP 404';throw e;}return {object:{sha:refs[key]}};}
    if(p==='git/commits'&&method==='POST'){const sha='l'+(++n);commits[sha]={...body,sha,tree:{sha:body.tree}};return {sha};}
    if(p.startsWith('git/commits/'))return commits[p.slice(12)];
    if(p==='git/refs'){const key=body.ref.slice(11);assert(!refs[key]);refs[key]=body.sha;return {};}
    if(p.startsWith('git/refs/heads/')){const key=p.slice(15);assert.equal(body.force,false);assert.equal(commits[body.sha].parents[0],refs[key]);refs[key]=body.sha;return {};}
    throw Error('Unexpected '+p);
  };
  const state=()=>refs[lock]?JSON.parse(commits[refs[lock]].message):null;
  return {api,state,created,readied,markReady:number=>readied.push(number)};
}

function repo({stage='ready',extraPath=null,extraFiles={},stale=false,remote='old',ancestor=true}={}){
  const files={};
  for(const p of allowedPaths(week))files[p]=JSON.stringify({week,path:p})+'\n';
  Object.assign(files,extraFiles);
  const reviewed=Object.fromEntries([...allowedPaths(week)].filter(p=>p!==`data/research/${week}.json`).map(p=>[p,digest(files[p])]));
  if(stale)files[`data/weeks/${week}.json`]+='changed after review\n';
  files[`data/research/${week}.json`]=JSON.stringify(stage==='ready'
    ?{schema_version:1,week,stage,remaining:[],editorial_review_completed:true,editorial_review:{completed:true},reviewed_files:reviewed}
    :{schema_version:1,week,stage,remaining:['Finir la revue']});
  const remotes={main:'main1',[branch]:remote},pushes=[];
  const paths=[...new Set([...allowedPaths(week),...(extraPath?[extraPath]:[]),...Object.keys(extraFiles)])];
  const git=args=>{
    const [cmd,...a]=args;
    if(cmd==='rev-parse')return 'head';
    if(cmd==='ls-remote'){const b=a[1].slice(11);return remotes[b]?`${remotes[b]}\trefs/heads/${b}`:'';}
    if(cmd==='fetch')return '';
    if(cmd==='merge-base'&&a[0]==='--is-ancestor'){if(a[1]===a[2]||(ancestor&&a[2]==='head'))return '';throw Error('not ancestor');}
    if(cmd==='merge-base')return 'base';
    if(cmd==='diff')return paths.join('\n');
    if(cmd==='ls-tree')return files[a.at(-1)]!==undefined?a.at(-1):'';
    if(cmd==='show')return files[a[0].split(':').slice(1).join(':')];
    if(cmd==='push'){const [sha,ref]=a[1].split(':');assert(!a[1].startsWith('+'),'force push');pushes.push(a[1]);remotes[ref.slice(11)]=sha;return '';}
    throw Error('unexpected git '+args.join(' '));
  };
  return {git,remotes,pushes};
}

test('a sealed candidate is pushed fast-forward under a released chat lease',async()=>{
  const r=repo(),{api,state,markReady}=leaseApi();
  const out=await pushCandidate(week,{git:r.git,api,repo:repoName,markReady,clock:()=>0});
  assert.equal(out.pushed,true);assert.deepEqual(r.pushes,['head:refs/heads/'+branch]);
  assert.equal(r.remotes[branch],'head');assert.equal(state().released,true);assert.equal(state().mode,'chat');
});

test('a moved remote candidate is refused before any lease or push',async()=>{
  const r=repo({ancestor:false}),{api,state}=leaseApi();
  await assert.rejects(pushCandidate(week,{git:r.git,api}),/never force/);
  assert.equal(state(),null);assert.deepEqual(r.pushes,[]);
});

test('code or configuration paths cannot travel with a weekly candidate',()=>{
  assert.throws(()=>preflight(week,repo({extraPath:'scripts/validate-editorial.mjs'}).git),/code\/configuration/);
});

test('a poster copied into the site may travel with the candidate only as the fingerprinted image of its work',()=>{
  const poster='assets/posters/la-firme.webp',sha='a'.repeat(64);
  const works=image=>JSON.stringify({works:[{id:'la-firme',title:'La Firme',image,image_sha256:sha}]})+'\n';
  assert.equal(preflight(week,repo({extraFiles:{'data/works.json':works(poster),[poster]:'RIFF-WEBP'}}).git).stage,'ready');
  assert.throws(()=>preflight(week,repo({extraFiles:{'data/works.json':works('https://cdn.example.test/p.jpg'),[poster]:'RIFF-WEBP'}}).git),
    /fingerprinted image of its work/);
  assert.throws(()=>preflight(week,repo({extraFiles:{'data/works.json':works(poster),'assets/posters/../x.webp':'x'}}).git),/code\/configuration/);
  assert.throws(()=>preflight(week,repo({extraFiles:{'data/works.json':works(poster),'assets/js/image-resolver.js':'x'}}).git),/code\/configuration/);
});

test('a sealed review must match the committed blobs, not the working tree',()=>{
  assert.throws(()=>preflight(week,repo({stale:true}).git),/stale/);
});

test('an active lease held by another producer blocks the push',async()=>{
  const r=repo(),{api}=leaseApi();
  manageLease(api,{week,action:'acquire',owner:'other',mode:'chat',now:0});
  await assert.rejects(pushCandidate(week,{git:r.git,api,clock:()=>1}),/occupied/);
  assert.deepEqual(r.pushes,[]);
});

test('a failing push still releases the lease',async()=>{
  const r=repo(),{api,state}=leaseApi();
  const failing=args=>{if(args[0]==='push')throw Error('rejected');return r.git(args);};
  await assert.rejects(pushCandidate(week,{git:failing,api,clock:()=>0}),/rejected/);
  assert.equal(state().released,true);
});

test('a sealed candidate opens one non-draft PR, reused when rerun',async()=>{
  const r=repo(),l=leaseApi();
  const first=await pushCandidate(week,{git:r.git,api:l.api,repo:repoName,markReady:l.markReady,clock:()=>0});
  assert.equal(first.pull_request.number,90);assert.equal(l.created.length,1);assert.equal(l.created[0].draft,false);
  const again=await pushCandidate(week,{git:r.git,api:l.api,repo:repoName,markReady:l.markReady,clock:()=>0});
  assert.equal(again.reason,'already up to date');assert.equal(again.pull_request.number,90);
  assert.equal(l.created.length,1);assert.deepEqual(l.readied,[]);
});

test('an existing draft PR is marked ready once the candidate is sealed',async()=>{
  const r=repo(),l=leaseApi({number:69,html_url:'https://github.com/'+repoName+'/pull/69',draft:true});
  const out=await pushCandidate(week,{git:r.git,api:l.api,repo:repoName,markReady:l.markReady,clock:()=>0});
  assert.deepEqual(l.readied,[69]);assert.equal(out.pull_request.marked_ready,true);assert.equal(l.created.length,0);
});

test('a preparation checkpoint is pushed without opening or readying a PR',async()=>{
  const r=repo({stage:'enrichment'}),l=leaseApi({number:69,html_url:'x',draft:true});
  const out=await pushCandidate(week,{git:r.git,api:l.api,repo:repoName,markReady:l.markReady,clock:()=>0});
  assert.equal(out.pushed,true);assert.equal(out.pull_request,undefined);assert.deepEqual(l.readied,[]);assert.equal(l.created.length,0);
});

test('dry run and preparation checkpoints never take the lease',async()=>{
  const r=repo({stage:'enrichment'}),{api,state}=leaseApi();
  const out=await pushCandidate(week,{git:r.git,api,dryRun:true});
  assert.equal(out.pushed,false);assert.equal(out.stage,'enrichment');assert.equal(state(),null);assert.deepEqual(r.pushes,[]);
});

test('the real git runner keeps blob bytes intact, including the final newline',()=>{
  const git=gitRunner();
  const p='data/automation-config.json',raw=git(['show','HEAD:'+p]);
  assert(raw.endsWith('\n'),'git show output must not be trimmed');
  assert.equal(git(['rev-parse','HEAD']),git(['rev-parse','HEAD']).trim());
});

test('origin URLs resolve to the GitHub repository',()=>{
  assert.equal(repositoryFromRemote('https://github.com/kingrabbit89/selection-tv.git'),'kingrabbit89/selection-tv');
  assert.equal(repositoryFromRemote('git@github.com:kingrabbit89/selection-tv.git'),'kingrabbit89/selection-tv');
  assert.throws(()=>repositoryFromRemote('https://example.com/x/y'),/GitHub/);
});
