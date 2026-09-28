import test from 'node:test';
import assert from 'node:assert/strict';
import {manageLease} from './editorial-lease.mjs';
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
