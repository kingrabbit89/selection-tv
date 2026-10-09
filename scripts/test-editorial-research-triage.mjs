import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planResearchActions} from './editorial-research-triage.mjs';

const now = '2026-10-09T20:30:00Z';
const progress = () => ({week:'2026-S42', remaining:['Vérifier TV5.', 'Remplacer le film.'], resume:{next_actions:['Remplacer le film.']}, research_attempts:[]});
const gate = extra => ({state:'waiting_for_new_evidence', action_texts:['Vérifier TV5.'],
  reason:'Provenance inconnue malgré les sources examinées.', resume_when:'Nouvelle archive officielle publiée.',
  observed_at:'2026-10-09T20:00:00Z', evidence:'TVinfo consulté ; provenance non établie.', ...extra});
const plan = (p = progress(), options = {}) => planResearchActions(p, {now, ...options});

test('explicit exact gate keeps the unresolved requirement and evidence without mutating inputs', () => {
  const p = progress(); p.research_attempts.push({retry_gate:gate()}); const before = structuredClone(p);
  const report = plan(p);
  assert.deepEqual(report.all_actions, ['Remplacer le film.', 'Vérifier TV5.']);
  assert.deepEqual(report.actionable_actions, ['Remplacer le film.']);
  assert.equal(report.waiting_actions[0].gates[0].retry_gate.evidence, gate().evidence);
  assert.deepEqual(p, before);
  report.waiting_actions[0].gates[0].retry_gate.evidence = 'Altered report';
  assert.deepEqual(p, before);
});
test('exact linkage refuses substrings, case changes and partially unmapped gate sets', () => {
  for (const action_texts of [['Vérifier TV5'], ['vérifier TV5.'], ['Vérifier TV5.', 'Autre besoin.']]) {
    const p = progress(); p.research_attempts.push({retry_gate:gate({action_texts})});
    assert.deepEqual(plan(p).waiting_actions, []);
    assert.match(plan(p).review_warnings[0], /unmapped/);
  }
});
test('missing, invalid, expired or future conditions require review and never suppress action', () => {
  for (const extra of [{evidence:''}, {reason:''}, {resume_when:undefined}, {observed_at:null},
    {observed_at:'2026-02-30T20:00:00Z'}, {observed_at:'2026-10-10T20:00:00Z'},
    {expires_at:'2026-10-09T20:15:00Z'}, {expires_at:'bad'}]) {
    const p = progress(); p.research_attempts.push({retry_gate:gate(extra)});
    assert.deepEqual(plan(p).waiting_actions, []);
    assert.equal(plan(p).actionable_actions.length, 2);
    assert.match(plan(p).review_warnings[0], /needs_review/);
  }
});
test('unknown source provenance, blocking and resume_when alone imply no retry suppression or certification', () => {
  const p = progress(); p.research_attempts.push({status:'blocked', blocking:true, source_independence:'unknown',
    resume_when:'Fournisseur publié.', action:'Vérifier TV5.', evidence:'Guides différents.'});
  const report = plan(p);
  assert.equal(report.waiting_actions.length, 0);
  assert.equal(report.actionable_actions.length, 2);
  assert(!Object.hasOwn(report, 'ready'));
  assert(!Object.hasOwn(report, 'source_independence'));
});
test('a reopened gate requires new evidence with a real timestamp after the original observation', () => {
  const p = progress(); p.research_attempts.push({retry_gate:gate({state:'reopened',
    new_evidence:'Nouvelle archive officielle datée disponible.', reopened_at:'2026-10-09T20:20:00Z'})});
  assert.equal(plan(p).actionable_actions.length, 2);
  assert.deepEqual(plan(p).review_warnings, []);
  for (const extra of [{new_evidence:''}, {new_evidence:gate().evidence}, {reopened_at:null}, {reopened_at:'2026-10-09T19:59:00Z'}]) {
    const invalid = structuredClone(p); Object.assign(invalid.research_attempts[0].retry_gate, extra);
    assert.match(plan(invalid).review_warnings[0], /dated new_evidence/);
  }
});
test('another reopened or unrelated gate cannot cancel an unresolved exact gate', () => {
  const p = progress(); p.research_attempts.push({retry_gate:gate()}, {retry_gate:gate({state:'reopened',
    reopened_at:'2026-10-09T20:20:00Z', new_evidence:'Nouvelle page.'})}, {retry_gate:gate({action_texts:['Autre besoin.']})});
  assert.deepEqual(plan(p).actionable_actions, ['Remplacer le film.']);
  assert.equal(plan(p).waiting_actions.length, 1);
  assert.equal(plan(p).review_warnings.length, 1);
});
test('only a run matching the caller exact start contributes a current batch, including historical replay', () => {
  const startedAt = '2026-10-09T20:10:00Z';
  const p = progress(); p.run_metrics = [{started_at:'2026-10-09T19:00:00Z', ended_at:null, run_state:'running', next_useful_batch:'Ancienne piste.'},
    {started_at:startedAt, ended_at:null, run_state:'running', stop_reason:null, next_useful_batch:'Lot actuel.'}];
  assert.deepEqual(plan(p, {startedAt}).all_actions, ['Lot actuel.', 'Remplacer le film.', 'Vérifier TV5.']);
  p.run_metrics[1].ended_at = '2026-10-09T20:25:00Z';
  assert.deepEqual(plan(p, {startedAt}).all_actions, ['Remplacer le film.', 'Vérifier TV5.']);
  p.run_metrics[1].ended_at = '2026-10-09T20:45:00Z';
  p.run_metrics[1].run_state = 'stopped';
  p.run_metrics[1].stop_reason = 'budget_reserve_reached';
  assert.equal(plan(p, {startedAt}).all_actions[0], 'Lot actuel.');
});
test('a stale unfinished run, invalid clock or stopped undated run never becomes current', () => {
  const startedAt = '2026-10-09T20:10:00Z';
  const p = progress(); p.run_metrics = [{started_at:startedAt, ended_at:null, run_state:'running', next_useful_batch:'Ancienne piste.'}];
  for (const options of [{}, {startedAt:'2026-10-09T20:11:00Z'}, {startedAt:'invalid'}, {startedAt:'2026-10-10T20:11:00Z'}]) {
    const report = plan(p, options);
    assert.deepEqual(report.all_actions, ['Remplacer le film.', 'Vérifier TV5.']);
    assert.match(report.review_warnings[0], /needs_review/);
  }
  for (const extra of [{run_state:'stopped'}, {run_state:undefined,status:'running'}, {ended_at:'invalid'}, {stop_reason:'stopped'}, {ended_at:'2026-10-09T20:09:00Z'}]) {
    const invalid = structuredClone(p); Object.assign(invalid.run_metrics[0], extra);
    assert.deepEqual(plan(invalid, {startedAt}).all_actions, ['Remplacer le film.', 'Vérifier TV5.']);
    assert.match(plan(invalid, {startedAt}).review_warnings[0], /needs_review/);
  }
});
test('replay before a documented reopening preserves original waiting instead of importing future evidence', () => {
  const p = progress(); p.research_attempts.push({retry_gate:gate({state:'reopened',
    new_evidence:'Nouvelle archive officielle datée disponible.', reopened_at:'2026-10-09T20:40:00Z'})});
  const historical = plan(p);
  assert.deepEqual(historical.actionable_actions, ['Remplacer le film.']);
  assert.deepEqual(historical.review_warnings, []);
  assert.equal(historical.waiting_actions[0].gates[0].effective_state, 'waiting_for_new_evidence');
  assert.equal(historical.waiting_actions[0].gates[0].retry_gate.evidence, gate().evidence);
  const reopened = plan(p, {now:'2026-10-09T20:45:00Z'});
  assert.equal(reopened.actionable_actions.length, 2);
  assert.equal(reopened.waiting_actions.length, 0);
});
test('malformed progress is rejected rather than losing requirements', () => {
  for (const p of [null, {...progress(),week:'../main'}, {...progress(),week:['2026-S42']}, {...progress(),remaining:null},
    {...progress(),remaining:['']}, {...progress(),resume:{next_actions:[false]}}, {...progress(),research_attempts:{}}]) assert.throws(() => plan(p));
  assert.throws(() => planResearchActions(progress(), {now:'2026-02-30T20:00:00Z'}));
});
test('CLI reads only immutable committed checkpoint, rejects mutable refs and does not alter the tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-triage-'));
  const script = fileURLToPath(new URL('./editorial-research-triage.mjs', import.meta.url));
  try {
    const git = (...args) => execFileSync('git', args, {cwd:dir, encoding:'utf8'}).trim();
    git('init', '-q'); git('config','user.name','Test'); git('config','user.email','test@example.invalid');
    fs.mkdirSync(path.join(dir,'data/research'), {recursive:true});
    const checkpoint = progress(); checkpoint.run_metrics = [{started_at:'2026-10-09T20:10:00Z', run_state:'running', ended_at:null, next_useful_batch:'Lot actuel.'}];
    const source = path.join(dir,'data/research/2026-S42.json'); fs.writeFileSync(source, JSON.stringify(checkpoint));
    git('add','.'); git('commit','-qm','Checkpoint'); const sha = git('rev-parse','HEAD');
    fs.writeFileSync(source, JSON.stringify({...progress(), remaining:['Uncommitted change.'], resume:{}}));
    const dirty = git('diff');
    const result = spawnSync(process.execPath, [script,'2026-S42','--ref',sha,'--now',now], {cwd:dir, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.source_sha, sha);
    assert(report.all_actions.includes('Vérifier TV5.'));
    assert(!report.all_actions.includes('Uncommitted change.'));
    assert(!report.all_actions.includes('Lot actuel.'));
    const current = spawnSync(process.execPath, [script,'2026-S42','--ref',sha,'--now',now,'--started-at','2026-10-09T20:10:00Z'], {cwd:dir, encoding:'utf8'});
    assert.equal(current.status, 0, current.stderr);
    assert.equal(JSON.parse(current.stdout).all_actions[0], 'Lot actuel.');
    assert.equal(git('diff'), dirty);
    assert.notEqual(spawnSync(process.execPath, [script,'2026-S42','--ref','HEAD'], {cwd:dir}).status, 0);
    const output = path.join(dir,'report.json');
    assert.equal(spawnSync(process.execPath, [script,'2026-S42','--ref',sha,'--now',now,'--json',output], {cwd:dir}).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).source_sha, sha);
    assert.notEqual(spawnSync(process.execPath, [script,'2026-S42','--ref',sha,'--json',output], {cwd:dir}).status, 0);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
