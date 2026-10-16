import test from 'node:test';
import assert from 'node:assert/strict';
import {manageLease,withEditorialLease} from './editorial-lease.mjs';
const week='2026-S42';
function fixture(){
 const refs={main:'main'},commits={main:{sha:'main',tree:{sha:'tree'}}};let n=0;
 const api=(p,method='GET',body)=>{
  if(p.startsWith('git/ref/heads/')){const key=p.slice(14);if(!refs[key]){const e=Error('missing');e.stderr='HTTP 404';throw e;}return {object:{sha:refs[key]}};}
  if(p==='git/commits'&&method==='POST'){const sha='c'+(++n);commits[sha]={...body,sha,tree:{sha:body.tree}};return {sha};}
  if(p.startsWith('git/commits/'))return commits[p.slice(12)];
  if(p==='git/refs'){const key=body.ref.slice(11);assert(!refs[key],'reference exists');refs[key]=body.sha;return {};}
  if(p.startsWith('git/refs/heads/')){const key=p.slice(15);assert.equal(body.force,false);assert.equal(commits[body.sha].parents[0],refs[key],'not fast-forward');refs[key]=body.sha;return {};}
  throw Error('Unexpected '+p);
 };return {api,refs,commits};
}
test('acquire, check, renew and release preserve exclusive owner',()=>{
 const {api}=fixture();const first=manageLease(api,{week,action:'acquire',owner:'a',now:0});
 assert.equal(first.owner,'a');assert.throws(()=>manageLease(api,{week,action:'acquire',owner:'b',now:1}),/occupied/);
 assert.throws(()=>manageLease(api,{week,action:'release',owner:'b',now:1}),/another/);
 manageLease(api,{week,action:'renew',owner:'a',now:1000});manageLease(api,{week,action:'check',owner:'a',now:2000});
 manageLease(api,{week,action:'release',owner:'a',now:3000});assert.equal(manageLease(api,{week,action:'acquire',owner:'b',now:4000}).owner,'b');
});
test('crashed expired owner cannot write or release the replacement lease',()=>{
 const {api}=fixture();manageLease(api,{week,action:'acquire',owner:'a',now:0});
 assert.throws(()=>manageLease(api,{week,action:'renew',owner:'a',now:3600000}),/expired/);
 manageLease(api,{week,action:'acquire',owner:'b',now:3600001});
 assert.throws(()=>manageLease(api,{week,action:'check',owner:'a',now:3600002}),/another/);
});
test('simultaneous acquisition loses cleanly without overwriting winner',()=>{
 const {api,refs,commits}=fixture();manageLease(api,{week,action:'acquire',owner:'old',now:0});let raced=false;
 const racing=(p,m,b)=>{if(p==='git/commits'&&m==='POST'&&!raced){raced=true;manageLease(api,{week,action:'acquire',owner:'winner',now:3600001});}return api(p,m,b);};
 assert.throws(()=>manageLease(racing,{week,action:'acquire',owner:'loser',now:3600001}),/fast-forward/);
 assert.equal(JSON.parse(commits[refs['locks/editorial-'+week]].message).owner,'winner');
});
test('malformed lock fails closed',()=>{const {api,refs,commits}=fixture();refs['locks/editorial-'+week]='bad';commits.bad={message:'not json'};assert.throws(()=>manageLease(api,{week,action:'acquire',owner:'a'}));});

test('chat leases expire after ten minutes, without changing the legacy sixty-minute default',()=>{
 const {api}=fixture();const first=manageLease(api,{week,action:'acquire',owner:'chat',mode:'chat',now:0});
 assert.equal(first.mode,'chat');assert.equal(Date.parse(first.expires_at),600000);
 assert.throws(()=>manageLease(api,{week,action:'acquire',owner:'other',mode:'chat',now:599999}),/occupied/);
 assert.throws(()=>manageLease(api,{week,action:'check',owner:'chat',now:600000}),/expired/);
 const second=manageLease(api,{week,action:'acquire',owner:'other',now:600000});
 assert.equal(second.mode,undefined);assert.equal(Date.parse(second.expires_at),4200000);
 assert.throws(()=>manageLease(api,{week,action:'release',owner:'chat',now:600001}),/another/);
});

test('chat renewals retain a short lease and release permits immediate reacquisition',()=>{
 const {api}=fixture();manageLease(api,{week,action:'acquire',owner:'a',mode:'chat',now:0});
 const renewed=manageLease(api,{week,action:'renew',owner:'a',now:300000});
 assert.equal(renewed.mode,'chat');assert.equal(Date.parse(renewed.expires_at),900000);
 assert.throws(()=>manageLease(api,{week,action:'renew',owner:'a',mode:'legacy',now:300001}),/mode/);
 const released=manageLease(api,{week,action:'release',owner:'a',now:300002});
 assert.equal(released.released,true);
 assert.equal(manageLease(api,{week,action:'acquire',owner:'b',mode:'chat',now:300003}).owner,'b');
});

test('invalid lease mode cannot silently bypass ownership',()=>{
 const {api,refs,commits}=fixture();
 assert.throws(()=>manageLease(api,{week,action:'acquire',owner:'a',mode:'none',now:0}),/mode/);
 refs['locks/editorial-'+week]='bad';commits.bad={message:JSON.stringify({kind:'selection-tv-editorial-lease',week,owner:'a',expires_at:new Date(600000).toISOString(),released:false,mode:'broken'})};
 assert.throws(()=>manageLease(api,{week,action:'acquire',owner:'b',mode:'chat',now:0}),/mode/);
});

test('scoped chat writer releases after success and after failure',async()=>{
 const {api}=fixture();let clock=0;
 const first=await withEditorialLease(api,{week,owner:'a',clock:()=>clock},async({owner,check,renew})=>{
  assert.equal(owner,'a');assert.equal(check().mode,'chat');clock=250000;
  assert.equal(Date.parse(renew().expires_at),850000);
  clock=260000;check();return 'saved';
 });
 assert.equal(first,'saved');
 assert.equal(manageLease(api,{week,action:'acquire',owner:'b',mode:'chat',now:260001}).owner,'b');
 manageLease(api,{week,action:'release',owner:'b',now:260002});
 await assert.rejects(withEditorialLease(api,{week,owner:'c',clock:()=>clock},async({check})=>{
  check();throw new Error('write failed');
 }),/write failed/);
 assert.equal(manageLease(api,{week,action:'acquire',owner:'d',mode:'chat',now:260003}).owner,'d');
});

test('scoped chat writer never releases a lease taken over after expiration',async()=>{
 const {api,refs,commits}=fixture();let clock=0;
 await assert.rejects(withEditorialLease(api,{week,owner:'a',clock:()=>clock},async({check})=>{
  clock=600000;
  manageLease(api,{week,action:'acquire',owner:'b',mode:'chat',now:clock});
  assert.throws(()=>check(),/another/);
 }),/another/);
 assert.equal(JSON.parse(commits[refs['locks/editorial-'+week]].message).owner,'b');
});

test('scoped chat writer reports cleanup failures without hiding the write failure',async()=>{
 const {api}=fixture();let clock=0;
 await assert.rejects(withEditorialLease(api,{week,owner:'a',clock:()=>clock},async()=>{
  clock=600000;throw new Error('write failed');
 }),error=>error instanceof AggregateError && error.errors.some(e=>/write failed/.test(e.message)) && error.errors.some(e=>/expired/.test(e.message)));
});

test('scoped chat writer preserves falsy thrown errors and releases',async()=>{
 const {api}=fixture();
 await assert.rejects(withEditorialLease(api,{week,owner:'a',clock:()=>0},async()=>{throw 0;}),error=>error===0);
 assert.equal(manageLease(api,{week,action:'acquire',owner:'b',mode:'chat',now:1}).owner,'b');
});
