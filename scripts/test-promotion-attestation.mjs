import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAttestation, workflowPath, attestStep} from './verify-promotion-attestation.mjs';

const week = '2026-S42', base = 'a'.repeat(40), other = 'b'.repeat(40), repo = 'owner/repo';
const run = (id, extra = {}) => ({id, head_sha: base, path: workflowPath, status: 'completed', conclusion: 'success', run_attempt: 1,
  repository: {full_name: repo}, head_repository: {full_name: repo}, ...extra});
const validated = (r, extra = {}) => [{run_id: r.id, run_attempt: r.run_attempt, name: 'resolve', status: 'completed', conclusion: 'success'},
  {run_id: r.id, run_attempt: r.run_attempt, name: 'validate-promotion', status: 'completed', conclusion: 'success',
    steps: [{name: attestStep, status: 'completed', conclusion: 'success'}], ...extra}];

function check(runs, {jobs = {}, artifacts = {}, proofs = {}} = {}) {
  const read = [];
  const result = selectAttestation({runs, week, base, repo,
    jobsFor: r => jobs[r.id] ?? validated(r),
    artifactsFor: r => artifacts[r.id] ?? [{name: 'promotion-ready-' + week, expired: false}],
    readProof: r => {read.push(r.id); return proofs[r.id] ?? {week, base_sha: base};}});
  return {...result, read};
}

test('latest successful revalidation with exact artifact is accepted', () => {
  const r = check([run(1), run(2)]);
  assert.equal(r.verified, true); assert.equal(r.run_id, 2); assert.deepEqual(r.read, [2]);
});

test('older success never hides a newer failed revalidation', () => {
  const r = check([run(1), run(2, {conclusion: 'failure'})]);
  assert.equal(r.verified, false); assert.match(r.reason, /failure/); assert.deepEqual(r.read, []);
});

test('older success never hides a newer revalidation still in progress or queued', () => {
  for (const status of ['in_progress', 'queued', 'waiting']) {
    const r = check([run(1), run(2, {status, conclusion: null})]);
    assert.equal(r.verified, false); assert.match(r.reason, new RegExp(status));
  }
});

test('a re-run that turned red blocks its own earlier attempt and older runs', () => {
  const r = check([run(1), run(2, {run_attempt: 2, conclusion: 'failure'})]);
  assert.equal(r.verified, false); assert.match(r.reason, /attempt 2/);
});

test('jobs from a stale attempt cannot attest the current attempt', () => {
  const r2 = run(2, {run_attempt: 2});
  const stale = validated(run(2, {run_attempt: 1}));
  const r = check([r2], {jobs: {2: stale}});
  assert.equal(r.verified, false); assert.match(r.reason, /latest attempt/);
});

test('a cancelled newer revalidation blocks older proofs', () => {
  assert.equal(check([run(1), run(2, {conclusion: 'cancelled'})]).verified, false);
});

test('resolver-only success is not a revalidation and does not mask or replace the decision', () => {
  const resolverOnly = r => [{run_id: r.id, run_attempt: 1, name: 'resolve', status: 'completed', conclusion: 'success'},
    {run_id: r.id, run_attempt: 1, name: 'validate-promotion', status: 'completed', conclusion: 'skipped', steps: []}];
  const ok = check([run(1), run(2)], {jobs: {2: resolverOnly(run(2))}});
  assert.equal(ok.verified, true); assert.equal(ok.run_id, 1);
  const blocked = check([run(1, {conclusion: 'failure'}), run(2)], {jobs: {2: resolverOnly(run(2))}});
  assert.equal(blocked.verified, false);
});

test('successful run without a successful attestation step is refused', () => {
  const noAttest = r => validated(r, {steps: [{name: attestStep, status: 'completed', conclusion: 'skipped'}]});
  assert.equal(check([run(1)], {jobs: {1: noAttest(run(1))}}).verified, false);
});

test('missing, expired or foreign artifacts are refused without falling back to an older run', () => {
  assert.match(check([run(1), run(2)], {artifacts: {2: []}}).reason, /no promotion-ready/);
  assert.match(check([run(1), run(2)], {artifacts: {2: [{name: 'promotion-ready-' + week, expired: true}]}}).reason, /expired/);
  assert.match(check([run(1), run(2)], {artifacts: {2: [{name: 'promotion-ready-2026-S43', expired: false}]}}).reason, /no promotion-ready/);
  const wrongSha = check([run(1), run(2)], {proofs: {2: {week, base_sha: other}}});
  assert.equal(wrongSha.verified, false); assert.deepEqual(wrongSha.read, [2]);
  assert.equal(check([run(2)], {proofs: {2: {week: '2026-S43', base_sha: base}}}).verified, false);
});

test('runs for another base, another workflow or another repository are ignored', () => {
  const r = check([run(1, {head_sha: other}), run(2, {path: '.github/workflows/other.yml'}),
    run(3, {head_repository: {full_name: 'fork/repo'}})]);
  assert.equal(r.verified, false); assert.match(r.reason, /No post-merge revalidation/);
});
