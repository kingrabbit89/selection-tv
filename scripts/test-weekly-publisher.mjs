import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runPublisher,verifyAttestation,AttestationPending,checksProgress,CHECKS_RUNNING_LIMIT_MS,listPullFiles} from './weekly-publisher.mjs';
import {PENDING_EXIT} from './verify-promotion-attestation.mjs';
import {allowedPaths,digest} from './editorial-handoff.mjs';

const week='2026-S43',repo='owner/repo',main='a'.repeat(40),head='b'.repeat(40);
const encode=value=>({encoding:'base64',content:Buffer.from(JSON.stringify(value)).toString('base64')});
const notFound=()=>Object.assign(Error('Not Found'),{stderr:'gh: Not Found (HTTP 404)'});
const promotionPR={number:7,changed_files:2,draft:false,base:{ref:'main'},head:{sha:head,ref:'promote/'+week,repo:{full_name:repo}}};

// S42 on 9 Oct: d3eddf73 was pushed at 23:40:41, its two jobs started at
// 23:40:50 and finished at 23:41:15 and 23:41:58. The publisher run of 23:41:08
// read them in progress and failed red; the run of 23:42:00 merged the candidate.
const checksStarted='2026-10-09T23:40:50Z',publisherNow=Date.parse('2026-10-09T23:41:20Z');
const actions={id:15368,slug:'github-actions'};
let checkId=0;
const checkRun=(name,status='completed',conclusion=status==='completed'?'success':null,extra={})=>
  ({id:++checkId,name,app:actions,status,conclusion,started_at:checksStarted,...extra});
const green=()=>[checkRun('data-and-policy'),checkRun('browser-presentation')];
const running=(status='in_progress')=>[checkRun('data-and-policy',status),checkRun('browser-presentation',status)];
const checkEndpoints=(checks,statuses)=>({
  [`commits/${head}/check-runs?per_page=100`]:{total_count:checks.length,check_runs:checks},
  [`commits/${head}/status?per_page=100`]:{total_count:statuses.length,statuses}});

// S43 at 18:57 UTC: the draft is merged on main, no candidate or promotion PR is open.
function fixture({promotion=false,checks=green(),statuses=[],now=publisherNow}={}){
  const manifest={latest:'2026-S42',updated:'2026-10-16',weeks:[{week:'2026-S42',status:'published'},{week,status:'draft'}]};
  const mutations=[],logs=[],verified=[],checkReads=checkEndpoints(checks,statuses);
  const api=(path,method='GET',body)=>{
    if(method!=='GET')mutations.push({path,method,body});
    if(method==='GET'&&checkReads[path])return checkReads[path];
    if(path==='pulls/7/merge'&&method==='PUT')return {merged:true};
    if(path==='pages/builds'&&method==='POST')return {status:'queued'};
    if(path==='git/ref/heads/main')return {object:{sha:main}};
    if(path==='git/ref/heads/promote/'+week)throw notFound();
    if(path===`contents/data/manifest.json?ref=${main}`)return encode(manifest);
    if(path===`contents/data/weeks/${week}.json?ref=${main}`)return encode({week,publication_status:'draft'});
    if(path==='pulls?state=open&base=main&per_page=100')return promotion?[promotionPR]:[];
    if(path==='pulls/7')return promotionPR;
    if(path===`compare/${main}...${head}`)return {status:'ahead'};
    if(path==='pulls/7/files?per_page=100&page=1')return [{filename:'data/manifest.json'},{filename:`data/weeks/${week}.json`}];
    if(path==='git/commits/'+main)return {tree:{sha:'d'.repeat(40)}};
    if(path==='git/trees'&&method==='POST')return {sha:'e'.repeat(40)};
    if(path==='git/commits'&&method==='POST')return {sha:'f'.repeat(40)};
    if(path==='git/refs'&&method==='POST')return {ref:body.ref};
    if(path.startsWith('pulls?state=open&base=main&head='))return [];
    if(path==='pulls'&&method==='POST')return {html_url:`https://github.com/${repo}/pull/8`};
    throw Error('Unexpected API call: '+method+' '+path);
  };
  const run=outcome=>runPublisher({api,repo,week,log:s=>logs.push(s),now:()=>now,verify:(target,base)=>{
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
function candidateFixture({progress=enrichment(),relation='ahead',draft=false,extraPaths=[],checks=green(),statuses=[],now=publisherNow}={}){
  const manifest={latest:'2026-S42',updated:'2026-10-16',weeks:[{week:'2026-S42',status:'published'}]};
  const pr={number:9,changed_files:[...allowedPaths(week),...extraPaths].length,draft,base:{ref:'main'},head:{sha:head,ref:'auto/'+week,repo:{full_name:repo}}};
  const text=value=>({encoding:'base64',content:Buffer.from(value).toString('base64')});
  const mutations=[],logs=[],verified=[],checkReads=checkEndpoints(checks,statuses);
  const api=(path,method='GET',body)=>{
    if(method!=='GET')mutations.push({path,method,body});
    if(method==='GET'&&checkReads[path])return checkReads[path];
    if(path==='git/ref/heads/main')return {object:{sha:main}};
    if(path===`contents/data/manifest.json?ref=${main}`)return encode(manifest);
    if(path==='pulls?state=open&base=main&per_page=100')return [pr];
    if(path==='pulls/9')return pr;
    if(path===`compare/${main}...${head}`)return {status:relation};
    if(path==='pulls/9/files?per_page=100&page=1')return [...allowedPaths(week),...extraPaths].map(filename=>({filename}));
    if(path===`contents/${research}?ref=${head}`){if(progress===null)throw notFound();return text(JSON.stringify(progress));}
    const atHead=/^contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(path);
    if(atHead?.[2]===head)return text(contentAt(atHead[1]));
    if(path==='pulls/9/merge'&&method==='PUT')return {merged:true};
    if(path==='actions/workflows/promote-validated-week.yml/dispatches'&&method==='POST')return null;
    throw Error('Unexpected API call: '+method+' '+path);
  };
  const run=()=>runPublisher({api,repo,week,log:s=>logs.push(s),now:()=>now,verify:(target,base)=>{verified.push({week:target,base});return true;}});
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
    [{progress:sealed(),checks:[checkRun('data-and-policy'),checkRun('browser-presentation','completed','failure')]},/checks missing, pending, failed/],
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

// The two red runs of 9 Oct: at 23:34:05 browser-presentation of e6f5b9b1 had
// already failed (23:33:58), a real refusal; at 23:41:08 d3eddf73 was still running.
const otherApp={id:1,slug:'someone-else'};
const startedAgo=ms=>new Date(publisherNow-ms).toISOString();
const stillRunning=[
  running(),running('queued'),
  [checkRun('data-and-policy'),checkRun('browser-presentation','in_progress')],
  // A re-run replaces the older success of the same check until it finishes.
  [...green(),checkRun('browser-presentation','queued')],
  // A successful check from another app does not block, as in checksPass.
  [...running(),checkRun('external-review','completed','success',{app:otherApp})],
  running().map(c=>({...c,started_at:startedAgo(CHECKS_RUNNING_LIMIT_MS)})),
];
const refusedChecks=[
  [checkRun('data-and-policy'),checkRun('browser-presentation','completed','failure')],
  ...['failure','cancelled','timed_out','skipped','neutral','action_required','stale',null].map(conclusion=>
    [checkRun('data-and-policy','in_progress'),checkRun('browser-presentation','completed',conclusion)]),
  ...['waiting','requested','pending'].map(status=>[checkRun('data-and-policy','in_progress'),checkRun('browser-presentation',status)]),
  [],[checkRun('data-and-policy','in_progress')],
  [checkRun('data-and-policy','in_progress'),checkRun('browser-presentation','in_progress',null,{app:otherApp})],
  [...running(),checkRun('external-review','in_progress',null,{app:otherApp})],
];
const refusedStatuses=['failure','error','pending'].map(state=>[{state,context:'external/ci'}]);
const stuckChecks=[
  running().map(c=>({...c,started_at:startedAgo(CHECKS_RUNNING_LIMIT_MS+1000)})),
  [checkRun('data-and-policy','in_progress'),checkRun('browser-presentation','queued',null,{started_at:null})],
  [checkRun('data-and-policy','in_progress',null,{started_at:undefined}),checkRun('browser-presentation')],
];

test('a sealed candidate whose checks are still running ends neutral and logged (S42, 9 Oct 23:41 UTC)',async()=>{
  for(const checks of stillRunning){
    const f=candidateFixture({progress:sealed(),checks});
    assert.deepEqual(await f.run(),{pending:true},JSON.stringify(checks));
    assert.deepEqual(f.mutations,[],'nothing is merged or dispatched while checks run');
    assert.equal(f.logs.length,1);
    assert.match(f.logs[0],/^Candidate checks still running for 2026-S43; next run will continue\. PR #9 at b{40}: \S+ (queued|in_progress)/);
  }
  const f=candidateFixture({progress:sealed(),checks:running()});
  await f.run();
  assert.deepEqual(f.logs,[`Candidate checks still running for 2026-S43; next run will continue. PR #9 at ${head}: data-and-policy in_progress, browser-presentation in_progress.`]);
});

test('promotion checks still running end neutral and logged, after the attestation',async()=>{
  for(const checks of stillRunning){
    const f=fixture({promotion:true,checks});
    assert.deepEqual(await f.run(true),{pending:true},JSON.stringify(checks));
    assert.deepEqual(f.verified,[{week,base:main}],'the attestation is still required first');
    assert.deepEqual(f.mutations,[],'nothing is merged or built while checks run');
    assert.equal(f.logs.length,1);
    assert.match(f.logs[0],/^Promotion checks still running for 2026-S43; next run will continue\. PR #7 at b{40}: /);
  }
});

test('failed, skipped, foreign, missing, unapproved or stuck checks still fail the candidate and the promotion',async()=>{
  const cases=[
    ...refusedChecks.map(checks=>[{checks},/checks missing, pending, failed, skipped or awaiting approval/]),
    ...refusedStatuses.map(statuses=>[{checks:running(),statuses},/checks missing, pending, failed, skipped or awaiting approval/]),
    ...stuckChecks.map(checks=>[{checks},/checks unfinished for more than 60 minutes or since an unknown time \(.+\); they are stuck, not running/]),
  ];
  for(const [options,reason] of cases){
    const candidate=candidateFixture({progress:sealed(),...options});
    await assert.rejects(candidate.run(),reason,JSON.stringify(options));
    assert.deepEqual(candidate.mutations,[]);
    assert.deepEqual(candidate.logs,[]);
    const promotion=fixture({promotion:true,...options});
    await assert.rejects(promotion.run(true),reason,JSON.stringify(options));
    assert.deepEqual(promotion.mutations,[]);
    assert.deepEqual(promotion.logs,[]);
  }
});

test('a green, attested promotion still merges and requests Pages',async()=>{
  const f=fixture({promotion:true});
  assert.deepEqual(await f.run(true),{pending:false});
  assert.deepEqual(f.mutations,[
    {path:'pulls/7/merge',method:'PUT',body:{sha:head,merge_method:'squash'}},
    {path:'pages/builds',method:'POST',body:{}}]);
  assert.deepEqual(f.logs,[`Merged protected PR #7 at ${head}.`]);
});

test('checks run for at most 60 minutes, measured from their own start',()=>{
  const at=ms=>running().map(c=>({...c,started_at:startedAgo(ms)}));
  assert.equal(checksProgress(green(),[],publisherNow).state,'success');
  assert.equal(checksProgress(at(0),[],publisherNow).state,'running');
  assert.equal(checksProgress(at(CHECKS_RUNNING_LIMIT_MS),[],publisherNow).state,'running');
  assert.equal(checksProgress(at(CHECKS_RUNNING_LIMIT_MS+1),[],publisherNow).state,'stuck');
  assert.equal(checksProgress(running().map(c=>({...c,started_at:null})),[],publisherNow).state,'stuck');
  assert.equal(checksProgress(running(),[],Date.parse(checksStarted)+61*60000).state,'stuck');
  assert.equal(checksProgress(refusedChecks[0],[],publisherNow).state,'refused');
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

test('a candidate with more than 100 files is listed page by page and proved complete (S44, 21 Oct: 120 files with posters)',()=>{
  const names=Array.from({length:120},(_,i)=>({filename:`assets/posters/oeuvre-${i}.webp`}));
  const calls=[];
  const api=path=>{calls.push(path);const page=Number(/&page=(\d+)$/.exec(path)[1]);return names.slice((page-1)*100,page*100);};
  assert.equal(listPullFiles(api,{number:92,changed_files:120}).length,120);
  assert.deepEqual(calls,['pulls/92/files?per_page=100&page=1','pulls/92/files?per_page=100&page=2']);
  assert.throws(()=>listPullFiles(api,{number:92,changed_files:121}),/incomplete PR file listing/);
  assert.throws(()=>listPullFiles(api,{number:92}),/incomplete PR file listing/);
  const full=()=>names.slice(0,100);
  assert.throws(()=>listPullFiles(full,{number:93,changed_files:3500}),/incomplete PR file listing/,'beyond the GitHub listing limit the review is still refused');
});
