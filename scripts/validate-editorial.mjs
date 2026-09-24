import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read('data/manifest.json');
const latest=manifest.latest;
const links=read('data/links.json').links||{};
const config=read('data/editorial-config.json');
const pconfig=read('data/personalization-config.json');
const week=read('data/weeks/'+latest+'.json');
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const linkKeys=new Set(Object.keys(links).map(norm));
const titles=new Set();
for(const p of week.pages||[]){
 if(!/-selection$|-grille(?:-2)?$/.test(p.id))continue;
 let m;const r1=/<article class="feature"[\s\S]*?<h3>([^<]+)<\/h3>/g;while((m=r1.exec(p.html)))titles.add(m[1].trim());
 const r2=/<td class="prog">([^<]+)<\/td>/g;while((m=r2.exec(p.html)))titles.add(m[1].trim());
}
const missing=[...titles].filter(t=>!linkKeys.has(norm(t)));
console.log('Latest:',latest,'retained daily titles:',titles.size,'without central exact link:',missing.length);
if(missing.length)console.log('Missing links:',missing.join(' | '));
const strict=latest>='2026-S41';
if(strict && missing.length){console.error('✗ Every retained item must have an exact direct link from S41 onward');process.exitCode=1}
const covPath='data/coverage/'+latest+'.json';
if(strict){
 const pers=week.personalization;
 if(!pers||pers.schema_version!==1||!pers.pools){console.error('✗ Personalization pools missing');process.exitCode=1}
 else{
   const days=['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'];
   for(const day of days){
     const pool=pers.pools[day+'-selection'];
     if(!pool){console.error('✗ Missing reserve pool for '+day);process.exitCode=1;continue}
     const n=(pool.candidates||[]).length;
     if(pool.target!==pconfig.daily_developed.target){console.error('✗ Bad target for '+day);process.exitCode=1}
     if(n<pconfig.daily_developed.minimum_total_candidates&&!pool.shortage_reason){console.error('✗ '+day+' reserve too shallow without shortage_reason');process.exitCode=1}
     const ranks=new Set();for(const c of pool.candidates||[]){if(!c.title||!c.rank||ranks.has(c.rank)){console.error('✗ Invalid candidate ranking in '+day);process.exitCode=1}ranks.add(c.rank);if(!c.work_id)console.warn('! '+day+' candidate without stable work_id: '+c.title)}
   }
 }
 const radarPath='data/radar-reserves/'+latest+'.json';
 if(!fs.existsSync(radarPath)){console.error('✗ Radar reserve data missing for '+latest);process.exitCode=1}
 else{
   const rr=read(radarPath);
   const popular=rr.popular;
   if(!popular){console.error('✗ Missing popularity radar reserve');process.exitCode=1}
   else{
     const n=(popular.candidates||[]).length;
     if(popular.target!==pconfig.radar_popularity.target_visible){console.error('✗ Bad popularity radar target');process.exitCode=1}
     if(n<pconfig.radar_popularity.minimum_total_candidates&&!popular.shortage_reason){console.error('✗ Popularity radar reserve too shallow');process.exitCode=1}
   }
   for(const key of ['hd1','hd2']){
     const pool=rr[key];
     if(!pool){console.error('✗ Missing HD radar reserve '+key);process.exitCode=1;continue}
     const n=(pool.candidates||[]).length;
     if(pool.target!==pconfig.radar_1080p.page_capacity){console.error('✗ Bad HD radar target for '+key);process.exitCode=1}
     if(n<Math.ceil(pconfig.radar_1080p.minimum_total_candidates/2)&&!pool.shortage_reason){console.error('✗ HD radar reserve too shallow for '+key);process.exitCode=1}
   }
 }
 if(!fs.existsSync(covPath)){console.error('✗ Coverage audit missing for '+latest);process.exitCode=1}
 else{
   const cov=read(covPath);
   if(!cov.full_week_reaudit_completed){console.error('✗ Full inventory-first coverage audit not completed');process.exitCode=1}
   const days=cov.days||[];
   if(days.length!==config.quality_gates.days_scanned){console.error('✗ Coverage must contain 7 days');process.exitCode=1}
   const req=new Set(config.required_core_channels.map(norm));
   for(const day of days){const got=new Set((day.channels_scanned||[]).map(norm));const miss=[...req].filter(x=>!got.has(x));if(miss.length){console.error('✗ '+day.date+' missing required channels: '+miss.join(', '));process.exitCode=1}}
 }
}
if(process.exitCode)process.exit(process.exitCode);
console.log('✓ Editorial validation passed');
