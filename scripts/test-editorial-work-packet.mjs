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

const batchFixture = () => {
  const input = fixture();
  input.works.works.push({id:'ghost',title:'A Ghost Story',aliases:['Une histoire de fantôme'],year:2017});
  input.inventory.days[0].items.push({title:'Une histoire de fantôme',channel:'Ciné+ Classic',start:'23:00',version:'TCM copy'});
  input.links.links['Un crime dans la tête']={official:'https://original.test/'};
  input.links.links['Une histoire de fantôme']={imdb:'https://ghost.test/'};
  input.research.verification_records=[
    {work_id:'original',checked_at:'2026-08-01',status:'conflict',fields:['version'],source_urls:['https://original.test/'],evidence_note:'1962 copy unresolved'},
    {work_id:'remake',checked_at:'2026-08-02',status:'verified',fields:['director'],source_urls:['https://remake.test/']},
    {applies_to:{title:'Une histoire de fantôme'},checked_at:'2026-08-03',status:'unavailable',fields:['replay'],source_urls:['https://ghost.test/']},
    {applies_to:{week:'2026-S42',channel:'Ciné+ Classic',date:'2026-10-10'},checked_at:'2026-08-04',status:'needs_check'},
    {applies_to:'A Ghost Story version uncertain',checked_at:'2026-08-05',status:'conflict'},
    {work_id:'unrelated',checked_at:'2026-08-06',status:'verified'}
  ];
  input.coverage.documentary_discovery.candidates=[
    {title:'Un crime dans la tête',critical_evidence:[{checked_at:'2026-08-07',access:'partial'}]},
    {title:'Une histoire de fantôme',critical_evidence:[{checked_at:'2026-08-08',assessment:'Contradictory reception'}]}
  ];
  input.coverage.cinema_official_broadcast_observations=[{work_id:'original',comparison:'conflict',note:'Channel absent'}];
  input.research.research_attempts=[{id:'ghost-offer',object:{title:'A Ghost Story',offer:'France'},status:'paused_offer',blocking_scope:'Only this offer',resume_condition:'New exact offer'}];
  input.historicalIssues=[{entry:{week:'2026-S41'},issue:{pages:[{id:'samedi-selection',html:'<h3>Un crime dans la tête</h3><h3>A Ghost Story</h3>'}]}}];
  return input;
};

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
test('batch shares context while preserving each title’s exact evidence, ambiguity and history', () => {
  const input=batchFixture(), snapshot=structuredClone(input);
  const titles=['A Ghost Story','Un crime dans la tête'];
  const batch=buildWorkPacket(input,{titles});
  assert.deepEqual(batch.works,titles.map(title=>buildWorkPacket(input,{title}).work));
  assert.deepEqual(batch.works.map(work=>work.requested_title),titles,'requested order is retained, not ranked');
  assert.equal(batch.works[1].identity_status,'ambiguous_catalogue_matches');
  assert.deepEqual(batch.works[1].canonical_title_historical_exposure.map(row=>row.work_id),['original','remake']);
  assert.equal(batch.works[0].verification_records[0].checked_at,'2026-08-03');
  assert.equal(batch.works[0].research_attempts[0].blocking_scope,'Only this offer');
  assert.equal(batch.works[0].supporting_schedule_records[0].status,'needs_check');
  assert.equal(batch.works[0].unstructured_applicability_records[0].status,'conflict');
  assert.equal(batch.work,undefined);
  assert.equal(batch.catalogue_leads,undefined);
  assert.equal(batch.researched_dossier_index,undefined);
  assert.deepEqual(batch.remaining,['Certifier les grilles']);
  for(const work of batch.works){
    assert.equal(work.no_automatic_reuse,true);
    assert.equal(work.remaining,undefined,'global requirements appear only once');
    assert.equal(work.freshness_context,undefined,'shared history context appears only once');
  }
  assert.equal(batch.publication_ready,false);
  assert.deepEqual(input,snapshot);
  const compact=buildWorkPacket(input,{titles,compact:true});
  assert.deepEqual(compact.works,batch.works);
  assert.equal(compact.remaining,undefined);
  assert.equal(compact.remaining_count,1);
});
test('one-title lists preserve single-title output and bounded batches never resolve unknown works', () => {
  const input=batchFixture();
  for(const compact of [false,true]){
    assert.deepEqual(buildWorkPacket(input,{titles:['Un crime dans la tête'],compact}),
      buildWorkPacket(input,{title:'Un crime dans la tête',compact}));
  }
  const titles=Array.from({length:8},(_,i)=>'Unknown '+i);
  const batch=buildWorkPacket(input,{titles});
  assert.deepEqual(batch.works.map(work=>work.requested_title),titles);
  assert(batch.works.every(work=>work.found===false&&work.identity_status==='no_catalogue_match'));
  assert.deepEqual(batch.remaining,['Certifier les grilles']);
  assert.throws(()=>buildWorkPacket(input,{titles:[...titles,'Ninth']}),/1\.\.8/);
  assert.throws(()=>buildWorkPacket(input,{titles:[]}),/1\.\.8/);
  assert.throws(()=>buildWorkPacket(input,{titles:['']}),/nonempty/);
  assert.throws(()=>buildWorkPacket(input,{title:'A',titles:['B']}),/not both/);
});
test('batch Git extraction reads one resolved snapshot even if the requested ref moves', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-packet-batch-'));
  const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const write=(name,content)=>{const file=path.join(dir,'data',name+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(content));};
  try {
    git(['init','-q']);git(['config','user.name','fixture']);git(['config','user.email','fixture@example.test']);
    const input=batchFixture();
    for(const [name,content]of Object.entries({'research/2026-S42':input.research,'inventory/2026-S42':input.inventory,'coverage/2026-S42':input.coverage,'manifest':input.manifest,'works':input.works,'links':input.links}))write(name,content);
    git(['add','.']);git(['commit','-qm','old evidence']);const sha=git(['rev-parse','HEAD']).trim();
    git(['branch','moving',sha]);
    input.research.verification_records=[];write('research/2026-S42',input.research);
    input.works.works=[];write('works',input.works);
    git(['add','.']);git(['commit','-qm','new evidence']);const newer=git(['rev-parse','HEAD']).trim();
    write('coverage/2026-S42',{week:'2026-S43'});
    const before=git(['status','--porcelain']);
    const calls=[];
    const runGit=args=>{
      calls.push([...args]);
      const output=git(args);
      if(args[0]==='rev-parse'&&args.includes('moving^{commit}'))git(['update-ref','refs/heads/moving',newer]);
      return output;
    };
    const packet=packetFromGit('2026-S42','moving',{titles:['Un crime dans la tête','A Ghost Story']},dir,runGit);
    assert.equal(calls.filter(args=>args[0]==='rev-parse').length,1);
    assert.equal(calls.filter(args=>args[0]==='ls-tree').length,1);
    const shows=calls.filter(args=>args[0]==='show').map(args=>args[1]);
    assert(shows.every(ref=>ref.startsWith(sha+':')),'every read uses the one resolved SHA');
    assert.equal(new Set(shows).size,shows.length,'each data file is read at most once for the batch');
    assert.equal(git(['rev-parse','moving']).trim(),newer,'test moved the ref after resolution');
    assert.equal(packet.source_sha,sha);
    assert.deepEqual(packet.works.map(work=>work.canonical_candidates.length),[2,1]);
    assert.equal(packet.works[0].verification_records[0].checked_at,'2026-08-01');
    assert.equal(packet.works[1].verification_records[0].checked_at,'2026-08-03');
    assert.equal(git(['status','--porcelain']),before);
    const cli=path.resolve('scripts/editorial-work-packet.mjs');
    const one=execFileSync(process.execPath,[cli,'2026-S42','--ref',sha,'--title','Un crime dans la tête','--compact'],{cwd:dir,encoding:'utf8'});
    assert.equal(one.trim(),JSON.stringify(packetFromGit('2026-S42',sha,{title:'Un crime dans la tête',compact:true},dir)));
    const repeated=execFileSync(process.execPath,[cli,'2026-S42','--ref',sha,'--title','A Ghost Story','--title','Un crime dans la tête','--compact'],{cwd:dir,encoding:'utf8'});
    assert.deepEqual(JSON.parse(repeated).works.map(work=>work.requested_title),['A Ghost Story','Un crime dans la tête']);
    const titleArgs=Array.from({length:8},(_,i)=>['--title','Unknown '+i]).flat();
    assert.equal(JSON.parse(execFileSync(process.execPath,[cli,'2026-S42','--ref',sha,...titleArgs],{cwd:dir,encoding:'utf8'})).works.length,8);
    assert.throws(()=>execFileSync(process.execPath,[cli,'2026-S42','--ref',sha,...titleArgs,'--title','Ninth'],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}),/1\.\.8/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
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
