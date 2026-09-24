import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const fail=msg=>{console.error('✗ '+msg);process.exitCode=1};
const ok=msg=>console.log('✓ '+msg);
const manifestPath=path.join(root,'data','manifest.json');
if(!fs.existsSync(manifestPath)){fail('data/manifest.json manquant');process.exit(1)}
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
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
 if(data.week!==entry.week)fail(entry.week+' : identifiant incohérent');
 if(!Array.isArray(data.pages)||data.pages.length!==data.page_count)fail(entry.week+' : page_count incohérent');
 const ids=new Set();
 for(const p of data.pages||[]){if(ids.has(p.id))fail(entry.week+' : id de page dupliqué '+p.id);ids.add(p.id)}
 if(Buffer.byteLength(html)>3000)fail(entry.week+' : index.html trop lourd ('+Buffer.byteLength(html)+' octets)');
 if(/<style[\s>]/i.test(html))fail(entry.week+' : CSS embarqué interdit');
 const scriptTags=[...html.matchAll(/<script\b([^>]*)>/gi)];
 if(scriptTags.length!==1||!scriptTags[0][1].includes('assets/js/issue-loader.js'))fail(entry.week+' : la coquille doit charger uniquement issue-loader.js');
 ok(entry.week+' : '+data.pages.length+' pages, coquille '+Buffer.byteLength(html)+' octets');
}
if(!seen.has(manifest.latest))fail('latest ne correspond à aucune semaine du manifeste');
if(process.exitCode)process.exit(process.exitCode);
ok('Architecture valide');
