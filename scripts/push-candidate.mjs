import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertCandidatePaths} from './editorial-handoff.mjs';
import {reviewedCandidate} from './weekly-publisher.mjs';
import {withEditorialLease} from './editorial-lease.mjs';
import {checkProgressStructures} from './editorial-progress.mjs';
import {github,openPR} from './github-weekly-api.mjs';

// Push the committed candidate of one week to auto/YYYY-Sxx under the
// cooperative editorial lease. Only committed blobs are checked and pushed, so
// a working tree with converted line endings cannot reach the sealed review.
// Every remote write is a fast-forward; the lease is released in finally.
// A sealed candidate then gets its open, non-draft PR so CI and the protected
// publisher can take it to publication without waiting for anyone.

// Command output is trimmed; blob content read through `git show` is not, so
// sealed digests are compared with the exact committed bytes.
export function gitRunner(cwd=process.cwd()){
  const run=args=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
  return args=>args[0]==='show'?run(args):run(args).trim();
}

export function remoteSha(git,branch){
  const line=git(['ls-remote','origin','refs/heads/'+branch]).split('\n').find(l=>l.endsWith('\trefs/heads/'+branch));
  return line?line.split('\t')[0]:null;
}

const isAncestor=(git,a,b)=>{try{git(['merge-base','--is-ancestor',a,b]);return true;}catch{return false;}};

export function repositoryFromRemote(url){
  const m=/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(url||'').trim());
  assert(m,'origin is not a GitHub repository');
  return m[1];
}

export function preflight(week,git){
  assert.match(week||'',/^\d{4}-S\d{2}$/,'Usage: push-candidate.mjs YYYY-Sxx [--dry-run]');
  const branch='auto/'+week,head=git(['rev-parse','HEAD']);
  const main=remoteSha(git,'main');assert(main,'origin/main missing');
  git(['fetch','--quiet','origin',`+refs/heads/main:refs/remotes/origin/main`]);
  const remote=remoteSha(git,branch);
  if(remote){
    git(['fetch','--quiet','origin',`+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    assert(isAncestor(git,remote,head),`${branch} moved to ${remote}; reconcile with it first, never force`);
  }
  const base=git(['merge-base',main,head]);
  const paths=git(['diff','--name-only',base,head]).split('\n').filter(Boolean);
  const read=p=>git(['ls-tree','--name-only',head,'--',p])?git(['show',`${head}:${p}`]):null;
  assertCandidatePaths(week,paths,read);
  const raw=read(`data/research/${week}.json`);assert(raw!==null,'research checkpoint missing at HEAD');
  const progress=JSON.parse(raw);
  assert.equal(progress.week,week);checkProgressStructures(progress);
  if(progress.stage==='ready')reviewedCandidate(week,progress,read,paths);
  else{
    assert(progress.remaining?.length>0,'preparation must describe unfinished work');
    assert(progress.editorial_review_completed!==true&&progress.editorial_review?.completed!==true,'unfinished preparation cannot claim completed review');
  }
  return {week,branch,head,remote,main,stage:progress.stage,paths};
}

// CI runs on pull requests and the protected publisher merges only an open,
// non-draft PR, so a sealed candidate gets one. Preparation checkpoints never
// open or ready a PR: they stay unpublishable until sealed.
export function ensureCandidatePR(api,repo,week,{markReady}){
  const pr=openPR(api,repo,'auto/'+week,`Sélection TV ${week}`,
    `Candidate scellée de ${week}, poussée sous bail par push-candidate. La CI complète et le publicateur protégé décident seuls de la fusion et de la publication.`);
  if(pr.draft)markReady(pr.number);
  return {number:pr.number,url:pr.html_url,marked_ready:pr.draft===true};
}

const ghReady=repo=>number=>execFileSync('gh',['pr','ready',String(number),'--repo',repo],{stdio:['ignore','pipe','pipe']});

export async function pushCandidate(week,{git,api,repo,clock=Date.now,dryRun=false,markReady=ghReady(repo)}){
  const pre=preflight(week,git);
  if(dryRun&&pre.remote!==pre.head)return {...pre,pushed:false,reason:'dry run'};
  const result=pre.remote===pre.head?{...pre,pushed:false,reason:'already up to date'}:await withEditorialLease(api,{week,clock},async guard=>{
    guard.check();
    assert.equal(remoteSha(git,pre.branch),pre.remote,`${pre.branch} changed before the push; rerun after reconciling`);
    guard.check();
    git(['push','origin',`${pre.head}:refs/heads/${pre.branch}`]);
    assert.equal(remoteSha(git,pre.branch),pre.head,'remote candidate does not match the pushed commit');
    return {...pre,pushed:true,previous:pre.remote};
  });
  if(!dryRun&&pre.stage==='ready'){
    assert(repo,'repository required to open the candidate PR');
    result.pull_request=ensureCandidatePR(api,repo,week,{markReady});
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),dryRun=args.includes('--dry-run');
  const [week,...rest]=args.filter(a=>a!=='--dry-run');
  assert.equal(rest.length,0,'Usage: push-candidate.mjs YYYY-Sxx [--dry-run]');
  const git=gitRunner();
  const repo=process.env.GITHUB_REPOSITORY||repositoryFromRemote(git(['remote','get-url','origin']));
  console.log(JSON.stringify(await pushCandidate(week,{git,api:dryRun?null:github(repo),repo,dryRun}),null,2));
}
