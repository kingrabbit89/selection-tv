import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {github,branchSha} from './github-weekly-api.mjs';

// Keep the historical task lease unchanged. Chat uses a shorter, opt-in lease
// only for the critical section that writes an already prepared editorial lot.
const LEGACY_TTL=60*60*1000;
const CHAT_TTL=10*60*1000;

export function inspectLease(api,week){
  assert.match(week,/^\d{4}-S\d{2}$/);
  const branch='locks/editorial-'+week,sha=branchSha(api,branch);
  if(!sha)return {branch,sha:null,lease:null};
  const commit=api('git/commits/'+sha),lease=JSON.parse(commit.message);
  assert.equal(lease.kind,'selection-tv-editorial-lease');assert.equal(lease.week,week);
  assert(typeof lease.owner==='string'&&lease.owner.length>0);
  assert(Number.isFinite(Date.parse(lease.expires_at)),'Unreadable lease expiration');
  assert(typeof lease.released==='boolean');
  assert(lease.mode===undefined||['legacy','chat'].includes(lease.mode),'Unreadable lease mode');
  return {branch,sha,lease,tree:commit.tree.sha};
}

export function manageLease(api,{week,action,owner=randomUUID(),now=Date.now(),mode}){
  assert(['acquire','check','renew','release'].includes(action));
  assert(mode===undefined||['legacy','chat'].includes(mode),'Unsupported lease mode');
  const current=inspectLease(api,week);
  const active=current.lease&&!current.lease.released&&Date.parse(current.lease.expires_at)>now;
  if(action==='acquire')assert(!active,'Lease occupied; do not write or retry aggressively');
  else {assert(active,'Lease expired or released');assert.equal(current.lease.owner,owner,'Lease lost to another owner');}
  const leaseMode=action==='acquire'?(mode||'legacy'):(current.lease.mode||'legacy');
  if(mode!==undefined)assert.equal(mode,leaseMode,'Lease mode cannot change while owned');
  if(action==='check')return {...current.lease,sha:current.sha};
  const parent=current.sha||branchSha(api,'main');assert(parent,'main missing');
  const tree=current.tree||api('git/commits/'+parent).tree.sha;
  const ttl=leaseMode==='chat'?CHAT_TTL:LEGACY_TTL;
  const lease={kind:'selection-tv-editorial-lease',week,owner,expires_at:new Date(now+ttl).toISOString(),released:action==='release'};
  if(leaseMode==='chat')lease.mode='chat';
  const commit=api('git/commits','POST',{tree,parents:[parent],message:JSON.stringify(lease)});
  if(current.sha)api('git/refs/heads/'+current.branch,'PATCH',{sha:commit.sha,force:false});
  else api('git/refs','POST',{ref:'refs/heads/'+current.branch,sha:commit.sha});
  const confirmed=inspectLease(api,week);
  assert.equal(confirmed.sha,commit.sha,'Lease changed during operation');
  assert.equal(confirmed.lease.owner,owner,'Lease ownership not confirmed');
  return {...confirmed.lease,sha:confirmed.sha};
}

// For authenticated scripts: acquire only around writes and release even if
// the operation throws. A crash cannot run finally; the short TTL is the fallback.
// Work MUST call check() immediately before every write and renew() if needed.
export async function withEditorialLease(api,{week,owner=randomUUID(),clock=Date.now},work){
  assert.equal(typeof work,'function','Supply an editorial write operation');
  assert.equal(typeof clock,'function','Supply a clock function');
  manageLease(api,{week,action:'acquire',owner,mode:'chat',now:clock()});
  const guard={owner,
    check:()=>manageLease(api,{week,action:'check',owner,now:clock()}),
    renew:()=>manageLease(api,{week,action:'renew',owner,now:clock()})};
  let failed=false,originalError;
  try{return await work(guard);}
  catch(error){failed=true;originalError=error;throw error;}
  finally{
    try{manageLease(api,{week,action:'release',owner,now:clock()});}
    catch(releaseError){
      if(failed)throw new AggregateError([originalError,releaseError],'Editorial work failed and its lease could not be released');
      throw releaseError;
    }
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),chat=args.includes('--chat');
  const [action,week,owner,...rest]=args.filter(a=>a!=='--chat');
  assert.equal(rest.length,0,'Unexpected lease arguments');
  if(chat)assert.equal(action,'acquire','--chat is only supported when acquiring');
  if(action!=='acquire')assert(owner,'Supply the owner returned at acquisition');
  console.log(JSON.stringify(manageLease(github(),{action,week,owner,mode:chat?'chat':undefined}),null,2));
}
