import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runPublisher,verifyAttestation,AttestationPending} from './weekly-publisher.mjs';
import {PENDING_EXIT} from './verify-promotion-attestation.mjs';
import {allowedPaths,digest} from './editorial-handoff.mjs';

const week='2026-S43',repo='owner/repo',main='a'.repeat(40),head='b'.repeat(40);
const encode=value=>({encoding:'base64',content:Buffer.from(JSON.stringify(value)).toString('base64')});
const notFound=()=>Object.assign(Error('Not Found'),{stderr:'gh: Not Found (HTTP 404)'});
const promotionPR={number:7,draft:false,base:{ref:'main'},head:{sha:head,ref:'promote/'+week,repo:{full_name:repo}}};

// S43 at 18:57 UTC: the draft is merged on main, no candidate or promotion PR is open.
function fixture({promotion=false}={}){
  const manifest={latest:'2026-S42',updated:'2026-10-16',weeks:[{week:'2026-S42',status:'published'},{week,status:'draft'}]};
  const mutations=[],logs=[],verified=[];
  const api=(path,method='GET',body)=>{
    if(method!=='GET')mutations.push({path,method,body});
    if(path==='git/ref/heads/main')return {object:{sha:main}};
    if(path==='git/ref/heads/promote/'+week)throw notFound();
    if(path===`contents/data/manifest.json?ref=${main}`)return encode(manifest);
    if(path===`contents/data/weeks/${week}.json?ref=${main}`)return encode({week,publication_status:'draft'});
    if(path==='pulls?state=open&base=main&per_page=100')return promotion?[promotionPR]:[];
    if(path==='pulls/7')return promotionPR;
    if(path===`compare/${main}...${head}`)return {status:'ahead'};
    if(path==='pulls/7/files?per_page=100')return [{filename:'data/manifest.json'},{filename:`data/weeks/${week}.json`}];
    if(path==='git/commits/'+main)return {tree:{sha:'d'.repeat(40)}};
    if(path==='git/trees'&&method==='POST')return {sha:'e'.repeat(40)};
    if(path==='git/commits'&&method==='POST')return {sha:'f'.repeat(40)};
    if(path==='git/refs'&&method==='POST')return {ref:body.ref};
    if(path.startsWith('pulls?state=open&base=main&head='))return [];
    if(path==='pulls'&&method==='POST')return {html_url:`https://github.com/${repo}/pull/8`};
    throw Error('Unexpected API call: '+method+' '+path);
  };
  const run=outcome=>runPublisher({api,repo,week,log:s=>logs.push(s),verify:(target,base)=>{
    verified.push({week:target,base});
    if(outcome instanceof Error)throw outcome;
    return true;
  }});
  return {mutations,logs,verified,run};
}
const pending=()=>new AttestationPending(`Revalidation run 38951144459 for ${main} is still in_progress; wait for its result.`);

for(const promotion of [false,true]){
  const stage=promotion?'merging the promotion PR':'opening the promotion PR';
  test('a revalidation still running ends neutral and logged before '+stage,async()=>{
    const f=fixture({promotion});
    assert.deepEqual(await f.run(pending()),{pending:true});
    assert.deepEqual(f.verified,[{week,base:main}]);
    assert.deepEqual(f.mutations,[],'nothing may advance without an attestation');
    assert.equal(f.logs.length,1);
    assert.match(f.logs[0],/^Attestation pending for 2026-S43; next run will continue\. Revalidation run 38951144459 .* in_progress/);
  });
  test('a real attestation failure or mismatch still fails before '+stage,async()=>{
    for(const reason of [`Run 1 attests 2026-S43@${'c'.repeat(40)}, not 2026-S43@${main}.`,
      `Latest revalidation run 1 (attempt 1) for ${main} concluded failure.`,
      `Revalidation run 1 for ${main} is still in_progress after more than 60 minutes; it is stuck, not pending.`]){
      const f=fixture({promotion});
      await assert.rejects(f.run(Error(reason)),error=>error.message===reason);
      assert.deepEqual(f.mutations,[]);
      assert.deepEqual(f.logs,[]);
    }
  });
}

test('a verified attestation still opens the promotion PR',async()=>{
  const f=fixture();
  assert.deepEqual(await f.run(true),{pending:false});
  assert.deepEqual(f.mutations.filter(m=>m.path==='git/refs').map(m=>m.body.ref),['refs/heads/promote/'+week]);
  assert(f.mutations.some(m=>m.path==='pulls'&&m.method==='POST'));
  assert(!f.logs.some(s=>/pending/i.test(s)));
});

// S43 at 18:10 UTC: auto/2026-S43 has an open, non-draft PR (the handoff import
// opens one at any stage) while its checkpoint is still at 'enrichment'.
const research=`data/research/${week}.json`,deliverables=[...allowedPaths(week)].filter(p=>p!==research);
const headManifest={latest:'2026-S42',updated:'2026-10-16',weeks:[{week:'2026-S42',status:'published'},{week,status:'draft'}]};
const contentAt=p=>p==='data/manifest.json'?JSON.stringify(headManifest):p===`data/weeks/${week}.json`?JSON.stringify({week,publication_status:'draft'}):`content of ${p}\n`;
const enrichment=(extra={})=>({schema_version:1,week,stage:'enrichment',editorial_review_completed:false,
  remaining:Array.from({length:34},(_,i)=>`Requirement ${i+1}`),...extra});
const sealed=(extra={})=>({schema_version:1,week,stage:'ready',editorial_review_completed:true,remaining:[],
  reviewed_files:Object.fromEntries(deliverables.map(p=>[p,digest(contentAt(p))])),...extra});
function candidateFixture({progress=enrichment(),relation='ahead',draft=false,extraPaths=[],checks='success'}={}){
  const manifest={latest:'2026-S42',updated:'2026-10-16',weeks:[{week:'2026-S42',status:'published'}]};
  const pr={number:9,draft,base:{ref:'main'},head:{sha:head,ref:'auto/'+week,repo:{full_name:repo}}};
  const text=value=>({encoding:'base64',content:Buffer.from(value).toString('base64')});
  const mutations=[],logs=[],verified=[];
  const api=(path,method='GET',body)=>{
    if(method!=='GET')mutations.push({path,method,body});
    if(path==='git/ref/heads/main')return {object:{sha:main}};
    if(path===`contents/data/manifest.json?ref=${main}`)return encode(manifest);
    if(path==='pulls?state=open&base=main&per_page=100')return [pr];
    if(path==='pulls/9')return pr;
    if(path===`compare/${main}...${head}`)return {status:relation};
    if(path==='pulls/9/files?per_page=100')return [...allowedPaths(week),...extraPaths].map(filename=>({filename}));
    if(path===`contents/${research}?ref=${head}`){if(progress===null)throw notFound();return text(JSON.stringify(progress));}
    const atHead=/^contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(path);
    if(atHead?.[2]===head)return text(contentAt(atHead[1]));
    if(path===`commits/${head}/check-runs?per_page=100`)return {total_count:2,check_runs:['data-and-policy','browser-presentation'].map((name,i)=>
      ({id:i+1,name,app:{id:15368,slug:'github-actions'},status:checks==='success'?'completed':'in_progress',conclusion:checks==='success'?'success':null}))};
    if(path===`commits/${head}/status?per_page=100`)return {total_count:0,statuses:[]};
    if(path==='pulls/9/merge'&&method==='PUT')return {merged:true};
    if(path==='actions/workflows/promote-validated-week.yml/dispatches'&&method==='POST')return null;
    throw Error('Unexpected API call: '+method+' '+path);
  };
  const run=()=>runPublisher({api,repo,week,log:s=>logs.push(s),verify:(target,base)=>{verified.push({week:target,base});return true;}});
  return {mutations,logs,verified,run};
}

test('a candidate still in enrichment ends neutral and logged (S43, 16 Oct 18:10 UTC)',async()=>{
  const f=candidateFixture();
  assert.deepEqual(await f.run(),{pending:true});
  assert.deepEqual(f.mutations,[],'a candidate in production is never merged, synchronized or dispatched');
  assert.deepEqual(f.verified,[]);
  assert.deepEqual(f.logs,["Candidate not ready for 2026-S43; next run will continue. PR #9 is at stage 'enrichment' with 34 remaining item(s)."]);
});

test('a candidate in preparation behind or diverged from main also waits (S42, 9 Oct)',async()=>{
  for(const relation of ['behind','diverged'])for(const stage of ['inventory','enrichment']){
    const f=candidateFixture({relation,progress:enrichment({stage})});
    assert.deepEqual(await f.run(),{pending:true},relation+' '+stage);
    assert.deepEqual(f.mutations,[]);
    assert.match(f.logs[0],new RegExp(`^Candidate not ready for 2026-S43; next run will continue\\. PR #9 is at stage '${stage}'`));
  }
});

test('every real refusal of a candidate still fails the run, without writes or neutral log',async()=>{
  const cases=[
    [{draft:true},/PR is a draft/],
    [{extraPaths:['scripts/weekly-publisher.mjs']},/cannot change code\/configuration: scripts\/weekly-publisher\.mjs/],
    [{relation:'behind',extraPaths:['.github/workflows/weekly-publisher.yml']},/cannot change code\/configuration/],
    [{progress:enrichment({remaining:[]})},/preparation must describe unfinished work/],
    [{progress:enrichment({editorial_review_completed:true})},/cannot claim completed review/],
    [{progress:enrichment({editorial_review:{completed:true}})},/cannot claim completed review/],
    [{progress:enrichment({week:'2026-S42'})},/strictly equal/],
    [{progress:null},/research checkpoint missing at candidate head/],
    [{progress:enrichment({stage:'sealed'})},/strictly equal/],
    [{progress:sealed({remaining:['Relire la grille du dimanche.']})},/unfinished editorial work/],
    [{progress:sealed({reviewed_files:{...sealed().reviewed_files,'data/works.json':'0'.repeat(64)}})},/review is stale for data\/works\.json/],
    [{progress:sealed(),relation:'behind'},/behind\/diverged from main/],
    [{progress:sealed(),checks:'pending'},/checks missing, pending/],
  ];
  for(const [options,reason] of cases){
    const f=candidateFixture(options);
    await assert.rejects(f.run(),reason,JSON.stringify(options));
    assert.deepEqual(f.mutations,[]);
    assert.deepEqual(f.logs,[]);
  }
});

test('a sealed, green, up-to-date candidate still merges and starts its revalidation',async()=>{
  const f=candidateFixture({progress:sealed()});
  assert.deepEqual(await f.run(),{pending:false});
  assert.deepEqual(f.mutations,[
    {path:'pulls/9/merge',method:'PUT',body:{sha:head,merge_method:'squash'}},
    {path:'actions/workflows/promote-validated-week.yml/dispatches',method:'POST',body:{ref:'main',inputs:{week}}}]);
  assert.deepEqual(f.logs,[`Merged protected PR #9 at ${head}.`]);
});

test('only the verifier pending exit status becomes AttestationPending',()=>{
  const calls=[];
  const exitWith=(status,stderr)=>(cmd,args,options)=>{calls.push(args);throw Object.assign(Error('Command failed'),{status,stderr:Buffer.from(stderr)});};
  assert.throws(()=>verifyAttestation(week,main,exitWith(PENDING_EXIT,'still in_progress; wait\n')),
    error=>error instanceof AttestationPending&&error.message==='still in_progress; wait');
  assert.deepEqual(calls[0],['scripts/verify-promotion-attestation.mjs',week,main]);
  for(const status of [1,2,null,undefined]){
    const failure=exitWith(status,'Run 1 attests another base');
    assert.throws(()=>verifyAttestation(week,main,failure),error=>!(error instanceof AttestationPending)&&error.status===status);
  }
  assert.equal(verifyAttestation(week,main,()=>''),true);
});

test('a real child process exit status reaches the publisher unchanged',()=>{
  const child=code=>(cmd,args,options)=>execFileSync(cmd,['-e',`process.stderr.write('child says ${code}');process.exitCode=${code}`],options);
  assert.throws(()=>verifyAttestation(week,main,child(PENDING_EXIT)),error=>error instanceof AttestationPending&&/child says 75/.test(error.message));
  assert.throws(()=>verifyAttestation(week,main,child(1)),error=>!(error instanceof AttestationPending)&&error.status===1);
  assert.equal(verifyAttestation(week,main,child(0)),true);
});
