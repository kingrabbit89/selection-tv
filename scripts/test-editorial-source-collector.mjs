import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseSource,collectSources,sourcePlanFromInventory} from './editorial-source-collector.mjs';

const arte={id:'arte-10',adapter:'arte-guide-html',url:'https://www.arte.tv/fr/guide/20261010/',channel:'Arte',date:'2026-10-10'};
const f2={id:'f2-10',adapter:'francetvpro-grid-html',url:'https://www.francetvpro.fr/grille/france-2/10-10-2026/10-10-2026',channel:'France 2',date:'2026-10-10'};
const xml={...f2,id:'f2-week',adapter:'francetvpro-grid-xml',url:'https://www.francetvpro.fr/grille-xml/france-2/10-10-2026'};
// Structural excerpts of raw official captures taken on 2026-10-09, not an
// assumed JSON-LD/XMLTV format. Unrelated image/UI content is omitted.
const arteRow=(time,title,subtitle='')=>`<li class="ds-wjuije" data-testid="tsguide-itm"><div><span>${time}</span></div><div data-testid="ts-tsItem"><a data-testid="ts-tsItemLink" href="/fr/videos/083910-000-A/thorin-le-dernier-neandertalien/"><h3 data-testid="ts-tsTitle">${title}</h3>${subtitle?`<p data-testid="ts-tsSubtitle">${subtitle}</p>`:''}</a></div></li>`;
const arteBody=`<html><head><link rel="canonical" href="${arte.url}"/></head><body><ul>${arteRow('05:05','Le dessous des cartes','Médicaments : un marché mondial')}${arteRow('23:20','Thorin, le dernier Néandertalien')}${arteRow('00:20','Abel Selaocoe','Festival de musique du Rheingau 2025')}</ul></body></html>`;
const f2Body=`<link rel="canonical" href="${f2.url}"/><div class="program-item"><div class="program-item__time"><time datetime="2026-10-10T03:00:00+00:00">05.00</time></div><a href="#" class="program-item__name">Pays et marchés du monde</a><div class="program-item__description">Mayotte - Petite terre</div></div><div class="program-item"><div class="program-item__time"><time datetime="2026-10-10T22:05:00+00:00">00.05</time></div><a href="#" class="program-item__name">Quelle époque !</a></div>`;
const xmlBody='<?xml version="1.0"?><response><item key="78564372"><title>Pays et Marchés du Monde</title><subtitle>Mayotte - Petite Terre</subtitle><diffusion_date>2026-10-10T05:00:00</diffusion_date><duration><value>00:06</value></duration></item><item key="last"><title>Le Livreur de Noël</title><diffusion_date>2026-10-17T02:25:00</diffusion_date></item></response>';
const response=(body,status=200,url=arte.url)=>new Response(body,{status,headers:{'content-type':'text/html'}});
const plan=sources=>({schema_version:1,sources});

test('observed ARTE SSR rows retain titles/subtitles and correct next civil day after midnight',()=>{
  const parsed=parseSource(arteBody,arte);
  assert.equal(parsed.status,'parsed');assert.equal(parsed.observations.length,3);
  assert.deepEqual(parsed.observations.map(o=>[o.date,o.start]),[['2026-10-10','05:05'],['2026-10-10','23:20'],['2026-10-11','00:20']]);
  assert.equal(parsed.observations[0].title,'Le dessous des cartes Médicaments : un marché mondial');
  assert.equal(parsed.details[2].subtitle,'Festival de musique du Rheingau 2025');
  assert(parsed.warnings[0].includes('previous guide'));
});
test('observed FranceTVPro HTML uses explicit offset rather than the page date or printed time',()=>{
  const parsed=parseSource(f2Body,f2);
  assert.equal(parsed.status,'parsed');assert.deepEqual(parsed.observations.map(o=>[o.date,o.start]),[['2026-10-10','05:00'],['2026-10-11','00:05']]);
  assert.equal(parsed.details[1].source_datetime,'2026-10-10T22:05:00+00:00');
  assert.throws(()=>parseSource(f2Body,{...f2,date:'2026-10-16'}),/date mismatch/);
  assert.throws(()=>parseSource(f2Body.replace('T03:00:00+00:00','T03:00:00'),f2),/no event on the requested/);
  assert.throws(()=>parseSource(f2Body,{...f2,url:f2.url.replace('france-2','france-3'),channel:'France 3'}),/canonical channel/,'a France 2 body cannot become France 3');
  const wrongDay=f2Body.replace('T22:05:00+00:00','T07:05:00+00:00').replace('2026-10-10T07','2026-10-11T07');
  assert.equal(parseSource(wrongDay,f2).status,'partial','next-day morning is not silently accepted as overnight');
});
test('real FranceTVPro response/item XML is local civil time, not XMLTV or a fabricated channel',()=>{
  const parsed=parseSource(xmlBody,xml);
  assert.equal(parsed.status,'parsed');assert.equal(parsed.observations[1].date,'2026-10-17');
  assert.equal(parsed.details[0].provider_id,'78564372');assert.equal(parsed.details[0].slot_duration,'00:06');
  assert.throws(()=>parseSource(xmlBody,{...xml,channel:'France 3'}),/channel mismatch/);
  assert.throws(()=>parseSource(xmlBody.replace('</item>',''),xml),/unbalanced XML/);
  assert.throws(()=>parseSource(xmlBody.replace('</item>','<unclosed></item>'),xml),/unbalanced XML/);
  const late=parseSource(xmlBody.replace('2026-10-17T02:25:00','2026-10-17T21:00:00'),xml);
  assert.equal(late.status,'partial');assert.equal(late.observations.length,1,'last-date carry-out is confined to overnight');
  assert.throws(()=>parseSource('<tv><programme/></tv>',xml),/response XML missing/);
});
test('generic HTML, challenge pages, stale canonical dates and unsupported providers never parse successfully',()=>{
  assert.throws(()=>parseSource('<html><h1>Site Unavailable</h1></html>',arte),/challenge\/unavailable/);
  assert.throws(()=>parseSource('<html>12:00 A title</html>',arte),/canonical/);
  assert.throws(()=>parseSource(arteBody+'<form id="challenge-form">Verify you are human</form>',arte),/challenge\/unavailable/);
  assert.throws(()=>parseSource(arteBody.replace('20261010/','20261009/'),arte),/canonical/);
  assert.throws(()=>parseSource(arteBody,{...arte,url:'https://unrelated.test/fr/guide/20261010/'}),/requires arte.tv/);
  assert.throws(()=>parseSource(xmlBody,{...xml,date:'2026-02-30'}),/invalid calendar/);
  assert.throws(()=>parseSource(arteBody,{...arte,adapter:'auto'}),/unsupported adapter/);
});
test('malformed ARTE rows produce an explicitly partial source without inventing missing facts',()=>{
  const parsed=parseSource(arteBody.replace('23:20','25:20'),arte);
  assert.equal(parsed.status,'partial');assert.equal(parsed.errors.length,2,'unknown late row also leaves the following midnight rollover unproved');
  assert(parsed.observations.every(o=>o.start!=='25:20'));
  const changed=parseSource(arteBody.replace('05:05','00:05'),arte);
  assert.equal(changed.status,'partial');assert(!changed.observations.some(o=>o.start==='00:05'),'unknown first-row format stays unparsed');
  const truncated=parseSource(arteBody.replace(/<\/li><\/ul>/,'</ul>'),arte);
  assert.equal(truncated.status,'partial');assert(truncated.errors.some(e=>/truncated/.test(e.message)),'a missing row close cannot be silently certified as parsed');
});
test('collection bounds concurrency, retries transient failures and keeps independent source observations distinct',async()=>{
  let active=0,peak=0,calls=0;const attempts=new Map();
  const sources=Array.from({length:5},(_,i)=>({...arte,id:'a'+i,date:'2026-10-'+(10+i),url:'https://www.arte.tv/fr/guide/202610'+(10+i)+'/'}));
  const fetchImpl=async url=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,3));active--;return response(arteBody.replace(arte.url,url));};
  const report=await collectSources(plan(sources),{fetchImpl,concurrency:2,retries:0});
  assert.equal(calls,5);assert(peak<=2);assert.equal(report.source_results.length,5);
  assert.equal(report.observations.length,15,'different acquired dates retain their distinct observations');
  assert.equal(report.publication_ready,false);assert.equal(report.coverage_certified,false);
  const retry=await collectSources(plan([arte]),{fetchImpl:async()=>{const n=(attempts.get('a')||0)+1;attempts.set('a',n);return response(n===1?'failure':arteBody,n===1?503:200);},retries:1});
  assert.equal(retry.source_results[0].evidence.attempts,2);assert.equal(retry.source_results[0].status,'parsed');
  const two=await collectSources(plan([arte,f2]),{fetchImpl:async url=>response(url===arte.url?arteBody:f2Body),retries:0});
  assert.equal(two.source_results[1].observations_count,2);assert.equal(two.observations.length,5);
  let duplicateCalls=0;
  const duplicate=await collectSources(plan([arte,{...arte,id:'second-request'}]),{fetchImpl:async()=>{duplicateCalls++;return response(arteBody);},retries:0});
  assert.equal(duplicateCalls,1,'identical URL/scope is acquired once per batch');
  assert.equal(duplicate.observations.length,3,'same-source duplicate observations are kept once');
});
test('HTTP block, timeout, oversized source and redirected wrong provider remain observable failures',async()=>{
  let calls=0;
  const blocked=await collectSources(plan([arte]),{fetchImpl:async()=>{calls++;return response('forbidden',403);},retries:2});
  assert.equal(calls,1);assert.equal(blocked.observations.length,0);assert.equal(blocked.source_results[0].errors[0].http_status,403);
  const timed=await collectSources(plan([arte]),{fetchImpl:()=>new Promise(()=>{}),timeoutMs:5,retries:0});
  assert.match(timed.source_results[0].errors[0].message,/timeout/);
  const large=await collectSources(plan([arte]),{fetchImpl:async()=>response(arteBody),maxBytes:30,retries:0});
  assert.match(large.source_results[0].errors[0].message,/byte limit/);
  const redirected=await collectSources(plan([arte]),{fetchImpl:async()=>({ok:true,status:200,url:'https://other.test/block',headers:new Headers(),text:async()=>arteBody}),retries:0});
  assert.equal(redirected.observations.length,0);assert.match(redirected.source_results[0].errors[0].message,/requires arte.tv/);
});
test('cache preserves original evidence dates, refreshes when expired and falls back only on observed failure',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'selection-source-cache-'));let calls=0;
  try{
    const options={fetchImpl:async()=>{calls++;return response(arteBody);},cacheDir:path.join(dir,'cache'),snapshotDir:path.join(dir,'nested','snapshots'),retries:0,now:'2026-10-09T15:06:12Z'};
    const first=await collectSources(plan([arte]),options);
    assert.equal(first.source_results[0].evidence.mode,'network');
    const raw=await fs.readFile(first.source_results[0].evidence.body_path);
    assert.equal(createHash('sha256').update(raw).digest('hex'),first.source_results[0].evidence.sha256);
    const cached=await collectSources(plan([arte]),{...options,now:'2026-10-09T15:16:12Z'});
    assert.equal(calls,1);assert.equal(cached.source_results[0].evidence.mode,'cache');
    assert.equal(cached.source_results[0].evidence.fetched_at,'2026-10-09T15:06:12.000Z');
    const fresh=await collectSources(plan([arte]),{...options,now:'2026-10-10T15:06:12Z'});
    assert.equal(calls,2);assert.equal(fresh.source_results[0].evidence.mode,'network');
    const stale=await collectSources(plan([arte]),{...options,fetchImpl:async()=>{calls++;return response('blocked',403);},now:'2026-10-11T15:06:12Z'});
    assert.equal(calls,3);assert.equal(stale.source_results[0].evidence.mode,'stale_cache');assert.equal(stale.source_results[0].status,'stale');assert.equal(stale.source_results[0].freshness_verified,false);
    assert.equal(stale.source_results[0].evidence.fetched_at,'2026-10-10T15:06:12.000Z');
    assert.equal(stale.source_results[0].errors[0].http_status,403);
    const refreshed=await collectSources(plan([arte]),{...options,refresh:true,now:'2026-10-10T15:06:12Z'});
    assert.equal(calls,4);assert.equal(refreshed.source_results[0].evidence.fetched_at,'2026-10-10T15:06:12.000Z');
    const cacheFiles=await fs.readdir(options.cacheDir);await fs.writeFile(path.join(options.cacheDir,cacheFiles.find(n=>n.endsWith('.body'))),'truncated');
    const corrupt=await collectSources(plan([arte]),{...options,now:'2026-10-10T15:16:12Z'});
    assert.equal(calls,4);assert.match(corrupt.source_results[0].errors[0].message,/fingerprint/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('provided captures are labeled files and cannot masquerade as a new network consultation',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'selection-source-file-'));
  try{
    const file=path.join(dir,'capture.html');await fs.writeFile(file,arteBody);
    const report=await collectSources(plan([{...arte,input_file:file,captured_at:'2026-10-09T15:06:12Z'}]),{fetchImpl:()=>{throw Error('must not fetch');},snapshotDir:path.join(dir,'snapshots')});
    assert.equal(report.source_results[0].status,'parsed');assert.equal(report.source_results[0].evidence.mode,'provided_file');
    assert.equal(report.source_results[0].evidence.fetched_at,'2026-10-09T15:06:12Z');assert.equal(report.source_results[0].evidence.http_status,null);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('future source plans use observed channel URL templates and do not silently refetch the acquired cycle',()=>{
  const inventory={days:[{date:'2026-10-10',items:[
    {channel:'Arte',source_url:'https://tv-programme.com/arte/samedi-10-octobre-2026/'},
    {channel:'France 2',source_url:'https://tv-programme.com/france-2/samedi-10-octobre-2026/'},
    {channel:'Other',source_url:'https://unrelated.test/guess/'},
    {channel:'Arte',source_url:'https://www.arte.tv/fr/guide/20261010/'}]}]};
  assert.equal(sourcePlanFromInventory(inventory,{from:'2026-10-10'}).sources.length,0);
  const next=sourcePlanFromInventory(inventory,{from:'2026-10-17'});
  assert.equal(next.sources.length,21);assert.equal(next.sources[0].url,'https://tv-programme.com/arte/samedi-17-octobre-2026/');
  assert.equal(next.sources[1].channel,'France 2');assert.equal(next.sources[2].url,'https://www.arte.tv/fr/guide/20261017/');
  assert.equal(next.sources.at(-3).url,'https://tv-programme.com/arte/vendredi-23-octobre-2026/');
  assert.equal(sourcePlanFromInventory(inventory,{from:'2026-10-10',refresh:true}).sources.length,21);
});
test('duplicate IDs and unbounded configuration are rejected before acquisition',async()=>{
  await assert.rejects(collectSources(plan([arte,arte])),/unique source id/);
  await assert.rejects(collectSources(plan([arte]),{concurrency:20}),/concurrency/);
  const unsupported=await collectSources(plan([{...arte,adapter:'tv-programme-html'}]),{fetchImpl:()=>{throw Error('must not fetch unsupported');}});
  assert.equal(unsupported.source_results[0].status,'unsupported');assert.deepEqual(unsupported.observations,[]);
});
