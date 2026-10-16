import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {allowedPaths, digest} from './editorial-handoff.mjs';
import {editorialReviewState} from './editorial-task-board.mjs';
import {reviewedCandidate} from './weekly-publisher.mjs';
import {testEnvironment} from './run-test-isolation.mjs';

function fixture(t, remaining = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-review-test-')), week = '2026-S43';
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const progressPath = `data/research/${week}.json`, paths = [...allowedPaths(week)];
  for (const p of paths) {
    fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true});
    fs.writeFileSync(path.join(root, p), p.endsWith('.json') ? '{}' : '<!-- synthetic test -->');
  }
  const progress = {schema_version: 1, week, stage: 'enrichment', remaining,
    editorial_review_completed: false, editorial_review: {completed: false, basis: 'synthetic fixture; keep this context'}};
  fs.writeFileSync(path.join(root, progressPath), JSON.stringify(progress));
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const run = args => spawnSync(process.execPath, [fileURLToPath(new URL('./seal-editorial-review.mjs', import.meta.url)), week, ...args],
    {cwd: root, env: testEnvironment(), encoding: 'utf8', timeout: 10000});
  return {root, week, paths, progressPath, progress, read, run};
}

test('explicit review sealing synchronizes modern and legacy declarations and preserves review context', t => {
  const f = fixture(t), bytes = Object.fromEntries(f.paths.map(p => [p, f.read(p)]));
  const run = f.run(['--review-completed']); assert.equal(run.status, 0, run.stderr);
  const saved = JSON.parse(f.read(f.progressPath));
  assert.equal(saved.editorial_review.completed, true);
  assert.equal(saved.editorial_review_completed, true);
  assert.equal(saved.editorial_review.reviewed_at, saved.reviewed_at);
  assert.equal(saved.editorial_review.basis, f.progress.editorial_review.basis);
  assert.equal(editorialReviewState(saved).declared_completed, true);
  assert.equal(saved.stage, 'ready'); assert.deepEqual(saved.remaining, []);
  for (const p of f.paths.filter(p => p !== f.progressPath)) {
    assert.equal(f.read(p), bytes[p]); assert.equal(saved.reviewed_files[p], digest(bytes[p]));
  }
});

for (const [name, remaining, args] of [
  ['missing explicit acknowledgement', [], []], ['unfinished work', ['still unverified'], ['--review-completed']]
]) test(`review sealing rejects ${name} without modifying the checkpoint`, t => {
  const f = fixture(t, remaining), before = f.read(f.progressPath), run = f.run(args);
  assert.notEqual(run.status, 0); assert.equal(f.read(f.progressPath), before);
});

test('candidate guard rejects an explicitly incomplete current review even with a legacy true flag', t => {
  const f = fixture(t);
  const progress = {...f.progress, stage: 'ready', editorial_review_completed: true,
    reviewed_files: Object.fromEntries(f.paths.filter(p => p !== f.progressPath).map(p => [p, digest(f.read(p))]))};
  assert.throws(() => reviewedCandidate(f.week, progress, f.read, f.paths), /current editorial review/);
  // Old checkpoints without a modern declaration retain their compatibility.
  delete progress.editorial_review;
  reviewedCandidate(f.week, progress, f.read, f.paths);
  progress.editorial_review = {completed: true};
  reviewedCandidate(f.week, progress, f.read, f.paths);
});
