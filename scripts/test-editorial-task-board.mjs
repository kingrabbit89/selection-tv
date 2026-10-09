import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildTaskBoard, editorialReviewState, taskBoardMarkdown} from './editorial-task-board.mjs';
import {buildReport, inputSnapshot, matchingReport, validators} from './preparation-gaps.mjs';

const week = '2026-S42';
const fixture = () => [
  {validator: 'validate-publication-candidate', status: 1, output: '✗ coverage full_week_reaudit_completed must be true'},
  {validator: 'validate-editorial', status: 1, output: [
    '✗ Full inventory-first coverage audit not completed',
    ...['mardi', 'mercredi', 'jeudi'].map(day => `✗ ${day} reserve too shallow without shortage_reason`),
    ...['Film A', 'Film B', 'Film C', 'Film D', 'Film E'].map(title => `✗ Popularity radar reserve duplicates scan or public primary: ${title}`)
  ].join('\n')},
  {validator: 'validate-reserves', status: 1, output: ['mardi', 'mercredi', 'jeudi'].map(day =>
    `✗ ${day}-selection: 7 candidats (< 10) et shortage_reason non structuré`).join('\n')},
  {validator: 'validate-links', status: 0, output: '✓ ok'},
  {validator: 'validate-freshness', status: 0, output: '✓ ok'}
];

test('thirteen real-style blocker messages become five actions without losing observations or requirements', () => {
  const progress = {remaining: Array.from({length: 35}, (_, i) => 'Exigence ' + i),
    editorial_review: {completed: false}, remaining_items: [{id: 'example', text: 'Exigence 0', blocking: true}]};
  const input = {week, from: '2026-10-10', sections: [], results: fixture(), progress};
  const before = structuredClone(input);
  const report = buildReport(input);
  assert.equal(report.gap_count, 13);
  assert.equal(report.task_board.calculated.blocking_actions, 5);
  assert.equal(report.task_board.calculated.status, 'observed');
  assert.equal(report.task_board.declared.paragraph_count, 35);
  assert.deepEqual(report.task_board.declared.paragraphs, progress.remaining);
  assert.deepEqual(report.task_board.declared.structured_items, progress.remaining_items);
  assert.equal(report.task_board.declared.editorial_review.certified_by_this_report, false);
  assert.equal(report.task_board.calculated.actions.reduce((sum, action) => sum + action.messages.length, 0), 13);
  assert.deepEqual(report.task_board.calculated.actions.flatMap(action => action.messages).map(message =>
    JSON.stringify(message)).sort(), report.gaps.map(message => JSON.stringify(message)).sort());
  assert.deepEqual(input, before);
  assert.match(taskBoardMarkdown(report.task_board), /35 paragraphe/);
  assert.match(taskBoardMarkdown(report.task_board), /Ce nombre n'est pas un compte de tâches actives/);
});

test('warnings remain visible and do not become blocking actions', () => {
  const gaps = [{validator: 'validate-reserves', severity: 'warning', message: 'lundi-selection: 12 candidats prêts; objectif éditorial 15 non atteint mais minimum satisfait', scope: {kind: 'day', value: 'lundi'}}];
  const board = buildTaskBoard({gaps});
  assert.equal(board.calculated.blocking_messages, 0);
  assert.equal(board.calculated.blocking_actions, 0);
  assert.equal(board.calculated.warning_messages, 1);
  assert.equal(board.calculated.actions[0].blocking, false);
});

test('after overlap removal both popularity depth checks remain one action to fill distinct reserves', () => {
  const results = fixture();
  results[1].output = results[1].output.split('\n').filter(line => !line.includes('duplicates scan')).concat([
    '✗ Popularity radar reserve too shallow', '✗ Popularity radar distinct reserve too shallow']).join('\n');
  const report = buildReport({week, from: '2026-10-10', sections: [], results});
  assert.equal(report.gap_count, 10);
  assert.equal(report.task_board.calculated.blocking_actions, 5);
  const action = report.task_board.calculated.actions.find(row => row.id === 'radar-popularity-depth');
  assert.equal(action.messages.length, 2);
  assert.equal(action.blocking, true);
});

test('unknown errors preserve separate validators, scopes, messages and severity', () => {
  const gaps = ['one', 'two'].map(validator => ({validator, message: 'Unknown defect', severity: 'blocking', scope: {kind: 'global', value: null}}));
  const board = buildTaskBoard({gaps});
  assert.equal(board.calculated.actions.length, 2);
  assert.deepEqual(board.calculated.actions.flatMap(action => action.messages), gaps);
});

test('current editorial review declaration takes precedence over legacy fields without certification', () => {
  assert.equal(editorialReviewState({editorial_review: {completed: false}, editorial_review_completed: true}).declared_completed, false);
  assert.equal(editorialReviewState({editorial_review: {completed: true}, editorial_review_completed: false}).declared_completed, true);
  assert.equal(editorialReviewState({editorial_review_completed: true}).source, 'editorial_review_completed');
  assert.equal(editorialReviewState({}).declared_completed, false);
});

test('missing diagnostics or validator execution failures cannot look like a clean full observation', () => {
  const base = {week, from: '2026-10-10', sections: [], progress: null};
  assert.equal(buildReport({...base, results: []}).task_board.calculated.status, 'unavailable');
  const crash = buildReport({...base, results: [{validator: 'validate-links', status: 1, output: 'TypeError: crashed'}]});
  assert.equal(crash.task_board.calculated.status, 'partial');
  assert.equal(crash.gap_count, 1);
  const timedOut = buildReport({...base, results: [{validator: 'validate-links', status: 1, output: '✗ timeout', execution_error: 'ETIMEDOUT'}]});
  assert.equal(timedOut.task_board.calculated.status, 'partial');
  const truncated = buildReport({...base, results: validators.map(validator => ({validator, status: validator === 'validate-reserves' ? 1 : 0,
    output: validator === 'validate-reserves' ? '✗ first defect\n✗ Reserve readiness: 121 problème(s)' : '✓ ok'}))});
  assert.equal(truncated.task_board.calculated.status, 'partial');
  assert.equal(truncated.gap_count, 1);
  assert.match(taskBoardMarkdown(buildTaskBoard({observationsAvailable: false})), /aucun nombre de blocages/);
});

test('reusing a gap artifact requires the same inputs, week and CI execution', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-task-board-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'sample.json'), '{"value":1}');
  const env = {GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'abc', GITHUB_HEAD_REF: 'auto/2026-S42', SELECTION_TV_TODAY: '2026-10-10'};
  const snapshot = inputSnapshot(week, {root, env});
  const report = {week, input_snapshot: snapshot, gaps: [], validator_results: []};
  assert(matchingReport(report, snapshot));
  for (const key of ['week', 'sha256', 'run_id', 'run_attempt', 'checkout_sha', 'head_ref', 'validation_date']) {
    assert.equal(matchingReport(report, {...snapshot, [key]: 'changed'}), false, key);
  }
  assert.equal(matchingReport({...report, error: 'unavailable'}, snapshot), false);
  assert.equal(matchingReport({...report, input_snapshot: null}, snapshot), false);
  assert.equal(matchingReport(report, inputSnapshot(week, {root, env: {...env, SELECTION_TV_TODAY: '2026-10-11'}})), false);
  assert.equal(matchingReport(report, inputSnapshot(week, {root, env: {...env, GITHUB_HEAD_REF: 'promote/2026-S42'}})), false);
  fs.mkdirSync(path.join(root, 'assets', 'js'), {recursive: true});
  fs.writeFileSync(path.join(root, 'assets', 'js', 'urlguard.js'), 'changed guard');
  assert.equal(matchingReport(report, inputSnapshot(week, {root, env})), false);
  fs.rmSync(path.join(root, 'assets'), {recursive: true});
  fs.writeFileSync(path.join(root, 'data', 'sample.json'), '{"value":2}');
  assert.equal(matchingReport(report, inputSnapshot(week, {root, env})), false);
});

test('generation report displays declared paragraphs and rejects a stale calculation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-generation-board-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  };
  write('data/manifest.json', {latest: week, weeks: [{week, status: 'draft'}]});
  write(`data/research/${week}.json`, {remaining: Array(35).fill('À réconcilier'), editorial_review: {completed: false}, editorial_review_completed: true});
  write('preparation-gaps.json', buildReport({week, from: '2026-10-10', sections: [], progress: {},
    results: validators.map(validator => ({validator, status: 0, output: '✓ ok'})), snapshot: inputSnapshot(week, {root})}));
  const command = fileURLToPath(new URL('./generation-report.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [command], {cwd: root, encoding: 'utf8'});
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /35 paragraphes à réconcilier/);
  assert.match(valid.stdout, /Revue éditoriale déclarée achevée : non/);
  assert.doesNotMatch(valid.stdout, /Travaux restants : 35/);
  assert.match(valid.stdout, /0 message\(s\) bloquant/);
  write(`data/weeks/${week}.json`, {week, pages: [{id: 'new'}]});
  const stale = run();
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /Contrôles actuels indisponibles/);
  assert.doesNotMatch(stale.stdout, /0 message\(s\) bloquant/);
});
