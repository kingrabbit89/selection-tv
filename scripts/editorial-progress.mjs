import assert from 'node:assert/strict';
import {auditRecordedRun} from './editorial-continuation.mjs';

// Optional working structures of data/research/YYYY-Sxx.json. They organise
// production; they never certify a requirement, a card or a publication.

export const days = ['samedi', 'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
export const shortlistStatuses = ['to_research', 'researching', 'dossier_complete', 'card_drafted', 'card_complete', 'rejected', 'deferred'];
export const runMetricFields = ['prompt_revision', 'started_at', 'ended_at', 'duration_basis', 'completed_batches',
  'deliverables_changed', 'stop_reason', 'next_useful_batch'];
const array = value => Array.isArray(value) ? value : [];
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;

// remaining stays the authoritative string array. remaining_items, when
// present, must describe exactly the same requirements: none lost or invented.
export function checkRemainingItems(progress) {
  if (progress.remaining_items === undefined) return;
  const items = progress.remaining_items;
  assert(Array.isArray(items), 'remaining_items must be an array');
  const ids = new Set();
  for (const item of items) {
    assert(item && typeof item === 'object', 'remaining_items entries must be objects');
    assert(nonEmpty(item.id) && !ids.has(item.id), 'remaining_items need unique ids'); ids.add(item.id);
    assert(nonEmpty(item.text), 'remaining_items text missing: ' + item.id);
    assert(['global', 'coverage', 'day', 'rubrique', 'deliverable', 'candidate'].includes(item.scope?.kind), 'invalid remaining_items scope: ' + item.id);
    if (item.scope.kind === 'day') assert(days.includes(item.scope.value), 'invalid remaining_items day: ' + item.id);
    else if (item.scope.kind !== 'global') assert(nonEmpty(item.scope.value), 'remaining_items scope value missing: ' + item.id);
    assert(typeof item.blocking === 'boolean', 'remaining_items blocking must be boolean: ' + item.id);
    assert(nonEmpty(item.closes_when), 'remaining_items closes_when missing: ' + item.id);
  }
  const texts = items.map(item => item.text).sort();
  assert.deepEqual(texts, [...array(progress.remaining)].sort(),
    'remaining_items must describe exactly the remaining requirements (none lost, none added)');
}

// A revisable shortlist orients research. Each kept lead carries at least one
// verifiable editorial signal; a rejection keeps its motive.
export function checkShortlist(progress) {
  if (progress.shortlist === undefined) return;
  const shortlist = progress.shortlist;
  assert(shortlist && typeof shortlist === 'object' && Array.isArray(shortlist.entries), 'shortlist.entries must be an array');
  const ids = new Set(shortlist.entries.map(entry => entry?.id));
  assert.equal(ids.size, shortlist.entries.length, 'shortlist ids must be unique');
  for (const entry of shortlist.entries) {
    assert(nonEmpty(entry.id) && nonEmpty(entry.title), 'shortlist entry needs id and title');
    const scope = entry.scope || {};
    assert(days.includes(scope.day) || nonEmpty(scope.rubrique), 'shortlist scope needs a day or a rubrique: ' + entry.id);
    assert(shortlistStatuses.includes(entry.status), 'invalid shortlist status: ' + entry.id);
    if (entry.status === 'rejected' || entry.status === 'deferred') assert(nonEmpty(entry.decision_note), 'shortlist decision_note required: ' + entry.id);
    else assert(array(entry.signals).some(signal => nonEmpty(signal?.kind) && nonEmpty(signal?.note) && /^https?:\/\//.test(signal?.source_url || '')),
      'shortlist entry needs a sourced editorial signal: ' + entry.id);
    for (const other of array(entry.alternatives)) assert(ids.has(other), 'unknown shortlist alternative: ' + entry.id + ' -> ' + other);
  }
}

export function checkProgressStructures(progress) {
  checkRemainingItems(progress);
  checkShortlist(progress);
}

// Informative only: missing fields and unsupported recorded stop decisions.
// This never certifies editorial work or changes the publication gate.
export function lastRunGaps(progress) {
  const run = array(progress.run_metrics).at(-1);
  if (!run) return ['no run_metrics entry recorded'];
  const missing = runMetricFields.filter(field => run[field] === undefined || run[field] === '' ||
    (field === 'deliverables_changed' && !Array.isArray(run[field])))
    .map(field => 'last run_metrics entry lacks ' + field + (field === 'started_at' || field === 'ended_at' ? ' (record null with a reason if unknown; never reconstruct it)' : ''));
  return [...missing, ...auditRecordedRun(run, progress)];
}

export function shortlistSummary(progress) {
  const entries = array(progress.shortlist?.entries);
  const groups = {};
  for (const entry of entries) {
    const key = entry.scope?.day || entry.scope?.rubrique || 'unscoped';
    groups[key] ??= Object.fromEntries(shortlistStatuses.map(status => [status, 0]));
    groups[key][entry.status] = (groups[key][entry.status] || 0) + 1;
  }
  return {entries: entries.length, by_scope: groups};
}
