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
