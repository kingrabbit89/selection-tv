import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const advanceStep = 'Advance one verified publication stage';

function successfulStep(job, name) {
  return job.steps?.some(step => step.name === name && step.status === 'completed' && step.conclusion === 'success');
}

export function publisherTrigger(eventName, event, jobsForRun) {
  if (eventName !== 'workflow_run') return {allowed: true, reason: 'Scheduled or manual publication check.'};
  const run = event.workflow_run;
  if (run?.conclusion !== 'success') return {allowed: false, reason: 'Source workflow did not succeed.'};
  if (run.name === 'Validate architecture' && run.path === '.github/workflows/validate-architecture.yml')
    return {allowed: true, reason: 'Architecture validation succeeded; normal publication guards still apply.'};
  if (run.name !== 'Validate merged weekly issue for promotion' || run.path !== '.github/workflows/promote-validated-week.yml')
    return {allowed: false, reason: 'Unrecognized publication validation source.'};
  const matching = jobsForRun(run.id).filter(job => job.run_id === run.id && job.name === 'validate-promotion');
  const job = matching.length === 1 ? matching[0] : null;
  const allowed = job?.status === 'completed' && job.conclusion === 'success' &&
    successfulStep(job, 'Attest the validated base commit');
  return {allowed: Boolean(allowed), reason: allowed
    ? 'Merged draft validation and its exact-base attestation succeeded.'
    : 'Promotion resolver found no validated draft; publication stage will not run.'};
}

export function watchdogTrigger(eventName, event, jobsForRun) {
  if (eventName !== 'workflow_run') return {allowed: true, reason: 'Scheduled or manual watchdog check.'};
  const run = event.workflow_run;
  if (run?.conclusion === 'skipped') return {allowed: false, reason: 'Publisher was skipped; nothing to reconcile.'};
  // Preserve surveillance for actual failures and unavailable source-job proofs.
  if (run?.conclusion !== 'success') return {allowed: true, reason: 'Publisher did not succeed; preserve failure reconciliation.'};
  const matching = jobsForRun(run.id).filter(job => job.run_id === run.id && job.name === 'publish');
  const allowed = matching.some(job => successfulStep(job, advanceStep));
  return {allowed, reason: allowed
    ? 'A publication stage ran; reconcile any existing alert.'
    : 'Publisher eligibility only: no publication stage ran; no alert reconciliation needed.'};
}

function main() {
  const mode = process.argv[2];
  assert(['publisher', 'watchdog'].includes(mode), 'Usage: publication-trigger-context.mjs publisher|watchdog');
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = eventName === 'workflow_run' ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const repo = process.env.GITHUB_REPOSITORY;
  assert.match(repo || '', /^[\w.-]+\/[\w.-]+$/);
  const jobsForRun = runId => {
    assert(Number.isSafeInteger(runId) && runId > 0, 'Exact triggering run required');
    const result = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    }));
    assert(result.total_count <= 100, 'Source run has too many jobs for a complete trigger proof');
    assert(Array.isArray(result.jobs), 'Source jobs unavailable');
    return result.jobs;
  };
  let result;
  if (mode === 'watchdog') {
    try {result = watchdogTrigger(eventName, event, jobsForRun);}
    catch {result = {allowed: true, reason: 'Publisher job proof unavailable; preserve watchdog reconciliation.'};}
  } else result = publisherTrigger(eventName, event, jobsForRun);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${result.allowed ? 'true' : 'false'}\n`);
  console.log(result.reason);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.reason + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
