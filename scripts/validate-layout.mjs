/** Optional browser gate: npm install --no-save playwright && npx playwright install chromium
 * Run: node scripts/validate-layout.mjs
 * CHROMIUM_EXECUTABLE_PATH can point at an existing Chromium installation.
 * No production dependencies; serves the existing repository without a build step.
 */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{
 const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/\/$/,'/index.html'));
 if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-dev-shm-usage'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const settle=async()=>{
  await page.waitForFunction(()=>window.SelectionTVLayout);
  await page.evaluate(async()=>{document.querySelectorAll('img').forEach(i=>i.loading='eager');await Promise.all([...document.images].map(i=>i.complete?null:new Promise(r=>{i.addEventListener('load',r,{once:true});i.addEventListener('error',r,{once:true});setTimeout(r,10000)})))});
  await page.waitForTimeout(1400);await page.evaluate(()=>window.SelectionTVLayout.layout());
 };
 const signature=()=>[...document.querySelectorAll('article,tbody tr')].map(e=>({text:e.textContent,links:[...e.querySelectorAll('a')].map(a=>a.href)}));
 for(const week of ['2026-S40','2026-S39','2026-S38','2026-S37']){
  await page.goto(`${origin}/semaines/${week}/`,{waitUntil:'domcontentloaded'});await settle();
  const before=await page.evaluate(signature);
  await page.evaluate(()=>{window.SelectionTVLayout.restore();window.SelectionTVLayout.layout()});
  assert.deepEqual(await page.evaluate(signature),before,`${week}: content and links must survive reflow`);
  assert.equal(await page.evaluate(()=>document.body.dataset.layoutOverflow),'',`${week}: fixed page overflow`);
  await page.emulateMedia({media:'print'});await page.evaluate(()=>window.SelectionTVLayout.layout());
  assert.equal(await page.evaluate(()=>document.body.dataset.layoutOverflow),'',`${week}: print overflow`);
  await page.emulateMedia({media:'screen'});
  for(const width of [390,768,1100]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(120);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${week}: horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:1000});
  console.log(`✓ ${week}: screen, print, responsive, text and links`);
 }
 await page.goto(`${origin}/semaines/2026-S40/`,{waitUntil:'domcontentloaded'});await settle();
 const save=page.locator('#samedi-selection button.save').first();await save.click();assert.match(await save.textContent(),/✓/);await save.click();assert.doesNotMatch(await save.textContent(),/✓/);
 await page.locator('#samedi-selection .seen-btn').first().click();await page.waitForTimeout(300);
 assert(await page.locator('#samedi-selection .replacement-generated,[data-layout-source="samedi-selection"] .replacement-generated').count()>0);
 await page.locator('#seenToggle').click();await page.waitForTimeout(300);assert.equal(await page.locator('.replacement-generated').count(),0);
 await page.evaluate(()=>localStorage.clear());
 await page.goto(`${origin}/catalogue.html`);await page.locator('#q').fill('Paris, Texas');await page.waitForSelector('.card');assert.equal(await page.locator('.card').count(),1);
 await page.locator('.seen-btn').click();assert.match(await page.locator('.seen-btn').textContent(),/✓/);
 await page.locator('.actions a').first().click();await page.waitForSelector('#seenWorkButton');assert.match(await page.locator('#seenWorkButton').textContent(),/✓/);
 await page.locator('#seenWorkButton').click();assert.equal(await page.locator('#seenStatusLabel').textContent(),'Non vu');
 assert.deepEqual(errors,[]);console.log('✓ Save, seen, reserve, catalogue and permanent work state');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
