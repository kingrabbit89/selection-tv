import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAttestation, cliOutcome, workflowPath, attestStep, PENDING_EXIT, PENDING_LIMIT_MS} from './verify-promotion-attestation.mjs';

const week = '2026-S42', base = 'a'.repeat(40), other = 'b'.repeat(40), repo = 'owner/repo';
const run = (id, extra = {}) => ({id, head_sha: base, path: workflowPath, status: 'completed', conclusion: 'success', run_attempt: 1,
  repository: {full_name: repo}, head_repository: {full_name: repo}, ...extra});
const validated = (r, extra = {}) => [{run_id: r.id, run_attempt: r.run_attempt, name: 'resolve', status: 'completed', conclusion: 'success',
  started_at: new Date(Date.UTC(2026, 9, 8, 20, r.id)).toISOString()},
  {run_id: r.id, run_attempt: r.run_attempt, name: 'validate-promotion', status: 'completed', conclusion: 'success',
    steps: [{name: attestStep, status: 'completed', conclusion: 'success'}], ...extra}];

function check(runs, {jobs = {}, artifacts = {}, proofs = {}, now} = {}) {
  const read = [];
  const result = selectAttestation({runs, week, base, repo, now,
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

test('an older run ID rerun later in failure or cancellation supersedes a newer ID success', () => {
  for (const conclusion of ['failure', 'cancelled']) {
    const older = run(1, {run_attempt: 2, conclusion});
    const jobs = validated(older);
    jobs[0].started_at = '2026-10-08T22:15:00Z';
    const result = check([older, run(2)], {jobs: {1: jobs}});
    assert.equal(result.verified, false); assert.match(result.reason, /run 1 \(attempt 2\)/);
    assert.deepEqual(result.read, []);
  }
});

test('an older run ID whose later rerun is pending blocks completed successes', () => {
  for (const status of ['queued', 'in_progress']) {
    const result = check([run(1, {run_attempt: 2, status, conclusion: null}), run(2)]);
    assert.equal(result.verified, false); assert.match(result.reason, new RegExp(status));
    assert.deepEqual(result.read, []);
  }
});

test('latest actual attempt wins even when its run ID is older and updated_at is misleading', () => {
  const older = run(1, {run_attempt: 2, updated_at: '2026-10-08T19:00:00Z'});
  const newer = run(2, {conclusion: 'failure', updated_at: '2026-10-09T22:00:00Z'});
  const jobs = validated(older); jobs[0].started_at = '2026-10-08T22:15:00Z';
  const result = check([older, newer], {jobs: {1: jobs}});
  assert.equal(result.verified, true); assert.equal(result.run_id, 1);
});

test('missing, invalid or ambiguous actual-attempt timestamps fail closed', () => {
  for (const started_at of [undefined, null, 'invalid']) {
    const jobs = validated(run(1)); jobs[0].started_at = started_at;
    const result = check([run(1), run(2)], {jobs: {1: jobs}});
    assert.equal(result.verified, false); assert.match(result.reason, /order cannot be proven/);
  }
  const same = validated(run(1)); same[0].started_at = validated(run(2))[0].started_at;
  assert.match(check([run(1), run(2)], {jobs: {1: same}}).reason, /ambiguous start times/);
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

// S43, 2026-10-16: the publisher checked main 2429fac while the dispatched
// revalidation of that exact SHA was still running.
const now = Date.parse('2026-10-16T18:59:20Z');
const startedAt = minutes => new Date(now - minutes * 60000).toISOString();

test('a recent unfinished revalidation of the exact base is pending, never a proof', () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) {
    const r = check([run(1), run(2, {status, conclusion: null, run_started_at: startedAt(3)})], {now});
    assert.equal(r.verified, false); assert.equal(r.pending, true);
    assert.match(r.reason, new RegExp(`run 2 .* still ${status}; wait`)); assert.deepEqual(r.read, []);
  }
  const created = check([run(1, {status: 'queued', conclusion: null, created_at: startedAt(1)})], {now});
  assert.equal(created.pending, true);
  const rerun = check([run(1, {run_attempt: 2, status: 'in_progress', conclusion: null, run_started_at: startedAt(59)}), run(2)], {now});
  assert.equal(rerun.verified, false); assert.equal(rerun.pending, true);
});

test('an unfinished revalidation that is too old or undated is stuck, not pending', () => {
  const minutes = PENDING_LIMIT_MS / 60000;
  const stuck = check([run(1, {status: 'in_progress', conclusion: null, run_started_at: startedAt(minutes + 1)})], {now});
  assert.equal(stuck.verified, false); assert.equal(stuck.pending, undefined); assert.match(stuck.reason, /stuck, not pending/);
  for (const extra of [{}, {run_started_at: 'invalid'}, {run_started_at: null, created_at: null}]) {
    const undated = check([run(1, {status: 'queued', conclusion: null, ...extra})], {now});
    assert.equal(undated.pending, undefined); assert.match(undated.reason, /cannot be proven pending/);
  }
});

test('completed refusals are never pending', () => {
  const refusals = [
    check([run(1, {conclusion: 'failure'})], {now}),
    check([run(1, {conclusion: 'cancelled'})], {now}),
    check([run(1)], {now, artifacts: {1: []}}),
    check([run(1)], {now, proofs: {1: {week, base_sha: other}}}),
    check([run(1, {head_sha: other})], {now}),
    check([run(1)], {now, jobs: {1: []}})
  ];
  for (const r of refusals) {assert.equal(r.verified, false); assert.equal(r.pending, undefined);}
});

test('the CLI exits 0 with a proof, PENDING_EXIT while pending and fails every other refusal', () => {
  assert.equal(PENDING_EXIT, 75);
  assert.equal(cliOutcome(check([run(1)], {now})).exitCode, 0);
  const pending = cliOutcome(check([run(1, {status: 'in_progress', conclusion: null, run_started_at: startedAt(3)})], {now}));
  assert.equal(pending.exitCode, PENDING_EXIT); assert.match(pending.message, /Attestation pending.*never bypass/);
  for (const result of [check([run(1, {conclusion: 'failure'})], {now}), check([run(1)], {now, proofs: {1: {week, base_sha: other}}}),
    check([run(1, {status: 'in_progress', conclusion: null})], {now}), {verified: false, pending: 'yes', reason: 'forged'}]) {
    const outcome = cliOutcome(result);
    assert.equal(outcome.exitCode, 1); assert.match(outcome.message, /never bypass this gate/);
  }
});
