import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';

const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');

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
    const clone=()=>JSON.parse(JSON.stringify(fixture));
    window.ApiClient={
      serverId:()=> 'fixture-server',
      serverAddress:()=> 'http://jellyfin.local',
      getCurrentUserId:()=> 'fixture-user',
      getImageUrl:()=> 'https://images.example.test/poster.jpg',
      getUrl:(path)=>'/'+String(path||'').replace(/^\//,''),
      ajax:async opts=>{
        const url=String(opts?.url||'');
        if(url.includes('SelectionTv/Uploads'))return {Items:[],WindowHours:24,GeneratedAt:new Date().toISOString()};
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

  const childHtml=`<!doctype html><meta charset="utf-8"><body>fixture<script>
    window.received=[];
    window.addEventListener('message',function(e){
      if(e.data&&e.data.type==='selection-tv:jellyfin-ready'){
        parent.postMessage({type:'selection-tv:jellyfin-query',version:1,items:[{
          key:'imdb:tt0087884',title:'Paris, Texas',year:'1984',imdbId:'tt0087884',tmdbId:'655'
        }]},'*');
      }
      if(e.data&&e.data.type==='selection-tv:jellyfin-result'){
        window.received.push(e.data);
        document.body.dataset.result=JSON.stringify(e.data.items&&e.data.items[0]||{});
      }
    });
  <\/script></body>`;

  await page.route('https://kingrabbit89.github.io/selection-tv/latest.html',route=>
    route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:childHtml})
  );
  await page.route('https://images.example.test/**',route=>route.abort());

  await page.goto(origin+'/integrations/jellyfin/selection-tv.html',{waitUntil:'domcontentloaded'});
  const child=page.frames().find(f=>f.url().startsWith('https://kingrabbit89.github.io/selection-tv/latest.html'));
  assert(child,'Jellyfin iframe fixture did not load');

  await child.waitForFunction(()=>document.body.dataset.result);
  const result=JSON.parse(await child.getAttribute('body','data-result'));
  assert.equal(result.found,true,'canonical IMDb/title match must be found');
  assert.equal(result.itemId,'jf-paris-texas');
  assert.equal(result.played,true,'Jellyfin UserData.Played must propagate');
  assert.equal(result.quality,'1080p','Jellyfin media width must hydrate quality');

  await child.evaluate(()=>{
    parent.postMessage({
      type:'selection-tv:jellyfin-open',
      itemId:'stale-id',
      request:{key:'imdb:tt0087884',title:'Paris, Texas',year:'1984',imdbId:'tt0087884',tmdbId:'655'}
    },'*');
  });
  await page.waitForFunction(()=>location.hash.includes('details?id=jf-paris-texas'));
  assert.match(page.url(),/#\/details\?id=jf-paris-texas&serverId=fixture-server$/,'stale cached ID must recover to the live Jellyfin item');

  assert.deepEqual(errors,[],'Jellyfin Web bridge page errors: '+errors.join(' | '));
  console.log('✓ Jellyfin Web bridge: indexed match, played, quality, origin-gated messaging and stale-ID recovery');
}finally{
  await browser?.close();
  await new Promise(r=>server.close(r));
}
