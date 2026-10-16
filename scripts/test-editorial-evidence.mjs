import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRecordErrors, compactEvidenceGaps, isCompactRecord, normalizeEvidenceRecord} from './editorial-evidence.mjs';
import {buildProductionPlan} from './editorial-production-plan.mjs';
import {buildWorkPacket} from './editorial-work-packet.mjs';
import {buildReport, markdown} from './preparation-gaps.mjs';

const SHA = 'a'.repeat(40), WEEK = '2026-S42', PDF = 'sha256:' + 'b'.repeat(64);
const compact = (extra = {}) => ({work_id: 'film-1962', url: 'https://www.imdb.com/title/tt0000001/',
  checked_at: '2026-10-08T09:12:00Z', field: 'director', result: 'verified', value: 'Une réalisatrice', ...extra});

test('a compact record states url, real check time, field and result', () => {
  assert(isCompactRecord(compact()));
  assert.deepEqual(compactRecordErrors(compact()), []);
  assert.deepEqual(compactRecordErrors(compact({url: PDF + '#page=12', field: 'broadcast.start', value: '20:50',
    work_id: undefined, applies_to: {date: '2026-10-10', channel: 'Arte', start: '20:50'}})), []);
  assert.deepEqual(compactRecordErrors(compact({result: 'unavailable', value: undefined, note: 'Replay retiré le 7 octobre.'})), []);
  const bad = [
    [{url: 'www.imdb.com/title/tt0000001/'}, /url/], [{url: PDF}, /url/], [{url: 'https://www.google.com/search?q=x y'}, /url/],
    [{checked_at: '2026-10-08'}, /checked_at/], [{checked_at: 'hier'}, /checked_at/],
    [{field: ' '}, /field/], [{result: 'ok'}, /result/], [{work_id: undefined}, /work_id, title/],
    [{result: 'corrected', value: undefined}, /observed value/], [{result: 'contradicted', value: ''}, /observed value/],
    [{value: {director: 'x'}}, /scalar/], [{value: 'x'.repeat(301)}, /value exceeds/],
    [{note: 'x'.repeat(281)}, /note/], [{stability: 'dynamic'}, /stability/]];
  for (const [extra, pattern] of bad) {
    const errors = compactRecordErrors(compact(extra));
    assert(errors.some(error => pattern.test(error)), JSON.stringify(extra) + ' -> ' + errors.join(' | '));
  }
  assert.deepEqual(compactRecordErrors(compact({work_id: undefined, title: 'Un film'})), []);
});

test('evidence gaps cover compact records only; legacy prose records stay untouched', () => {
  const legacy = {title: 'Un film', fields: ['director'], urls: ['https://x.test/'], checked_at: '2026-08-01',
    status: 'verified', evidence_note: 'Longue note historique conservée telle quelle.'};
  const progress = {verification_records: [legacy, compact(), compact({checked_at: '2026-10-08'}), compact({result: 'maybe'})]};
  const gaps = compactEvidenceGaps(progress);
  assert(gaps.every(gap => /^verification_records\[(2|3)\]/.test(gap)), gaps.join(' | '));
  assert.equal(gaps.length, 2);
  assert.deepEqual(compactEvidenceGaps({}), []);
});

test('normalisation gives the planning tools their legacy fields without changing the stored record', () => {
  const record = compact(), before = structuredClone(record);
  const view = normalizeEvidenceRecord(record);
  assert.deepEqual(record, before);
  assert.deepEqual(view.fields, ['director']);
  assert.deepEqual(view.source_urls, [record.url]);
  assert.equal(view.status, 'verified');
  assert.equal(view.stability, 'stable');
  assert.equal(normalizeEvidenceRecord(compact({field: 'broadcast.start'})).stability, 'cycle_specific');
  assert.equal(normalizeEvidenceRecord(compact({field: 'ratings.imdb', stability: 'stable'})).stability, 'stable');
  assert.equal(normalizeEvidenceRecord(compact({result: 'corrected'})).status, 'verified_corrected');
  assert.equal(normalizeEvidenceRecord(compact({result: 'contradicted'})).status, 'contradicted');
  const legacy = {title: 'Un film', fields: ['director'], urls: ['https://x.test/'], status: 'verified'};
  assert.deepEqual(normalizeEvidenceRecord(legacy).source_urls, ['https://x.test/']);
  const explicit = {...legacy, source_urls: ['https://y.test/']};
  assert.equal(normalizeEvidenceRecord(explicit), explicit);
});

const work = {id: 'film-1962', title: 'Un film', aliases: [], director: 'Une réalisatrice', year: 1962, country: 'France',
  genre: 'Drame', duration: '100 min', image: 'https://images.example/exact.jpg', ratings: {imdb: '7/10'},
  links: {imdb: 'https://www.imdb.com/title/tt0000001/'}};
const context = records => ({week: WEEK, sha: SHA, from: '2026-10-10', inventory: {week: WEEK, days: []}, coverage: {week: WEEK},
  research: {week: WEEK, verification_records: records, research_dossiers: [], research_attempts: [], remaining: ['Revue finale']},
  works: {works: [work]}, links: {links: {}}, currentissue: {week: WEEK, pages: [], personalization: {pools: {}}}, historicalissues: []});
const observation = {title: 'Un film', date: '2026-10-10', start: '20:50', channel: 'Arte'};
const planItem = records => buildProductionPlan(context(records), {observations: [observation], limit: 50}).queue[0];

test('the production plan reads compact records like verified legacy evidence', () => {
  const identity = compact({field: 'director'}), year = compact({field: 'year', value: 1962});
  const item = planItem([identity, year]);
  assert.equal(item.saved_verification_records.length, 2);
  const saved = item.saved_verification_records[0];
  assert.deepEqual(saved.fields, ['director']);
  assert.deepEqual(saved.source_urls, [identity.url]);
  assert.equal(saved.status, 'verified');
  assert.equal(saved.result, 'verified');
  assert.equal(saved.value, 'Une réalisatrice');
  assert.equal(saved.provenance.json_pointer, '/verification_records/0');
  assert.equal(item.cached_facts.find(fact => fact.field === 'director').evidence[0].checked_at, identity.checked_at);
  assert(!item.dynamic_requirements.includes('review_saved_field_provenance:director'));
  assert(!item.dynamic_requirements.includes('review_saved_field_provenance:year'));
  assert(item.dynamic_requirements.includes('editorial_selection_and_card_review'), 'saved evidence never selects or completes a card');
});

test('a contradicted compact record raises a conflict; another broadcast scope keeps it out', () => {
  const contradicted = compact({field: 'broadcast.start', result: 'contradicted', value: '21:00',
    applies_to: {date: '2026-10-10', channel: 'Arte', start: '20:50'}});
  assert(planItem([contradicted]).conflicting_requirements.includes('resolve_saved_conflict:broadcast.start'));
  const otherDay = {...contradicted, applies_to: {date: '2026-10-11', channel: 'Arte', start: '20:50'}};
  const item = planItem([otherDay]);
  assert.equal(item.saved_verification_records.length, 0);
  assert(!item.conflicting_requirements.includes('resolve_saved_conflict:broadcast.start'));
});

test('legacy records saved with urls now expose them to the plan', () => {
  const legacy = {title: 'Un film', fields: ['director'], urls: ['https://identity.example'], stability: 'stable',
    status: 'verified', checked_at: '2026-10-08T09:00:00Z', applies_to: 'Identité vérifiée.'};
  const item = planItem([legacy]);
  assert.deepEqual(item.saved_verification_records[0].source_urls, ['https://identity.example']);
  assert(!item.dynamic_requirements.includes('review_saved_field_provenance:director'));
});

test('the work packet returns compact records as stored for the requested work', () => {
  const record = compact();
  const packet = buildWorkPacket({week: WEEK, sha: SHA, research: {week: WEEK, remaining: ['x'], verification_records: [record, compact({work_id: 'other'})]},
    inventory: {week: WEEK, days: []}, coverage: {week: WEEK}, works: {works: [work]}, links: {links: {}}, manifest: {latest: '2026-S41'}, files: []},
  {title: 'Un film'});
  assert.deepEqual(packet.work.verification_records, [record]);
});

test('the gap report lists malformed compact evidence without adding a publication gap', () => {
  const progress = {week: WEEK, remaining: ['x'], verification_records: [compact({checked_at: '2026-10-08'})]};
  const report = buildReport({week: WEEK, from: '2026-10-10', sections: [], progress, results: []});
  assert.equal(report.process.evidence_gaps.length, 1);
  assert.equal(report.gap_count, 0);
  assert.match(markdown(report), /Preuve compacte : verification_records\[0\]: checked_at/);
});
