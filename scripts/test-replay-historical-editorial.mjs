import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {frozenSnapshot,historicalDecisions,replaySnapshot,writeReplay} from './replay-historical-editorial.mjs';

// The immutable real fixture must not change when later weeks enrich the catalogue.
const snapshot = frozenSnapshot('2026-S41','2c661aaf235903f4a98ffc02e115ca7864892bb9');
const original = JSON.stringify(snapshot.issue);
const report = replaySnapshot(snapshot,{checked_at:'2026-10-08'});

test('real S41 preserves full issue, every pool/radar rank and frozen dates', () => {
  assert.equal(report.simulation,true); assert.equal(report.archive.page_count,26);
  assert.equal(report.new_source_consultations,0); assert.equal(report.publication_ready,false);
  assert.equal(report.certifies_s42,false); assert.equal(report.archive.original_consultation_markers.coverage_rebuilt,'2026-09-27');
  assert.equal(Object.values(report.archive.pools).reduce((sum,p) => sum+p.candidates,0),86);
  assert.equal(Object.entries(report.archive.pools).filter(([id]) => id.endsWith('-selection')).reduce((sum,[,p]) => sum+p.candidates,0),66);
  assert.equal(Object.values(report.archive.radar_candidates).reduce((a,b) => a+b,0),20);
  assert.equal(report.strict.attempted,128);
  const records = historicalDecisions(snapshot);
  for (const [page,pool] of Object.entries(snapshot.issue.personalization.pools)) {
    const replayed = records.filter(r => r.source.includes(`/pools/${page}/`));
    assert.deepEqual(replayed.map(r => r.source_rank),pool.candidates.map(c => c.rank));
    assert.deepEqual(replayed.map(r => r.candidate.summary),pool.candidates.map(c => c.summary));
    assert.deepEqual(replayed.map(r => r.candidate.why),pool.candidates.map(c => c.why));
  }
  assert.equal(JSON.stringify(snapshot.issue),original,'source JSON must remain unchanged');
});

test('strict replay keeps actual gaps, real grid copy and explicitly technical reviews', () => {
  const leSamourai = report.strict.probes.find(p => p.candidate.work_id === 'le-samourai-1967');
  assert.equal(leSamourai.status,'rejected'); assert.match(leSamourai.error,/ratings_checked/);
  const jardin = report.strict.probes.find(p => p.page === 'samedi-selection' && p.candidate.title === 'Le Jardin des Finzi-Contini');
  assert.equal(jardin.status,'rendered'); assert.equal(jardin.source_rank,4); assert.equal(jardin.technical_position,1);
  assert(jardin.pages.some(p => p.id === 'samedi-grille'),'actual grid reason is re-rendered');
  assert.equal(jardin.technical_review.checked_at,'2026-10-08');
  for (const field of ['identity_version','canonical_fields','current_broadcast','editorial_copy']) assert.match(jardin.technical_review[field],/aucune nouvelle consultation/);
  const physical = report.strict.probes.find(p => p.page === 'sorties-physiques' && p.candidate.release_url);
  assert.equal(physical.candidate.release.url,physical.candidate.release_url);
  assert.equal(physical.candidate.release.date,physical.candidate.release_date);
  assert(!physical.missing_structured_fields.includes('release.date'));
  assert(physical.missing_structured_fields.includes('release.checked_at'),'overall updated date must not become a release consultation');
  const hamnet = report.strict.probes.find(p => p.page === 'plateformes-abonnement' && p.candidate.title === 'Hamnet');
  assert.equal(hamnet.candidate.frozen_display_facts.service,'CANAL+');
  assert.equal(hamnet.candidate.frozen_display_facts.arrival_or_release,'6 octobre');
  assert(hamnet.missing_structured_fields.includes('offer.checked_at'));
});

test('simulation writes exact original sources and previews, never a production handoff', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'s41-replay-test-'));
  const output = path.join(temporary,'result');
  try {
    writeReplay(snapshot,report,output);
    for (const [file,content] of snapshot.files) assert.equal(fs.readFileSync(path.join(output,'frozen',file),'utf8'),content);
    const preview = fs.readFileSync(path.join(output,'archive-preview.html'),'utf8');
    assert.match(preview,/SIMULATION HISTORIQUE LOCALE/); assert.equal((preview.match(/<section id=/g) || []).length,26);
    const strict = fs.readFileSync(path.join(output,'strict-preview.html'),'utf8');
    assert.match(strict,/Structure compatible seulement/); assert.match(strict,/rang historique 4, position technique 1/);
    assert(!fs.readdirSync(output).some(name => /handoff|bundle|attestation/.test(name)));
    assert.throws(() => writeReplay(snapshot,report,output),/new empty output/);
    assert.throws(() => writeReplay(snapshot,report,path.join(process.cwd(),'simulation-output')),/outside the source repository/);
    const linked = path.join(temporary,'linked-repository-scripts');
    fs.symlinkSync(path.join(process.cwd(),'scripts'),linked,'dir');
    assert.throws(() => writeReplay(snapshot,report,path.join(linked,'simulation-output')),/outside the source repository/);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
