import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {allowedPaths, digest, planImport} from './editorial-handoff.mjs';
import {reviewedCandidate} from './weekly-publisher.mjs';
import {calendarTarget, addDays} from './week-calendar.mjs';
import {checkProgressStructures} from './editorial-progress.mjs';

// Preparation is observable, but can never satisfy the publication gate.
export function validationContext(branch, read, baseRead, paths, today) {
  if (!branch.startsWith('auto/')) return {mode: 'published'};
  const week = branch.slice(5);
  assert.match(week, /^\d{4}-S\d{2}$/, 'invalid weekly candidate branch');
  const allowed = allowedPaths(week);
  for (const p of paths) assert(allowed.has(p), 'candidate cannot change code/configuration: '+p);
  const raw = read(`data/research/${week}.json`);
  // Older complete candidates without a checkpoint still receive every gate.
  if (raw === null) return {mode: 'candidate', week};
  const progress = JSON.parse(raw);
  assert.equal(progress.schema_version, 1);
  assert.equal(progress.week, week);
  assert(['inventory', 'enrichment', 'ready'].includes(progress.stage), 'invalid research stage');
  assert(Array.isArray(progress.remaining), 'remaining must be an array');
  assert(progress.remaining.every(x => typeof x === 'string' && x.trim()), 'invalid remaining item');
  checkProgressStructures(progress);
  if (progress.stage === 'ready') {
    reviewedCandidate(week, progress, read, paths);
    return {mode: 'candidate', week};
  }
  assert(progress.remaining.length > 0, 'preparation must describe unfinished work');
  assert(progress.editorial_review_completed !== true && progress.editorial_review?.completed !== true,
    'unfinished preparation cannot claim completed review');
  const target = calendarTarget(today);
  assert.equal(week, target.week, 'preparation must match current cycle');
  // Reuse the import invariants: latest and all other issues remain unchanged.
  const files = paths.map(p => {
    const content = read(p);
    assert(content !== null, 'preparation cannot delete an artifact: '+p);
    if (p.endsWith('.json')) {
      const value = JSON.parse(content);
      if (p.startsWith(`data/`) && p.endsWith(`/${week}.json`)) assert.equal(value.week, week, 'artifact week mismatch: '+p);
    }
    return {path: p, base_sha256: digest(baseRead(p)), content};
  });
  if (files.length) planImport({schema_version: 1, week, base_sha: '0'.repeat(40),
    stage: progress.stage, remaining: progress.remaining, files}, baseRead);
  const inventoryText = read(`data/inventory/${week}.json`);
  if (inventoryText !== null) {
    const inventory = JSON.parse(inventoryText);
    assert.equal(inventory.week, week);
    assert(Array.isArray(inventory.days), 'inventory days must be an array');
    const dates = new Set();
    for (const day of inventory.days) {
      assert([0,1,2,3,4,5,6].map(n => addDays(target.from,n)).includes(day.date), 'inventory date outside candidate');
      assert(!dates.has(day.date), 'duplicate inventory date'); dates.add(day.date);
      assert(Array.isArray(day.items), 'inventory items must be an array');
      for (const item of day.items) {
        assert(String(item.title || '').trim() && String(item.channel || '').trim(), 'inventory title/channel missing');
        assert.match(String(item.start || item.time || ''), /^(?:[01]\d|2[0-3]):[0-5]\d$/, 'invalid inventory start');
        assert.match(String(item.source_url || ''), /^https?:\/\//, 'inventory source missing');
      }
      for (const [channel, count] of Object.entries(day.channel_counts || {})) {
        assert(Number.isInteger(count) && count >= 0, 'invalid channel count');
        assert.equal(count, day.items.filter(x => x.channel === channel).length, 'channel count mismatch: '+channel);
      }
    }
  }
  return {mode: 'preparation', week, stage: progress.stage, remaining: progress.remaining};
}

export function checkoutBase(eventBase, ref, expectedHead, git) {
  assert.match(eventBase || '', /^[a-f0-9]{40}$/, 'exact PR base required');
  if (!/^refs\/pull\/\d+\/merge$/.test(ref || '')) return eventBase;
  // The event may retain an old base SHA after main moves. Checkout tests the
  // synthetic merge, whose first parent is the base actually being validated.
  assert.match(expectedHead || '', /^[a-f0-9]{40}$/, 'exact candidate head required');
  const parents = git(['rev-list','--parents','-n','1','HEAD']).trim().split(/\s+/).slice(1);
  assert.equal(parents.length, 2, 'PR merge checkout must have two parents');
  assert.equal(parents[1], expectedHead, 'PR merge checkout does not match candidate head');
  return parents[0];
}

function main() {
  const read = p => fs.existsSync(p) ? fs.readFileSync(p,'utf8') : null;
  const branch = process.env.GITHUB_HEAD_REF || '';
  if (process.argv.includes('--require-ready')) {
    assert(!process.env.SELECTION_TV_PREPARATION_WEEK,
      'Publication blocked: '+process.env.SELECTION_TV_PREPARATION_WEEK+' is still in preparation; finish remaining work, review and seal the complete candidate.');
    console.log('✓ No unfinished preparation can pass the required publication check');
    return;
  }
  const git = args => execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  const base = branch.startsWith('auto/')
    ? checkoutBase(process.env.BASE_SHA, process.env.GITHUB_REF, process.env.CANDIDATE_HEAD_SHA, git)
    : process.env.BASE_SHA;
  const baseRead = p => {try {return git(['show',`${base}:${p}`]);} catch {return null;}};
  if (branch.startsWith('auto/')) assert.match(base || '', /^[a-f0-9]{40}$/, 'exact PR base required');
  const paths = branch.startsWith('auto/') ? git(['diff','--name-only',base,'HEAD']).trim().split('\n').filter(Boolean) : [];
  const ctx = validationContext(branch, read, baseRead, paths);
  const env = ctx.mode === 'preparation'
    ? `SELECTION_TV_PREPARATION_WEEK=${ctx.week}\n`
    : ctx.mode === 'candidate' ? `SELECTION_TV_VALIDATE_WEEK=${ctx.week}\nSELECTION_TV_CANDIDATE=1\n` : '';
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV,env);
  const message = ctx.mode === 'preparation'
    ? `Preparation ${ctx.week} (${ctx.stage}): ${ctx.remaining.length} remaining tasks. Published issue regression tests run; candidate merge remains blocked.\n${ctx.remaining.map(x => '- '+x).join('\n')}`
    : ctx.mode === 'candidate' ? `Complete candidate ${ctx.week}: all publication/editorial/browser gates required.` : 'Published issue validation.';
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,message+'\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
