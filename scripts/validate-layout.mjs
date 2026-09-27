/** Browser quality gate for Selection TV.
 * CI installs Playwright/Chromium and runs this script on every push/PR.
 * It tests the current issue dynamically, plus the S40 regression case and legacy issues.
 */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';

const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(resolve(root,'data/manifest.json'),'utf8'));
const targetWeek=process.env.SELECTION_TV_VALIDATE_WEEK||manifest.latest;
const worksData=JSON.parse(await readFile(resolve(root,'data/works.json'),'utf8'));
const normTitle=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const worksByTitle=new Map((worksData.works||[]).map(w=>[normTitle(w.title),w]));
const weeks=[...new Set([targetWeek,'2026-S41','2026-S40','2026-S39','2026-S38','2026-S37'].filter(Boolean))];

const server=createServer(async(req,res)=>{
 const requestUrl=new URL(req.url,'http://localhost');
 // Regression fixture for poster hosts that reject hotlinking only when a
 // Referer is sent. The resolver must retry with referrerPolicy=no-referrer.
 if(requestUrl.pathname==='/__referer-sensitive.svg'){
  if(req.headers.referer){res.writeHead(403);res.end('referer rejected');return}
  res.setHeader('Content-Type','image/svg+xml');
  res.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="white"/></svg>');
  return;
 }
 const path=resolve(root,'.'+decodeURIComponent(requestUrl.pathname).replace(/\/$/,'/index.html'));
 if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return}
 try{
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[extname(path)]||'application/octet-stream');
  res.end(await readFile(path));
 }catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;

let browser;
try{
 browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-dev-shm-usage'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));

 // External poster hosts must never make CI flaky. Force the site's own
 // fallback/resolver path while keeping every local JSON/JS/CSS request real.
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='127.0.0.1'||u.hostname==='localhost')route.continue();
  else route.abort();
 });

 const settle=async()=>{
  await page.waitForFunction(()=>window.SelectionTVLayout);
  await page.evaluate(()=>document.querySelectorAll('img').forEach(i=>i.loading='eager'));
  await page.waitForTimeout(700);
  await page.evaluate(()=>window.SelectionTVLayout.layout());
  await page.waitForTimeout(150);
 };

 const signature=()=>[...document.querySelectorAll('article,tbody tr')].map(e=>({
  text:e.textContent,
  links:[...e.querySelectorAll('a')].map(a=>a.href)
 }));

 const tocState=()=> {
  const source=window.SELECTION_TV_WEEK_DATA?.pages?.find(p=>p.id==='sommaire')?.html||'';
  const parsed=new DOMParser().parseFromString(source,'text/html');
  const read=root=>[...root.querySelectorAll('.toc-link')].map(a=>({
   href:a.getAttribute('href'),
   label:[...a.querySelector('.toc-label')?.childNodes||[]].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ').replace(/\s+/g,' ').trim(),
   sub:a.querySelector('.toc-sub')?.textContent.replace(/\s+/g,' ').trim()||''
  }));
  return {expected:read(parsed),actual:read(document)};
 };

 const exactLinkCheck=()=>[...document.querySelectorAll('.program-actions a,.ratings a')].map(a=>({
  label:a.textContent.trim(),
  href:a.href
 })).filter(x=>{
  const l=x.label.toLowerCase();
  return l.includes('imdb')||l.includes('senscritique');
 });

 const visualCoverage=()=>[...document.querySelectorAll(
  'article.week-card,article.feature,article.list-card,article.platform,article.release-card,article.expire-card,article.radar-card,article.torrent-card'
 )].filter(el=>getComputedStyle(el).display!=='none').map(el=>{
   const selector=el.matches('.feature')
     ? ':scope>.visual>img,:scope>.visual>.canonical-image-fallback,:scope>.visual>.fallback'
     : ':scope>img,:scope>.canonical-image-fallback,:scope>.radar-reserve-fallback,:scope>.release-fallback,:scope>.replacement-fallback';
   const visuals=[...el.querySelectorAll(selector)].filter(v=>{
     const cs=getComputedStyle(v),r=v.getBoundingClientRect();
     return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)>0&&r.width>0&&r.height>0;
   });
   return {
     title:el.dataset.title||el.querySelector('h3')?.textContent?.trim()||'?',
     visibleVisuals:visuals.length,
     kinds:visuals.map(v=>v.tagName.toLowerCase()+'.'+v.className)
   };
 }).filter(x=>x.visibleVisuals!==1);

 const checkDesktopGeometry=async week=>{
  const state=await page.evaluate(()=>{
   const ps=[...document.querySelectorAll('.book>.page')].filter(e=>getComputedStyle(e).display!=='none');
   return {
    tops:ps.map(e=>e.getBoundingClientRect().top+scrollY),
    ids:ps.map(e=>e.id),
    height:document.documentElement.scrollHeight,
    overflow:document.body.dataset.layoutOverflow||''
   };
  });
  assert.equal(state.overflow,'',`${week}: fixed page overflow`);
  for(let i=1;i<state.tops.length;i++)assert(state.tops[i]>state.tops[i-1],`${week}: page order/geometry broken near ${state.ids[i]}`);

  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const bottom=await page.evaluate(()=>({
   y:scrollY,
   max:document.documentElement.scrollHeight-innerHeight,
   innerHeight,
   last:[...document.querySelectorAll('.book>.page')].filter(e=>getComputedStyle(e).display!=='none').at(-1)?.getBoundingClientRect().top
  }));
  assert(Math.abs(bottom.y-bottom.max)<=3,`${week}: cannot scroll to document bottom`);
  assert(bottom.last<bottom.innerHeight,`${week}: last visible page is not reachable`);
  await page.evaluate(()=>window.scrollTo(0,0));
 };

 for(const week of weeks){
  const preview=(process.env.SELECTION_TV_VALIDATE_WEEK&&week===targetWeek)?'?preview=1':'';
  await page.goto(`${origin}/semaines/${week}/${preview}`,{waitUntil:'domcontentloaded'});
  await settle();

  const before=await page.evaluate(signature);
  const toc=await page.evaluate(tocState);
  assert.deepEqual(toc.actual,toc.expected,`${week}: table-of-contents labels/subtitles were mutated by layout`);

  const exact=await page.evaluate(exactLinkCheck);
  for(const x of exact){
   if(x.label.toLowerCase().includes('imdb'))assert(/^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/tt\d+\/?$/.test(x.href),`${week}: non-canonical IMDb link rendered: ${x.href}`);
   if(x.label.toLowerCase().includes('senscritique'))assert(/^https:\/\/www\.senscritique\.com\/(?:film|serie)\/[^?#]+\/\d+\/?$/.test(x.href),`${week}: non-canonical SensCritique link rendered: ${x.href}`);
  }

  const brokenVisuals=await page.evaluate(visualCoverage);
  assert.deepEqual(brokenVisuals,[],`${week}: cards must have exactly one visible visual: ${JSON.stringify(brokenVisuals)}`);

  await page.evaluate(()=>{window.SelectionTVLayout.restore();window.SelectionTVLayout.layout()});
  assert.deepEqual(await page.evaluate(signature),before,`${week}: content and links must survive reflow`);
  await checkDesktopGeometry(week);

  await page.emulateMedia({media:'print'});
  await page.evaluate(()=>window.SelectionTVLayout.layout());
  assert.equal(await page.evaluate(()=>document.body.dataset.layoutOverflow),'',`${week}: print overflow`);
  await page.emulateMedia({media:'screen'});

  for(const width of [390,768,1100]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(120);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${week}: horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:1000});
  console.log(`✓ ${week}: scroll, TOC, exact links, visuals, reflow, print and responsive layout`);
 }

 // Android TV regression: commented schedule rows are text tables on the
 // magazine site, but the Fire TV renderer promotes every one of them to a
 // visual Jellyfin card. Verify the actual TV model has inherited the
 // catalogue poster, year/metadata and ratings before testing personal state.
 const latest=targetWeek;
 const tvQuery=process.env.SELECTION_TV_VALIDATE_WEEK?'?tv=1&preview=1':'?tv=1';
 await page.goto(`${origin}/semaines/${latest}/${tvQuery}`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.stv-tv-shell');
 await page.waitForFunction(()=>Array.isArray(window.SelectionTvAndroidModels));
 const tvGridModels=await page.evaluate(()=>{
   const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
   const norm=s=>clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
   const gridTitles=[...document.querySelectorAll('.page[id$="-grille"] table.schedule .prog,.page[id*="-grille-"] table.schedule .prog')]
     .map(el=>clean(el.childNodes?.[0]?.textContent||el.textContent))
     .filter(Boolean);
   const models=window.SelectionTvAndroidModels||[];
   return [...new Set(gridTitles)].map(title=>{
     const model=models.find(m=>norm(m.title)===norm(title));
     return {
       title,
       exists:!!model,
       posterCount:model?.imageCandidates?.length||0,
       year:String(model?.year||''),
       meta:model?.meta||[],
       ratings:model?.ratings||[],
       imdbId:model?.imdbId||'',
       tmdbId:model?.tmdbId||''
     };
   });
 });
 assert(tvGridModels.length>0,`${latest}: Android TV grid regression found no commented-grid titles`);
 for(const model of tvGridModels){
   assert(model.exists,`${latest}: Android TV grid model missing for ${model.title}`);
   const work=worksByTitle.get(normTitle(model.title));
   assert(work,`${latest}: Android TV grid title absent from works catalogue: ${model.title}`);
   assert(model.posterCount>0,`${latest}: Android TV grid model has no poster candidates: ${model.title}`);
   assert(model.year,`${latest}: Android TV grid model has no year: ${model.title}`);
   assert(model.meta.length>0,`${latest}: Android TV grid model has no metadata: ${model.title}`);
   if(work?.ratings && Object.keys(work.ratings).length){
     assert(model.ratings.length>0,`${latest}: Android TV grid ratings were not hydrated for ${model.title}`);
   }
   const linkText=JSON.stringify(work?.links||{});
   const hasCatalogueIdentity=/imdb\.com\/title\/tt\d+|themoviedb\.org\/(?:movie|tv)\/\d+/i.test(linkText);
   if(hasCatalogueIdentity){
     assert(model.imdbId||model.tmdbId,`${latest}: Android TV grid provider ID was not hydrated for ${model.title}`);
   }
 }
 console.log(`✓ ${latest}: Android TV commented grids inherit posters, metadata, ratings and provider IDs`);

 // Fire TV reserve regression: TV mode used to return before seen-filter.js,
 // so the ranked pools existed in JSON but were completely absent from the
 // APK. Verify every daily selection exposes prepared reserves and that a
 // Jellyfin-played primary can be replaced by one of them.
 const tvReserve=await page.evaluate(()=>{
   const rows=(window.SelectionTvAndroidPersonalizedRows||[]).filter(r=>/-selection$/.test(r.pageId));
   const target=rows.find(r=>(r.reserveModels||[]).length>0);
   if(!target)return {rowCount:rows.length,replaced:false,reserveCount:0};
   const original=target.baseModels?.[0];
   const reserve=target.reserveModels?.[0];
   if(!original||!reserve)return {rowCount:rows.length,replaced:false,reserveCount:target.reserveModels?.length||0};
   original.state='found';original.played=true;
   reserve.state='missing';reserve.played=false;
   window.SelectionTvAndroidRefreshPersonalizedRows?.();
   const visible=[...target.grid.querySelectorAll('.stv-tv-tile-title')].map(x=>x.textContent.trim());
   return {
     rowCount:rows.length,
     reserveCount:target.reserveModels.length,
     replaced:visible.includes(reserve.title)&&!visible.includes(original.title),
     reserveTitle:reserve.title,
     reserveTagged:!![...target.grid.querySelectorAll('.stv-tv-tile')].find(x=>x.querySelector('.stv-tv-tile-title')?.textContent.trim()===reserve.title)?.querySelector('.stv-tv-reserve-tag')
   };
 });
 assert.equal(tvReserve.rowCount,7,`${latest}: Fire TV must expose reserve pools for all 7 daily selections`);
 assert(tvReserve.reserveCount>0,`${latest}: Fire TV daily reserve pool is empty`);
 assert(tvReserve.replaced,`${latest}: Jellyfin-played primary was not replaced by reserve: ${JSON.stringify(tvReserve)}`);
 assert(tvReserve.reserveTagged,`${latest}: Fire TV replacement is not identified as reserve`);
 console.log(`✓ ${latest}: Fire TV daily reserves replace Jellyfin-watched primaries`);

 // Exercise callbacks with absent played state and errors, plus section pools.
 const tvSafety=await page.evaluate(()=>{
   const rows=window.SelectionTvAndroidPersonalizedRows||[];
   const sectionIds=rows.map(r=>r.pageId);
   const results=[];
   for(const id of ['rendezvous-1','sorties-physiques']){
     const row=rows.find(r=>r.pageId===id);
     if(!row)continue;
     const originals=row.baseModels.slice(0,2), reserves=row.reserveModels.slice(0,2);
     originals.forEach(m=>{m.played=true;m.state='found'});
     reserves.forEach(m=>window.SelectionTvAndroidResult({key:m.key,found:true,itemId:'fixture-'+m.key}));
     const unknown=reserves.every(m=>m.played===null&&!row.activeModels.includes(m));
     reserves.forEach(m=>window.SelectionTvAndroidResult({key:m.key,found:true,itemId:'fixture-'+m.key,played:false}));
     const replaced=reserves.every(m=>row.activeModels.includes(m));
     if(reserves[0])window.SelectionTvAndroidResult({key:reserves[0].key,error:'offline'});
     const failedUnknown=!reserves[0]||reserves[0].played===null;
     results.push({id,unknown,replaced,failedUnknown,count:reserves.length});
   }
   return {sectionIds,results,uploads:document.querySelectorAll('.stv-tv-shell .jellyfin-private-upload').length};
 });
 if(latest==='2026-S41')for(const id of ['rendezvous-1','sorties-physiques'])assert(tvSafety.sectionIds.includes(id),'Missing TV section pool '+id);
 for(const result of tvSafety.results){
   assert(result.count>0&&result.unknown&&result.replaced&&result.failedUnknown,JSON.stringify(result));
 }
 assert.equal(tvSafety.uploads,0,'Vos Uploads must remain Web-only');
 console.log('✓ TV callbacks retain unknown state; section reserves replace multiple played items');

 // Functional gate on the current issue: save/seen state and reserve replacement.
 const desktopQuery=process.env.SELECTION_TV_VALIDATE_WEEK?'?preview=1':'';
 await page.goto(`${origin}/semaines/${latest}/${desktopQuery}`,{waitUntil:'domcontentloaded'});
 await settle();

 // Resolver regression: an image can already have failed before the canonical
 // resolver binds. It must retry a later source, clear .visual.broken and hide
 // the legacy fallback instead of leaving the card stuck on a blue block.
 await page.waitForFunction(()=>window.SelectionTVBindImage);
 const imageRecovery=await page.evaluate(async()=>{
   const card=document.createElement('article');
   card.className='feature';
   card.style.cssText='position:fixed;left:0;top:0;width:100px;height:120px;z-index:-1';
   card.innerHTML='<div class="visual broken"><img class="poster" loading="eager" src="/__already-failed.png" alt=""><div class="fallback">Resolver fixture</div></div><h3>Resolver fixture</h3>';
   document.body.append(card);
   const img=card.querySelector('img');
   await new Promise(r=>setTimeout(r,80));
   const good='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="white"/></svg>');
   window.SelectionTVBindImage(img,'Resolver fixture',card,['/__retry-fails.png',good]);
   await new Promise(resolve=>{
     const until=Date.now()+1200;
     const tick=()=>{
       const live=card.querySelector('img');
       if((live&&live.complete&&live.naturalWidth>0)||Date.now()>until)return resolve();
       setTimeout(tick,20);
     };
     tick();
   });
   const live=card.querySelector('img');
   const visual=card.querySelector('.visual');
   const legacy=card.querySelector('.fallback');
   const out={
     loaded:!!live&&live.naturalWidth>0,
     broken:visual?.classList.contains('broken')||false,
     legacyVisible:!!legacy&&getComputedStyle(legacy).display!=='none'
   };
   card.remove();
   return out;
 });
 assert.deepEqual(imageRecovery,{loaded:true,broken:false,legacyVisible:false},`${latest}: canonical image resolver recovery failed: ${JSON.stringify(imageRecovery)}`);
 console.log(`✓ ${latest}: pre-bind image failure recovers through fallback source`);

 // Hotlink regression: first request carries a Referer and is rejected; after
 // binding, the exact same URL must be retried with no Referer and succeed.
 const noRefererRecovery=await page.evaluate(async()=>{
   const card=document.createElement('article');
   card.className='feature';
   card.style.cssText='position:fixed;left:0;top:0;width:100px;height:120px;z-index:-1';
   card.innerHTML='<div class="visual broken"><img class="poster" loading="eager" src="/__referer-sensitive.svg" alt=""><div class="fallback">Referer fixture</div></div><h3>Referer fixture</h3>';
   document.body.append(card);
   const img=card.querySelector('img');
   await new Promise(r=>setTimeout(r,100));
   const failedBefore=img.complete&&img.naturalWidth===0;
   window.SelectionTVBindImage(img,'Referer fixture',card);
   await new Promise(resolve=>{
     const until=Date.now()+1500;
     const tick=()=>{
       const live=card.querySelector('img');
       if((live&&live.complete&&live.naturalWidth>0)||Date.now()>until)return resolve();
       setTimeout(tick,20);
     };
     tick();
   });
   const live=card.querySelector('img');
   const out={
     failedBefore,
     loadedAfter:!!live&&live.naturalWidth>0,
     referrerPolicy:live?.referrerPolicy||'',
     broken:card.querySelector('.visual')?.classList.contains('broken')||false
   };
   card.remove();
   return out;
 });
 assert.deepEqual(noRefererRecovery,{failedBefore:true,loadedAfter:true,referrerPolicy:'no-referrer',broken:false},`${latest}: no-referrer image recovery failed: ${JSON.stringify(noRefererRecovery)}`);
 console.log(`✓ ${latest}: referer-blocked poster is retried without Referer`);

 // Do not replace a poster that has already loaded successfully just because
 // works.json contains another canonical URL.
 const preserveLoaded=await page.evaluate(async()=>{
   const card=document.createElement('article');
   card.className='feature';
   const good='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="white"/></svg>');
   card.innerHTML='<div class="visual"><img class="poster" loading="eager" alt=""></div><h3>Preserve fixture</h3>';
   document.body.append(card);
   const img=card.querySelector('img');
   img.src=good;
   await new Promise(resolve=>img.complete?resolve():img.addEventListener('load',resolve,{once:true}));
   window.SelectionTVImageMap.set('preserve fixture',{title:'Preserve fixture',image:'/__canonical-would-fail.png'});
   const before=img.src;
   window.SelectionTVBindImage(img,'Preserve fixture',card);
   await new Promise(r=>setTimeout(r,80));
   const out={same:img.src===before,loaded:img.naturalWidth>0};
   card.remove();
   window.SelectionTVImageMap.delete('preserve fixture');
   return out;
 });
 assert.deepEqual(preserveLoaded,{same:true,loaded:true},`${latest}: resolver replaced an already-loaded poster`);
 console.log(`✓ ${latest}: already-loaded poster is preserved`);

 await page.evaluate(()=>localStorage.clear());
 await page.reload({waitUntil:'domcontentloaded'});
 await settle();

 const pool=await page.evaluate(()=>{
  const pools=window.SELECTION_TV_WEEK_DATA?.personalization?.pools||{};
  const entry=Object.entries(pools).find(([k,v])=>/-selection$/.test(k)&&v?.page_id);
  return entry?{key:entry[0],pageId:entry[1].page_id}:null;
 });
 if(pool){
  const selector=`#${pool.pageId} .seen-btn,[data-layout-source="${pool.pageId}"] .seen-btn`;
  const seen=page.locator(selector).first();
  assert(await seen.count(),`${latest}: no Seen button on first daily selection pool`);
  await seen.click();await page.waitForTimeout(400);
  const repl=page.locator(`#${pool.pageId} .replacement-generated,[data-layout-source="${pool.pageId}"] .replacement-generated`).first();
  assert(await repl.count(),`${latest}: Seen action did not produce a reserve replacement`);
  assert(await repl.locator('img,.canonical-image-fallback,.replacement-fallback,.radar-reserve-fallback').count(),`${latest}: reserve replacement has no image/fallback`);
  const reserveLinks=await repl.locator('.program-actions a').evaluateAll(as=>as.map(a=>({label:a.textContent.trim(),href:a.href})));
  for(const x of reserveLinks){
   const l=x.label.toLowerCase();
   if(l.includes('imdb'))assert(/^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/tt\d+\/?$/.test(x.href),`${latest}: reserve IMDb link is not exact`);
   if(l.includes('senscritique'))assert(/^https:\/\/www\.senscritique\.com\/(?:film|serie)\/[^?#]+\/\d+\/?$/.test(x.href),`${latest}: reserve SensCritique link is not exact`);
  }
  console.log(`✓ ${latest}: Seen replacement, reserve visual and reserve links`);
 }

 // Section reserve regression: S41 exposed a generic "seen hidden" notice on
 // weekly rendezvous and physical releases but did not refill the page. Recreate
 // the exact failure: four seen rendezvous must still leave five visible cards,
 // and two seen physical releases must still leave four visible cards.
 await page.evaluate(()=>localStorage.clear());
 const sectionReservePools=await page.evaluate(()=>{
   const pools=window.SELECTION_TV_WEEK_DATA?.personalization?.pools||{};
   return !!(pools['rendezvous-1']&&pools['sorties-physiques']);
 });
 if(sectionReservePools){
   await page.evaluate(()=>{
     const pools=window.SELECTION_TV_WEEK_DATA.personalization.pools;
     const seen={};
     for(const c of (pools['rendezvous-1'].candidates||[]).slice(0,4)){
       seen[c.work_id||('title:'+c.title)]={title:c.title,work_id:c.work_id||null,seen_at:new Date().toISOString()};
     }
     for(const c of (pools['sorties-physiques'].candidates||[]).slice(0,2)){
       seen[c.work_id||('title:'+c.title)]={title:c.title,work_id:c.work_id||null,seen_at:new Date().toISOString()};
     }
     localStorage.setItem('selectionTV_seen_v2',JSON.stringify(seen));
     localStorage.setItem('selectionTV_hide_seen_v1','1');
   });
   await page.reload({waitUntil:'domcontentloaded'});
   await settle();
   await page.waitForTimeout(500);

   const sectionReserveState=await page.evaluate(()=>{
     const visible=(root,selector)=>[...root.querySelectorAll(selector)].filter(el=>{
       const cs=getComputedStyle(el),r=el.getBoundingClientRect();
       return !el.classList.contains('seen-hidden')&&cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0;
     });
     const rendezvous=document.getElementById('rendezvous-1');
     const physical=document.getElementById('sorties-physiques');
     if(!rendezvous||!physical)return {missing:true};
     const rv=visible(rendezvous,'article.week-card');
     const ph=visible(physical,'article.release-card');
     return {
       missing:false,
       rendezvousVisible:rv.length,
       rendezvousReplacements:rv.filter(x=>x.classList.contains('replacement-generated')).length,
       rendezvousSummary:rendezvous.querySelector('.reserve-summary')?.textContent||'',
       physicalVisible:ph.length,
       physicalReplacements:ph.filter(x=>x.classList.contains('replacement-generated')).length,
       physicalSummary:physical.querySelector('.reserve-summary')?.textContent||'',
       physicalReplacementTypes:ph.filter(x=>x.classList.contains('replacement-generated')).map(x=>x.className)
     };
   });
   assert.equal(sectionReserveState.missing,false,latest+': section reserve pages missing');
   assert.equal(sectionReserveState.rendezvousVisible,5,latest+': four seen weekly rendezvous must be refilled to five: '+JSON.stringify(sectionReserveState));
   assert(sectionReserveState.rendezvousReplacements>=4,latest+': weekly rendezvous did not draw four replacements: '+JSON.stringify(sectionReserveState));
   assert.match(sectionReserveState.rendezvousSummary,/4 remplacées par la réserve éditoriale/,latest+': weekly rendezvous replacement summary is wrong');
   assert.equal(sectionReserveState.physicalVisible,4,latest+': two seen physical releases must be refilled to four: '+JSON.stringify(sectionReserveState));
   assert(sectionReserveState.physicalReplacements>=2,latest+': physical releases did not draw two replacements: '+JSON.stringify(sectionReserveState));
   assert(sectionReserveState.physicalReplacementTypes.every(x=>/release-card/.test(x)),latest+': physical reserve rendered with the wrong card type');
   assert.match(sectionReserveState.physicalSummary,/2 remplacées par la réserve éditoriale/,latest+': physical release replacement summary is wrong');
   for(const width of [390,768,1100,1440]){
     await page.setViewportSize({width,height:1000});await settle();
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),latest+': section reserves overflow at '+width);
     await checkDesktopGeometry(latest+' section reserves '+width);
   }
   await page.emulateMedia({media:'print'});await settle();
   assert.equal(await page.evaluate(()=>document.body.dataset.layoutOverflow),'',latest+': section reserve print overflow');
   await page.emulateMedia({media:'screen'});await settle();
   console.log('✓ '+latest+': weekly rendezvous and physical-release reserves preserve section targets');
 }

 // Permanent S41 regression: one-page grids must filter seen rows; all card
 // kinds must expose save actions and restore saved state when seen is undone.
 await page.goto(`${origin}/semaines/2026-S41/`,{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>localStorage.clear());
 await page.reload({waitUntil:'domcontentloaded'});await settle();
 const originalGrid=await page.locator('#samedi-grille tbody tr').count();
 const gridTitle=await page.locator('#samedi-grille tbody tr .prog').first().evaluate(el=>el.childNodes[0].textContent.trim());
 await page.locator('#samedi-grille tbody tr .seen-btn').first().click();await settle();
 const gridTitles=await page.locator('#samedi-grille tbody tr').evaluateAll(rows=>rows.map(row=>row.querySelector('.prog').childNodes[0].textContent.trim()));
 assert(!gridTitles.includes(gridTitle),'S41: one-page grid still displays the seen work');
 assert.equal(new Set(gridTitles).size,gridTitles.length,'S41: duplicate grid recommendations');
 assert(gridTitles.length<=originalGrid,'S41: grid exceeds its initial capacity');
 await page.locator('#seenToggle').click();await settle();
 assert.equal(await page.locator('#samedi-grille tbody tr').count(),originalGrid,'show seen must restore all grid rows');
 const release=page.locator('#sorties-physiques article.release-card').first();
 await release.locator('button.save').click();
 assert.equal(await page.locator('#savedCount').textContent(),'1','save counter must update immediately');
 await release.locator('button.seen-btn').click();await settle();
 assert.equal(await page.locator('#savedCount').textContent(),'0');
 await release.locator('button.seen-btn').click();await settle();
 assert.equal(await page.locator('#savedCount').textContent(),'1','undo seen must restore saved state');
 assert.match(await release.locator('button.save').textContent(),/✓/,'undo seen must refresh save button');
 await page.locator('#seenToggle').click();await settle();
 // Repeat geometry after dynamic replacement, including independent horizontal bounds.
 for(const width of [390,768,1100,1440]){
   await page.setViewportSize({width,height:1000});await settle();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'personalized horizontal overflow '+width);
   await checkDesktopGeometry('S41 personalized '+width);
 }
 await page.emulateMedia({media:'print'});await settle();
 assert.equal(await page.evaluate(()=>document.body.dataset.layoutOverflow),'','personalized print overflow');
 await page.emulateMedia({media:'screen'});
 console.log('✓ S41 one-page grid, save/seen/undo, personalized widths and print');

 // Old canonical IDs remain valid as URLs and as saved seen keys.
 await page.evaluate(()=>{localStorage.clear();localStorage.setItem('selectionTV_seen_v2',JSON.stringify({'the-mandalorian-and-grogu-2026':{title:'Star Wars: The Mandalorian and Grogu'}}))});
 await page.goto(`${origin}/oeuvre.html?id=the-mandalorian-and-grogu-2026`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#seenWorkButton');
 assert.equal(await page.locator('#seenStatusLabel').textContent(),'Vu','legacy ID must resolve to canonical seen work');
 await page.locator('#seenWorkButton').click();
 assert.equal(await page.locator('#seenStatusLabel').textContent(),'Non vu','undo must remove the legacy seen alias');

 // Permanent state still propagates between catalogue and work page.
 await page.evaluate(()=>localStorage.clear());
 await page.goto(`${origin}/catalogue.html`,{waitUntil:'domcontentloaded'});
 await page.locator('#q').fill('Paris, Texas');await page.waitForSelector('.card');
 assert.equal(await page.locator('.card').count(),1);
 await page.locator('.seen-btn').click();assert.match(await page.locator('.seen-btn').textContent(),/✓/);
 await page.locator('.actions a').first().click();await page.waitForSelector('#seenWorkButton');
 assert.match(await page.locator('#seenWorkButton').textContent(),/✓/);
 await page.locator('#seenWorkButton').click();assert.equal(await page.locator('#seenStatusLabel').textContent(),'Non vu');

 assert.deepEqual(pageErrors,[],`Browser page errors: ${pageErrors.join(' | ')}`);
 console.log('✓ Catalogue and permanent work seen-state propagation');
}finally{
 await browser?.close();
 await new Promise(r=>server.close(r));
}
