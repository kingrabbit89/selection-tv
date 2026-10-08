import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const workflowPath = '.github/workflows/promote-validated-week.yml';
export const attestStep = 'Attest the validated base commit';

const succeeded = x => x?.status === 'completed' && x.conclusion === 'success';

// The latest revalidation of the exact base decides. An older success never
// hides a newer failed, cancelled, re-run or still-running revalidation.
export function selectAttestation({runs, jobsFor, artifactsFor, readProof, week, base, repo}) {
  assert.match(week || '', /^\d{4}-S\d{2}$/, 'Invalid week');
  assert.match(base || '', /^[a-f0-9]{40}$/, 'Invalid base');
  const relevant = runs.filter(run => run.head_sha === base && run.path === workflowPath &&
    (!repo || (run.repository?.full_name === repo && run.head_repository?.full_name === repo)));
  const attempts = [];
  for (const run of relevant) {
    // A queued rerun keeps its old run ID. Do not let any unfinished attempt
    // disappear behind a newer ID whose earlier attempt succeeded.
    if (run.status !== 'completed')
      return {verified: false, reason: `Revalidation run ${run.id} for ${base} is still ${run.status}; wait for its result.`};
    // filter=latest returns the jobs of the newest attempt; refuse stale attempts.
    const jobs = jobsFor(run).filter(job => job.run_id === run.id &&
      (run.run_attempt === undefined || job.run_attempt === undefined || job.run_attempt === run.run_attempt));
    const resolvers = jobs.filter(job => job.name === 'resolve');
    if (resolvers.length !== 1)
      return {verified: false, reason: `Jobs of the latest attempt of run ${run.id} are unavailable; the attestation step cannot be proven.`};
    const validation = jobs.filter(job => job.name === 'validate-promotion');
    if (validation.length > 1) return {verified: false, reason: `Run ${run.id} has ambiguous validate-promotion jobs.`};
    const job = validation[0];
    // A successful resolver that found no current draft is not a revalidation;
    // every other outcome (failure, cancellation, timeout) blocks older proofs.
    if (run.conclusion === 'success' && (!job || job.conclusion === 'skipped')) continue;
    // GitHub job timestamps belong to the selected attempt. Run IDs identify
    // the original run, and updated_at can change without a new validation.
    const started = resolvers[0].started_at;
    const attemptStart = typeof started === 'string' ? Date.parse(started) : NaN;
    if (!Number.isFinite(attemptStart))
      return {verified: false, reason: `Latest-attempt start time of run ${run.id} is unavailable; revalidation order cannot be proven.`};
    attempts.push({run, job, attemptStart});
  }
  attempts.sort((a, b) => b.attemptStart - a.attemptStart);
  if (attempts.length > 1 && attempts[0].attemptStart === attempts[1].attemptStart)
    return {verified: false, reason: 'Latest revalidation attempts have ambiguous start times; revalidate current main.'};
  if (attempts.length) {
    const {run, job} = attempts[0];
    if (run.conclusion !== 'success')
      return {verified: false, reason: `Latest revalidation run ${run.id} (attempt ${run.run_attempt ?? '?'}) for ${base} concluded ${run.conclusion}.`};
    if (!succeeded(job) || !job.steps?.some(step => step.name === attestStep && succeeded(step)))
      return {verified: false, reason: `Latest revalidation run ${run.id} did not complete its attestation step.`};
    const name = 'promotion-ready-' + week;
    const artifacts = artifactsFor(run).filter(a => a.name === name);
    if (!artifacts.length) return {verified: false, reason: `Latest revalidation run ${run.id} has no ${name} artifact.`};
    if (artifacts.every(a => a.expired)) return {verified: false, reason: `The ${name} artifact of run ${run.id} expired; revalidate current main.`};
    const proof = readProof(run, name);
    if (proof?.week !== week || proof?.base_sha !== base)
      return {verified: false, reason: `Run ${run.id} attests ${proof?.week}@${proof?.base_sha}, not ${week}@${base}.`};
    return {verified: true, run_id: run.id, run_attempt: run.run_attempt, reason: `Run ${run.id} attests ${week} at exact base ${base}.`};
  }
  return {verified: false, reason: `No post-merge revalidation of ${week} exists for base ${base}.`};
}

function main() {
  const [week, base] = process.argv.slice(2);
  if (!/^\d{4}-S\d{2}$/.test(week || '') || !/^[a-f0-9]{40}$/.test(base || '')) throw Error('Invalid week/base');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw Error('GITHUB_REPOSITORY missing');
  const api = p => JSON.parse(execFileSync('gh', ['api', p], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}));
  const runs = [];
  for (let page = 1; ; page++) {
    // All statuses and conclusions: filtering on success would hide newer failures.
    const batch = api(`repos/${repo}/actions/workflows/promote-validated-week.yml/runs?head_sha=${base}&per_page=100&page=${page}`).workflow_runs || [];
    runs.push(...batch);
    if (batch.length < 100) break;
    assert(page < 10, 'Too many revalidation runs for one base');
  }
  const result = selectAttestation({
    runs, week, base, repo,
    jobsFor: run => api(`repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs || [],
    artifactsFor: run => api(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts || [],
    readProof: (run, name) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-proof-'));
      try {
        execFileSync('gh', ['run', 'download', String(run.id), '--repo', repo, '--name', name, '--dir', dir], {stdio: 'pipe'});
        return JSON.parse(fs.readFileSync(path.join(dir, 'promotion-ready.json'), 'utf8'));
      } finally {fs.rmSync(dir, {recursive: true, force: true});}
    }
  });
  if (!result.verified) throw Error(result.reason + ' Run promote-validated-week on current main; never bypass this gate.');
  console.log('✓ ' + result.reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
