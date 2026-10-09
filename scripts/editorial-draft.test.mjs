import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildDraftBundle,draftContextFromGit} from './editorial-draft-cards.mjs';
import {planImport} from './editorial-handoff.mjs';

const work = (id='film-1962',title='Un crime dans la tête',year=1962) => ({id,title,year,director:'John Frankenheimer',
  country:'États-Unis',genre:'Thriller',duration:'2 h 06',image:'https://images.example.test/film.jpg',
  image_source_url:'https://official.example.test/film',image_checked:'2026-09-01',
  ratings:{imdb:'7,9'},ratings_checked:'2026-09-01',occurrences:[{week:'S40',url:'semaines/2026-S40/'}]});
const fixture = () => {
  const raw = new Map(Object.entries({'data/manifest.json':{schema_version:1,latest:'2026-S41',updated:'2026-09-27',weeks:[{week:'2026-S41',status:'published'}]},
    'data/works.json':{updated:'2026-09-27',works:[work()]},'data/links.json':{schema_version:1,updated:'2026-09-27',links:{'Un crime dans la tête':{imdb:'https://www.imdb.com/title/tt0056218/'}}}}).map(([name,value]) => [name,JSON.stringify(value,null,2)+'\n']));
  return {sha:'a'.repeat(40),read:name => raw.get(name) ?? null,manifest:JSON.parse(raw.get('data/manifest.json')),
    works:JSON.parse(raw.get('data/works.json')),links:JSON.parse(raw.get('data/links.json')),issue:null,shell:null};
};
const card = overrides => ({work_id:'film-1962',date:'2026-10-10',time:'20:50',channel:'TCM Cinéma',rank:1,quality:'MAJEUR',
  summary:'Un vétéran de Corée revient auprès de sa famille et découvre que ses souvenirs ont été manipulés.',
  why:'Le récit transforme la paranoïa politique en une mise en scène de la mémoire et du pouvoir des images.',
  grid_reason:'Une construction du thriller politique par les images et les souvenirs manipulés.',
  review:{checked_at:'2026-10-08',identity_version:'Long métrage de 1962, distinct du remake de 2004.',canonical_fields:'Métadonnées et visuel de cette version revus.',
    current_broadcast:'Créneau du 10 octobre recoupé avec la chaîne.',editorial_copy:'Synopsis et justification écrits et relus pour cette proposition.',evidence_urls:['https://official.example.test/film']},...overrides});
const plan = cards => ({schema_version:1,week:'2026-S42',from:'2026-10-10',source_sha:'a'.repeat(40),cards:cards || [card()],remaining:['Terminer les six autres jours et les rubriques, puis revoir la candidate complète.']});
const issueFrom = result => JSON.parse(result.bundle.files.find(file => file.path === 'data/weeks/2026-S42.json').content);
const appendedCard = (rank=5,overrides={}) => {
  const supplied=work('next-film-2005','Prochain film',2005);delete supplied.occurrences;
  return card({work_id:supplied.id,work:supplied,links:{imdb:'https://www.imdb.com/title/tt0056218/'},rank,grid_reason:undefined,...overrides});
};
const savedDailyContext = () => {
  const original=fixture(), cards=[card()];
  for(let rank=2;rank<=4;rank++){
    const supplied=work('saved-film-'+rank,'Film conservé '+rank,2000+rank);delete supplied.occurrences;
    cards.push(card({work_id:supplied.id,work:supplied,rank,links:{imdb:'https://www.imdb.com/title/tt0056218/'},
      grid_reason:rank===4?undefined:'Commentaire de grille conservé '+rank}));
  }
  const first=buildDraftBundle(original,plan(cards));
  const raw=new Map(['data/works.json','data/links.json','data/manifest.json'].map(name=>[name,original.read(name)]));
  for(const file of first.bundle.files)raw.set(file.path,file.content);
  const issue=JSON.parse(raw.get('data/weeks/2026-S42.json'));
  issue.pages.push({id:'sommaire',className:'page',html:'<p>Sommaire sauvegardé à préserver</p>'});
  issue.pages.push({id:'custom-notes',className:'page',html:'<p>Page étrangère au lot</p>'});
  issue.page_count=issue.pages.length;
  issue.personalization.pools['samedi-selection'].shortage_reason={status:'pending',note:'Motif original non modifié'};
  issue.personalization.pools['samedi-selection'].candidates[0].review={checked_at:'2026-08-01',status:'conflict',note:'Ancienne preuve à conserver'};
  const manifest=JSON.parse(raw.get('data/manifest.json'));manifest.weeks.find(entry=>entry.week==='2026-S42').page_count=issue.page_count;
  const works=JSON.parse(raw.get('data/works.json'));delete works.works[0].image_checked;
  raw.set('data/weeks/2026-S42.json',JSON.stringify(issue,null,2)+'\n');
  raw.set('data/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  raw.set('data/works.json',JSON.stringify(works,null,2)+'\n');
  return {sha:original.sha,read:name=>raw.get(name)??null,manifest,works,issue,
    links:JSON.parse(raw.get('data/links.json')),shell:raw.get('semaines/2026-S42/index.html')};
};

test('one decision renders a feature, matching pool and explicit grid without changing latest or proof dates', () => {
  const context=fixture(), snapshot=JSON.stringify(context), result=buildDraftBundle(context,plan()), issue=issueFrom(result);
  assert.equal(JSON.stringify(context),snapshot);
  assert.equal(result.report.publication_ready,false); assert.equal(result.report.review_sealed,false);
  assert.equal(result.bundle.stage,'enrichment'); assert.deepEqual(result.bundle.remaining,plan().remaining);
  assert.equal(issue.publication_status,'draft'); assert.equal(issue.page_count,2);
  assert.equal(issue.personalization.pools['samedi-selection'].candidates[0].work_id,'film-1962');
  assert.match(issue.pages[0].html,/<h3>Un crime dans la tête<\/h3>/);
  assert.match(issue.pages[1].html,/<td class="prog">Un crime dans la tête<\/td>/);
  assert.match(issue.pages[1].html,/<span>2<\/span><\/div>$/);
  assert.equal(result.bundle.files.find(file => file.path === 'data/works.json'),undefined,'unchanged catalogue must not be refreshed');
  const manifest=JSON.parse(result.bundle.files.find(file => file.path === 'data/manifest.json').content);
  assert.equal(manifest.latest,'2026-S41'); assert.equal(manifest.weeks[1].status,'published');
  assert.equal(manifest.weeks[0].page_count,issue.pages.length); assert.equal(manifest.updated,'2026-09-27');
  assert.doesNotThrow(() => planImport(result.bundle,context.read));
});

test('rank four remains a fully rendered reserve and is not chosen for the public page', () => {
  const context=fixture(), cards=[];
  for(let i=1;i<=4;i++) {context.works.works.push(work('other-'+i,'Film '+i,2000+i)); cards.push(card({work_id:'other-'+i,rank:i,links:{imdb:'https://www.imdb.com/title/tt0056218/'},grid_reason:undefined}));}
  const issue=issueFrom(buildDraftBundle(context,plan(cards)));
  assert.equal(issue.personalization.pools['samedi-selection'].candidates.length,4);
  assert.equal((issue.pages[0].html.match(/<article /g)||[]).length,3);
  assert(!issue.pages[0].html.includes('<h3>Film 4</h3>'));
  assert(!issue.personalization.pools['samedi-selection'].shortage_reason,'helper must not invent a quota exception');
  assert.equal(issue.pages.length,1,'no grid is created unless the editor supplies grid reasons');
});

test('long daily grids are paginated without dropping rows and shell keeps the source asset version', () => {
  const context=fixture(), cards=[];context.asset_version='13b49d38458b63d2';
  for(let i=1;i<=9;i++) {context.works.works.push(work('grid-'+i,'Grille '+i,2000+i));cards.push(card({work_id:'grid-'+i,rank:i,links:{imdb:'https://www.imdb.com/title/tt0056218/'}}));}
  const result=buildDraftBundle(context,plan(cards)), issue=issueFrom(result);
  assert.deepEqual(issue.pages.map(page => page.id),['samedi-selection','samedi-grille','samedi-grille-2']);
  assert.equal((issue.pages[1].html.match(/<td class="prog">/g)||[]).length,8);
  assert.equal((issue.pages[2].html.match(/<td class="prog">/g)||[]).length,1);
  assert.match(issue.pages[2].html,/<span>3<\/span><\/div>$/);
  assert.match(result.bundle.files.find(file => file.path.startsWith('semaines/')).content,/issue-loader\.js\?v=13b49d38458b63d2/);
  assert.throws(() => buildDraftBundle(context,{...plan(cards),grid_page_size:4}),/more than two pages/);
});

test('new work requires explicit ID, exact identity and authored metadata; no title inference or placeholders', () => {
  const context=fixture();
  const suppliedWork = (id,title,year) => {const result=work(id,title,year);delete result.occurrences;return result;};
  assert.throws(() => buildDraftBundle(context,plan([card({work_id:'unknown'})])),/canonical title/);
  assert.throws(() => buildDraftBundle(context,plan([card({work_id:'new',work:suppliedWork('new')})])),/duplicate/);
  const result=buildDraftBundle(context,plan([card({work_id:'nouveau-film-2026',work:suppliedWork('nouveau-film-2026','Nouveau film',2026),links:{official:'https://official.example.test/nouveau'}})]));
  const works=JSON.parse(result.bundle.files.find(file => file.path === 'data/works.json').content);
  assert.deepEqual(works.works[0],context.works.works[0]);
  assert.equal(works.works[1].id,'nouveau-film-2026'); assert.equal(works.works[1].image_checked,'2026-09-01');
  assert.throws(() => buildDraftBundle(context,plan([card({links:{imdb:'',official:'https://tv-programme.com/guide'}})])),/identity link/);
  assert.throws(() => buildDraftBundle(context,plan([card({work:{image:''}})])),/work.image/);
  assert.throws(() => buildDraftBundle(context,plan([card({review:undefined})])),/explicit card review/);
});

test('stale plans, public issues, mismatched calendars and noncontiguous ranks stop before producing changes', () => {
  const context=fixture();
  assert.throws(() => buildDraftBundle(context,{...plan(),source_sha:'b'.repeat(40)}),/stale plan/);
  assert.throws(() => buildDraftBundle({...context,manifest:{...context.manifest,latest:'2026-S42'}},plan()),/public issue/);
  assert.throws(() => buildDraftBundle(context,{...plan(),from:'2026-10-17'}),/week\/date mismatch/);
  assert.throws(() => buildDraftBundle(context,plan([card({date:'2026-10-17'})])),/outside issue/);
  assert.throws(() => buildDraftBundle(context,plan([card({rank:2})])),/contiguous/);
  assert.throws(() => buildDraftBundle(context,plan([card(),card()])),/duplicate work/);
});

test('existing daily decisions need explicit replacement; unrelated pages and future global changes remain intact', () => {
  const context=fixture(), first=issueFrom(buildDraftBundle(context,plan()));
  first.pages.unshift({id:'replay-1',className:'page replay-page',html:'<p>Reviewed replay copy</p><div class="footer"><span>S42</span><span>1</span></div>'});first.page_count=3;
  first.pages.push({id:'samedi-grille-2',className:'page',html:'<p>Stale replaced grid</p>'});first.page_count++;
  context.issue=first;context.shell='<html>existing shell</html>';
  assert.throws(() => buildDraftBundle(context,plan()),/replace_days authorization/);
  const result=buildDraftBundle(context,{...plan(),replace_days:['samedi']});
  const issue=issueFrom(result);
  assert.equal(issue.pages[0].id,'replay-1'); assert.match(issue.pages[0].html,/Reviewed replay copy/);
  assert.match(issue.pages[2].html,/<span>3<\/span><\/div>$/);
  assert(!issue.pages.some(page => page.id === 'samedi-grille-2'),'stale second grid is removed when the whole day is replaced');
  assert(!result.bundle.files.some(file => file.path.startsWith('semaines/')),'existing shell preserved');
});

test('incremental daily reserves preserve all saved cards, pages and original evidence without resubmitting reviews', () => {
  const context=savedDailyContext(), snapshot=JSON.stringify(context);
  const decision=appendedCard(), originalPool=context.issue.personalization.pools['samedi-selection'];
  const result=buildDraftBundle(context,{...plan([decision]),append_days:['samedi']}), issue=issueFrom(result);
  assert.deepEqual(issue.personalization.pools['samedi-selection'].candidates.slice(0,4),originalPool.candidates);
  assert.deepEqual({...issue.personalization.pools['samedi-selection'],candidates:[]},{...originalPool,candidates:[]});
  assert.equal(issue.personalization.pools['samedi-selection'].candidates[4].rank,5);
  assert.equal(issue.personalization.pools['samedi-selection'].candidates[4].title,'Prochain film');
  assert.deepEqual(issue.pages,context.issue.pages,'no primary, grid, footer, navigation or unrelated page is regenerated');
  assert.equal(issue.page_count,context.issue.page_count);
  assert.equal(result.bundle.files.some(file=>file.path==='data/manifest.json'),false,'public manifest and draft entry remain exact');
  assert.equal(result.report.authored_cards,1);assert.equal(result.report.public_daily_cards,0);
  assert.equal(result.report.reviews.length,1);assert.equal(result.report.reviews[0].work_id,decision.work_id);
  assert.equal(result.report.toc_rendered,false);
  assert.equal(result.report.publication_ready,false);assert.equal(result.report.review_sealed,false);
  assert.equal(issue.publication_status,'draft');assert.deepEqual(result.bundle.remaining,plan().remaining);
  assert.equal(JSON.stringify(context),snapshot);
});

test('incremental grid rows require an explicit reason and preserve existing HTML around the added row', () => {
  const context=savedDailyContext(), source=context.issue.pages.find(page=>page.id==='samedi-grille');
  const reason='Nouvelle justification explicite <et> relue.';
  const result=buildDraftBundle(context,{...plan([appendedCard(5,{grid_reason:reason})]),append_days:['samedi']});
  const issue=issueFrom(result), grid=issue.pages.find(page=>page.id===source.id);
  assert(grid.html.startsWith(source.html.split('</tbody>')[0]));
  assert(grid.html.endsWith('</tbody>'+source.html.split('</tbody>')[1]));
  assert.match(grid.html,/Nouvelle justification explicite &lt;et&gt; relue\./);
  assert.equal((grid.html.match(/<td class="prog">/g)||[]).length,4);
  assert.deepEqual(issue.pages.filter(page=>page.id!==source.id),context.issue.pages.filter(page=>page.id!==source.id));
  assert.throws(()=>buildDraftBundle(context,{...plan([appendedCard(5,{grid_reason:reason})]),append_days:['samedi'],grid_page_size:3}),/exceeds existing page capacity/);
  const withoutGrid={...context,issue:structuredClone(context.issue)};withoutGrid.issue.pages=withoutGrid.issue.pages.filter(page=>page.id!==source.id);
  assert.throws(()=>buildDraftBundle(withoutGrid,{...plan([appendedCard(5,{grid_reason:reason})]),append_days:['samedi']}),/require an existing grid page/);
});

test('incremental mode rejects stale plans, primary replacements, duplicate works, guessed ranks and incompatible operations', () => {
  const context=savedDailyContext(), valid={...plan([appendedCard()]),append_days:['samedi']}, snapshot=JSON.stringify(context);
  assert.throws(()=>buildDraftBundle(context,{...valid,source_sha:'b'.repeat(40)}),/stale plan/);
  for(const rank of [undefined,1,4,6])assert.throws(()=>buildDraftBundle(context,{...valid,cards:[appendedCard(rank,{rank})]}),/rank/);
  const duplicate=appendedCard(5,{work_id:'saved-film-4',work:undefined});
  assert.throws(()=>buildDraftBundle(context,{...valid,cards:[duplicate]}),/cannot replace an existing candidate/);
  assert.throws(()=>buildDraftBundle(context,{...valid,cards:[appendedCard(5,{review:undefined})]}),/explicit card review/);
  for(const append_days of [[],['unknown'],['samedi','samedi'],['dimanche'],['samedi','dimanche']])
    assert.throws(()=>buildDraftBundle(context,{...valid,append_days}),/append_days/);
  for(const extra of [{replace_days:['samedi']},{render_toc:true},{methode:{}},{cover:{}},{sections:[{}]},{shortage_reasons:{samedi:'changed'}}])
    assert.throws(()=>buildDraftBundle(context,{...valid,...extra}),/cannot be mixed/);
  const missingPrimary={...context,issue:structuredClone(context.issue)};
  missingPrimary.issue.personalization.pools['samedi-selection'].candidates.length=2;
  assert.throws(()=>buildDraftBundle(missingPrimary,valid),/cannot create or replace daily primaries/);
  assert.throws(()=>buildDraftBundle(fixture(),valid),/requires an existing draft/);
  assert.equal(JSON.stringify(context),snapshot,'all rejected plans leave the saved state intact');
});

test('titles and editorial copy are escaped; active URLs and conflicting versions are rejected', () => {
  const context=fixture();context.works.works[0].title='Film <script>alert("x")</script> & suite';
  context.links.links[context.works.works[0].title]={imdb:'https://www.imdb.com/title/tt0056218/'};
  const html=issueFrom(buildDraftBundle(context,plan([card({summary:'<img onerror="bad()"> Un récit relu.',grid_reason:'<b>Choix</b>'})]))).pages[0].html;
  assert(!html.includes('<script>'));assert(!html.includes('<img onerror="bad()">'));assert(html.includes('&lt;script&gt;'));
  assert.throws(() => buildDraftBundle(context,plan([card({work:{image:'javascript:alert(1)'}})])),/HTTP/);
  assert.throws(() => buildDraftBundle(context,plan([card(),card({date:'2026-10-11',work:{duration:'2 h 07'}})])),/conflicting canonical/);
});

test('git context reads one immutable commit, never the worktree, and malformed JSON is a real error', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-draft-')),git=args => execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try {
    git(['init','-q']);git(['config','user.name','fixture']);git(['config','user.email','fixture@example.test']);
    const context=fixture();
    fs.mkdirSync(path.join(dir,'data'),{recursive:true});
    for(const name of ['data/manifest.json','data/works.json','data/links.json']) fs.writeFileSync(path.join(dir,name),context.read(name));
    git(['add','.']);git(['commit','-qm','fixture']); const sha=git(['rev-parse','HEAD']).trim();
    fs.writeFileSync(path.join(dir,'data/works.json'),'malformed local edit');
    const before=git(['status','--porcelain']),loaded=draftContextFromGit('2026-S42',sha,dir);
    assert.equal(loaded.works.works[0].id,'film-1962');assert.equal(git(['status','--porcelain']),before);
    assert.throws(() => draftContextFromGit('2026-S42','--help',dir),/invalid ref/);
    git(['add','.']);git(['commit','-qm','malformed']); assert.throws(() => draftContextFromGit('2026-S42','HEAD',dir),SyntaxError);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
