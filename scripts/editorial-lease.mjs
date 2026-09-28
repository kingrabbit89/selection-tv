import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {github,branchSha} from './github-weekly-api.mjs';
const TTL=60*60*1000;
export function inspectLease(api,week){
  assert.match(week,/^\d{4}-S\d{2}$/);
  const branch='locks/editorial-'+week,sha=branchSha(api,branch);
  if(!sha)return {branch,sha:null,lease:null};
  const commit=api('git/commits/'+sha),lease=JSON.parse(commit.message);
  assert.equal(lease.kind,'selection-tv-editorial-lease');assert.equal(lease.week,week);
  assert(typeof lease.owner==='string'&&lease.owner.length>0);
  assert(Number.isFinite(Date.parse(lease.expires_at)),'Unreadable lease expiration');
  assert(typeof lease.released==='boolean');
  return {branch,sha,lease,tree:commit.tree.sha};
}
export function manageLease(api,{week,action,owner=randomUUID(),now=Date.now()}){
  assert(['acquire','check','renew','release'].includes(action));
  const current=inspectLease(api,week);
  const active=current.lease&&!current.lease.released&&Date.parse(current.lease.expires_at)>now;
  if(action==='acquire')assert(!active,'Lease occupied; do not write or retry aggressively');
  else {assert(active,'Lease expired or released');assert.equal(current.lease.owner,owner,'Lease lost to another owner');}
  if(action==='check')return {...current.lease,sha:current.sha};
  const parent=current.sha||branchSha(api,'main');assert(parent,'main missing');
  const tree=current.tree||api('git/commits/'+parent).tree.sha;
  const lease={kind:'selection-tv-editorial-lease',week,owner,expires_at:new Date(now+TTL).toISOString(),released:action==='release'};
  const commit=api('git/commits','POST',{tree,parents:[parent],message:JSON.stringify(lease)});
  if(current.sha)api('git/refs/heads/'+current.branch,'PATCH',{sha:commit.sha,force:false});
  else api('git/refs','POST',{ref:'refs/heads/'+current.branch,sha:commit.sha});
  const confirmed=inspectLease(api,week);
  assert.equal(confirmed.sha,commit.sha,'Lease changed during operation');
  assert.equal(confirmed.lease.owner,owner,'Lease ownership not confirmed');
  return {...confirmed.lease,sha:confirmed.sha};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [action,week,owner]=process.argv.slice(2);
  if(action!=='acquire')assert(owner,'Supply the owner returned at acquisition');
  console.log(JSON.stringify(manageLease(github(),{action,week,owner}),null,2));
}
