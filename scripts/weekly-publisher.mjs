import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {recoverPromotion} from './recover-promotion.mjs';
import {synchronizePromotion} from './synchronize-promotion.mjs';
import {calendarTarget} from './week-calendar.mjs';
import {allowedPaths,assertCandidatePaths,digest} from './editorial-handoff.mjs';
import {github,readContent,commitFiles,branchSha,openPR} from './github-weekly-api.mjs';
import {PENDING_EXIT} from './verify-promotion-attestation.mjs';

const summaryLog=s=>{console.log(s);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,s+'\n');};
// No attestation exists yet: a revalidation of this exact main is still running.
// Nothing advances; its completion (or the next cron) wakes the publisher again.
export class AttestationPending extends Error {}
// The open candidate is still in production (inventory or enrichment): it is
// neither merged nor synchronized. Pushing its sealed version wakes the publisher.
export class CandidateNotReady extends Error {}
// The PR's own required checks are still queued or running and nothing has
// failed. Their completion (Validate architecture) wakes the publisher again.
export class ChecksRunning extends Error {
  constructor(kind,message){super(message);this.kind=kind;}
}
export function verifyAttestation(week,base,exec=execFileSync){
  try{exec(process.execPath,['scripts/verify-promotion-attestation.mjs',week,base],{stdio:'pipe'});return true;}
  catch(e){
    if(e?.status===PENDING_EXIT)throw new AttestationPending(String(e.stderr??'').trim()||`Revalidation of ${week} at ${base} still running.`);
    throw e;
  }
}

const requiredChecks=['data-and-policy','browser-presentation'];
const trustedCheck=c=>c.app?.slug==='github-actions';
const passedCheck=c=>c.status==='completed'&&c.conclusion==='success';
function latestChecks(checks){
  const latest=new Map();
  for(const c of checks){const key=`${c.app?.id}:${c.name}`;if(!latest.has(key)||latest.get(key).id<c.id)latest.set(key,c);}
  return [...latest.values()];
}
export function checksPass(checks,statuses=[]){
  const list=latestChecks(checks);
  return requiredChecks.every(name=>list.some(c=>c.name===name&&trustedCheck(c)&&passedCheck(c)))
    &&list.every(passedCheck)&&statuses.every(s=>s.state==='success');
}
// The validation jobs take minutes (browser-presentation times out at 15). A
// check unfinished for longer, or since an unknown time, is stuck, not running.
export const CHECKS_RUNNING_LIMIT_MS=60*60*1000;
// 'running' only while nothing is refused: both required checks exist on the
// trusted app, every other check passed, every commit status succeeded, and
// each unfinished check is a trusted one still queued or in progress. A
// failure, cancellation, skip, approval wait or foreign app is never 'running'.
export function checksProgress(checks,statuses=[],now=Date.now()){
  if(checksPass(checks,statuses))return {state:'success',unfinished:[]};
  const list=latestChecks(checks),unfinished=list.filter(c=>!passedCheck(c));
  const waiting=statuses.every(s=>s.state==='success')
    &&requiredChecks.every(name=>list.some(c=>c.name===name&&trustedCheck(c)))
    &&unfinished.every(c=>trustedCheck(c)&&['queued','in_progress'].includes(c.status));
  if(!waiting)return {state:'refused',unfinished};
  const stale=c=>{const started=Date.parse(c.started_at??'');return !Number.isFinite(started)||now-started>CHECKS_RUNNING_LIMIT_MS;};
  return {state:unfinished.some(stale)?'stuck':'running',unfinished};
}
// GitHub can leave a check in_progress after its job finished: on 21 Oct the
// data-and-policy check of the S44 promotion (PR #94) stayed in_progress after
// "Complete job" at 14:57:50Z until run 39621296044 was rerun by hand at 15:10Z.
// Such a phantom is rerun once, 10 minutes after its job's last step. A rerun
// repeats the same checks; a second phantom of the same run is left to the
// running/stuck rule above.
export const PHANTOM_GRACE_MS=10*60*1000;
export function phantomCheck(api,check,now=Date.now()){
  const ids=/\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(check.details_url||check.html_url||'');
  if(!ids)return null;
  const run=api(`actions/runs/${ids[1]}`);
  if(run?.status!=='completed'||run.run_attempt!==1)return null;
  const steps=api(`actions/jobs/${ids[2]}`)?.steps||[];
  if(!steps.length||!steps.every(step=>step.status==='completed'))return null;
  const ended=Math.max(...steps.map(step=>Date.parse(step.completed_at??'')));
  if(!Number.isFinite(ended)||now-ended<=PHANTOM_GRACE_MS)return null;
  return {run:ids[1],job:ids[2],ended:new Date(ended).toISOString()};
}
// Every changed path must reach the path review below. Read every page of the
// PR's file list and prove it complete against the PR's own count; GitHub lists
// at most 3000 files, so a larger PR is still refused. A weekly candidate now
// carries its WebP posters, which took S44 past the former single page of 100.
export function listPullFiles(api,pr){
  const files=[];
  for(let page=1;page<=30;page++){
    const batch=api(`pulls/${pr.number}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if(batch.length<100)break;
  }
  assert(Number.isInteger(pr.changed_files)&&files.length===pr.changed_files,'incomplete PR file listing; automatic review refused');
  return files;
}
export function reviewedCandidate(week,progress,read,paths){
  assert.equal(progress.week,week);assert.equal(progress.stage,'ready');assert.equal(progress.editorial_review_completed,true);
  assert.deepEqual(progress.remaining,[],'unfinished editorial work');
  assert(progress.editorial_review?.completed!==false,'current editorial review is incomplete; legacy flag cannot override it');
  const expected=[...allowedPaths(week)].filter(p=>p!==`data/research/${week}.json`);
  for(const p of expected){const content=read(p);assert(content!==null,'missing output '+p);assert.equal(progress.reviewed_files?.[p],digest(content),'review is stale for '+p);}
  assertCandidatePaths(week,paths,read,'automatic candidate merge cannot change code/configuration: ');
}
// True for a coherent preparation checkpoint, which only waits. It still cannot
// carry code, claim a finished review or omit its unfinished work. Any other
// stage is left to reviewedCandidate, which accepts only a sealed 'ready'.
export function inPreparation(week,progress,read,paths){
  if(!['inventory','enrichment'].includes(progress.stage))return false;
  assert.equal(progress.week,week);
  assert(Array.isArray(progress.remaining)&&progress.remaining.length>0,'preparation must describe unfinished work');
  assert(progress.editorial_review_completed!==true&&progress.editorial_review?.completed!==true,'unfinished preparation cannot claim completed review');
  assertCandidatePaths(week,paths,read,'automatic candidate merge cannot change code/configuration: ');
  return true;
}
// A pending attestation, a candidate still in preparation and PR checks still
// running are the only neutral stops. Mismatches, failed or stuck revalidations
// or checks, stale or incoherent candidates and every other refusal still fail the run.
export async function runPublisher({api=github(),repo=process.env.GITHUB_REPOSITORY,week=calendarTarget().week,
  verify=verifyAttestation,log=summaryLog,now=Date.now}={}){
  try{await advancePublication({api,repo,week,verify,log,now});}
  catch(e){
    if(e instanceof AttestationPending)log(`Attestation pending for ${week}; next run will continue. ${e.message}`);
    else if(e instanceof CandidateNotReady)log(`Candidate not ready for ${week}; next run will continue. ${e.message}`);
    else if(e instanceof ChecksRunning)log(`${e.kind} checks still running for ${week}; next run will continue. ${e.message}`);
    else throw e;
    return {pending:true};
  }
  return {pending:false};
}
async function advancePublication({api,repo,week,verify,log,now}){
  // No weekday window: a sealed candidate of the calendar target advances as
  // soon as its checks are green. Friday 20:00 is the deadline, not the start.
  let main=branchSha(api,'main');
  const manifest=JSON.parse(readContent(api,main,'data/manifest.json'));
  const entry=manifest.weeks.find(w=>w.week===week);
  if(entry?.status==='published'&&manifest.latest===week){
    try{execFileSync(process.execPath,['scripts/verify-public-deployment.mjs',week],{stdio:'pipe'});log(week+' publicly deployed.');}
    catch(e){
      // Built-in-token merges do not trigger legacy Pages. Explicit build request, never a force push.
      const builds=api('pages/builds?per_page=1');
      if(!['queued','building'].includes(builds[0]?.status))api('pages/builds','POST',{});
      log('Publication merged but deployment unverified; Pages build requested/pending. Watchdog remains authoritative.');
      throw Error('Public deployment not yet verified: '+week);
    }
    return;
  }
  const candidate='auto/'+week,promotion='promote/'+week;
  const prs=api('pulls?state=open&base=main&per_page=100');
  const find=branch=>{const p=prs.filter(x=>x.head.ref===branch&&x.head.repo?.full_name===repo);assert(p.length<=1,'ambiguous candidate');return p[0];};
  async function mergeGreen(pr,isPromotion){
    pr=api('pulls/'+pr.number);
    assert(!pr.draft,'PR is a draft');
    const head=pr.head.sha;
    assert.equal(pr.base.ref,'main');assert.equal(pr.head.repo.full_name,repo);
    main=branchSha(api,'main');
    const relation=api(`compare/${main}...${head}`);
    if(isPromotion&&['behind','diverged'].includes(relation.status)){
      if(process.env.HAS_DEDICATED_TOKEN!=='true')
        log('Promotion synchronization uses the built-in token: new PR checks may require explicit approval. The watchdog retains publication-pending; autonomy without approval is not established.');
      const synced=synchronizePromotion(api,repo,week,main,head,{prNumber:pr.number,
        verifyAttestation:(target,base)=>verify(target,base)});
      log(`Synchronized exact promotion PR #${pr.number} at ${synced.sha}; new checks must pass before any merge.`);
      return;
    }
    const files=listPullFiles(api,pr);
    const paths=files.map(f=>f.filename),read=p=>readContent(api,head,p);
    let progress=null;
    if(!isPromotion){
      const checkpoint=read(`data/research/${week}.json`);assert(checkpoint!==null,'research checkpoint missing at candidate head');
      progress=JSON.parse(checkpoint);
      // Before the synchronization check: main moving under a candidate in
      // production is expected. Only a sealed candidate must be up to date.
      if(inPreparation(week,progress,read,paths))
        throw new CandidateNotReady(`PR #${pr.number} is at stage '${progress.stage}' with ${progress.remaining.length} remaining item(s).`);
    }
    assert(['ahead','identical'].includes(relation.status),'branch behind/diverged from main; normal synchronization required');
    if(!isPromotion){
      reviewedCandidate(week,progress,read,paths);
      const m=JSON.parse(read('data/manifest.json'));
      assert.equal(m.latest,manifest.latest);assert.equal(m.weeks.find(w=>w.week===week)?.status,'draft');
      assert.equal(JSON.parse(read(`data/weeks/${week}.json`)).publication_status,'draft');
    }else{
      verify(week,main);
      assert.deepEqual([...paths].sort(),['data/manifest.json',`data/weeks/${week}.json`].sort());
    }
    const checks=api(`commits/${head}/check-runs?per_page=100`);
    assert(checks.total_count<=100,'too many checks');
    const status=api(`commits/${head}/status?per_page=100`);
    assert(status.total_count<=100,'too many statuses');
    // Nothing has been written yet: a neutral stop here advances nothing.
    const checkState=checksProgress(checks.check_runs,status.statuses,now());
    const unfinished=checkState.unfinished.map(c=>`${c.name} ${c.status}`).join(', ');
    // Only trusted checks are unfinished in these states. Nothing is merged here:
    // the rerun's completion (Validate architecture) wakes the publisher again.
    if(['running','stuck'].includes(checkState.state))for(const check of checkState.unfinished){
      const phantom=phantomCheck(api,check,now());
      if(!phantom)continue;
      api(`actions/runs/${phantom.run}/rerun`,'POST');
      log(`Rerun requested for ${check.name}: job ${phantom.job} of run ${phantom.run} finished at ${phantom.ended} but its check is still ${check.status} at ${head}.`);
      throw new ChecksRunning(isPromotion?'Promotion':'Candidate',`PR #${pr.number} at ${head}: ${check.name} rerun requested.`);
    }
    if(checkState.state==='running')
      throw new ChecksRunning(isPromotion?'Promotion':'Candidate',`PR #${pr.number} at ${head}: ${unfinished}.`);
    assert(checkState.state!=='stuck',`checks unfinished for more than ${CHECKS_RUNNING_LIMIT_MS/60000} minutes or since an unknown time (${unfinished}); they are stuck, not running`);
    assert(checksPass(checks.check_runs,status.statuses),'checks missing, pending, failed, skipped or awaiting approval');
    assert.equal(branchSha(api,'main'),main,'main moved; retry');
    assert.equal(api('pulls/'+pr.number).head.sha,head,'PR moved; retry');
    const merged=api(`pulls/${pr.number}/merge`,'PUT',{sha:head,merge_method:'squash'});
    assert.equal(merged.merged,true,'GitHub did not authorize merge');
    log(`Merged protected PR #${pr.number} at ${head}.`);
    if(!isPromotion)api('actions/workflows/promote-validated-week.yml/dispatches','POST',{ref:'main',inputs:{week}});
    else api('pages/builds','POST',{});
  }
  const pendingPromotion=find(promotion);
  if(pendingPromotion){await mergeGreen(pendingPromotion,true);return;}
  const pendingCandidate=find(candidate);
  if(pendingCandidate){await mergeGreen(pendingCandidate,false);return;}
  if(entry?.status!=='draft'){log('No ready candidate: editorial production is still needed.');return;}
  // A successful run attests this exact base. No marker, old SHA or skipped run can replace it.
  verify(week,main);
  assert.equal(branchSha(api,'main'),main,'main moved after attestation');
  const oldBranch=branchSha(api,promotion);
  if(oldBranch){
    const recovered=recoverPromotion(api,repo,week,main,oldBranch);
    log('Recovered promotion PR: '+recovered.html_url+'; checks must finish before any merge.');
    return;
  }
  // Simulate only the known, reviewed two-file transition using trusted code/data.
  const newManifest=structuredClone(manifest),data=JSON.parse(readContent(api,main,`data/weeks/${week}.json`));
  assert.equal(data.publication_status,'draft');
  newManifest.latest=week;newManifest.updated=new Date().toISOString().slice(0,10);
  newManifest.weeks.find(w=>w.week===week).status='published';data.publication_status='published';
  const files=[{path:'data/manifest.json',content:JSON.stringify(newManifest,null,2)+'\n'},{path:`data/weeks/${week}.json`,content:JSON.stringify(data,null,2)+'\n'}];
  const sha=commitFiles(api,main,files,`Promote validated ${week}`);
  assert.equal(branchSha(api,'main'),main,'main moved before branch creation');
  api('git/refs','POST',{ref:'refs/heads/'+promotion,sha});
  const pr=openPR(api,repo,promotion,`Publier ${week}`,`Promotion après revalidation du commit ${main}. Seuls le manifeste et le statut de la semaine changent. Les contrôles obligatoires doivent réussir avant fusion.`);
  log(`Promotion PR: ${pr.html_url}. With GITHUB_TOKEN, approve workflows if requested by GitHub. The publisher never approves or bypasses them.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runPublisher();
