/** Real reading-position regression, with a poster failing AFTER navigation.
 * Keep images lazy and exercise Chromium and Firefox: eager image settlement
 * before a single scroll-to-bottom hid the S42 Thursday-to-Monday regression.
 */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';

const playwright=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(resolve(root,'data/manifest.json'),'utf8'));
const target=process.env.SELECTION_TV_VALIDATE_WEEK||manifest.latest;
const weeks=[...new Set([target,'2026-S41'])];
let posterReleased=false;
const pendingPosters=new Set();
const rejectPoster=res=>{res.writeHead(404);res.end('late poster unavailable')};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__late-poster.svg'){
  if(posterReleased)rejectPoster(res);
  else {pendingPosters.add(res);res.on('close',()=>pendingPosters.delete(res))}
  return;
 }
 const path=resolve(root,'.'+decodeURIComponent(url.pathname).replace(/\/$/,'/index.html'));
 if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return}
 try{
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[extname(path)]||'application/octet-stream');
  res.end(await readFile(path));
 }catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const sample=page=>page.evaluate(()=>{
 const anchor=window.__scrollRegressionAnchor;
 const r=anchor?.getBoundingClientRect();
 return {y:scrollY,top:r?.top,connected:anchor?.isConnected,height:document.documentElement.scrollHeight,
  visible:[...document.querySelectorAll('.book>.page')].filter(p=>{const b=p.getBoundingClientRect();return b.bottom>110&&b.top<innerHeight}).map(p=>p.id)};
});
let browser;
try{
 for(const engine of ['chromium','firefox']){
  browser=await playwright[engine].launch({headless:true});
  for(const week of weeks){
   posterReleased=false;
   const page=await browser.newPage({viewport:{width:1440,height:1000}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const preview=process.env.SELECTION_TV_VALIDATE_WEEK&&week===target?'?preview=1':'';
   await page.goto(`${origin}/semaines/${week}/${preview}`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.SelectionTVLayout&&window.SelectionTVBindImage&&document.querySelector('#jeudi-selection article.feature'));
   await page.waitForTimeout(1500);
   // Use the real resolver and an actual Thursday card; only the image host is
   // a deterministic fixture. Do not call layout as part of image settlement.
   await page.evaluate(src=>{
    const card=document.querySelector('#jeudi-selection article.feature');
    const visual=card.querySelector('.visual');
    const title=card.dataset.title||card.querySelector('h3').textContent.trim();
    const img=document.createElement('img');img.className='poster';img.loading='eager';img.src=src;
    img.dataset.scrollRegression='late-poster';
    visual.replaceChildren(img);window.SelectionTVBindImage(img,title,card);
    window.__scrollRegressionAnchor=card;
   },origin+'/__late-poster.svg');
   await page.waitForTimeout(200);
   assert(pendingPosters.size>0,`${engine}/${week}: delayed poster fixture was never requested`);
   await page.evaluate(()=>window.scrollTo(0,document.getElementById('jeudi-selection').getBoundingClientRect().top+scrollY-110));
   await page.waitForTimeout(100);
   const before=await sample(page);
   assert(before.visible.includes('jeudi-selection'),`${engine}/${week}: Thursday not reached before delayed image`);
   posterReleased=true;
   for(const res of pendingPosters)rejectPoster(res);
   await page.waitForFunction(()=>!document.querySelector('[data-scroll-regression="late-poster"]'));
   await page.waitForTimeout(250);
   const after=await sample(page);
   assert(after.connected,`${engine}/${week}: reading card lost after delayed image failure`);
   assert(Math.abs(after.top-before.top)<=3,`${engine}/${week}: delayed image moved Thursday reading position (${before.top} → ${after.top}, y ${before.y} → ${after.y})`);

   // A real selection refresh restores the page before rebuilding reserves.
   // Its restore/layout gap must retain the pre-restoration reading position.
   await page.evaluate(()=>document.dispatchEvent(new CustomEvent('selectiontv:seenchange')));
   await page.waitForTimeout(350);
   const refreshed=await sample(page);
   assert(refreshed.visible.includes('jeudi-selection'),`${engine}/${week}: selection refresh jumped away from Thursday: ${refreshed.visible}`);
   assert(Math.abs(refreshed.y-after.y)<=3,`${engine}/${week}: unchanged selection refresh moved the reader`);

   await page.mouse.wheel(0,900);await page.waitForTimeout(250);
   const continued=await sample(page);
   assert(continued.y>refreshed.y+300,`${engine}/${week}: forward scrolling from Thursday stalled or went backwards`);
   await page.evaluate(()=>window.scrollTo(0,document.getElementById('vendredi-grille').getBoundingClientRect().top+scrollY));
   await page.waitForTimeout(100);
   await page.evaluate(()=>{
    window.__scrollRegressionAnchor=document.querySelector('#vendredi-grille tbody tr');
   });
   const friday=await sample(page);
   for(let n=0;n<3;n++){
    await page.evaluate(()=>window.SelectionTVLayout.layout());
    await page.waitForTimeout(50);
    const stable=await sample(page);
    assert(Math.abs(stable.top-friday.top)<=3,`${engine}/${week}: repeated reflow moved Friday (${friday.top} → ${stable.top})`);
   }
   await page.keyboard.press('End');await page.waitForTimeout(250);
   const end=await page.evaluate(()=>({y:scrollY,max:document.documentElement.scrollHeight-innerHeight}));
   assert(Math.abs(end.y-end.max)<=3,`${engine}/${week}: end of issue is unreachable`);
   assert.deepEqual(errors,[],`${engine}/${week}: runtime errors during reading`);
   console.log(`✓ ${engine} ${week}: delayed poster, selection refresh, Thursday → Friday, repeated reflow and document end`);
   await page.close();
  }
  await browser.close();browser=null;
 }
}finally{
 for(const res of pendingPosters)res.destroy();
 if(browser)await browser.close();
 await new Promise(r=>server.close(r));
}
