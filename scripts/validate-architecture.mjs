import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const fail=msg=>{console.error('✗ '+msg);process.exitCode=1};
const ok=msg=>console.log('✓ '+msg);
const manifestPath=path.join(root,'data','manifest.json');
if(!fs.existsSync(manifestPath)){fail('data/manifest.json manquant');process.exit(1)}
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const editorialConfig=JSON.parse(fs.readFileSync(path.join(root,'data','editorial-config.json'),'utf8'));
const subscriptionMax=editorialConfig.layout_safety?.subscription_page_max_cards??3;
if(manifest.schema_version!==1) fail('schema_version du manifeste invalide');
const seen=new Set();
for(const entry of manifest.weeks||[]){
 if(seen.has(entry.week))fail('Semaine dupliquée dans le manifeste : '+entry.week);
 seen.add(entry.week);
 const jsonPath=path.join(root,'data','weeks',entry.week+'.json');
 const htmlPath=path.join(root,'semaines',entry.week,'index.html');
 if(!fs.existsSync(jsonPath)){fail(jsonPath+' manquant');continue}
 if(!fs.existsSync(htmlPath)){fail(htmlPath+' manquant');continue}
 const data=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
 const html=fs.readFileSync(htmlPath,'utf8');
 if(data.schema_version!==1)fail(entry.week+' : schema_version invalide');
 if(entry.page_count!==data.page_count)fail(entry.week+' : page_count du manifeste incohérent avec le JSON');
 if(data.week!==entry.week)fail(entry.week+' : identifiant incohérent');
 if(!Array.isArray(data.pages)||data.pages.length!==data.page_count)fail(entry.week+' : page_count incohérent');
 const ids=new Set();
 for(const [pageIndex,p] of (data.pages||[]).entries()){
   if(ids.has(p.id))fail(entry.week+' : id de page dupliqué '+p.id);ids.add(p.id);
   const footer=p.html.match(/<div class="footer">[\s\S]*?<span>(\d+)<\/span><\/div>\s*$/);
   if(footer&&Number(footer[1])!==pageIndex+1)fail(entry.week+' : pagination interne incohérente sur '+p.id+' (attendu '+(pageIndex+1)+', trouvé '+footer[1]+')');
   if((p.className||'').split(/\s+/).includes('subscription-page')){
     const cards=(p.html.match(/<article class="platform(?:\s|")/g)||[]).length;
     if(cards>subscriptionMax)fail(entry.week+' : '+p.id+' contient '+cards+' cartes plateformes enrichies ; maximum sûr '+subscriptionMax);
   }
 }
 if(Buffer.byteLength(html)>3000)fail(entry.week+' : index.html trop lourd ('+Buffer.byteLength(html)+' octets)');
 if(/<style[\s>]/i.test(html))fail(entry.week+' : CSS embarqué interdit');
 const scriptTags=[...html.matchAll(/<script\b([^>]*)>/gi)];
 if(scriptTags.length!==1||!scriptTags[0][1].includes('assets/js/issue-loader.js'))fail(entry.week+' : la coquille doit charger uniquement issue-loader.js');
 ok(entry.week+' : '+data.pages.length+' pages, coquille '+Buffer.byteLength(html)+' octets');
}
if(!seen.has(manifest.latest))fail('latest ne correspond à aucune semaine du manifeste');

// Cross-client routing contract: GitHub Pages, Jellyfin Web and Android TV must
// all follow manifest.latest instead of pinning a specific week.
const latestEntry=(manifest.weeks||[]).find(x=>x.week===manifest.latest);
if(latestEntry){
 const latestShellPath=path.join(root,latestEntry.path,'index.html');
 if(!fs.existsSync(latestShellPath))fail('Coquille du dernier numéro manquante : '+latestShellPath);
 else{
   const latestShell=fs.readFileSync(latestShellPath,'utf8');
   const bodyWeek=(latestShell.match(/<body[^>]*data-week=["']([^"']+)["']/i)||[])[1];
   if(bodyWeek!==manifest.latest)fail('La coquille du dernier numéro pointe vers '+(bodyWeek||'aucune semaine')+' au lieu de '+manifest.latest);
 }
}

const latestRouterPath=path.join(root,'latest.html');
const jellyfinWebPath=path.join(root,'integrations','jellyfin','selection-tv.html');
const androidPath=path.join(root,'integrations','androidtv','SelectionTvFragment.kt');
for(const required of [latestRouterPath,jellyfinWebPath,androidPath]){
 if(!fs.existsSync(required))fail(required+' manquant');
}
if(fs.existsSync(latestRouterPath)){
 const latestRouter=fs.readFileSync(latestRouterPath,'utf8');
 if(!latestRouter.includes("fetch('data/manifest.json',{cache:'no-store'})"))fail('latest.html doit résoudre manifest.latest sans cache');
 if(!latestRouter.includes("params.get('tv')==='1'"))fail('latest.html doit préserver le mode tv=1');
}
if(fs.existsSync(jellyfinWebPath)){
 const jellyfinWeb=fs.readFileSync(jellyfinWebPath,'utf8');
 if(!/selection-tv\/latest\.html/.test(jellyfinWeb))fail('Jellyfin Web doit charger latest.html, pas une semaine figée');
}
if(fs.existsSync(androidPath)){
 const android=fs.readFileSync(androidPath,'utf8');
 if(!/SELECTION_TV_URL\s*=\s*"https:\/\/kingrabbit89\.github\.io\/selection-tv\/latest\.html\?tv=1"/.test(android)){
   fail('Android TV doit charger latest.html?tv=1, pas une semaine figée');
 }
}

if(process.exitCode)process.exit(process.exitCode);
ok('Architecture valide');
