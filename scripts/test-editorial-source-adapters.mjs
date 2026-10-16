import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSource,collectSources,tv5mondeUrl,tv5mondeSources,paginationGaps,tele7joursSources,TELE7JOURS_CHANNELS} from './editorial-source-collector.mjs';

const tv5=(date,page)=>({id:`tv5-${date}-${page}`,adapter:'tv5monde-psi-json',url:tv5mondeUrl(date,page),channel:'TV5MONDE',date});
const tv5Body=(page,programs,total=programs.length,pages=1)=>JSON.stringify({success:true,data:{programs,
  pagination:{page,limit:10,total_products:total,total_pages:pages}}});
const prog=(publishDate,title,episodeTitle=null,channelId=6)=>({id:1,originId:2,title,episodeTitle,publishDate,duration:'00:52',category:'Séries',channelId,timezone:'Europe/Paris'});

test('TV5MONDE official grid keeps civil dates across midnight and the October time change',()=>{
  const body=tv5Body(1,[prog('2026-10-24T21:01:00+02:00','Je sais pas','Épisode 3'),prog('2026-10-25T02:40:00+01:00','Le mensonge','La chute'),
    prog('2026-10-24T22:00:00+02:00','Hors flux',null,18)],3,1);
  const parsed=parseSource(body,tv5('2026-10-24',1));
  assert.equal(parsed.status,'partial');assert.deepEqual(parsed.pagination,{page:1,total_pages:1,total_products:3});
  assert.deepEqual(parsed.observations.map(o=>[o.date,o.start,o.title]),[['2026-10-24','21:01','Je sais pas Épisode 3'],['2026-10-25','02:40','Le mensonge La chute']]);
  assert.equal(parsed.observations[0].source,'TV5MONDE — guide officiel (flux FBS)');
  assert.match(parsed.errors[0].message,/FBS/);
});

test('TV5MONDE pages after the last one are explicit, while an empty first page is a failure',()=>{
  const beyond=parseSource(tv5Body(6,[],0,0),tv5('2026-10-24',6));
  assert.equal(beyond.status,'beyond_last_page');assert.equal(beyond.observations.length,0);
  assert.throws(()=>parseSource(tv5Body(1,[],0,0),tv5('2026-10-24',1)),/first page is empty/);
  assert.throws(()=>parseSource(tv5Body(2,[prog('2026-10-24T08:00:00+02:00','X')],11,2).replace('"page":2','"page":3'),tv5('2026-10-24',2)),/page mismatch/);
  assert.throws(()=>parseSource('{"success":false}',tv5('2026-10-24',1)),/not successful/);
});

test('TV5MONDE identity is the exact FBS endpoint for the requested date and page',()=>{
  const ok=tv5('2026-10-24',1);
  assert.throws(()=>parseSource('{}',{...ok,url:ok.url.replace('channel=6','channel=18')}),/official FBS/);
  assert.throws(()=>parseSource('{}',{...ok,date:'2026-10-25'}),/official FBS/);
  assert.throws(()=>parseSource('{}',{...ok,channel:'TV5MONDE Info'}),/channel mismatch/);
  assert.throws(()=>parseSource('{}',{...ok,url:tv5mondeUrl('2026-10-24',11)}),/page must be/);
  assert.equal(tv5mondeSources('2026-10-24',{pages:2}).length,16);
  assert.equal(tv5mondeSources('2026-10-24')[0].date,'2026-10-23');
});

test('pagination gaps report missing pages and count mismatches, never an empty schedule',()=>{
  const row=(date,page,status,count,total,pages)=>({adapter:'tv5monde-psi-json',url:tv5mondeUrl(date,page),date,status,observations_count:count,
    pagination:status==='beyond_last_page'?{page,total_pages:0,total_products:0}:{page,total_pages:pages,total_products:total}});
  const complete=[row('2026-10-24',1,'parsed',10,14,2),row('2026-10-24',2,'parsed',4,14,2),row('2026-10-24',3,'beyond_last_page',0)];
  assert.deepEqual(paginationGaps(complete),[]);
  assert.deepEqual(paginationGaps([row('2026-10-24',1,'parsed',10,14,2)]),[{date:'2026-10-24',reason:'pages missing or unparsed',pages:[2]}]);
  assert.equal(paginationGaps([row('2026-10-24',1,'parsed',10,15,2),row('2026-10-24',2,'parsed',4,15,2)])[0].reason,'observation count differs from total_products');
  assert.equal(paginationGaps([{adapter:'tv5monde-psi-json',url:tv5mondeUrl('2026-10-25',1),date:'2026-10-25',status:'unparsed'}])[0].reason,'first page unavailable');
});

const t7j=(slug,suffix,date,channel=TELE7JOURS_CHANNELS[slug])=>({id:`t7j-${slug}-${date}`,adapter:'tele7jours-html',
  url:`https://www.programme-television.org/tv/chaines/${slug}/${suffix}`,channel,date});
const row=(time,title,season='')=>`<li class="tvgrid-broadcast__item"><div class="tvgrid-broadcast__wrapper"><div class="tvgrid-broadcast__details"><a class="tvgrid-broadcast__wrapper--link" href="/type/films/x-${time.replace(':','')}"><div class="tvgrid-broadcast__details-in"><div class="tvgrid-broadcast__details-time">${time}</div><div class="tvgrid-broadcast__details-title"> <span>${title}</span> </div><div class="tvgrid-broadcast__details-season">${season}</div><div class="tvgrid-broadcast__subdetails"> 106 mins | Films dramatiques </div></div></a></div></div></li>`;
const page=(canonical,title,rows)=>`<html><head><title>${title}</title><link rel="canonical" href="${canonical}" /></head><body><ul class="tvgrid-broadcast__list">${rows.join('')}</ul></body></html>`;

test('Télé 7 Jours pages prove their date in the title and roll over after midnight',()=>{
  const src=t7j('cine-club','mardi','2026-10-20');
  const parsed=parseSource(page(src.url,'Programme TV Ciné+ Club mardi 20 octobre | Télé 7 Jours',
    [row('18:51','Mollusk'),row('19:04','Left-handed girl'),row('22:42','La L&eacute;gende du roi crabe','Saison 1 - &Eacute;pisode 2'),row('00:21','Le maître du Kabuki')]),src);
  assert.equal(parsed.status,'parsed');
  assert.deepEqual(parsed.observations.map(o=>[o.date,o.start,o.title]),[['2026-10-20','18:51','Mollusk'],['2026-10-20','19:04','Left-handed girl'],
    ['2026-10-20','22:42','La Légende du roi crabe Saison 1 - Épisode 2'],['2026-10-21','00:21','Le maître du Kabuki']]);
  assert.equal(parsed.observations[0].channel,'Ciné+ Festival');
  const tf1=t7j('tf1','vendredi','2026-10-23');
  assert.equal(parseSource(page(tf1.url.replace('/tf1/','/TF1/'),'Programme TV TF1 vendredi 23 octobre | Télé 7 Jours',[row('20:10','Journal')]),tf1).status,'parsed');
});

test('Télé 7 Jours wrong, undated or truncated pages never pass as a schedule',()=>{
  const src=t7j('tf1','samedi','2026-10-24');
  assert.throws(()=>parseSource(page(src.url,'Programme TV TF1  | Télé 7 Jours',[row('20:10','X')]),src),/date does not match/);
  assert.throws(()=>parseSource(page(src.url,'Programme TV TF1 samedi 17 octobre | Télé 7 Jours',[row('20:10','X')]),src),/date does not match/);
  assert.throws(()=>parseSource(page('https://www.programme-television.org/tv/chaines/','Programme TV TF1 samedi 24 octobre | Télé 7 Jours',[row('20:10','X')]),src),/canonical/);
  const truncated=parseSource(page(src.url,'Programme TV TF1 samedi 24 octobre | Télé 7 Jours',[row('20:10','X')])+'<div class="tvgrid-broadcast__details-time">21:00</div>',src);
  assert.equal(truncated.status,'partial');assert.match(truncated.errors[0].message,/truncated/);
  const first=t7j('tf1','dimanche','2026-11-01');
  assert.equal(parseSource(page(first.url,'Programme TV TF1 dimanche 1er novembre | Télé 7 Jours',[row('09:00','X')]),first).status,'parsed');
});

test('Télé 7 Jours identity follows the channel table and its weekday',()=>{
  assert.throws(()=>parseSource('',t7j('tv5monde-europe','samedi','2026-10-24','TV5MONDE')),/unsupported Télé 7 Jours/);
  assert.throws(()=>parseSource('',t7j('tf1','dimanche','2026-10-24')),/weekday/);
  assert.throws(()=>parseSource('',{...t7j('tf1','samedi','2026-10-24'),channel:'M6'}),/channel mismatch/);
  assert.throws(()=>parseSource('',{...t7j('tf1','samedi','2026-10-24'),url:'https://www.programme-television.org/tv/chaines/tf1/samedi?x=1'}),/parameters/);
});

test('Télé 7 Jours plans use weekday pages 1-7 days ahead, -prochain 8-13 days ahead, and list the rest',()=>{
  const plan=tele7joursSources('2026-10-24',{today:'2026-10-16',channels:['TF1']});
  const byDate=Object.fromEntries(plan.sources.map(s=>[s.date,s.url.split('/').pop()]));
  assert.equal(byDate['2026-10-23'],'vendredi');assert.equal(byDate['2026-10-24'],'samedi-prochain');assert.equal(byDate['2026-10-29'],'jeudi-prochain');
  assert.deepEqual(plan.unreachable,['2026-10-30']);
  assert.throws(()=>tele7joursSources('2026-10-24',{today:'2026-10-16',channels:['TV5MONDE']}),/no Télé 7 Jours slug/);
});

test('429 responses wait for Retry-After and minIntervalMs paces one host',async()=>{
  const waits=[],src=t7j('tf1','samedi','2026-10-24'),ok=page(src.url,'Programme TV TF1 samedi 24 octobre | Télé 7 Jours',[row('20:10','X')]);
  let calls=0;
  const fetchImpl=async url=>{calls++;if(calls===1)return {ok:false,status:429,url,headers:new Headers({'retry-after':'3'}),text:async()=>''};
    return {ok:true,status:200,url,headers:new Headers(),text:async()=>ok};};
  const report=await collectSources({schema_version:1,sources:[src]},{fetchImpl,retries:1,sleep:async ms=>{waits.push(ms);}});
  assert.equal(report.source_results[0].status,'parsed');assert.deepEqual(waits,[3000]);
  const paced=[];const second={...t7j('m6','samedi','2026-10-24')};
  const okFor=s=>page(s.url,`Programme TV ${s.channel} samedi 24 octobre | Télé 7 Jours`,[row('20:10','X')]);
  await collectSources({schema_version:1,sources:[src,second]},{concurrency:1,minIntervalMs:1500,sleep:async ms=>{paced.push(ms);},
    fetchImpl:async url=>({ok:true,status:200,url,headers:new Headers(),text:async()=>okFor(url.includes('/m6/')?second:src)})});
  assert.equal(paced.length,1);assert(paced[0]>0&&paced[0]<=1500);
  await assert.rejects(collectSources({schema_version:1,sources:[]},{minIntervalMs:-1}),/minIntervalMs/);
});

test('the wide plan keeps official grids official and paces only Télé 7 Jours channels without one',async()=>{
  const {wideSourcePlan,pythonCommand}=await import('./editorial-production-flow.mjs');
  const plan=wideSourcePlan('2026-S44',{today:'2026-10-16'});
  const guide=plan.sources.filter(s=>s.adapter==='tele7jours-html');
  for(const channel of ['Arte','France 2','France 3','France 4','France 5','TV5MONDE'])assert(!guide.some(s=>s.channel===channel),channel+' must stay on its official grid');
  assert.equal(new Set(guide.map(s=>s.channel)).size,23);
  assert.equal(plan.sources.filter(s=>s.adapter==='tv5monde-psi-json').length,48);
  assert(plan.sources.length<=400);assert.deepEqual(plan.unreachable_guide_dates,['2026-10-30']);
  assert.equal(pythonCommand({},'win32'),'python');assert.equal(pythonCommand({},'linux'),'python3');
  assert.equal(pythonCommand({SELECTION_TV_PYTHON:'C:/Python314/python.exe'},'win32'),'C:/Python314/python.exe');
});
