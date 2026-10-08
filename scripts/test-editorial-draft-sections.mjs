import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDraftBundle} from './editorial-draft-cards.mjs';
import {planImport} from './editorial-handoff.mjs';

const sha = 'a'.repeat(40);
const work = i => ({id:'oeuvre-'+i, title:'Œuvre '+i, year:2000+i, director:'Réalisatrice '+i, country:'France', genre:'Drame',
  duration:'1 h 3'+(i%10), image:'https://images.example.test/'+i+'.jpg', image_source_url:'https://official.example.test/'+i,
  image_checked:'2026-10-01', ratings:{imdb:'7,'+(i%10)}, ratings_checked:'2026-10-01'});
function context({issue = null, radar = null} = {}) {
  const works = {updated:'2026-09-27', works:Array.from({length:40},(_,i) => work(i+1))};
  const links = {schema_version:1, updated:'2026-09-27', links:Object.fromEntries(works.works.map(w => [w.title,{imdb:'https://www.imdb.com/title/tt'+String(1000000+Number(w.id.slice(7)))+'/'}]))};
  const manifest = {schema_version:1, latest:'2026-S41', updated:'2026-09-27', weeks:[{week:'2026-S41', status:'published'}]};
  const raw = new Map([['data/manifest.json',manifest],['data/works.json',works],['data/links.json',links],
    ...(issue ? [['data/weeks/2026-S42.json',issue]] : []), ...(radar ? [['data/radar-reserves/2026-S42.json',radar]] : [])]
    .map(([name,value]) => [name, JSON.stringify(value,null,2)+'\n']));
  return {sha, read:name => raw.get(name) ?? null, manifest, works, links, issue, shell:issue ? '<html></html>' : null, radar_reserves:radar};
}
const review = {checked_at:'2026-10-08', identity_version:'Version et identité confirmées sur la fiche exacte.', canonical_fields:'Champs canoniques et visuel revus.',
  current_broadcast:'Offre ou diffusion de ce cycle relue sur la source officielle.', editorial_copy:'Textes rédigés pour cette proposition et relus.',
  evidence_urls:['https://official.example.test/evidence']};
const base = (i, rank, extra = {}) => ({work_id:'oeuvre-'+i, rank, summary:'Résumé informatif rédigé pour l’œuvre '+i+', distinct du texte promotionnel.',
  why:'Justification éditoriale propre à l’œuvre '+i+', fondée sur sa réception et sa singularité.', review, ...extra});
const tv = (i, rank, extra) => base(i, rank, {date:'2026-10-1'+(i%7), time:'20:50', channel:'Arte', quality:'TRÈS FORT', ...extra});
const offer = extra => ({service:'ARTE.TV', url:'https://www.arte.tv/fr/videos/000000-000-A/oeuvre/', checked_at:'2026-10-08', ...extra});
const header = {kicker:'Kicker rédigé', h1:'Titre rédigé', deck:'Chapeau rédigé pour la rubrique.'};
const plan = extra => ({schema_version:1, week:'2026-S42', from:'2026-10-10', source_sha:sha, range:'10 au 16 octobre 2026',
  remaining:['Terminer les autres rubriques, les jours et la revue complète.'], ...extra});
const issueOf = result => JSON.parse(result.bundle.files.find(f => f.path === 'data/weeks/2026-S42.json').content);
const fileOf = (result, path) => {const f = result.bundle.files.find(file => file.path === path); return f && JSON.parse(f.content);};
const articles = html => (html.match(/<article\b/g) || []).length;

test('rendezvous pages render visible cards, keep ranked reserves in their pool and feed the catalogue', () => {
  const ctx = context();
  const cards = Array.from({length:8},(_,i) => tv(i+1, i+1));
  const result = buildDraftBundle(ctx, plan({sections:[{kind:'rendezvous', page:1, header, target:5, cards}]}));
  const issue = issueOf(result), page = issue.pages.find(p => p.id === 'rendezvous-1');
  assert.equal(articles(page.html), 5);
  assert.match(page.html, /<article class="week-card" data-title="Œuvre 1" data-work-id="oeuvre-1">/);
  assert.match(page.html, /<div class="where">dimanche 11 · 20:50 · Arte<\/div>/);
  const pool = issue.personalization.pools['rendezvous-1'];
  assert.deepEqual([pool.card_type, pool.target, pool.candidates.length, pool.container_selector], ['week-card', 5, 8, '.week-grid']);
  assert(!pool.shortage_reason, 'helper must not invent a shortage');
  assert.equal(result.report.publication_ready, false);
  assert.equal(fileOf(result, 'data/works.json'), undefined, 'unchanged catalogue is not rewritten');
  assert.doesNotThrow(() => planImport(result.bundle, ctx.read));
});

test('offer-based rubriques need dated, sourced offers and keep every decision visible', () => {
  const ctx = context();
  const sections = [
    {kind:'replay', header, cards:[base(1,1,{offer:offer({available_until:'2026-12-20'})})]},
    {kind:'platform_free', header, cards:[base(2,1,{offer:offer()})]},
    {kind:'platform_subscription', header, cards:[base(3,1,{offer:offer({service:'CANAL+', arrival_date:'2026-10-12'})}), base(4,2,{offer:offer({service:'Netflix'})})]},
    {kind:'streaming_release', header, cards:[base(5,1,{offer:offer({service:'Netflix', arrival_date:'2026-10-14'})})]},
    {kind:'expiring', header, cards:[base(6,1,{offer:offer({last_day:'2026-10-15'})})]}];
  const issue = issueOf(buildDraftBundle(ctx, plan({sections})));
  const html = id => issue.pages.find(p => p.id === id).html;
  assert.match(html('replay-1'), /ARTE\.TV · disponible jusqu’au 20\/12\/2026/);
  assert.match(html('replay-1'), /<img class="section-thumb" src="https:\/\/images\.example\.test\/1\.jpg"/);
  assert.match(html('plateformes-abonnement'), /<div class="date">12 octobre 2026<\/div>/);
  assert.match(html('sorties-streaming'), /14 octobre 2026 · Netflix/);
  assert.match(html('avant-disparition'), /Dernier jour : 15 octobre 2026/);
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'replay', header, cards:[base(1,1,{offer:offer()})]}]})), /available_until/);
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'platform_free', header, cards:[base(1,1,{offer:offer({url:'javascript:alert(1)'})})]}]})), /HTTP/);
  const four = [1,2,3,4].map(i => base(i,i,{offer:offer()}));
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'platform_subscription', header, cards:four}]})), /another page/);
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'replay', header, cards:[base(1,1,{offer:offer({available_until:'2026-12-20'})})], target:1},
    {kind:'replay', header, cards:[base(2,1,{offer:offer({available_until:'2026-12-20'})})]}]})), /decided twice/);
});

test('physical releases keep a release-card pool with sourced release facts', () => {
  const release = {date:'2026-10-14', format:'UHD 4K', editor:'Carlotta', price:'39,99 €', url:'https://editor.example.test/release', checked_at:'2026-10-08', restoration:'Nouvelle restauration 4K'};
  const cards = [1,2,3,4,5,6].map(i => base(i,i,{quality:'PATRIMOINE', release}));
  const issue = issueOf(buildDraftBundle(context(), plan({sections:[{kind:'physical_release', header, target:4, cards}]})));
  const page = issue.pages.find(p => p.id === 'sorties-physiques');
  assert.equal(articles(page.html), 4);
  assert.match(page.html, /14 octobre 2026 · UHD 4K/);
  assert.match(page.html, /Carlotta · 39,99 €/);
  assert.deepEqual([issue.personalization.pools['sorties-physiques'].card_type, issue.personalization.pools['sorties-physiques'].candidates.length], ['release-card', 6]);
  assert.throws(() => buildDraftBundle(context(), plan({sections:[{kind:'physical_release', header, cards:[base(1,1,{quality:'PATRIMOINE', release:{...release, url:undefined}})]}]})), /release.url/);
});

test('radars render their pages and the radar-reserves file without discarding other keys', () => {
  const ctx = context({radar:{schema_version:1, week:'2026-S42', hd2:{page_id:'radar-2', target:5, candidates:[]}}});
  const signal = i => base(i, i, {signal:'Top 10 public · #'+i, signal_source_url:'https://signal.example.test/week'});
  const added = (i, r) => base(i, r, {added:'Ajout HD repéré · 9 octobre', added_source_url:'https://hd.example.test/list'});
  const result = buildDraftBundle(ctx, plan({sections:[
    {kind:'radar_popularity', header, target:5, cards:[1,2,3,4,5,6,7].map(signal)},
    {kind:'radar_popularity_scan', header, cards:[8,9,10,11,12].map((i,k) => base(i,k+1,{signal:'Signal élargi', signal_source_url:'https://signal.example.test/archive'}))},
    {kind:'radar_hd', page:1, header, target:5, cards:[13,14,15,16,17,18,19,20].map((i,k) => added(i,k+1))}]}));
  const issue = issueOf(result), radar = fileOf(result, 'data/radar-reserves/2026-S42.json');
  assert.equal(articles(issue.pages.find(p => p.id === 'radar-torrent').html), 5);
  assert.deepEqual(radar.popular_deep.candidates.map(c => c.work_id), ['oeuvre-6','oeuvre-7']);
  assert.equal(radar.popular_scan.page_id, 'radar-torrent-sillonnage');
  assert.deepEqual([radar.hd1.page_id, radar.hd1.target, radar.hd1.candidates.length], ['radar-1', 5, 8]);
  assert.deepEqual(radar.hd2, {page_id:'radar-2', target:5, candidates:[]}, 'untouched radar key preserved');
  assert.match(issue.pages.find(p => p.id === 'radar-1').html, /Réalisation : Réalisatrice 13 · Sortie : 2013 · Pays : France · Durée : 1 h 33 · Genre : Drame/);
  assert.deepEqual(issue.pages.map(p => p.id), ['radar-torrent','radar-torrent-sillonnage','radar-1']);
});

test('cover and hero reuse a developed daily choice; sommaire is rebuilt from actual pages', () => {
  const ctx = context();
  const daily = [1,2,3].map(i => ({...tv(i,i), date:'2026-10-10', quality:'MAJEUR'}));
  const result = buildDraftBundle(ctx, plan({cards:daily, render_toc:true, sections:[{kind:'replay', header, cards:[base(9,1,{offer:offer({available_until:'2026-12-20'})})]}],
    cover:{lead_work_id:'oeuvre-1', side_work_ids:['oeuvre-2'], kicker:'Sélection hebdomadaire', h1:'Titre de couverture rédigé', deck:'Chapeau de couverture rédigé.'}}));
  const issue = issueOf(result);
  assert.deepEqual(issue.pages.map(p => p.id), ['couverture','sommaire','replay-1','samedi-selection']);
  assert.deepEqual([issue.hero_image, issue.hero_title, issue.hero_meta], ['https://images.example.test/1.jpg','Œuvre 1','Réalisatrice 1 · 2001 · France']);
  const manifest = fileOf(result, 'data/manifest.json');
  assert.deepEqual([manifest.latest, manifest.weeks[0].hero_title, manifest.weeks[0].status], ['2026-S41','Œuvre 1','draft']);
  const toc = issue.pages[1].html;
  assert.match(toc, /href="#replay-1"><span class="toc-label">Replay<\/span><span class="toc-page">p\. 3<\/span>/);
  assert.match(toc, /href="#samedi-selection"><span class="toc-label">Samedi 10 octobre<span class="toc-sub">sélection<\/span><\/span><span class="toc-page">p\. 4<\/span>/);
  assert(!toc.includes('#rendezvous-1'), 'no link to a page that does not exist');
  assert.match(issue.pages[0].html, /<div>20:50 · Arte<\/div><h2>Œuvre 1<\/h2>/);
  assert.match(issue.pages[3].html, /<span>4<\/span><\/div>$/);
  assert.throws(() => buildDraftBundle(ctx, plan({cards:daily, cover:{lead_work_id:'oeuvre-9', kicker:'k', h1:'h', deck:'d'}})), /developed daily choice/);
});

test('existing rubrique pages need explicit replacement; shortages must be structured and match rendered counts', () => {
  const first = issueOf(buildDraftBundle(context(), plan({sections:[{kind:'replay', header, cards:[base(1,1,{offer:offer({available_until:'2026-12-20'})})]}]})));
  first.pages.push({id:'samedi-selection', className:'page', html:'<p>Reviewed day</p><div class="footer"><span>S42</span><span>2</span></div>'});
  const ctx = context({issue:first});
  const again = {sections:[{kind:'replay', header, cards:[base(2,1,{offer:offer({available_until:'2026-12-21'})})]}]};
  assert.throws(() => buildDraftBundle(ctx, plan(again)), /replace_pages/);
  const issue = issueOf(buildDraftBundle(ctx, plan({...again, replace_pages:['replay-1']})));
  assert.match(issue.pages.find(p => p.id === 'replay-1').html, /Œuvre 2/);
  assert.match(issue.pages.find(p => p.id === 'samedi-selection').html, /Reviewed day/);
  const shortage = {reason:'Une seule arrivée gratuite vérifiée et suffisamment forte cette semaine.', searched_sources:['https://a.example.test/','https://b.example.test/'], verified_count:1};
  const sections = [{kind:'platform_free', header, cards:[base(3,1,{offer:offer()})]}];
  assert.deepEqual(issueOf(buildDraftBundle(context(), plan({sections, section_shortages:{'plateformes-gratuites':shortage}}))).section_shortages['plateformes-gratuites'], shortage);
  assert.throws(() => buildDraftBundle(context(), plan({sections, section_shortages:{'plateformes-gratuites':{...shortage, verified_count:2}}})), /verified_count/);
  assert.throws(() => buildDraftBundle(context(), plan({sections, section_shortages:{'plateformes-gratuites':'raison libre'}})), /structured/);
});

test('partial continuation-only families link to actual pages and return to base anchors when completed', () => {
  const ctx = context();
  const sections = [
    {kind:'replay',page:2,header,cards:[base(1,1,{offer:offer({available_until:'2026-12-20'})})]},
    {kind:'platform_subscription',page:2,header,cards:[base(2,1,{offer:offer({service:'CANAL+'})})]},
    {kind:'rendezvous',page:2,header,cards:[tv(3,1)]},
    {kind:'radar_hd',page:2,header,cards:[base(4,1,{added:'Ajout HD repéré · 8 octobre',added_source_url:'https://hd.example.test/list'})]}];
  const partial=issueOf(buildDraftBundle(ctx,plan({sections,render_toc:true}))),toc=partial.pages.find(page => page.id === 'sommaire').html;
  const anchors=[...toc.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(anchors,['rendezvous-2','replay-2','plateformes-abonnement-2','radar-2']);
  for(const id of anchors) assert(partial.pages.some(page => page.id === id),'TOC target must exist: '+id);
  assert(!toc.includes('href="#replay-1"') && !toc.includes('href="#radar-1"'));
  const complete=issueOf(buildDraftBundle(context({issue:partial}),plan({render_toc:true,sections:[
    {kind:'replay',page:1,header,cards:[base(5,1,{offer:offer({available_until:'2026-12-20'})})]},
    {kind:'radar_hd',page:1,header,cards:[base(6,1,{added:'Ajout HD repéré · 8 octobre',added_source_url:'https://hd.example.test/list'})]}]})));
  const completedToc=complete.pages.find(page => page.id === 'sommaire').html;
  assert.match(completedToc,/href="#replay-1"/);assert.match(completedToc,/href="#radar-1"/);
  assert(!completedToc.includes('href="#replay-2"') && !completedToc.includes('href="#radar-2"'));
});

test('section copy is escaped and unknown identities or unsupported kinds are refused', () => {
  const ctx = context();
  const html = issueOf(buildDraftBundle(ctx, plan({sections:[{kind:'replay', header:{...header, h1:'<script>x</script>'},
    cards:[base(1,1,{why:'<img onerror="bad()"> Justification relue.', offer:offer({available_until:'2026-12-20'})})]}]}))).pages[0].html;
  assert(!html.includes('<script>') && !html.includes('<img onerror'));
  assert(html.includes('&lt;script&gt;'));
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'replay', header, cards:[base(99,1,{offer:offer({available_until:'2026-12-20'})})]}]})), /canonical title/);
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'unknown', header, cards:[]}]})), /unsupported section kind/);
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'replay', header:{kicker:'k', h1:'h'}, cards:[base(1,1,{offer:offer({available_until:'2026-12-20'})})]}]})), /header.deck/);
  assert.throws(() => buildDraftBundle(ctx, plan({sections:[{kind:'replay', header, cards:[{...base(1,1,{offer:offer({available_until:'2026-12-20'})}), review:undefined}]}]})), /explicit card review/);
});
