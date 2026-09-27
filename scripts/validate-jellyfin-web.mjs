import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';

const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const bridgeSource=await readFile(resolve(root,'assets/js/jellyfin-bridge.js'),'utf8');
const worksSource=await readFile(resolve(root,'data/works.json'),'utf8');
const linksSource=await readFile(resolve(root,'data/links.json'),'utf8');

const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  const p=resolve(root,'.'+decodeURIComponent(u.pathname).replace(/\/$/,'/index.html'));
  if(!p.startsWith(root+'/')){res.writeHead(403);res.end();return}
  try{
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[extname(p)]||'application/octet-stream');
    res.end(await readFile(p));
  }catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;

const item={
  Id:'jf-paris-texas',
  Name:'Paris, Texas',
  OriginalTitle:'Paris, Texas',
  ProductionYear:1984,
  ProviderIds:{Imdb:'tt0087884',Tmdb:'655'},
  Type:'Movie',
  UserData:{Played:true},
  MediaSources:[{Width:1920,Height:1080}],
  Genres:['Drame'],
  Overview:'Fixture Jellyfin Web',
  People:[{Type:'Director',Name:'Wim Wenders'}],
  CommunityRating:8.1,
  ImageTags:{Primary:'fixture'}
};

let browser;
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));

  await page.addInitScript(({fixture})=>{
    if(window.top!==window)return;
    const clone=()=>{const value=JSON.parse(JSON.stringify(window.fixtureOverride||fixture));value.UserData.Played=window.fixturePlayed!==false;return value};
    window.ApiClient={
      serverId:()=> 'fixture-server',
      serverAddress:()=> 'http://jellyfin.local',
      getCurrentUserId:()=> 'fixture-user',
      getImageUrl:()=> 'https://images.example.test/poster.jpg',
      getUrl:(path)=>'/'+String(path||'').replace(/^\//,''),
      ajax:async opts=>{
        const url=String(opts?.url||'');
        if(url.includes('SelectionTv/Uploads'))return {
          Items:[{
            TopicTitle:'Paris Texas 1984 1080p',
            TitleGuess:'Paris, Texas',
            TopicUrl:'https://forum.example.test/paris-texas',
            ActivityAt:new Date().toISOString(),
            Year:1984
          }],
          WindowHours:24,
          GeneratedAt:new Date().toISOString()
        };
        if(url.includes('SelectionTv/Enrich'))return {};
        if(url.includes('Items/RemoteSearch'))return [];
        return {};
      },
      getItems:async (_user,opts={})=>{
        const ids=Array.isArray(opts.Ids)?opts.Ids:[];
        if(ids.length){
          if(ids.map(String).includes('stale-id'))return {Items:[],TotalRecordCount:0};
          return {Items:[clone()],TotalRecordCount:1};
        }
        if(opts.SearchTerm)return {Items:[clone()],TotalRecordCount:1};
        const start=Number(opts.StartIndex||0);
        return start===0?{Items:[clone()],TotalRecordCount:1}:{Items:[],TotalRecordCount:1};
      }
    };
  },{fixture:item});

  const childHtml=`<!doctype html><meta charset="utf-8">
    <style>body{margin:0}.feature{width:240px}.program-actions{min-height:20px}</style>
    <div id="sommaire"><div class="toc-group"><a class="toc-link" href="#samedi-selection">Samedi</a></div></div>
    <div class="book">
      <section id="samedi-selection">
        <article class="feature" data-title="Paris, Texas">
          <h3>Paris, Texas</h3>
          <div class="work-meta">1984 · Wim Wenders</div>
          <div class="program-actions"></div>
        </article>
      </section>
      <section id="methode"></section>
    </div>
    <script src="https://kingrabbit89.github.io/selection-tv/assets/js/jellyfin-bridge.js"><\/script>`;

  const weeklyUrl='https://kingrabbit89.github.io/selection-tv/semaines/2026-S41/';
  await page.route('https://kingrabbit89.github.io/selection-tv/latest.html',route=>
    route.fulfill({
      status:200,
      contentType:'text/html; charset=utf-8',
      body:'<!doctype html><meta charset="utf-8"><script>location.replace('+JSON.stringify(weeklyUrl)+')</script>'
    })
  );
  await page.route(weeklyUrl,route=>
    route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:childHtml})
  );
  await page.route('https://kingrabbit89.github.io/selection-tv/assets/js/jellyfin-bridge.js',route=>
    route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:bridgeSource})
  );
  await page.route(/https:\/\/kingrabbit89\.github\.io\/selection-tv\/data\/works\.json.*/,route=>
    route.fulfill({status:200,contentType:'application/json',body:worksSource})
  );
  await page.route(/https:\/\/kingrabbit89\.github\.io\/selection-tv\/data\/links\.json.*/,route=>
    route.fulfill({status:200,contentType:'application/json',body:linksSource})
  );
  await page.route('https://images.example.test/**',route=>route.abort());

  await page.goto(origin+'/integrations/jellyfin/selection-tv.html',{waitUntil:'domcontentloaded'});
  await page.locator('#selectionTvFrame').waitFor({state:'attached'});
  let child=null;
  for(let attempt=0;attempt<50;attempt++){
    child=page.frames().find(f=>f!==page.mainFrame()&&f.url().startsWith(weeklyUrl))||null;
    if(child)break;
    await page.waitForTimeout(100);
  }
  assert(child,'Jellyfin iframe fixture did not navigate through latest.html to the weekly page');
  const childReferrer=await child.evaluate(()=>document.referrer);
  assert.match(childReferrer,/kingrabbit89\.github\.io\/selection-tv\/latest\.html/,'weekly page must reproduce the same-origin latest.html referrer');

  await child.locator('article.feature .jellyfin-actions').waitFor({state:'attached'});
  await child.locator('article.feature .jellyfin-pill.played').waitFor({state:'visible'});
  assert.equal(await child.locator('article.feature .jellyfin-pill.played').textContent(),'✓ Vu dans Jellyfin');
  assert.equal(await child.locator('article.feature .jellyfin-pill.quality').textContent(),'1080p');
  assert.equal(await child.locator('article.feature .jellyfin-open').textContent(),'Ouvrir dans Jellyfin');

  await child.locator('.jellyfin-private-uploads-page').waitFor({state:'attached'});
  assert.match(await child.locator('.jellyfin-private-uploads-page').first().textContent(),/Vos Uploads|uploads des dernières 24 heures/,'private uploads section must survive the latest.html redirect handshake');

  // Two mutation batches inside the debounce window must retain both cards.
  await child.evaluate(async()=>{
    const first=document.querySelector('article.feature');
    const copy=()=>{const node=first.cloneNode(true);node.querySelector('.jellyfin-actions')?.remove();node.classList.add('dynamic-fixture');first.parentNode.append(node)};
    copy();await new Promise(r=>setTimeout(r,25));copy();
  });
  await child.waitForFunction(()=>document.querySelectorAll('.dynamic-fixture .jellyfin-open').length===2);
  // An open iframe must refresh mutable played state after the cache TTL.
  await page.evaluate(()=>{window.fixturePlayed=false;const now=Date.now;Date.now=()=>now()+61000});
  await child.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await child.waitForFunction(()=>document.querySelector('article.feature .jellyfin-actions')&&!document.querySelector('article.feature .played'));

  // Simulate a stale persisted UUID while keeping the exact request metadata
  // emitted by the real child bridge. The wrapper must recover the live item.
  await child.locator('article.feature .jellyfin-open').evaluate(button=>{
    const original=button.onclick;
    button.onclick=null;
    parent.postMessage({
      type:'selection-tv:jellyfin-open',
      itemId:'stale-id',
      request:{key:'imdb:tt0087884',title:'Paris, Texas',year:'1984',imdbId:'tt0087884',tmdbId:'655'}
    },window.__selectionTvTestParentOrigin||'*');
    button.onclick=original;
  });
  await page.waitForFunction(()=>location.hash.includes('details?id=jf-paris-texas'));
  assert.match(page.url(),/#\/details\?id=jf-paris-texas&serverId=fixture-server$/,'stale cached ID must recover to the live Jellyfin item');

  // Exercise actual latest.html, manifest, S41 JSON and all shared scripts.
  // Only Jellyfin API and external image hosts remain fixtures.
  await page.unrouteAll();
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'){await route.continue();return}
    if(url.origin==='https://kingrabbit89.github.io'&&url.pathname.startsWith('/selection-tv/')){
      const relative=url.pathname.slice('/selection-tv'.length).replace(/\/$/,'/index.html');
      const file=resolve(root,'.'+relative);
      if(!file.startsWith(root+'/')){await route.abort();return}
      try{await route.fulfill({status:200,contentType:({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{await route.fulfill({status:404,body:'missing'})}
      return;
    }
    await route.abort();
  });
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
  await page.addInitScript(()=>{
    window.fixtureOverride={Id:'jf-samourai',Name:'Le Samouraï',ProductionYear:1967,ProviderIds:{Imdb:'tt0062229'},Type:'Movie',UserData:{Played:true},MediaSources:[{Width:1920}]};
  });
  await page.goto(origin+'/integrations/jellyfin/selection-tv.html',{waitUntil:'domcontentloaded'});
  let fullChild;
  for(let attempt=0;attempt<100;attempt++){
    fullChild=page.frames().find(f=>f.url().startsWith(weeklyUrl));
    if(fullChild)break;
    await page.waitForTimeout(100);
  }
  assert(fullChild,'actual latest.html did not resolve S41');
  await fullChild.locator('#samedi-selection article.feature').first().scrollIntoViewIfNeeded();
  await fullChild.locator('#samedi-selection .jellyfin-open').first().waitFor({state:'attached'});
  await fullChild.locator('.jellyfin-private-uploads-page').first().waitFor({state:'attached'});
  assert(await fullChild.locator('.book>.page').count()>=26,'real S41 content was not rendered');
  console.log('✓ Actual latest.html → full S41 → Jellyfin buttons and Vos Uploads (API fixture)');

  const status=await page.locator('#selectionTvBridgeStatus').textContent();
  assert.match(status,/Jellyfin/);
  assert.deepEqual(errors,[],'Jellyfin Web bridge page errors: '+errors.join(' | '));
  console.log('✓ Jellyfin Web bridge: real child bridge, indexed match, played, 1080p and stale-ID recovery');
}finally{
  await browser?.close();
  await new Promise(r=>server.close(r));
}
