import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildWorkPacket, packetFromGit} from './editorial-work-packet.mjs';

const fixture = () => ({week: '2026-S42', sha: 'a'.repeat(40),
  research: {week: '2026-S42', remaining: ['Certifier les grilles'], verification_records: []},
  inventory: {week: '2026-S42', days: [{date:'2026-10-10', items:[{title:'Un crime dans la tête',channel:'Ciné+ Classic',start:'20:50',source_url:'https://guide.test/'}]}]},
  coverage: {week:'2026-S42', full_week_reaudit_completed:false, documentary_discovery:{candidates:[]}},
  works:{works:[{id:'original',title:'Un crime dans la tête',year:1962},{id:'remake',title:'Un crime dans la tête',year:2004}]},
  links:{links:{}}, manifest:{latest:'2026-S41'}, files:[]});

test('same-title remakes stay ambiguous, with no automatic identity or reuse', () => {
  const input=fixture(), snapshot=structuredClone(input);
  const p=buildWorkPacket(input,{title:'Un crime dans la tête'});
  assert.equal(p.work.identity_status,'ambiguous_catalogue_matches');
  assert.deepEqual(p.work.canonical_candidates.map(w=>w.id),['original','remake']);
  assert.equal(p.publication_ready,false);
  assert.equal(p.work.no_automatic_reuse,true);
  assert.deepEqual(input,snapshot);
});
test('old notes/provenance and conflicts are preserved verbatim, not refreshed', () => {
  const input=fixture();
  const record={work_id:'original',checked_at:'2026-08-01',status:'conflict',stability:'dynamic',fields:['ratings'],source_urls:['https://source.test/'],evidence_note:'Other version'};
  input.research.verification_records.push(record);
  const p=buildWorkPacket(input,{title:'Un crime dans la tête'});
  assert.deepEqual(p.work.verification_records,[record]);
  assert.equal(p.stage,null);
  assert.deepEqual(p.remaining,['Certifier les grilles']);
});
test('paused candidate is not offered as a catalogue lead and still retains its blocking scope', () => {
  const input=fixture();
  input.research.research_attempts=[{id:'conflict',object:{title:'Un crime dans la tête'},status:'paused_conflict',blocking_scope:'Coverage still unresolved',resume_condition:'Official correction'}];
  const p=buildWorkPacket(input);
  assert.equal(p.catalogue_lead_count,0);
  assert.equal(p.paused_or_excluded[0].blocking_scope,'Coverage still unresolved');
  assert.equal(p.coverage.full_week_reaudit_completed,false);
  assert.deepEqual(p.remaining,['Certifier les grilles']);
});
test('completed dossier is separated from a publication-ready card; unknown title does not invent one', () => {
  const input=fixture();
  input.coverage.documentary_discovery.candidates=[{title:'Thorin',dossier_completeness:{status:'complete_for_editorial_comparison',not_yet_publication_ready:['work_id','textes']}}];
  const p=buildWorkPacket(input);
  assert.deepEqual(p.completed_research_dossiers[0].publication_work_remaining,['work_id','textes']);
  assert.equal(p.publication_ready,false);
  assert.equal(buildWorkPacket(input,{title:'Unknown'}).work.found,false);
  assert.throws(()=>buildWorkPacket({...input,coverage:{week:'2026-S43'}}),/another week/);
});
test('excluding one territorial offer does not hide other schedule leads for the same film', () => {
  const input=fixture();
  input.research.research_attempts=[{id:'offer',object:{title:'Un crime dans la tête'},status:'excluded_current_offer',blocking_scope:'This offer excludes France'}];
  const p=buildWorkPacket(input);
  assert.equal(p.catalogue_lead_count,1);
  assert.equal(p.paused_or_excluded[0].blocking_scope,'This offer excludes France');
  assert.equal(p.catalogue_leads_are_recommendations,false);
});
test('git packet uses requested immutable ref, leaves files unchanged and rejects malformed checkpoints', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-packet-'));
  const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try {
    git(['init','-q']);git(['config','user.name','fixture']);git(['config','user.email','fixture@example.test']);
    const input=fixture();
    for(const [name,content]of Object.entries({'research/2026-S42':input.research,'inventory/2026-S42':input.inventory,'coverage/2026-S42':input.coverage,'manifest':input.manifest,'works':input.works})){
      const file=path.join(dir,'data',name+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(content));
    }
    git(['add','.']);git(['commit','-qm','checkpoint']);const sha=git(['rev-parse','HEAD']).trim();
    const file=path.join(dir,'data/research/2026-S42.json');fs.writeFileSync(file,'{"week":"2026-S43"}');
    const before=git(['status','--porcelain']);
    const p=packetFromGit('2026-S42',sha,{},dir);
    assert.equal(p.source_sha,sha);assert.deepEqual(p.remaining,['Certifier les grilles']);
    assert.equal(git(['status','--porcelain']),before);
    assert.throws(()=>packetFromGit('2026-S42','--help',{},dir),/invalid ref/);
    fs.writeFileSync(file,'bad json');git(['add','.']);git(['commit','-qm','broken']);
    assert.throws(()=>packetFromGit('2026-S42','HEAD',{},dir),SyntaxError);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
