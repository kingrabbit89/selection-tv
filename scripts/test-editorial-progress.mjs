import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRemainingItems, checkShortlist, lastRunGaps, shortlistSummary} from './editorial-progress.mjs';
import {classify, parseProblems, buildReport, markdown} from './preparation-gaps.mjs';
import {validationContext} from './validation-context.mjs';

const remaining = ['Recouper dimanche.', 'Écrire les rendez-vous.'];
const items = () => [
  {id: 'cov-dimanche', text: 'Recouper dimanche.', scope: {kind: 'day', value: 'dimanche'}, blocking: true, closes_when: 'Second guide daté lu et omissions consignées.'},
  {id: 'rdv', text: 'Écrire les rendez-vous.', scope: {kind: 'rubrique', value: 'rendezvous-1'}, blocking: true, closes_when: 'Dix fiches complètes ou pénurie sourcée.'}];

test('remaining_items is optional and must mirror remaining exactly', () => {
  checkRemainingItems({remaining});
  checkRemainingItems({remaining, remaining_items: items()});
  assert.throws(() => checkRemainingItems({remaining, remaining_items: items().slice(1)}), /none lost/);
  const extra = [...items(), {...items()[0], id: 'other', text: 'Exigence inventée.'}];
  assert.throws(() => checkRemainingItems({remaining, remaining_items: extra}), /none lost/);
  const dup = items(); dup[1].id = dup[0].id;
  assert.throws(() => checkRemainingItems({remaining, remaining_items: dup}), /unique/);
  for (const mutate of [x => x.scope = {kind: 'day', value: 'dimanch'}, x => x.blocking = 'yes', x => x.closes_when = '', x => x.scope = {kind: 'other'}]) {
    const bad = items(); mutate(bad[0]); assert.throws(() => checkRemainingItems({remaining, remaining_items: bad}));
  }
  checkRemainingItems({remaining: [], remaining_items: []});
});

const lead = (extra = {}) => ({id: 'sl-1', title: 'Film', scope: {day: 'samedi'}, status: 'to_research',
  signals: [{kind: 'critique', note: 'Critique argumentée publiée.', source_url: 'https://example.org/critique'}], ...extra});

test('shortlist keeps sourced signals, motivated rejections and known alternatives', () => {
  checkShortlist({});
  checkShortlist({shortlist: {entries: [lead(), lead({id: 'sl-2', scope: {rubrique: 'replay-1'}, alternatives: ['sl-1']})]}});
  checkShortlist({shortlist: {entries: [lead({status: 'rejected', signals: [], decision_note: 'Réception non étayée après deux voies.'})]}});
  assert.throws(() => checkShortlist({shortlist: {entries: [lead({signals: [{kind: 'critique', note: 'sans source'}]})]}}), /sourced/);
  assert.throws(() => checkShortlist({shortlist: {entries: [lead({status: 'rejected', signals: []})]}}), /decision_note/);
  assert.throws(() => checkShortlist({shortlist: {entries: [lead({scope: {}})]}}), /scope/);
  assert.throws(() => checkShortlist({shortlist: {entries: [lead({status: 'ready'})]}}), /status/);
  assert.throws(() => checkShortlist({shortlist: {entries: [lead({alternatives: ['sl-9']})]}}), /alternative/);
  assert.throws(() => checkShortlist({shortlist: {entries: [lead(), lead()]}}), /unique/);
  assert.deepEqual(shortlistSummary({shortlist: {entries: [lead(), lead({id: 'b', status: 'card_drafted'})]}}).by_scope.samedi.card_drafted, 1);
});

test('run metric gaps are reported, never reconstructed', () => {
  assert.deepEqual(lastRunGaps({}), ['no run_metrics entry recorded']);
  const gaps = lastRunGaps({run_metrics: [{date: 'x', stop_reason: 'budget_near_limit'}]});
  assert(gaps.some(g => g.includes('prompt_revision')) && gaps.some(g => g.includes('never reconstruct')));
  assert(!gaps.some(g => g.includes('stop_reason')));
  const full = {prompt_revision: 'r', started_at: null, ended_at: null, duration_basis: 'unknown: tool has no clock', completed_batches: [],
    deliverables_changed: [], stop_reason: 'all_accessible_tasks_blocked', next_useful_batch: 'x'};
  assert.deepEqual(lastRunGaps({run_metrics: [full]}), []);
});

test('gap report exposes a checkpoint used as an unsupported terminal stop', () => {
  const run = {prompt_revision: 'production-shortlist-2026-10-08',
    started_at: '2026-10-09T07:02:51.000Z', ended_at: '2026-10-09T07:19:27.285Z',
    duration_basis: 'known checkpoint times; remote save excluded', completed_batches: ['dimanche', 'mardi'],
    deliverables_changed: ['data/weeks/2026-S42.json'],
    stop_reason: 'two_coherent_daily_batches_rendered_checked_and_ready_for_remote_save_before_active_work_limit',
    next_useful_batch: 'Construire les réserves puis achever lundi.'};
  const progress = {stage: 'enrichment', remaining: ['Réserves et lundi.'], run_metrics: [run]};
  assert(lastRunGaps(progress).length > 0);
  const report = buildReport({week: '2026-S42', from: '2026-10-10', sections: [], progress, results: []});
  assert(report.process.last_run_gaps.length > 0);
  assert.equal(report.gap_count, 0, 'a process warning must not introduce a publication requirement');
});

test('validation-context rejects an inconsistent remaining_items or unsourced shortlist', () => {
  const week = '2026-S42', manifest = JSON.stringify({latest: '2026-S41', weeks: [{week: '2026-S41', status: 'published'}]});
  const run = progress => validationContext('auto/' + week, p => p === 'data/manifest.json' ? manifest : p === `data/research/${week}.json` ? JSON.stringify(progress) : null,
    p => p === 'data/manifest.json' ? manifest : null, [`data/research/${week}.json`], '2026-10-08');
  const base = {schema_version: 1, week, stage: 'enrichment', remaining};
  assert.equal(run({...base, remaining_items: items()}).mode, 'preparation');
  assert.throws(() => run({...base, remaining_items: items().slice(0, 1)}), /none lost/);
  assert.throws(() => run({...base, shortlist: {entries: [lead({signals: []})]}}), /sourced/);
});

test('gap report classifies validator lines and states it does not certify', () => {
  const from = '2026-10-10', sections = ['rendezvous-1', 'replay-1', 'samedi-selection'];
  assert.deepEqual(classify('Missing reserve pool for lundi', {from, sections}), {kind: 'day', value: 'lundi'});
  assert.deepEqual(classify('2026-S42 publication gate: rendezvous-1 has 0 cards', {from, sections}), {kind: 'rubrique', value: 'rendezvous-1'});
  assert.deepEqual(classify('2026-10-11 missing required channels: arte', {from, sections}), {kind: 'coverage', value: 'dimanche'});
  assert.deepEqual(classify('2026-S42 publication gate: hero image missing', {from, sections}), {kind: 'deliverable', value: null});
  assert.equal(parseProblems('✓ ok\n✗ a\n! b\n✗ Candidate publication gate failed: 2 problem(s)').length, 2);
  const report = buildReport({week: '2026-S42', from, sections, progress: {remaining},
    results: [{validator: 'validate-editorial', status: 1, output: '✗ Missing reserve pool for lundi'}, {validator: 'validate-links', status: 1, output: 'crash'}]});
  assert.equal(report.gap_count, 2);
  assert.match(report.notice, /NON CERTIFIANT/);
  assert.match(markdown(report), /require-ready/);
  assert.equal(buildReport({week: '2026-S42', from, sections, progress: null, results: []}).gap_count, 0);
});
