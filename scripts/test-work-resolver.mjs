import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workIdentity, identityOwners, resolveWorks, applyResolutions, summarize, parseCli, applyRefusal,
  expectedYear, isoMinutes, catalogueMinutes, catalogueAgreement, ratingsNote} from './work-resolver.mjs';
import {linkClaims} from './poster-resolver.mjs';

const TODAY='2026-10-17';
const KEY='v3-secret-key';
const SC_URL='https://www.senscritique.com/film/la_venue_de_l_avenir/79419902';
const IMDB_URL='https://www.imdb.com/title/tt31411349/';
const ARTE_URL='https://www.arte.tv/fr/videos/123976-000-A/la-venue-de-l-avenir/';
const TMDB='https://api.themoviedb.org/3';
const WD_ENTITY=id=>`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
const options={today:TODAY,intervalMs:0,concurrency:1};

const scPage=({id='79419902',kind='film',type='Movie',year='2025-05-22',duration='PT2H6M',director=['Cédric Klapisch'],creator=[],
  genre=['Comédie dramatique','Drame'],alternateName,rating={ratingValue:6.9,ratingCount:5123,bestRating:10}}={})=>`<html><head>
<script type="application/ld+json">${JSON.stringify({'@context':'http://schema.org','@type':type,name:'La Venue de l’avenir',datePublished:year,
  ...(duration?{duration}:{}),director:director.map(name=>({'@type':'Person',name})),creator:creator.map(name=>({'@type':'Person',name})),
  genre,...(alternateName?{alternateName}:{}),aggregateRating:rating&&{'@type':'AggregateRating',...rating},
  url:`https://www.senscritique.com/${kind}/la_venue_de_lavenir/${id}`})}</script></head></html>`;

// Wikidata claims in the API's own shape.
const item=value=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:{'entity-type':'item',id:value}}}});
const plain=(value,rank='normal')=>({rank,mainsnak:{snaktype:'value',datavalue:{value}}});
const entity=(id,claims,sitelinks={})=>({entities:{[id]:{id,claims,sitelinks}}});
const LABELS={Q11424:'film',Q5398426:'série télévisée',Q456:'Cédric Klapisch',Q142:'France',Q31:'Belgique',Q789:'Will Smith',Q145:'Royaume-Uni'};
const filmClaims=({year='+2025-05-22T00:00:00Z',minutes='+126',imdb='tt31411349'}={})=>({P31:[item('Q11424')],P57:[item('Q456')],
  P495:[item('Q142'),item('Q31')],P577:[plain({time:year,precision:11})],P2047:[plain({amount:minutes,unit:'http://www.wikidata.org/entity/Q7727'})],
  P1476:[plain({text:'La Venue de l’avenir',language:'fr'})],P345:[plain(imdb)],P10100:[plain('79419902')]});

// Exact routes first, then predicate routes; anything else is a 404.
function fakeWeb(routes,matchers=[]){
  const calls=[];
  const fetcher=async(url,init={})=>{
    calls.push({url,headers:init.headers||{}});
    let route=routes[url];
    if(route===undefined)route=matchers.find(([test])=>test(url))?.[1];
    if(route===undefined)return new Response('not found',{status:404});
    const answer=typeof route==='function'?route(url,init):route;
    const response=new Response(answer.body??'',{status:answer.status??200,headers:answer.headers||{}});
    if(answer.final)Object.defineProperty(response,'url',{value:answer.final});
    return response;
  };
  return {fetcher,calls};
}
const html=body=>({body,headers:{'content-type':'text/html; charset=utf-8'}});
const json=value=>({body:JSON.stringify(value),headers:{'content-type':'application/json'}});
const challenge={status:202,headers:{'x-amzn-waf-action':'challenge'},body:'<html>challenge</html>'};
const sparql=(items,expect=[])=>[url=>url.startsWith('https://query.wikidata.org/sparql?'),url=>{
  const query=decodeURIComponent(url.split('query=')[1]);
  for(const fragment of expect)assert(query.includes(fragment),'exact lookup '+fragment+' in '+query);
  return json({results:{bindings:items.map(id=>({item:{type:'uri',value:'http://www.wikidata.org/entity/'+id}}))}});
}];
const labels=[url=>url.startsWith('https://www.wikidata.org/w/api.php?action=wbgetentities'),url=>{
  const ids=decodeURIComponent(url.match(/ids=([^&]+)/)[1]).split('|');
  return json({entities:Object.fromEntries(ids.map(id=>[id,{labels:LABELS[id]?{fr:{language:'fr',value:LABELS[id]}}:{}}]))});
}];

test('identity: Wikidata and Wikipedia links count; an identifier claimed by several works identifies none', () => {
  const works=[
    {id:'paris-texas-1984',title:'Paris, Texas',links:{wiki:'https://fr.wikipedia.org/wiki/Paris,_Texas',wd:'https://www.wikidata.org/wiki/Q1056853'}},
    {id:'slow-horses-s5',title:'Slow Horses — saison 5',links:{imdb:'https://www.imdb.com/title/tt5875444/'}},
    {id:'slow-horses-s6',title:'Slow Horses — saison 6',links:{imdb:'https://www.imdb.com/title/tt5875444/',sc:'https://www.senscritique.com/serie/slow_horses/43702519'}}];
  const claims=linkClaims(works),owners=identityOwners(works,{claims});
  const paris=workIdentity(works[0],{claims,owners});
  assert.equal(paris.identity.wikidata.id,'Q1056853');
  assert.deepEqual([paris.identity.wikipedia.lang,paris.identity.wikipedia.page],['fr','Paris,_Texas']);
  const s6=workIdentity(works[2],{claims,owners});
  assert.equal(s6.identity.imdb,undefined,'the series IMDb id names two works');
  assert.equal(s6.identity.senscritique.id,'43702519');
  assert.match(s6.notes[0],/imdb tt5875444 also claimed by slow-horses-s5, ignored/);
  // Search pages and guides are never identities.
  const search=workIdentity({id:'x',title:'X',links:{a:'https://fr.wikipedia.org/w/index.php?search=X',b:'https://www.wikidata.org/w/index.php?search=X'}});
  assert.deepEqual(search.identity,{});
});

test('ladder: SensCritique, TMDb, Wikidata and ARTE agree; IMDb challenge reported once; proposals carry their source', async () => {
  const {fetcher,calls}=fakeWeb({
    [SC_URL]:html(scPage({director:['Cédric Klapisch (Klap)']})),
    [IMDB_URL]:challenge,
    [`${TMDB}/find/tt31411349?external_source=imdb_id&api_key=${KEY}`]:json({movie_results:[{id:1084242}],tv_results:[]}),
    [`${TMDB}/movie/1084242?language=fr-FR&append_to_response=credits%2Cexternal_ids&api_key=${KEY}`]:json({release_date:'2025-05-22',runtime:126,
      imdb_id:'tt31411349',original_title:'La Venue de l’avenir',genres:[{id:35,name:'Comédie'},{id:18,name:'Drame'}],
      production_countries:[{iso_3166_1:'FR',name:'France'},{iso_3166_1:'BE',name:'Belgium'}],
      credits:{crew:[{job:'Director',name:'Cédric Klapisch'},{job:'Screenplay',name:'Santiago Amigorena'}]}}),
    [WD_ENTITY('Q123')]:json(entity('Q123',filmClaims(),{frwiki:{title:'La Venue de l’avenir'}})),
    'https://api-cdn.arte.tv/api/player/v2/config/fr/123976-000-A':json({data:{attributes:{metadata:{providerId:'123976-000-A',episodic:false,duration:{seconds:7505}}}}}),
    'https://www.imdb.com/title/tt0000002/':challenge
  },[sparql(['Q123'],['wdt:P345 "tt31411349"','wdt:P10100 "79419902"']),labels]);
  const work={id:'la-venue-de-l-avenir-2025',title:'La Venue de l’avenir'};
  const other={id:'autre-2020',title:'Autre',links:{imdb:'https://www.imdb.com/title/tt0000002/'}};
  const links={'La Venue de l’avenir':{sc:SC_URL,imdb:IMDB_URL,official:ARTE_URL}};
  const [result,second]=await resolveWorks({works:[work,other],links,targets:[work,other],fetcher,tmdbKey:KEY,...options});
  assert.equal(result.status,'proposals');
  assert.equal(result.expected_year,2025,'the id year gates sources when the catalogue has none');
  assert.deepEqual(Object.fromEntries(Object.entries(result.fields).map(([field,entry])=>[field,[entry.status,entry.value,entry.source]])),{
    year:['proposed','2025','senscritique'],director:['proposed','Cédric Klapisch','senscritique'],country:['proposed','France / Belgique','tmdb'],
    duration:['proposed','126 min','senscritique'],genre:['proposed','Comédie dramatique / drame','senscritique'],
    original_title:['same_as_title','La Venue de l’avenir','tmdb']});
  assert.deepEqual(result.fields.duration.sources.map(s=>[s.source,s.value]),[['senscritique','126 min'],['tmdb','126 min'],['wikidata','126 min'],['arte','126 min']]);
  assert(result.fields.year.sources.every(s=>s.checked_at===TODAY&&/^https:\/\//.test(s.source_url)));
  assert.deepEqual(result.ratings.senscritique,{value:'6,9',score:6.9,votes:5123,scale:10,source_url:SC_URL,checked_at:TODAY,status:'proposed'});
  assert.equal(result.ratings.imdb,undefined);
  assert.match(result.attempts.find(a=>a.source==='imdb').why,/challenge.*not bypassed/);
  assert.deepEqual(result.links_to_verify,{wikipedia:'https://fr.wikipedia.org/wiki/La_Venue_de_l%E2%80%99avenir'});
  assert.equal(second.attempts.find(a=>a.source==='imdb').skipped,'bot challenge earlier in this run, not retried');
  assert.equal(calls.filter(c=>c.url.includes('imdb.com')).length,1,'a challenged host is not asked again in the same run');
  assert(calls.every(c=>!/google\.|\/recherche|\/search|srsearch|wbsearchentities|[?&]q=/.test(c.url)),'no search page is ever fetched');
  assert(!JSON.stringify([result,second]).includes(KEY),'the TMDb key never enters the report');
  assert.deepEqual(result.update,{year:'2025',director:'Cédric Klapisch',country:'France / Belgique',duration:'126 min',duration_source_url:SC_URL,
    genre:'Comédie dramatique / drame',ratings:{senscritique:'6,9'},ratings_checked:TODAY,
    ratings_note:'SensCritique 6,9/10 sur 5 123 notes, relevé le 2026-10-17 sur la fiche liée.',
    metadata_prefill:{checked:TODAY,tool:'work-resolver',fields:{year:SC_URL,director:SC_URL,country:'https://www.themoviedb.org/movie/1084242',
      duration:SC_URL,genre:SC_URL,'ratings.senscritique':SC_URL}}});
  const {doc,changed,fields}=applyResolutions({updated:'2026-10-01',works:[work,other]},[result,second],{today:TODAY});
  assert.deepEqual([changed,fields],[1,6]);
  assert.equal(doc.updated,TODAY);
  assert.equal(doc.works[0].country,'France / Belgique');
  assert.equal(work.country,undefined,'apply works on a copy');
});

test('verified values are never replaced; disagreements are reported, not settled', async () => {
  const {fetcher}=fakeWeb({[SC_URL]:html(scPage({duration:'PT1H45M',director:['Cédric Klapisch'],rating:{ratingValue:7.2,ratingCount:90,bestRating:10}})),
    [WD_ENTITY('Q123')]:json(entity('Q123',filmClaims({minutes:'+98'})))},[sparql(['Q123']),labels]);
  const work={id:'la-venue-de-l-avenir-2025',title:'La Venue de l’avenir',year:'2025',director:'Klapisch Junior',country:'France / Belgique',
    genre:'Comédie',ratings:{imdb:'6,8'},ratings_checked:'2026-09-01',links:{sc:SC_URL}};
  const [result]=await resolveWorks({works:[work],targets:[work],fetcher,...options});
  assert.equal(result.fields.year.status,'agrees');
  assert.equal(result.fields.country.status,'agrees','same countries in another order');
  assert.equal(result.fields.genre.status,'differs');
  assert.deepEqual([result.fields.director.status,result.fields.director.current,result.fields.director.value],['differs','Klapisch Junior','Cédric Klapisch']);
  assert.equal(result.fields.duration.status,'conflict');
  assert.equal(result.fields.duration.value,undefined,'a conflict proposes nothing');
  assert.deepEqual(result.fields.duration.sources.map(s=>s.value),['105 min','98 min']);
  assert.equal(result.ratings.senscritique.status,'blocked');
  assert.match(result.ratings.senscritique.why,/ratings_checked dates the ratings already verified/);
  assert.equal(result.status,'complete');
  assert.equal(result.update,undefined);
  assert.deepEqual(summarize([result]).fields,{agrees:2,differs:2,conflict:1,same_as_title:1});

  // A value that appears between resolution and apply is kept, with its provenance.
  const fresh={id:'w',title:'W'};
  const late={work_id:'w',update:{duration:'90 min',duration_source_url:SC_URL,genre:'Drame',metadata_prefill:{checked:TODAY,tool:'work-resolver',fields:{duration:SC_URL,genre:SC_URL}}}};
  const applied=applyResolutions({works:[{...fresh,duration:'92 min (version ARTE)'}]},[late],{today:TODAY});
  assert.equal(applied.doc.works[0].duration,'92 min (version ARTE)');
  assert.equal(applied.doc.works[0].duration_source_url,undefined,'the kept duration does not get the resolver source');
  assert.equal(applied.doc.works[0].genre,'Drame');
  assert.deepEqual(applied.skipped,['w.duration','w.duration_source_url']);
});

test('year rules: mismatch rejects a source, undated disagreement stops the work, a series start does not date a season', async () => {
  let web=fakeWeb({[SC_URL]:html(scPage({year:'1950-01-01'}))});
  const dated={id:'la-venue-de-l-avenir-2025',title:'La Venue de l’avenir',links:{sc:SC_URL}};
  let [result]=await resolveWorks({works:[dated],targets:[dated],fetcher:web.fetcher,...options});
  assert.equal(result.status,'unresolved');
  assert.match(result.attempts.find(a=>a.source==='senscritique').why,/year mismatch: senscritique 1950, catalogue 2025/);

  web=fakeWeb({[SC_URL]:html(scPage({year:'1950-01-01'})),[WD_ENTITY('Q123')]:json(entity('Q123',filmClaims()))},[sparql(['Q123']),labels]);
  const undated={id:'la-venue',title:'La Venue de l’avenir',links:{sc:SC_URL}};
  [result]=await resolveWorks({works:[undated],targets:[undated],fetcher:web.fetcher,...options});
  assert.equal(result.status,'identity_conflict');
  assert.match(result.why,/1950 \/ 2025/);
  assert.equal(result.update,undefined);

  const series='https://www.senscritique.com/serie/slow_horses/43702519';
  web=fakeWeb({[series]:html(scPage({id:'43702519',kind:'serie',type:'TVSeries',year:'2022-04-01',duration:null,director:[],creator:['Will Smith'],
      genre:['Thriller','Drame'],rating:{ratingValue:7.4,ratingCount:3224}})),
    [`${TMDB}/tv/95480?language=fr-FR&append_to_response=credits%2Cexternal_ids&api_key=${KEY}`]:json({first_air_date:'2022-04-01',
      created_by:[{name:'Will Smith'}],origin_country:['GB'],production_countries:[],episode_run_time:[50],genres:[{name:'Drame'}],original_name:'Slow Horses'})});
  const season={id:'slow-horses-s6-2026',title:'Slow Horses — saison 6',year:'2026',director:'Saul Metzstein',
    links:{sc:series,tmdb:'https://www.themoviedb.org/tv/95480-slow-horses'}};
  [result]=await resolveWorks({works:[season],targets:[season],fetcher:web.fetcher,tmdbKey:KEY,...options});
  assert.equal(result.fields.year,undefined);
  assert.deepEqual(result.fields.creator.sources.map(s=>[s.source,s.value]),[['senscritique','Will Smith'],['tmdb','Will Smith']]);
  assert.equal(result.update.creator,'Will Smith','creator is its own empty field');
  assert.equal(result.update.director,undefined);
  assert.equal(result.update.country,'Royaume-Uni');
  assert.equal(result.update.duration,undefined,'episode runtimes do not time a series');
  assert.equal(result.fields.original_title.status,'same_as_title');
});

test('Wikidata is reached only through agreeing exact identifiers; ARTE episodes do not time the work', async () => {
  let web=fakeWeb({},[sparql(['Q1','Q2'])]);
  const both={id:'w-2025',title:'W',links:{imdb:IMDB_URL,sc:SC_URL}};
  let [result]=await resolveWorks({works:[both],targets:[both],fetcher:web.fetcher,...options});
  assert.match(result.attempts.find(a=>a.source==='wikidata').why,/several Wikidata items: Q1, Q2/);

  const wiki='https://fr.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item%7Cdisambiguation&titles=';
  web=fakeWeb({[wiki+'Paris%2C_Texas&format=json&formatversion=2']:json({query:{pages:[{title:'Paris, Texas',pageprops:{disambiguation:''}}]}})});
  const paris={id:'paris-texas-1984',title:'Paris, Texas',links:{wiki:'https://fr.wikipedia.org/wiki/Paris,_Texas'}};
  [result]=await resolveWorks({works:[paris],targets:[paris],fetcher:web.fetcher,...options});
  assert.match(result.attempts.find(a=>a.source==='wikidata').why,/disambiguation/);

  web=fakeWeb({[wiki+'Paris%2C_Texas&format=json&formatversion=2']:json({query:{pages:[{title:'Paris, Texas',pageprops:{wikibase_item:'Q9'}}]}}),
    [WD_ENTITY('Q9')]:json(entity('Q9',filmClaims({imdb:'tt0087884'})))},[sparql(['Q9']),labels]);
  const mixed={...paris,links:{...paris.links,imdb:'https://www.imdb.com/title/tt0000001/'}};
  [result]=await resolveWorks({works:[mixed],targets:[mixed],fetcher:web.fetcher,...options});
  assert.match(result.attempts.find(a=>a.source==='wikidata').why,/several Wikidata items|another IMDb identifier/);

  web=fakeWeb({'https://api-cdn.arte.tv/api/player/v2/config/fr/130381-000-A':json({data:{attributes:{metadata:{providerId:'130381-000-A_CLIP',duration:{seconds:74}}}}})});
  const offAir={id:'interstellar-2014',title:'Interstellar',links:{official:'https://www.arte.tv/fr/videos/130381-000-A/interstellar/'}};
  [result]=await resolveWorks({works:[offAir],targets:[offAir],fetcher:web.fetcher,...options});
  assert.match(result.attempts.find(a=>a.source==='arte').why,/describes 130381-000-A_CLIP, not the programme/,'a trailer does not time the film');

  web=fakeWeb({});
  const episode={id:'l-empire-lvmh',title:'L’empire LVMH',links:{official:'https://www.arte.tv/fr/videos/122704-001-A/l-empire-lvmh-1-2/'}};
  [result]=await resolveWorks({works:[episode],targets:[episode],fetcher:web.fetcher,...options});
  assert.match(result.attempts.find(a=>a.source==='arte').why,/is an episode/);
  assert.equal(web.calls.length,0);

  const press={id:'doc',title:'Doc',links:{official:'https://www.francetvpro.fr/contenu-de-presse/76812156'}};
  [result]=await resolveWorks({works:[press],targets:[press],fetcher:web.fetcher,...options});
  assert.match(result.why,/no metadata source reads these identities \(francetvpro\)/);
  const none={id:'tony',title:'Tony'};
  [result]=await resolveWorks({works:[none],targets:[none],fetcher:web.fetcher,...options});
  assert.match(result.why,/no exact identity link/);
  assert.equal(web.calls.length,0,'nothing is fetched without an exact identity');
});

test('original title and ratings: written only into empty fields, never over another work’s title', async () => {
  const page=scPage({alternateName:'The Future Awaits',rating:{ratingValue:6.9,ratingCount:5123,bestRating:10}});
  const {fetcher}=fakeWeb({[SC_URL]:html(page)});
  const base={id:'la-venue-de-l-avenir-2025',title:'La Venue de l’avenir',links:{sc:SC_URL}};
  const cases=[
    [{...base},'proposed','proposed'],
    [{...base,aliases:['Colors of Time']},'blocked','proposed'],
    [{...base,ratings:{sc:'6,9/10 (5,1 k)'},ratings_checked:'2026-10-01'},'proposed','agrees'],
    [{...base,ratings:{senscritique:'7,1'},ratings_checked:'2026-09-01'},'proposed','differs'],
    [{...base,ratings_unavailable_reason:'Coffret de deux films notés séparément.'},'proposed','blocked']];
  for(const [work,titleStatus,ratingStatus] of cases){
    const [result]=await resolveWorks({works:[work],targets:[work],fetcher,...options});
    assert.equal(result.fields.original_title.status,titleStatus,JSON.stringify(work));
    assert.equal(result.ratings.senscritique.status,ratingStatus,JSON.stringify(work));
  }
  const [first]=await resolveWorks({works:[cases[0][0]],targets:[cases[0][0]],fetcher,...options});
  assert.deepEqual(first.update.aliases,['The Future Awaits']);
  const taken={id:'the-future-awaits-2019',title:'The Future Awaits'};
  const [blocked]=await resolveWorks({works:[base,taken],targets:[base],fetcher,...options});
  assert.equal(blocked.fields.original_title.status,'blocked');
  assert.match(blocked.fields.original_title.why,/already names the-future-awaits-2019/);
});

test('helpers: durations, years, catalogue agreement and the house ratings note', () => {
  assert.equal(isoMinutes('PT1H45M'),105);
  assert.equal(isoMinutes('PT58M30S'),59);
  assert.equal(isoMinutes('P1D'),null);
  assert.equal(catalogueMinutes('1 h 33'),93);
  assert.equal(catalogueMinutes('110 min (site officiel A24)'),110);
  assert.equal(catalogueMinutes('2 h'),120);
  assert.equal(expectedYear({id:'le-samourai-1967'}),1967);
  assert.equal(expectedYear({id:'x-1967',year:2021}),2021);
  assert.equal(expectedYear({id:'blade-runner-2049'}),2049);
  assert.equal(expectedYear({id:'tony'}),null);
  assert.equal(catalogueAgreement('duration',{duration:'1 h 45 (version cinéma)'},'105 min'),'agrees');
  assert.equal(catalogueAgreement('director',{director:'Jean-Pierre Dardenne / Luc Dardenne'},'Luc Dardenne / Jean-Pierre Dardenne'),'agrees');
  assert.equal(catalogueAgreement('creator',{creator:'Nathalie Masduraud et Valérie Urrea'},'Valérie Urrea / Nathalie Masduraud'),'agrees');
  assert.equal(catalogueAgreement('country',{country:'Trinité-et-Tobago'},'Trinité-et-Tobago'),'agrees');
  assert.equal(catalogueAgreement('year',{year:''},'2020'),'empty');
  assert.equal(ratingsNote({imdb:{value:'6,3',votes:181},senscritique:{value:'6,2',votes:732}},'2026-10-16'),
    'IMDb 6,3/10 sur 181 votes et SensCritique 6,2/10 sur 732 notes, relevés le 2026-10-16 sur les fiches liées.');
});

test('CLI: week or works, --apply refused on a sealed week, nothing written without identity', () => {
  assert.throws(()=>parseCli([]),/Usage/);
  assert.throws(()=>parseCli(['--week','S43']),/YYYY-Sxx/);
  assert.throws(()=>parseCli(['--week','2026-S43','--force']),/unknown flag/);
  assert.deepEqual(parseCli(['--week','2026-S43','--work','a','--apply']),{works:['a'],apply:true,intervalMs:1200,week:'2026-S43'});
  assert.match(applyRefusal({stage:'ready'}),/reopen it/);
  assert.match(applyRefusal({stage:'enrichment',editorial_review_completed:true}),/sealed/);
  assert.equal(applyRefusal({stage:'enrichment'}),null);

  const script=fileURLToPath(new URL('./work-resolver.mjs',import.meta.url));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-work-cli-'));
  try {
    fs.mkdirSync(path.join(dir,'data/weeks'),{recursive:true});fs.mkdirSync(path.join(dir,'data/research'));
    const works=JSON.stringify({updated:'2026-10-01',works:[{id:'tony',title:'Tony'}]},null,2)+'\n';
    fs.writeFileSync(path.join(dir,'data/works.json'),works);
    fs.writeFileSync(path.join(dir,'data/links.json'),JSON.stringify({links:{}}));
    fs.writeFileSync(path.join(dir,'data/editorial-config.json'),JSON.stringify({quality_gates:{remote_image_health_from_week:'2026-S40'}}));
    fs.writeFileSync(path.join(dir,'data/weeks/2026-S43.json'),JSON.stringify({pages:[{id:'samedi-selection',html:'<article class="feature"><h3>Tony</h3></article>'}],personalization:{pools:{}}}));
    fs.writeFileSync(path.join(dir,'data/research/2026-S43.json'),JSON.stringify({stage:'ready',editorial_review_completed:true}));
    const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot};
    let run=spawnSync(process.execPath,[script,'--week','2026-S43','--apply'],{cwd:dir,encoding:'utf8',env});
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/ready or sealed checkpoint/);
    run=spawnSync(process.execPath,[script,'--week','2026-S43','--report','report.json'],{cwd:dir,encoding:'utf8',env});
    assert.equal(run.status,0,run.stdout+run.stderr);
    assert.match(run.stdout,/tony: unresolved — no exact identity link/);
    run=spawnSync(process.execPath,[script,'--work','tony','--apply'],{cwd:dir,encoding:'utf8',env});
    assert.equal(run.status,0,run.stdout+run.stderr);
    assert.equal(fs.readFileSync(path.join(dir,'data/works.json'),'utf8'),works);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8')).summary.status.unresolved,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
