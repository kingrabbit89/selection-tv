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
export function verifyAttestation(week,base,exec=execFileSync){
  try{exec(process.execPath,['scripts/verify-promotion-attestation.mjs',week,base],{stdio:'pipe'});return true;}
  catch(e){
    if(e?.status===PENDING_EXIT)throw new AttestationPending(String(e.stderr??'').trim()||`Revalidation of ${week} at ${base} still running.`);
    throw e;
  }
}

export function checksPass(checks,statuses=[]){
  const latest=new Map();
  for(const c of checks){const key=`${c.app?.id}:${c.name}`;if(!latest.has(key)||latest.get(key).id<c.id)latest.set(key,c);}
  const list=[...latest.values()];
  return ['data-and-policy','browser-presentation'].every(name=>list.some(c=>c.name===name&&c.app?.slug==='github-actions'&&c.status==='completed'&&c.conclusion==='success'))
    &&list.every(c=>c.status==='completed'&&c.conclusion==='success')&&statuses.every(s=>s.state==='success');
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
// A pending attestation and a candidate still in preparation are the only
// neutral stops. Mismatches, failed or stuck revalidations, stale or incoherent
// candidates and every other refusal still fail the run.
export async function runPublisher({api=github(),repo=process.env.GITHUB_REPOSITORY,week=calendarTarget().week,
  verify=verifyAttestation,log=summaryLog}={}){
  try{await advancePublication({api,repo,week,verify,log});}
  catch(e){
    if(e instanceof AttestationPending)log(`Attestation pending for ${week}; next run will continue. ${e.message}`);
    else if(e instanceof CandidateNotReady)log(`Candidate not ready for ${week}; next run will continue. ${e.message}`);
    else throw e;
    return {pending:true};
  }
  return {pending:false};
}
async function advancePublication({api,repo,week,verify,log}){
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
    const files=api(`pulls/${pr.number}/files?per_page=100`);assert(files.length<100,'too many files for safe automatic review');
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
