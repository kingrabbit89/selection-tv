import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWeek} from './weekly-watchdog.mjs';
const week='2026-S42';
const run=(entry,prs=[],verify=async()=>{})=>inspectWeek({week,manifest:{latest:week,weeks:entry?[{week,...entry}]:[]},prs,verify});
test('watchdog distinguishes missing, draft, pending, deployed and broken deployment',async()=>{
 assert.equal((await run(null)).reason,'generation-missing');
 assert.equal((await run({status:'draft'})).reason,'draft-stuck');
 assert.equal((await run({status:'draft'},[{state:'open',head:{ref:'auto/'+week},html_url:'fixture'}])).reason,'publication-pending');
 assert.equal((await run({status:'published'})).ok,true);
 assert.equal((await run({status:'published'},[],async()=>{throw Error('Pages 503')})).reason,'deployment-failed');
});

import {watchdogTarget} from './weekly-watchdog.mjs';
test('late Saturday UTC/Sunday Paris still supervises the same issue',()=>{
 assert.equal(watchdogTarget('2026-10-10'),'2026-S42');
 assert.equal(watchdogTarget('2026-10-11'),'2026-S42');
 assert.equal(watchdogTarget('2026-10-12'),'2026-S43');
 assert.equal(watchdogTarget('2027-01-03'),watchdogTarget('2027-01-02'));
});

import {watchdogTrigger} from './publication-trigger-context.mjs';
test('a neutral attestation-pending run cannot clear an alert; a real publisher failure still reaches the watchdog',async()=>{
 const event=conclusion=>({workflow_run:{id:5,conclusion}});
 const advanced=()=>[{run_id:5,name:'publish',steps:[{name:'Advance one verified publication stage',status:'completed',conclusion:'success'}]}];
 // Pending exits 0 from the advance step: the watchdog still reconciles, and an
 // unpublished draft (with or without its promotion PR) is never "deployed".
 assert(watchdogTrigger('workflow_run',event('success'),advanced).allowed);
 assert.equal((await run({status:'draft'})).reason,'draft-stuck');
 assert.equal((await run({status:'draft'},[{state:'open',head:{ref:'promote/'+week},html_url:'fixture'}])).reason,'publication-pending');
 // A mismatch, failed or stuck revalidation fails the run: always reconciled.
 for(const conclusion of ['failure','timed_out','cancelled'])assert(watchdogTrigger('workflow_run',event(conclusion),()=>[]).allowed);
});

test('a neutral candidate-not-ready run cannot clear an alert: an open candidate in preparation stays pending',async()=>{
 // The publisher exits 0 from the advance step, so the watchdog reconciles (reconcile-only on workflow_run).
 const advanced=()=>[{run_id:5,name:'publish',steps:[{name:'Advance one verified publication stage',status:'completed',conclusion:'success'}]}];
 assert(watchdogTrigger('workflow_run',{workflow_run:{id:5,conclusion:'success'}},advanced).allowed);
 const preparation=[{state:'open',head:{ref:'auto/'+week},html_url:'https://github.com/owner/repo/pull/9'}];
 for(const entry of [null,{status:'draft'}]){
  const result=await run(entry,preparation);
  assert.equal(result.ok,false);assert.equal(result.reason,'publication-pending');
 }
});

test('a neutral checks-running run cannot clear an alert: an open candidate or promotion stays pending',async()=>{
 // Running checks end the advance step with exit 0: reconcile-only on workflow_run, never "deployed".
 const advanced=()=>[{run_id:5,name:'publish',steps:[{name:'Advance one verified publication stage',status:'completed',conclusion:'success'}]}];
 assert(watchdogTrigger('workflow_run',{workflow_run:{id:5,conclusion:'success'}},advanced).allowed);
 for(const ref of ['auto/'+week,'promote/'+week]){
  const result=await run({status:'draft'},[{state:'open',head:{ref},html_url:'https://github.com/owner/repo/pull/9'}]);
  assert.equal(result.ok,false);assert.equal(result.reason,'publication-pending');
 }
 // Failed, stuck or unapproved checks fail the publisher run: always reconciled.
 for(const conclusion of ['failure','timed_out','cancelled'])assert(watchdogTrigger('workflow_run',{workflow_run:{id:5,conclusion}},()=>[]).allowed);
});
