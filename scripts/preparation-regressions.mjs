import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {checkoutBase, validationContext} from './validation-context.mjs';

const workflowPath = '.github/workflows/validate-architecture.yml';
const maximumAgeMs = 60 * 60 * 1000;
const requiredSteps = {
  'data-and-policy': ['Validate remote image sources'],
  'browser-presentation': ['Validate rendered issues', 'Validate Jellyfin Web bridge']
};

// This only reuses published-issue regressions. Preparation still cannot merge.
export function preparationOnly(context, paths) {
  if (context.mode !== 'preparation' || !paths.length) return false;
  const allowed = new Set(['research', 'inventory', 'coverage'].map(kind => `data/${kind}/${context.week}.json`));
  return paths.every(p => allowed.has(p));
}

export function recentBaseProof(runs, jobs, base, repo, now = new Date()) {
  assert.match(base || '', /^[a-f0-9]{40}$/);
  const candidates = runs.filter(run => run.head_sha === base && run.head_branch === 'main' &&
    run.event === 'push' && run.path === workflowPath && run.repository?.full_name === repo &&
    run.head_repository?.full_name === repo).sort((a, b) => b.id - a.id);
  const run = candidates[0]; // A newer pending/failed attempt invalidates an older success.
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') return false;
  const recent = value => {
    const age = now.getTime() - new Date(value).getTime();
    return Number.isFinite(age) && age >= 0 && age <= maximumAgeMs;
  };
  if (!recent(run.updated_at)) return false;
  for (const [name, steps] of Object.entries(requiredSteps)) {
    const matching = jobs.filter(job => job.name === name && job.run_id === run.id);
    if (matching.length !== 1) return false;
    const job = matching[0];
    if (job.status !== 'completed' || job.conclusion !== 'success' || !recent(job.completed_at)) return false;
    if (!steps.every(name => job.steps?.some(step => step.name === name &&
      step.status === 'completed' && step.conclusion === 'success'))) return false;
  }
  return {run_id: run.id, base_sha: base};
}

export function resolvePreparationRegressions(context, paths, base, repo, api, now = new Date()) {
  if (!preparationOnly(context, paths)) return false;
  // Query all conclusions so a newer failure/rerun cannot be hidden by a success filter.
  const {workflow_runs: runs = []} = api(`actions/runs?head_sha=${base}&branch=main&event=push&per_page=100`);
  const relevant = runs.filter(run => run.head_sha === base && run.head_branch === 'main' &&
    run.event === 'push' && run.path === workflowPath && run.repository?.full_name === repo &&
    run.head_repository?.full_name === repo).sort((a, b) => b.id - a.id)[0];
  if (!relevant || relevant.status !== 'completed' || relevant.conclusion !== 'success') return false;
  const {jobs = []} = api(`actions/runs/${relevant.id}/jobs?filter=latest&per_page=100`);
  return recentBaseProof(runs, jobs, base, repo, now);
}

function main() {
  const git = args => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']});
  const read = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  const branch = process.env.GITHUB_HEAD_REF || '';
  const base = checkoutBase(process.env.BASE_SHA, process.env.GITHUB_REF, process.env.CANDIDATE_HEAD_SHA, git);
  const paths = git(['diff', '--name-only', base, 'HEAD']).trim().split('\n').filter(Boolean);
  const baseRead = p => {try {return git(['show', `${base}:${p}`]);} catch {return null;}};
  // Independently prove the checkout is valid preparation in each required job.
  const context = validationContext(branch, read, baseRead, paths);
  const repo = process.env.GITHUB_REPOSITORY;
  assert.match(repo || '', /^[\w.-]+\/[\w.-]+$/);
  let proof = false;
  let fallback = 'No fresh successful validation of the exact main base; run full regressions.';
  try {
    const api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${endpoint}`], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    }));
    proof = resolvePreparationRegressions(context, paths, base, repo, api);
  } catch {
    // Missing token, timeout or API errors must increase checking, never bypass it.
    fallback = 'Base regression proof unavailable; run full regressions.';
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `reused=${proof ? 'true' : 'false'}\n`);
  const message = proof
    ? `Published-issue browser and image regressions reused from successful main push run ${proof.run_id} on exact base ${base}, completed within one hour. Only ${context.week} research/inventory/coverage changed. Current preparation invariants still run and the incomplete-candidate merge gate stays blocked. This does not validate ${context.week} for publication.`
    : fallback;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
