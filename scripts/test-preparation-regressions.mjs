import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparationOnly, recentBaseProof, resolvePreparationRegressions} from './preparation-regressions.mjs';

const base = 'a'.repeat(40), repo = 'owner/repo', week = '2026-S42';
const now = new Date('2026-10-08T19:00:00Z');
const context = {mode: 'preparation', week};
const paths = [`data/research/${week}.json`, `data/inventory/${week}.json`, `data/coverage/${week}.json`];
function run() {return {id: 20, head_sha: base, head_branch: 'main', event: 'push',
  path: '.github/workflows/validate-architecture.yml', repository: {full_name: repo},
  head_repository: {full_name: repo}, status: 'completed', conclusion: 'success', updated_at: '2026-10-08T18:30:00Z'};}
function jobs() {return Object.entries({
  'data-and-policy': ['Validate remote image sources'],
  'browser-presentation': ['Validate rendered issues', 'Validate Jellyfin Web bridge']
}).map(([name, names]) => ({run_id: 20, name, status: 'completed', conclusion: 'success',
  completed_at: '2026-10-08T18:30:00Z',
  steps: names.map(name => ({name, status: 'completed', conclusion: 'success'}))}));}

test('only nonempty current preparation research changes are eligible', () => {
  assert(preparationOnly(context, paths));
  assert(!preparationOnly(context, []));
  for (const mode of ['published', 'candidate']) assert(!preparationOnly({mode, week}, paths));
  for (const path of ['data/works.json', 'data/links.json', `data/weeks/${week}.json`,
    `data/radar-reserves/${week}.json`, `semaines/${week}/index.html`, 'assets/js/issue-loader.js',
    'data/research/2026-S41.json']) assert(!preparationOnly(context, [...paths, path]));
});

test('reuse requires an exact recent successful main push and successful real heavy steps', () => {
  assert.deepEqual(recentBaseProof([run()], jobs(), base, repo, now), {run_id: 20, base_sha: base});
  for (const patch of [{head_sha: 'b'.repeat(40)}, {event: 'pull_request'}, {head_branch: 'auto/2026-S42'},
    {path: '.github/workflows/other.yml'}, {repository: {full_name: 'fork/repo'}},
    {head_repository: {full_name: 'fork/repo'}}, {status: 'in_progress'}, {conclusion: 'failure'},
    {updated_at: '2026-10-08T17:59:59Z'}, {updated_at: '2026-10-08T19:01:00Z'}])
    assert(!recentBaseProof([{...run(), ...patch}], jobs(), base, repo, now));
  for (const change of [j => j.pop(), j => j.push(j[0]), j => j[0].conclusion = 'skipped',
    j => j[1].completed_at = '2026-10-08T17:00:00Z', j => j[1].steps[0].conclusion = 'skipped',
    j => j[0].run_id = 19, j => j[1].steps.pop()]) {
    const altered = jobs(); change(altered);
    assert(!recentBaseProof([run()], altered, base, repo, now));
  }
});

test('newer failure or pending rerun blocks an older exact-base success', () => {
  for (const patch of [{status: 'in_progress', conclusion: null}, {conclusion: 'failure'}])
    assert(!recentBaseProof([run(), {...run(), id: 21, ...patch}], jobs(), base, repo, now));
});

test('API resolver fetches latest jobs and never requests proof for ready or changed runtime', () => {
  const calls = [];
  const api = endpoint => {calls.push(endpoint); return endpoint.includes('/jobs?') ? {jobs: jobs()} : {workflow_runs: [run()]};};
  assert(resolvePreparationRegressions(context, paths, base, repo, api, now));
  assert.match(calls[0], /head_sha=a{40}/);
  assert(!calls[0].includes('status=success'));
  assert.match(calls[1], /filter=latest/);
  const never = () => {throw Error('proof must not be queried');};
  assert(!resolvePreparationRegressions({mode: 'candidate', week}, paths, base, repo, never, now));
  assert(!resolvePreparationRegressions(context, [...paths, 'data/works.json'], base, repo, never, now));
});

test('missing API permission falls back to full checking after current preparation is proven', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-regression-proof-'));
  const script = path.resolve('scripts/preparation-regressions.mjs');
  try {
    const git = args => execFileSync('git', args, {cwd: dir, encoding: 'utf8'});
    const write = (p, text) => {fs.mkdirSync(path.dirname(path.join(dir, p)), {recursive: true}); fs.writeFileSync(path.join(dir, p), text);};
    git(['init', '-q']);
    const manifest = JSON.stringify({latest: '2026-S41', weeks: [{week: '2026-S41', status: 'published'}]});
    write('data/manifest.json', manifest);
    git(['add', '.']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base']);
    const exactBase = git(['rev-parse', 'HEAD']).trim();
    write(`data/research/${week}.json`, JSON.stringify({schema_version: 1, week, stage: 'inventory', remaining: ['Review sources.']}));
    git(['add', '.']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'checkpoint']);
    write('bin/gh', '#!/bin/sh\nexit 1\n'); fs.chmodSync(path.join(dir, 'bin/gh'), 0o755);
    const output = path.join(dir, 'output');
    const env = {...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, BASE_SHA: exactBase,
      GITHUB_HEAD_REF: `auto/${week}`, GITHUB_REPOSITORY: repo, GITHUB_OUTPUT: output, SELECTION_TV_TODAY: '2026-10-08'};
    delete env.GITHUB_REF; delete env.CANDIDATE_HEAD_SHA; delete env.GITHUB_STEP_SUMMARY;
    const log = execFileSync(process.execPath, [script], {cwd: dir, env, encoding: 'utf8'});
    assert.match(log, /proof unavailable; run full regressions/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'reused=false\n');
    assert.equal(fs.readFileSync(path.join(dir, 'data/manifest.json'), 'utf8'), manifest);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('publisher wakeups retain main, research and promotion but exclude unrelated technical branches', () => {
  const source = fs.readFileSync('.github/workflows/weekly-publisher.yml', 'utf8');
  const section = source.split('  workflow_run:\n')[1].split('permissions:')[0];
  const patterns = section.match(/branches: \[([^\]]+)\]/)[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  for (const branch of ['main', 'auto/2026-S42', 'promote/2026-S42']) assert(patterns.some(pattern => path.matchesGlob(branch, pattern)));
  for (const branch of ['fix/ci', 'feat/editorial-tool', 'auto-other/2026-S42']) assert(!patterns.some(pattern => path.matchesGlob(branch, pattern)));
  assert(source.includes('  schedule:\n'));
  assert(source.includes('  workflow_dispatch:\n'));
});
