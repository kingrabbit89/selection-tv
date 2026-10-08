import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {publisherTrigger, watchdogTrigger} from './publication-trigger-context.mjs';

const event = (patch = {}) => ({workflow_run: {id: 42, conclusion: 'success',
  name: 'Validate merged weekly issue for promotion', path: '.github/workflows/promote-validated-week.yml', ...patch}});
const step = name => ({name, status: 'completed', conclusion: 'success'});
const promotion = () => [{run_id: 42, name: 'validate-promotion', status: 'completed', conclusion: 'success',
  steps: [step('Attest the validated base commit')]}];
const publish = () => [{run_id: 42, name: 'publish', status: 'completed', conclusion: 'success',
  steps: [step('Advance one verified publication stage')]}];
const noJobs = () => {throw Error('must not request source jobs');};

test('scheduled/manual and successful architecture checks keep their normal publication guards', () => {
  for (const name of ['schedule', 'workflow_dispatch']) assert(publisherTrigger(name, {}, noJobs).allowed);
  assert(publisherTrigger('workflow_run', event({name: 'Validate architecture', path: '.github/workflows/validate-architecture.yml'}), noJobs).allowed);
  assert(!publisherTrigger('workflow_run', event({conclusion: 'failure'}), noJobs).allowed);
  assert(!publisherTrigger('workflow_run', event({name: 'Other workflow'}), noJobs).allowed);
});

test('a successful resolver with skipped promotion cannot start publication', () => {
  const skipped = [{run_id: 42, name: 'resolve', status: 'completed', conclusion: 'success', steps: []},
    {run_id: 42, name: 'validate-promotion', status: 'completed', conclusion: 'skipped', steps: []}];
  assert(!publisherTrigger('workflow_run', event(), () => skipped).allowed);
  assert(!publisherTrigger('workflow_run', event(), () => []).allowed);
});

test('actual promotion job and exact-base attestation must both have succeeded', () => {
  assert(publisherTrigger('workflow_run', event(), promotion).allowed);
  for (const change of [j => j[0].conclusion = 'failure', j => j[0].status = 'in_progress',
    j => j[0].run_id = 41, j => j[0].steps[0].conclusion = 'skipped', j => j[0].steps = [], j => j.push(j[0])]) {
    const altered = promotion(); change(altered);
    assert(!publisherTrigger('workflow_run', event(), () => altered).allowed);
  }
});

test('watchdog avoids successful eligibility-only events and retains real attempts and failures', () => {
  assert(watchdogTrigger('workflow_run', event(), publish).allowed);
  assert(!watchdogTrigger('workflow_run', event(), () => []).allowed);
  const skipped = publish(); skipped[0].steps[0].conclusion = 'skipped';
  assert(!watchdogTrigger('workflow_run', event(), () => skipped).allowed);
  assert(!watchdogTrigger('workflow_run', event({conclusion: 'skipped'}), noJobs).allowed);
  for (const conclusion of ['failure', 'cancelled', 'timed_out'])
    assert(watchdogTrigger('workflow_run', event({conclusion}), noJobs).allowed);
  for (const name of ['schedule', 'workflow_dispatch']) assert(watchdogTrigger(name, {}, noJobs).allowed);
});

test('unavailable source jobs stop publication but preserve watchdog reconciliation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-trigger-'));
  const script = path.resolve('scripts/publication-trigger-context.mjs');
  try {
    fs.writeFileSync(path.join(dir, 'event.json'), JSON.stringify(event()));
    fs.mkdirSync(path.join(dir, 'bin')); fs.writeFileSync(path.join(dir, 'bin/gh'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(dir, 'bin/gh'), 0o755);
    const env = {...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_EVENT_PATH: path.join(dir, 'event.json'), GITHUB_REPOSITORY: 'owner/repo', GITHUB_OUTPUT: path.join(dir, 'output')};
    delete env.GITHUB_STEP_SUMMARY;
    assert.notEqual(spawnSync(process.execPath, [script, 'publisher'], {cwd: dir, env}).status, 0);
    const log = execFileSync(process.execPath, [script, 'watchdog'], {cwd: dir, env, encoding: 'utf8'});
    assert.match(log, /proof unavailable; preserve watchdog/);
    assert.equal(fs.readFileSync(path.join(dir, 'output'), 'utf8'), 'allowed=true\n');
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
