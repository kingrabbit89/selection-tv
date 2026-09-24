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
const weeks=[...new Set([manifest.latest,'2026-S40','2026-S39','2026-S38','2026-S37'].filter(Boolean))];

const server=createServer(async(req,res)=>{
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
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
 )].filter(el=>getComputedStyle(el).display!=='none').map(el=>({
  title:el.dataset.title||el.querySelector('h3')?.textContent?.trim()||'?',
  ok:!!el.querySelector('img,.canonical-image-fallback,.radar-reserve-fallback,.release-fallback,.replacement-fallback,.fallback')
 })).filter(x=>!x.ok);

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
  await page.goto(`${origin}/semaines/${week}/`,{waitUntil:'domcontentloaded'});
  await settle();

  const before=await page.evaluate(signature);
  const toc=await page.evaluate(tocState);
  assert.deepEqual(toc.actual,toc.expected,`${week}: table-of-contents labels/subtitles were mutated by layout`);

  const exact=await page.evaluate(exactLinkCheck);
  for(const x of exact){
   if(x.label.toLowerCase().includes('imdb'))assert(/^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/tt\d+\/?$/.test(x.href),`${week}: non-canonical IMDb link rendered: ${x.href}`);
   if(x.label.toLowerCase().includes('senscritique'))assert(/^https:\/\/www\.senscritique\.com\/(?:film|serie)\/[^?#]+\/\d+\/?$/.test(x.href),`${week}: non-canonical SensCritique link rendered: ${x.href}`);
  }

  const missingVisuals=await page.evaluate(visualCoverage);
  assert.deepEqual(missingVisuals,[],`${week}: visual cards without image/fallback: ${JSON.stringify(missingVisuals)}`);

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

 // Functional gate on the current issue: save/seen state and reserve replacement.
 const latest=manifest.latest;
 await page.goto(`${origin}/semaines/${latest}/`,{waitUntil:'domcontentloaded'});
 await settle();
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
