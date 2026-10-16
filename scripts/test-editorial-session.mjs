import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SESSION_PHASES, HANDED_OFF, INTERRUPTED, CHAIN_BASIS, newSessionRun, startPhase, endPhase, skipPhase, finishRun,
  resumeRun, auditSessionRun, sessionSummary, parseCli, runCli} from './editorial-session.mjs';
import {lastRunGaps} from './editorial-progress.mjs';
import {buildWorkPacket} from './editorial-work-packet.mjs';

const WEEK = '2026-S44';
const at = minutes => new Date(Date.UTC(2026, 9, 24, 8, 0) + minutes * 60000).toISOString();

// A complete session: every phase timed in order, then handed to the publisher.
function handedOff() {
  const run = newSessionRun(at(0));
  let minute = 1;
  for (const name of SESSION_PHASES.slice(0, -1)) {startPhase(run, name, at(minute++)); endPhase(run, name, at(minute++));}
  startPhase(run, 'publication_chain', at(minute++));
  finishRun(run, {now: at(minute), stop_reason: HANDED_OFF, deliverables_changed: ['data/weeks/2026-S44.json']});
  return run;
}

test('one session entry holds real phase timings and no pass-mode bookkeeping', () => {
  const run = handedOff();
  assert.equal(run.mode, 'session');
  assert.equal(run.run_state, 'stopped');
  assert.equal(run.ended_at, at(14));
  assert.deepEqual(Object.keys(run.phases), SESSION_PHASES);
  assert.deepEqual(run.phases.cards, {started_at: at(7), ended_at: at(8)});
  assert.deepEqual(run.phases.publication_chain, {started_at: at(13), ended_at: null, basis: CHAIN_BASIS});
  for (const field of ['continuation_decision', 'continuation_decisions', 'completed_batches', 'contract_reads']) assert.equal(run[field], undefined);
  assert.deepEqual(auditSessionRun(run), []);
  assert.equal(sessionSummary(run).phases.cards.span_seconds, 60);
  assert.equal(sessionSummary(run).phases.publication_chain.span_seconds, null);
});

test('phases refuse impossible transitions; a reopened phase keeps its first start', () => {
  const run = newSessionRun(at(0));
  assert.throws(() => newSessionRun('2026-10-24'), /clock/);
  assert.throws(() => startPhase(run, 'research', at(1)), /Unknown phase/);
  assert.throws(() => endPhase(run, 'cards', at(1)), /not running/);
  startPhase(run, 'cards', at(1), 'Samedi à mardi');
  assert.throws(() => startPhase(run, 'cards', at(2)), /already running/);
  assert.throws(() => skipPhase(run, 'cards', 'déjà fait'), /cannot be skipped/);
  assert.throws(() => endPhase(run, 'cards', at(2), 'x'.repeat(281)), /short text/);
  endPhase(run, 'cards', at(2));
  startPhase(run, 'checks', at(3)); endPhase(run, 'checks', at(4));
  startPhase(run, 'cards', at(5)); endPhase(run, 'cards', at(6));
  assert.deepEqual(run.phases.cards, {started_at: at(1), ended_at: at(6), note: 'Samedi à mardi', reopened_at: [at(5)]});
  assert.throws(() => skipPhase(run, 'import', ' '), /states why/);
  skipPhase(run, 'import', 'Import fusionné par une session précédente (PR de sources).');
  startPhase(run, 'import', at(7));
  assert.equal(run.phases.import.skipped, undefined, 'a skipped phase can still be done for real');
});

test('the handoff requires every phase ended or skipped and the publication chain started', () => {
  const run = newSessionRun(at(0));
  startPhase(run, 'import', at(1)); endPhase(run, 'import', at(2));
  assert.throws(() => finishRun(run, {now: at(3), stop_reason: HANDED_OFF}), /grid_inventory.*publication_chain/);
  for (const name of SESSION_PHASES.slice(1, -1)) skipPhase(run, name, 'test');
  assert.throws(() => finishRun(run, {now: at(3), stop_reason: HANDED_OFF}), /publication_chain/);
  startPhase(run, 'publication_chain', at(3));
  finishRun(run, {now: at(4), stop_reason: HANDED_OFF});
  assert.throws(() => startPhase(run, 'checks', at(5)), /stopped/);
  // The same session may take the candidate up again after a red check.
  resumeRun(run, at(6));
  startPhase(run, 'checks', at(6)); endPhase(run, 'checks', at(7));
  finishRun(run, {now: at(8), stop_reason: HANDED_OFF});
  assert.deepEqual(run.resumed_at, [at(6)]);
  assert.deepEqual(auditSessionRun(run), []);
});

test('a session stopping early records its next batch and closes running phases at the real stop', () => {
  const run = newSessionRun(at(0));
  startPhase(run, 'cards', at(1));
  assert.throws(() => finishRun(run, {now: at(2), stop_reason: 'user_stop'}), /--next/);
  finishRun(run, {now: at(2), stop_reason: 'user_stop', next_useful_batch: 'Cartes mercredi à vendredi.'});
  assert.equal(run.phases.cards.ended_at, at(2));
  assert.deepEqual(auditSessionRun(run), []);
  const interrupted = newSessionRun(at(0));
  startPhase(interrupted, 'cards', at(1));
  Object.assign(interrupted, {run_state: 'stopped', stop_reason: INTERRUPTED, ended_at: null});
  assert.deepEqual(auditSessionRun(interrupted), [], 'an unobserved end stays unknown, not reconstructed');
  assert.throws(() => resumeRun(interrupted, at(3)), /observed/);
});

test('the audit reports inconsistent entries and pass-mode fields, informatively', () => {
  const warn = (mutate, pattern) => {
    const run = handedOff(); mutate(run);
    assert(auditSessionRun(run).some(warning => pattern.test(warning)), String(pattern) + ' ' + JSON.stringify(auditSessionRun(run)));
  };
  warn(run => {run.started_at = null;}, /started_at/);
  warn(run => {run.phases.cards.ended_at = at(-30);}, /cards ends before/);
  warn(run => {run.phases.import.started_at = at(-5);}, /import starts before the session/);
  warn(run => {run.phases.checks.ended_at = at(60);}, /checks ends after the session/);
  warn(run => {run.phases.checks.ended_at = null;}, /checks is still open/);
  warn(run => {delete run.phases.sections;}, /sections is neither timed nor skipped/);
  warn(run => {run.phases.research = {started_at: at(1), ended_at: at(2)};}, /unknown phase research/);
  warn(run => {run.phases.shortlist = {skipped: ''};}, /without a reason/);
  warn(run => {run.continuation_decisions = [];}, /pass mode/);
  warn(run => {run.ended_at = null;}, /ended_at/);
  warn(run => {run.stop_reason = 'user_stop';}, /next_useful_batch/);
  warn(run => {delete run.phases.publication_chain.started_at; run.phases.publication_chain.basis = 'x';}, /publication chain started/);
  assert.deepEqual(auditSessionRun({mode: 'passes'}), ['run is not a session entry']);
});

test('gap reports audit the session by phase, never against the 50-minute pass contract', () => {
  assert.deepEqual(lastRunGaps({run_metrics: [{prompt_revision: 'production-weekly-continuity-2026-10-10'}, handedOff()]}), []);
  const running = newSessionRun(at(0));
  assert.deepEqual(lastRunGaps({run_metrics: [running]}), []);
  const legacy = lastRunGaps({run_metrics: [{prompt_revision: 'production-weekly-continuity-2026-10-10', stop_reason: 'x'}]});
  assert(legacy.some(gap => /continuation_decision/.test(gap)), 'the ChatGPT pass audit is unchanged');
});

test('the work packet summarises the last session by phase', () => {
  const packet = buildWorkPacket({week: WEEK, sha: 'a'.repeat(40), research: {week: WEEK, remaining: ['x'], run_metrics: [handedOff()]},
    inventory: {week: WEEK, days: []}, coverage: {week: WEEK}, works: {works: []}, links: {links: {}}, manifest: {latest: '2026-S43'}, files: []});
  assert.equal(packet.last_run.mode, 'session');
  assert.equal(packet.last_run.stop_reason, HANDED_OFF);
  assert.equal(packet.last_run.phases.grid_inventory.span_seconds, 60);
  const legacy = buildWorkPacket({week: WEEK, sha: 'a'.repeat(40), research: {week: WEEK, remaining: ['x'], run_metrics: [{stop_reason: 'budget_reserve_reached'}]},
    inventory: {week: WEEK, days: []}, coverage: {week: WEEK}, works: {works: []}, links: {links: {}}, manifest: {latest: '2026-S43'}, files: []});
  assert.equal(legacy.last_run.stop_reason, 'budget_reserve_reached');
  assert.equal(legacy.last_run.mode, undefined);
});

test('command line options are strict', () => {
  assert.deepEqual(parseCli(['phase', WEEK, 'cards', 'start', '--note', 'Lot 1']).name, 'cards');
  assert.throws(() => parseCli(['phase', WEEK, 'cards', 'pause']), /start\|end/);
  assert.throws(() => parseCli(['phase', WEEK, 'research', 'start']), /Unknown phase/);
  assert.throws(() => parseCli(['begin', WEEK]), /Usage/);
  assert.throws(() => parseCli(['start', '2026-44']), /Usage/);
  assert.throws(() => parseCli(['finish', WEEK, '--stop-reason']), /incomplete/);
  assert.throws(() => parseCli(['finish', WEEK, '--now', at(0)]), /Unknown/, 'no option lets a caller supply its own clock');
  assert.throws(() => parseCli(['start', WEEK, 'extra']), /Unexpected/);
});

test('command line: the journal holds the session until the checkpoint exists, then moves into run_metrics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-session-'));
  const exitCode = process.exitCode;
  try {
    let minute = 0;
    const lines = [];
    const cli = (...args) => runCli([...args.slice(0, 2), '--journal', 'journal.json', ...args.slice(2)],
      {cwd: dir, clock: () => at(minute++), log: line => lines.push(line)});
    cli('start', WEEK);
    cli('phase', WEEK, 'import', 'start');
    cli('phase', WEEK, 'import', 'end', '--note', 'PR de sources fusionnée');
    assert.throws(() => cli('start', WEEK), /still running/);
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'journal.json'), 'utf8'));
    assert.equal(journal.runs.length, 1);
    assert.equal(journal.runs[0].phases.import.note, 'PR de sources fusionnée');
    // The candidate checkpoint appears (created by the session); its content is preserved.
    fs.mkdirSync(path.join(dir, 'data/research'), {recursive: true});
    const checkpoint = path.join(dir, `data/research/${WEEK}.json`);
    const original = {schema_version: 1, week: WEEK, stage: 'inventory', remaining: ['Relire la transcription.'],
      run_metrics: [{prompt_revision: 'production-weekly-continuity-2026-10-10', started_at: at(-90), run_state: 'stopped'}],
      custom: {kept: true}};
    fs.writeFileSync(checkpoint, JSON.stringify(original, null, 2) + '\n');
    cli('phase', WEEK, 'grid_inventory', 'start');
    assert(!fs.existsSync(path.join(dir, 'journal.json')), 'the journal is removed once adopted');
    for (const name of ['grid_inventory']) cli('phase', WEEK, name, 'end');
    for (const name of ['shortlist', 'cards', 'sections', 'checks']) {cli('phase', WEEK, name, 'start'); cli('phase', WEEK, name, 'end');}
    cli('phase', WEEK, 'publication_chain', 'start');
    cli('finish', WEEK, '--stop-reason', HANDED_OFF, '--deliverables', `data/weeks/${WEEK}.json,data/works.json`);
    const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    assert.deepEqual(saved.custom, {kept: true});
    assert.deepEqual(saved.remaining, original.remaining);
    assert.equal(saved.run_metrics.length, 2);
    assert.deepEqual(saved.run_metrics[0], original.run_metrics[0]);
    const run = saved.run_metrics[1];
    assert.equal(run.started_at, at(0));
    assert.deepEqual(run.phases.import, {started_at: at(1), ended_at: at(2), note: 'PR de sources fusionnée'});
    assert.deepEqual(run.deliverables_changed, [`data/weeks/${WEEK}.json`, 'data/works.json']);
    const report = cli('check', WEEK);
    assert.deepEqual(report.run_gaps, []);
    assert.equal(report.location, 'checkpoint');
    assert.equal(process.exitCode, exitCode);
    // A new session after a real interruption keeps the earlier entry, never rewritten.
    cli('resume', WEEK);
    cli('start', WEEK, '--supersede');
    const again = JSON.parse(fs.readFileSync(checkpoint, 'utf8')).run_metrics;
    assert.equal(again.length, 3);
    assert.equal(again[1].stop_reason, INTERRUPTED);
    assert.equal(again[1].started_at, at(0));
    assert.equal(again[2].run_state, 'running');
    assert.deepEqual(cli('check', WEEK).run_gaps, []);
    fs.writeFileSync(checkpoint, JSON.stringify({...original, week: '2026-S43'}));
    assert.throws(() => cli('check', WEEK), /another week/);
  } finally {
    process.exitCode = exitCode;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
