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
test('episode-scoped and version-only pauses do not suppress other broadcasts', () => {
  const input=fixture();
  input.inventory.days[0].items.push({title:'Un crime dans la tête',channel:'Ciné+ Classic',start:'23:00'});
  input.research.research_attempts=[{object:{title:'Un crime dans la tête',date:'2026-10-10',channel:'Ciné+ Classic',start:'20:50'},status:'paused_conflict'}];
  assert.equal(buildWorkPacket(input).catalogue_leads[0].observations,1);
  input.research.research_attempts[0].object={title:'Un crime dans la tête',version:'1962 original'};
  assert.equal(buildWorkPacket(input).catalogue_leads[0].observations,2);
});
test('aliases recover saved title-array evidence and links without claiming identity', () => {
  const input=fixture();
  input.works.works=[{id:'one',title:'Un crime dans la tête',aliases:['The Manchurian Candidate']}];
  input.coverage.documentary_discovery.candidates=[{title:'The Manchurian Candidate',critical_evidence:[{checked_at:'2026-08-01'}]}];
  input.coverage.cinema_official_broadcast_observations=[{title:'The Manchurian Candidate',comparison:'conflict',note:'Event does not identify channel'}];
  input.links.links['The Manchurian Candidate']={imdb:'https://exact.test/'};
  const record={applies_to:{titles:['The Manchurian Candidate','Other']},status:'conflict',checked_at:'2026-08-01'};
  input.research.verification_records=[record];
  const p=buildWorkPacket(input,{title:'The Manchurian Candidate'});
  assert.equal(p.work.schedule_observations.length,1);
  assert.deepEqual(p.work.verification_records,[record]);
  assert.equal(p.work.research_dossiers.length,1);
  assert.deepEqual(p.work.official_broadcast_observations,input.coverage.cinema_official_broadcast_observations);
  assert.equal(p.work.exact_link_records.length,1);
  assert.equal(p.work.identity_status,'catalogue_lead_needs_confirmation');
});
test('schedule and unstructured evidence remain separate from exact work verification', () => {
  const input=fixture();
  const grid={applies_to:{week:'2026-S42',channel:'Ciné+ Classic',grid_date:'2026-10-10'},status:'verified'};
  const group={applies_to:{week:'2026-S42',channels:['Ciné+ Classic']},status:'needs_check'};
  const otherDate={applies_to:{week:'2026-S42',channel:'Ciné+ Classic',date:'2026-10-11'},status:'verified'};
  const otherCycle={applies_to:{week:'2026-S41',channel:'Ciné+ Classic'},status:'verified'};
  const text={applies_to:'Un crime dans la tête diffusé sur Ciné+ Classic',status:'conflict'};
  input.research.verification_records=[grid,group,otherDate,otherCycle,text];
  const p=buildWorkPacket(input,{title:'Un crime dans la tête'});
  assert.deepEqual(p.work.verification_records,[]);
  assert.deepEqual(p.work.supporting_schedule_records,[grid,group]);
  assert.deepEqual(p.work.unstructured_applicability_records,[text]);
  assert.equal(p.publication_ready,false);
});
test('pagination makes every catalogue lead reachable and compact packets only omit global remaining', () => {
  const input=fixture();
  input.works.works=Array.from({length:15},(_,i)=>({id:'w'+i,title:'Title '+String(i).padStart(2,'0')}));
  input.inventory.days[0].items=input.works.works.map(work=>({title:work.title}));
  const first=buildWorkPacket(input,{limit:12}),second=buildWorkPacket(input,{limit:12,offset:12});
  assert.equal(first.catalogue_lead_next_offset,12);
  assert.equal(second.catalogue_lead_next_offset,null);
  assert.equal(new Set([...first.catalogue_leads,...second.catalogue_leads].map(item=>item.title)).size,15);
  const full=buildWorkPacket(input,{title:'Title 00'}),compact=buildWorkPacket(input,{title:'Title 00',compact:true});
  assert.deepEqual(full.work,compact.work);
  assert.equal(compact.remaining_count,1);
  assert.equal(compact.remaining,undefined);
  assert.equal(compact.remaining_omitted,true);
  assert.throws(()=>buildWorkPacket(input,{offset:-1}),/offset/);
});
test('history distinguishes prior public, daily reserve and occurrence fallback with validator semantics', () => {
  const input=fixture();
  input.works.works[0].occurrences=[{week:'S40'}];
  input.historicalIssues=[
    {entry:{week:'2026-S41',short:'S41'},issue:{pages:[{id:'samedi-selection',html:'<h3>Un crime dans la tête</h3>'}],personalization:{pools:{'dimanche-selection':{target:1,candidates:[{title:'Main',rank:1},{title:'Reserve',rank:2}]},'platform-reserve':{target:0,candidates:[{title:'Ignore platform pool',rank:1}]}}}}},
    {entry:{week:'2026-S40',short:'S40'},issue:{pages:[]}}
  ];
  const p=buildWorkPacket(input,{title:'Un crime dans la tête'});
  assert.deepEqual(p.work.requested_title_historical_exposure,[{week:'2026-S41',scopes:['public']},{week:'2026-S40',scopes:['catalogue_occurrence_fallback']}]);
  assert.deepEqual(buildWorkPacket(input,{title:'Reserve'}).work.requested_title_historical_exposure,[{week:'2026-S41',scopes:['daily_reserve']}]);
  assert.deepEqual(buildWorkPacket(input,{title:'Ignore platform pool'}).work.requested_title_historical_exposure,[]);
  assert.equal(p.publication_ready,false);
});
test('historical HTML decodes apostrophes, quotes and ampersands once before comparing plain titles', () => {
  const input=fixture();
  input.historicalIssues=[{entry:{week:'2026-S41'},issue:{pages:[
    {id:'samedi-selection',html:'<h3>Les mots qu&#39;elles eurent un jour</h3><h3>&quot;Gomorra&quot;, manifeste antimafia</h3><h3>Tom &amp; Jerry</h3>'},
    {id:'dimanche-grille',html:'<td class="prog">Bob &amp;amp; Alice</td><td class="prog">&lt;3</td>'}
  ]}}];
  for(const title of ["Les mots qu'elles eurent un jour",'"Gomorra", manifeste antimafia','Tom & Jerry','Bob &amp; Alice','<3']){
    assert.deepEqual(buildWorkPacket(input,{title}).work.requested_title_historical_exposure,[{week:'2026-S41',scopes:['public']}],title);
  }
  assert.deepEqual(buildWorkPacket(input,{title:'Bob & Alice'}).work.requested_title_historical_exposure,[],'do not decode twice');
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
