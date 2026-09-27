import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarTarget,validateCandidateCalendar} from './week-calendar.mjs';
test('Thursday, Friday and Saturday share one cycle',()=>{
  for(const date of ['2026-10-08','2026-10-09','2026-10-10'])assert.deepEqual(calendarTarget(date),{week:'2026-S42',short:'S42',from:'2026-10-10',to:'2026-10-16'});
});
test('missed S42 cannot block S43 or publish stale S42',()=>{
  const latest={from:'2026-10-03'};
  assert.deepEqual(validateCandidateCalendar(latest,calendarTarget('2026-10-15'),'2026-10-15'),['2026-S42']);
  assert.throws(()=>validateCandidateCalendar(latest,calendarTarget('2026-10-08'),'2026-10-15'));
});
test('year rollover and DST weekends',()=>{
  assert.equal(calendarTarget('2026-12-31').week,'2027-S01');
  assert.equal(calendarTarget('2026-10-23').from,'2026-10-24');
  assert.equal(calendarTarget('2026-03-27').from,'2026-03-28');
});
test('reject invalid range, identity and backwards issue',()=>{
  const current={from:'2026-10-03'}, entry=calendarTarget('2026-10-08');
  for(const patch of [{to:'2026-10-15'},{week:'2026-S43'},{from:'2026-10-09'}])assert.throws(()=>validateCandidateCalendar(current,{...entry,...patch},'2026-10-08'));
  assert.throws(()=>validateCandidateCalendar(entry,entry,'2026-10-08'));
});
