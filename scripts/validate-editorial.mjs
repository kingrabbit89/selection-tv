import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read('data/manifest.json');
const latest=manifest.latest;
const links=read('data/links.json').links||{};
const config=read('data/editorial-config.json');
const pconfig=read('data/personalization-config.json');
const week=read('data/weeks/'+latest+'.json');
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const works=read('data/works.json').works||[];
const worksByTitle=new Map(works.map(w=>[norm(w.title),w]));
const linkKeys=new Set(Object.keys(links).map(norm));
const linksByTitle=new Map(Object.entries(links).map(([title,value])=>[norm(title),value||{}]));
const titles=new Set();
for(const p of week.pages||[]){
 if(!/-selection$|-grille(?:-2)?$/.test(p.id))continue;
 let m;const r1=/<article class="feature"[\s\S]*?<h3>([^<]+)<\/h3>/g;while((m=r1.exec(p.html)))titles.add(m[1].trim());
 const r2=/<td class="prog">([^<]+)<\/td>/g;while((m=r2.exec(p.html)))titles.add(m[1].trim());
}
const missing=[...titles].filter(t=>!linkKeys.has(norm(t)));
console.log('Latest:',latest,'retained daily titles:',titles.size,'without central exact link:',missing.length);
if(missing.length)console.log('Missing links:',missing.join(' | '));
// Ratings are central catalogue data. Do not let presentation depend on
// whichever occurrence of a title happened to include hardcoded pills.
const ratingCandidates=new Set();
for(const p of week.pages||[]){
  let m;
  const visual=/<article class="[^"]*\b(?:week-card|feature|list-card|platform|release-card|expire-card|radar-card|torrent-card)\b[^"]*"[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>/g;
  while((m=visual.exec(p.html||'')))ratingCandidates.add(m[1].replace(/<[^>]+>/g,'').trim());
  const grid=/<td class="prog">([^<]+)<\/td>/g;
  while((m=grid.exec(p.html||'')))ratingCandidates.add(m[1].trim());
}
const ratingMissing=[...ratingCandidates].filter(title=>{
  const key=norm(title),w=worksByTitle.get(key),l=linksByTitle.get(key)||{};
  const ratingSource=!!(l.imdb||l.sc);
  return ratingSource && !w?.ratings && !w?.ratings_unavailable_reason;
});
if(ratingMissing.length){
  console.warn('! Central ratings missing: '+ratingMissing.join(' | '));
}

const strict=latest>='2026-S41';
if(strict && missing.length){console.error('✗ Every retained item must have an exact direct link from S41 onward');process.exitCode=1}
if(strict && ratingMissing.length){console.error('✗ Every rated work with IMDb/SensCritique links must carry central ratings or an explicit unavailable reason from S41 onward');process.exitCode=1}
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
   const scan=rr.popular_scan,deep=rr.popular_deep;
   if(!scan){console.error('✗ Missing popularity radar scan');process.exitCode=1}
   else if((scan.candidates||[]).length<pconfig.radar_popularity.scan_visible){console.error('✗ Popularity radar scan too shallow');process.exitCode=1}
   if(!deep){console.error('✗ Missing popularity radar reserve');process.exitCode=1}
   else if((deep.candidates||[]).length<pconfig.radar_popularity.minimum_reserve_candidates&&!deep.shortage_reason){console.error('✗ Popularity radar reserve too shallow');process.exitCode=1}
   for(const key of ['hd1','hd2']){
     const pool=rr[key];
     if(!pool){console.error('✗ Missing HD radar reserve '+key);process.exitCode=1;continue}
     const n=(pool.candidates||[]).length;
     if(pool.target!==pconfig.radar_1080p.page_capacity){console.error('✗ Bad HD radar target for '+key);process.exitCode=1}
     if(n<Math.ceil(pconfig.radar_1080p.minimum_total_candidates/2)&&!pool.shortage_reason){console.error('✗ HD radar reserve too shallow for '+key);process.exitCode=1}
   }
 }
 // Visual image coverage: no silent poster gaps from S41 onward.
 const visualTitles=new Set();
 const visualClass=/\b(?:week-card|feature|list-card|platform|release-card|expire-card|radar-card|torrent-card|card|listitem|radarcard)\b/;
 for(const page of week.pages||[]){
   const re=/<article class="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g;let m;
   while((m=re.exec(page.html))){
     if(!visualClass.test(m[1]))continue;
     const t=(m[2].match(/<h3>([\s\S]*?)<\/h3>/)||[])[1]?.replace(/<[^>]+>/g,'').trim();
     if(t)visualTitles.add(t);
   }
 }
 if(fs.existsSync(radarPath)){
   const rrImages=read(radarPath);
   for(const key of ['popular_scan','popular_deep','hd1','hd2'])for(const c of rrImages[key]?.candidates||[])if(c.title)visualTitles.add(c.title);
 }
 // Personalization candidates are visual recommendations too, even when they are not present in the canonical HTML.
 for(const pool of Object.values(pers.pools||{}))for(const c of pool.candidates||[])if(c.title)visualTitles.add(c.title);
 const imageMissing=[...visualTitles].filter(title=>{const w=worksByTitle.get(norm(title));return !w||(!w.image&&!w.image_exception_reason)});
 if(imageMissing.length){console.error('✗ Visual image coverage incomplete: '+imageMissing.join(' | '));process.exitCode=1}
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
