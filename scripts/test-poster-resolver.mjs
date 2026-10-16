import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exactIdentity, linkClaims, identityOwners, workIdentity, hostPacer, resolvePosters, applyResolutions, buildPosterHandoff,
  weekTargets, parseCli, summarize} from './poster-resolver.mjs';
import {visualWorkTitles} from './image-health.mjs';
import {planImport, digest} from './editorial-handoff.mjs';
import {prepareProductionFlow} from './editorial-production-flow.mjs';

const JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,0,16,74,70,73,70]);
const PNG=Buffer.from([137,80,78,71,13,10,26,10,0,0]);
const SC_URL='https://www.senscritique.com/film/la_venue_de_l_avenir/79419902';
const SC_POSTER='https://media.senscritique.com/media/000022815548/300/la_venue_de_lavenir.png';
const SC_POSTER_600='https://media.senscritique.com/media/000022815548/600/la_venue_de_lavenir.png';
const SC_STILL='https://media.senscritique.com/media/000022805935/1200/la_venue_de_lavenir.jpg';

const scPage=({id='79419902',poster=SC_POSTER,year='2025-05-22'}={})=>`<html><head>
<meta content="${SC_STILL}" property="og:image" data-next-head=""/>
<script type="application/ld+json">${JSON.stringify({'@context':'http://schema.org','@type':'Movie',name:'La Venue de l’avenir',
  datePublished:year,image:poster,url:'https://www.senscritique.com/film/la_venue_de_lavenir/'+id})}</script></head></html>`;

// Each route answers one exact URL; anything else fails the test loudly.
function fakeWeb(routes){
  const calls=[];
  const fetcher=async(url,init={})=>{
    calls.push({url,headers:init.headers||{}});
    const route=routes[url];
    if(!route)return new Response('not found',{status:404});
    const answer=typeof route==='function'?route(url,init):route;
    const response=new Response(answer.body??'',{status:answer.status??200,headers:answer.headers||{}});
    if(answer.final)Object.defineProperty(response,'url',{value:answer.final});
    return response;
  };
  return {fetcher,calls};
}
const html=body=>({body,headers:{'content-type':'text/html; charset=utf-8'}});
const json=value=>({body:JSON.stringify(value),headers:{'content-type':'application/json'}});
const image=(bytes=JPEG,type='image/jpeg')=>({body:bytes,headers:{'content-type':type}});
const options={today:'2026-10-16',intervalMs:0,probeDelay:()=>Promise.resolve()};

test('only exact identity links count, and a links.json key shared by two works is ignored', () => {
  const work={id:'la-venue-de-l-avenir',title:'La Venue de l’avenir',links:{
    arte:'https://www.arte.tv/fr/videos/123976-000-A/gomorra/',guide:'https://www.arte.tv/fr/guide/20261014/',
    grid:'https://www.francetvpro.fr/grille/france-5/17-10-2026/16-10-2026',search:'https://www.senscritique.com/recherche?query=venue',
    critique:'https://www.senscritique.com/film/la_venue_de_l_avenir/79419902/critique/1',
    tv5:'https://www.tv5mondeplus.com/api/psi/programs-grid?channel=6&day=2026-10-17#program=128993'}};
  const links={'La Venue de l’avenir':{sc:SC_URL,imdb:'https://www.imdb.com/title/tt31411349/',
    tmdb:'https://www.themoviedb.org/movie/1084242-la-venue-de-l-avenir',official:'https://www.francetvpro.fr/contenu-de-presse/76812156'}};
  const {identity,conflicts}=exactIdentity(work,{links,claims:linkClaims([work])});
  assert.deepEqual(Object.keys(identity).sort(),['arte','francetvpro','imdb','senscritique','tmdb','tv5monde']);
  assert.equal(identity.senscritique.id,'79419902');
  assert.equal(identity.imdb.id,'tt31411349');
  assert.deepEqual([identity.tmdb.kind,identity.tmdb.id],['movie','1084242']);
  assert.equal(identity.arte.id,'123976-000-A');
  assert.equal(identity.tv5monde.grid,'https://www.tv5mondeplus.com/api/psi/programs-grid?channel=6&day=2026-10-17');
  assert.deepEqual(conflicts,[]);
  // A grid without programme id is not an identity.
  assert.equal(exactIdentity({id:'x',title:'X',links:{tv5:'https://www.tv5mondeplus.com/api/psi/programs-grid?channel=6&day=2026-10-17'}}).identity.tv5monde,undefined);

  const remake={id:'la-venue-1950',title:'La Venue de l’avenir',year:1950};
  const shared=exactIdentity(work,{links,claims:linkClaims([work,remake])});
  assert.equal(shared.identity.senscritique,undefined,'title-keyed link is ambiguous between two works');
  assert.match(shared.notes[0],/shared by several works/);

  const conflict=exactIdentity({id:'c',title:'C',links:{imdb:'https://www.imdb.com/title/tt1/'}},
    {links:{C:{imdb:'https://www.imdb.com/title/tt2/'}}});
  assert.equal(conflict.identity.imdb,undefined);
  assert.deepEqual(conflict.conflicts,[{kind:'imdb',ids:['tt1','tt2']}]);
});

test('an identifier claimed by two works identifies neither, from works.json links or links.json', async () => {
  const series='https://www.senscritique.com/serie/the_bear/40985616';
  const s1={id:'the-bear-s1',title:'The Bear (saison 1)',links:{sc:series,imdb:'https://www.imdb.com/title/tt14452776/'}};
  const s2={id:'the-bear-s2',title:'The Bear (saison 2)',links:{sc:series}};
  const remake={id:'remake',title:'Remake',links:{imdb:'https://www.imdb.com/title/tt7/'}};
  const original={id:'original',title:'Original'};
  const film={id:'film',title:'Film',links:{tmdb:'https://www.themoviedb.org/movie/136315'}};
  const show={id:'show',title:'Show',links:{tmdb:'https://www.themoviedb.org/tv/136315-show'}};
  const links={Original:{imdb:'https://www.imdb.com/title/tt7/'}};
  const works=[s1,s2,remake,original,film,show];
  const owners=identityOwners(works,{links});
  const first=workIdentity(s1,{links,owners});
  assert.deepEqual(Object.keys(first.identity),['imdb'],'the season keeps its own identifier');
  assert.deepEqual(first.notes,['senscritique serie/40985616 also claimed by the-bear-s2, ignored']);
  for(const work of [remake,original])
    assert.equal(workIdentity(work,{links,owners}).identity.imdb,undefined,'a works.json link and a links.json key claim alike');
  assert.equal(workIdentity(film,{links,owners}).identity.tmdb.kind,'movie','TMDb movie/N and tv/N are two works');
  assert.equal(workIdentity(show,{links,owners}).identity.tmdb.kind,'tv');
  // Two ids of one kind on a work: both stay claimed by it.
  const muddled={id:'muddled',title:'Muddled',links:{a:'https://www.imdb.com/title/tt8/',b:'https://www.imdb.com/title/tt9/'}};
  const clean={id:'clean',title:'Clean',links:{imdb:'https://www.imdb.com/title/tt9/'}};
  assert.deepEqual(workIdentity(clean,{owners:identityOwners([muddled,clean])}).notes,['imdb tt9 also claimed by muddled, ignored']);

  // The other season would get the series poster: nothing is fetched for it.
  const {fetcher,calls}=fakeWeb({});
  const [result]=await resolvePosters({works,links,targets:[s2],fetcher,...options});
  assert.equal(result.status,'unresolved');
  assert.match(result.why,/no exact identity link/);
  assert.deepEqual(result.notes,['senscritique serie/40985616 also claimed by the-bear-s1, ignored']);
  assert.equal(calls.length,0);
});

test('ladder: SensCritique poster first, IMDb challenge reported not bypassed, French TMDb poster as fallback', async () => {
  const key='v3-secret-key';
  const tmdbBase='https://api.themoviedb.org/3';
  const {fetcher,calls}=fakeWeb({
    [SC_URL]:html(scPage()),
    [SC_POSTER_600]:{status:404},
    [SC_POSTER]:image(PNG,'image/png'),
    'https://www.imdb.com/title/tt31411349/':{status:202,headers:{'x-amzn-waf-action':'challenge'},body:'<html>challenge</html>'},
    [`${tmdbBase}/find/tt31411349?external_source=imdb_id&api_key=${key}`]:json({movie_results:[{id:1084242}],tv_results:[]}),
    [`${tmdbBase}/movie/1084242/images?include_image_language=fr%2Cnull%2Cen&api_key=${key}`]:json({posters:[
      {file_path:'/en.jpg',iso_639_1:'en',vote_average:9},{file_path:'/fr.jpg',iso_639_1:'fr',vote_average:5},{file_path:'/none.jpg',iso_639_1:null}]}),
    'https://image.tmdb.org/t/p/w500/fr.jpg':image()
  });
  const work={id:'la-venue-de-l-avenir',title:'La Venue de l’avenir',year:2025};
  const links={'La Venue de l’avenir':{sc:SC_URL,imdb:'https://www.imdb.com/title/tt31411349/'}};
  const [result]=await resolvePosters({works:[work],links,targets:[work],fetcher,tmdbKey:key,...options});
  assert.equal(result.status,'resolved');
  assert.deepEqual(result.update,{image:SC_POSTER,image_type:'poster',image_source_url:SC_URL,image_checked:'2026-10-16',
    image_strategy:'resolver:senscritique',image_fallbacks:['https://image.tmdb.org/t/p/w500/fr.jpg']});
  const imdbAttempt=result.attempts.find(a=>a.rung==='imdb');
  assert.equal(imdbAttempt.status,202);
  assert.match(imdbAttempt.why,/challenge.*not bypassed/);
  assert.equal(calls.filter(c=>c.url.includes('imdb.com')).length,1,'a challenged page is not retried');
  assert(calls.every(c=>!/google\.|\/recherche|\/search|\/find\?q=/.test(c.url)),'no search page is ever fetched');
  assert(calls.filter(c=>c.url.startsWith('https://media.')||c.url.startsWith('https://image.')).every(c=>!c.headers.Referer&&!c.headers.referer),
    'images are probed without Referer');
  assert(!JSON.stringify(result).includes(key),'the TMDb key never enters the report');
  const {doc,changed}=applyResolutions({updated:'2026-10-01',works:[work]},[result],{today:'2026-10-16'});
  assert.equal(changed,1);
  assert.equal(doc.updated,'2026-10-16');
  assert.equal(doc.works[0].image_strategy,'resolver:senscritique');
  assert.equal(work.image,undefined,'apply works on a copy');
});

test('an HTML body behind an image URL, a redirect to another work and a year mismatch are refused', async () => {
  const work={id:'w',title:'W',year:2025,links:{sc:SC_URL}};
  const html200={body:'<html>not an image</html>',headers:{'content-type':'image/jpeg'}};
  let web=fakeWeb({[SC_URL]:html(scPage()),[SC_POSTER_600]:html200,[SC_POSTER]:html200,[SC_STILL]:image()});
  let [result]=await resolvePosters({works:[work],targets:[work],fetcher:web.fetcher,...options});
  assert.equal(result.update.image,SC_STILL,'falls through to the og:image still');
  assert.equal(result.update.image_type,'still');
  assert.equal(result.attempts.filter(a=>a.why==='non-image response bytes').length,2);

  web=fakeWeb({[SC_URL]:{...html(scPage()),final:'https://www.senscritique.com/film/autre/1234'}});
  [result]=await resolvePosters({works:[work],targets:[work],fetcher:web.fetcher,...options});
  assert.equal(result.status,'unresolved');
  assert.match(result.attempts[0].why,/redirected away from the exact page/);

  web=fakeWeb({[SC_URL]:html(scPage({year:'1950-01-01'}))});
  [result]=await resolvePosters({works:[work],targets:[work],fetcher:web.fetcher,...options});
  assert.equal(result.status,'unresolved');
  assert.match(result.attempts[0].why,/year mismatch/);
});

test('repair replaces a refused primary, keeps working fallbacks and drops dead ones', async () => {
  const dead='https://images.example.test/la-firme.jpg',alive='https://cdn.example.test/ok.jpg',gone='https://gone.example.test/x.jpg';
  const work={id:'la-firme',title:'La Firme',image:dead,image_type:'poster',image_strategy:'hand-picked',
    image_fallbacks:[gone,alive],links:{arte:'https://www.arte.tv/fr/videos/123976-000-A/la-firme/'}};
  const {fetcher}=fakeWeb({[dead]:{status:403},[gone]:{status:404},[alive]:image(),
    'https://api-cdn.arte.tv/api/player/v2/config/fr/123976-000-A':json({data:{attributes:{metadata:{providerId:'123976-000-A',
      images:[{url:'https://api-cdn.arte.tv/img/v2/image/Koi68/940x530'}]}}}}),
    'https://api-cdn.arte.tv/img/v2/image/Koi68/940x530':image()});
  const [result]=await resolvePosters({works:[work],targets:[work],fetcher,repair:true,complete:false,...options});
  assert.equal(result.status,'repaired');
  assert.equal(result.replaced.url,dead);
  assert.equal(result.replaced.status,403);
  assert.deepEqual(result.update,{image:'https://api-cdn.arte.tv/img/v2/image/Koi68/940x530',image_type:'official-program-art',
    image_source_url:'https://www.arte.tv/fr/videos/123976-000-A/la-firme/',image_checked:'2026-10-16',image_strategy:'resolver:arte',
    image_fallbacks:[alive]});

  // A working primary is never replaced, even in repair mode.
  const healthy={...work,image:alive,image_fallbacks:[]};
  const [kept]=await resolvePosters({works:[healthy],targets:[healthy],fetcher,repair:true,complete:false,...options});
  assert.equal(kept.status,'unchanged');
  assert.equal(kept.update,undefined);
});

test('fallbacks come from another host than the kept primary; official programme pages are pinned to their id', async () => {
  const ftv='https://www.francetvpro.fr/contenu-de-presse/76812156';
  const og='https://www.francetvpro.fr/sites/default/files/styles/crop_format_linkedin/public/telechargements/images/phototele-1_0.jpg.webp?itok=Zq';
  const original='https://www.francetvpro.fr/sites/default/files/telechargements/images/phototele-1_0.jpg';
  const grid='https://www.tv5mondeplus.com/api/psi/programs-grid?channel=6&day=2026-10-17';
  const work={id:'doc',title:'Doc',image:'https://media.senscritique.com/media/1/0/doc.jpg',links:{sc:SC_URL,official:ftv,tv5:grid+'#program=42'}};
  const {fetcher,calls}=fakeWeb({[SC_URL]:html(scPage()),
    [ftv]:html(`<meta property="og:url" content="${ftv}" /><meta property="og:image" content="${og.replace('&','&amp;')}" />`),
    [original]:image(),
    [grid]:json({success:true,data:{programs:[{id:41,channelId:6,image:'https://psi.tv5monde.com/media/image/960px/1.jpg'},
      {id:42,channelId:6,image:'https://psi.tv5monde.com/media/image/960px/2.jpg'}]}}),
    'https://psi.tv5monde.com/media/image/960px/2.jpg':image()});
  const [result]=await resolvePosters({works:[work],targets:[work],fetcher,...options});
  assert.equal(result.status,'fallbacks_added');
  assert.deepEqual(result.update,{image_fallbacks:[original,'https://psi.tv5monde.com/media/image/960px/2.jpg']});
  assert(!calls.some(c=>c.url.startsWith('https://media.senscritique.com/')),'same-host SensCritique images are not fallbacks');

  const wrong=fakeWeb({[ftv]:html(`<meta property="og:url" content="https://www.francetvpro.fr/contenu-de-presse/1" /><meta property="og:image" content="${og}" />`),
    [grid]:json({data:{programs:[{id:41,channelId:6,image:'https://psi.tv5monde.com/media/image/960px/1.jpg'}]}})});
  const bare={id:'doc',title:'Doc',links:{official:ftv,tv5:grid+'#program=42'}};
  const [refused]=await resolvePosters({works:[bare],targets:[bare],fetcher:wrong.fetcher,...options});
  assert.equal(refused.status,'unresolved');
  assert.match(refused.attempts.find(a=>a.rung==='francetvpro').why,/is not 76812156/);
  assert.match(refused.attempts.find(a=>a.rung==='tv5monde').why,/absent from the official TV5MONDE grid/);
  const other=fakeWeb({[grid]:json({data:{programs:[{id:42,channelId:7,image:'https://psi.tv5monde.com/media/image/960px/2.jpg'}]}})});
  const tv5Only={id:'doc',title:'Doc',links:{tv5:grid+'#program=42'}};
  const [otherChannel]=await resolvePosters({works:[tv5Only],targets:[tv5Only],fetcher:other.fetcher,...options});
  assert.match(otherChannel.attempts.find(a=>a.rung==='tv5monde').why,/another TV5MONDE channel/);
});

test('without exact identity the existing exception mechanism stays; nothing is fetched', async () => {
  const {fetcher,calls}=fakeWeb({});
  const works=[{id:'tony',title:'Tony'},{id:'agg',title:'Agrégat',image_exception_reason:'Carte d’agrégation sans œuvre unique.'},
    {id:'ok',title:'OK',image:'https://cdn.example.test/ok.jpg',image_fallbacks:['https://other.example.test/ok.jpg']}];
  const results=await resolvePosters({works,targets:works,fetcher,...options});
  assert.deepEqual(results.map(r=>r.status),['unresolved','exception_kept','unchanged']);
  assert.match(results[0].why,/no exact identity link/);
  assert.deepEqual(summarize(results),{works:3,unresolved:1,exception_kept:1,unchanged:1});
  assert.equal(calls.length,0);
  assert.equal(applyResolutions({works},results).changed,0);
});

test('host pacing runs one operation per host at a time, spaced, and leaves other hosts free', async () => {
  let clock=0,active=0,overlap=false;const starts=[];
  const pace=hostPacer({intervalMs:1000,now:()=>clock,sleep:async ms=>{clock+=ms;}});
  const task=url=>pace(url,async()=>{
    if(new URL(url).host==='a.test'){overlap||=active>0;active++;}
    starts.push([new URL(url).host,clock]);
    await new Promise(r=>setImmediate(r));
    if(new URL(url).host==='a.test')active--;
    return url;
  });
  const done=await Promise.all(['https://a.test/1','https://a.test/2','https://b.test/1','https://a.test/3'].map(task));
  assert.deepEqual(done,['https://a.test/1','https://a.test/2','https://b.test/1','https://a.test/3']);
  const at=hostName=>starts.filter(([h])=>h===hostName).map(([,t])=>t);
  const a=at('a.test');
  assert.equal(a.length,3);
  for(let i=1;i<a.length;i++)assert(a[i]-a[i-1]>=1000,'same host waits '+a);
  assert.equal(overlap,false,'one operation per host at a time');
  assert.deepEqual(at('b.test'),[0],'another host does not wait');
  await assert.rejects(pace('https://a.test/x',async()=>{throw Error('boom');}),/boom/);
  assert.equal(await task('https://a.test/4'),'https://a.test/4','a failure does not block the host queue');
});

test('the week set is the validator set: cards, grid rows, pools and radar', () => {
  const issue={pages:[{id:'samedi-selection',html:'<article class="feature"><h3>Film &amp; Co</h3></article><article class="other"><h3>Hors carte</h3></article>'},
    {id:'samedi-grille',html:'<table><tr><td class="prog">Grille</td></tr></table>'}],personalization:{pools:{samedi:{candidates:[{title:'Réserve'}]}}}};
  const radar={hd1:{candidates:[{title:'Radar'}]}};
  const works=['Film & Co','Grille','Réserve','Radar','Hors carte'].map((title,i)=>({id:'w'+i,title}));
  const config={quality_gates:{remote_image_health_from_week:'2026-S40'}};
  const {targets,missing}=weekTargets({week:'2026-S43',issue,works,config,radar:()=>radar});
  assert.deepEqual(targets.map(w=>w.title),[...visualWorkTitles(issue,{radar})]);
  assert.deepEqual(targets.map(w=>w.title).sort(),['Film & Co','Grille','Radar','Réserve']);
  assert.deepEqual(missing,[]);
  assert.deepEqual(weekTargets({week:'2026-S39',issue,works,config,radar}).targets.map(w=>w.title),['Grille'],'legacy issues probe grid rows only');
});

test('production flow: posters resolved for the batch become a reviewed works.json handoff, never a direct write', async () => {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'selection-poster-flow-')),out=path.join(parent,'batch');
  const works={updated:'2026-10-01',works:[{id:'saved-film',title:'Saved film',year:2025,director:'Saved director'}]};
  const context={week:'2026-S42',sha:'a'.repeat(40),
    inventory:{week:'2026-S42',days:[{date:'2026-10-10',items:[{title:'Saved film',start:'20:50',channel:'Arte',source:'Saved guide',source_url:'https://www.arte.tv/fr/guide/20261010/'}]}]},
    research:{week:'2026-S42',stage:'enrichment',remaining:['Complete reserves and coverage'],verification_records:[],research_dossiers:[]},
    coverage:{week:'2026-S42',full_week_reaudit_completed:false,days:[]},
    works,works_source_content:JSON.stringify(works,null,2)+'\n',
    links:{links:{'Saved film':{sc:SC_URL}}},
    issue:{week:'2026-S42',publication_status:'draft',pages:[],personalization:{pools:{}}},historicalIssues:[]};
  const snapshot=structuredClone(context);
  const {fetcher}=fakeWeb({[SC_URL]:html(scPage()),[SC_POSTER_600]:image(PNG,'image/png')});
  try {
    const result=await prepareProductionFlow({week:context.week,ref:context.sha,outDir:out,resolvePosters:true},
      {readContext:()=>context,collect:()=>{throw new Error('no source collection');},
        posterResolver:args=>resolvePosters({...args,fetcher,...options})});
    assert.equal(result.summary.poster_resolution.resolved,1);
    assert.equal(result.summary.publication_ready,false);
    const bundle=JSON.parse(fs.readFileSync(path.join(out,'poster-handoff.json'),'utf8'));
    assert.deepEqual(bundle.files.map(f=>f.path),['data/works.json']);
    assert.equal(bundle.files[0].base_sha256,digest(context.works_source_content));
    assert.equal(JSON.parse(bundle.files[0].content).works[0].image,SC_POSTER_600);
    const report=JSON.parse(fs.readFileSync(path.join(out,'poster-resolution.json'),'utf8'));
    assert.equal(report.results[0].status,'resolved');
    assert.deepEqual(context,snapshot,'the flow does not edit the catalogue');
    const manifest=JSON.stringify({latest:'2026-S41',weeks:[{week:'2026-S42',status:'draft'}]});
    const files={'data/works.json':context.works_source_content,'data/manifest.json':manifest};
    assert.equal(planImport(bundle,p=>files[p]??null).length,1,'the handoff applies to the exact base bytes');

    const sealed=buildPosterHandoff({...context,research:{...context.research,stage:'ready',remaining:[]}},result.poster_resolution.results,{today:'2026-10-16'});
    assert.equal(sealed.bundle,null);
    assert.match(sealed.refused,/ready or sealed/);
    assert.throws(()=>buildPosterHandoff({...context,works_source_content:'{}'},[],{}),/exact base content/);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});

test('CLI: one target selector, dry run writes nothing and an unresolved work fails', () => {
  assert.throws(()=>parseCli([]),/Usage/);
  assert.throws(()=>parseCli(['--week','2026-S43','--work','x']),/Usage/);
  assert.throws(()=>parseCli(['--week','S43']),/YYYY-Sxx/);
  assert.throws(()=>parseCli(['--week','2026-S43','--force']),/unknown flag/);
  assert.deepEqual(parseCli(['--week','2026-S43','--repair','--dry-run']),
    {works:[],repair:true,dryRun:true,all:false,intervalMs:1200,week:'2026-S43'});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-poster-cli-'));
  try {
    fs.mkdirSync(path.join(dir,'data'));
    const works=JSON.stringify({updated:'2026-10-01',works:[{id:'tony',title:'Tony'}]},null,2)+'\n';
    fs.writeFileSync(path.join(dir,'data/works.json'),works);
    fs.writeFileSync(path.join(dir,'data/links.json'),JSON.stringify({links:{}}));
    const run=spawnSync(process.execPath,[fileURLToPath(new URL('./poster-resolver.mjs',import.meta.url)),'--work','tony','--dry-run','--report','report.json'],
      {cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
    assert.equal(run.status,1,run.stdout+run.stderr);
    assert.match(run.stdout,/tony: unresolved — no exact identity link/);
    assert.equal(fs.readFileSync(path.join(dir,'data/works.json'),'utf8'),works);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8')).summary.unresolved,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
