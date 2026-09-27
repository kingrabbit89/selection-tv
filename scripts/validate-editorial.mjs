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
  const key=norm(title),w=worksByTitle.get(key);
  return !w?.ratings && !w?.ratings_unavailable_reason;
});
if(ratingMissing.length){
  console.warn('! Central ratings or explicit unavailable reason missing: '+ratingMissing.join(' | '));
}

const strict=latest>='2026-S41';
if(strict && missing.length){console.error('✗ Every retained item must have an exact direct link from S41 onward');process.exitCode=1}
if(strict && ratingMissing.length){console.error('✗ Every visual work must carry central ratings or an explicit ratings_unavailable_reason from S41 onward');process.exitCode=1}
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

/* Publication gate: from S41 onward, a week may exist as a draft, but it
 * cannot be promoted unless the editorial payload itself is demonstrably
 * complete. Structural validity alone is not sufficient. */
{
 const publishable=(manifest.weeks||[]).filter(e=>e.week>='2026-S41'&&e.status!=='draft');
 const q=config.quality_gates||{};
 const minImage=Number(q.published_daily_image_ratio_min??0.80);
 const minMeta=Number(q.published_daily_metadata_ratio_min??0.80);
 const minRatings=Number(q.published_daily_ratings_ratio_min??0.55);
 const minInventory=Number(q.raw_inventory_min_items_per_day??90);
 const dayIds=['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'];
 const banned=[
   /Rubrique conservée\s*;\s*publication prudente/i,
   /Au-dessus du seuil éditorial de la semaine/i,
   /Retenu après inventaire et filtre éditorial/i,
   /Retenu pour son intérêt cinématographique,\s*sa singularité ou sa valeur patrimoniale/i
 ];
 const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
 const articleCount=html=>(String(html||'').match(/<article\b/gi)||[]).length;
 const h3Titles=html=>[...String(html||'').matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)]
   .map(m=>clean(m[1])).filter(Boolean);
 const failPub=(week,msg)=>{console.error('✗ '+week+' publication gate: '+msg);process.exitCode=1};

 for(const entry of publishable){
   const candidate=read('data/weeks/'+entry.week+'.json');
   const pages=candidate.pages||[];
   const byId=new Map(pages.map(p=>[p.id,p]));
   const allHtml=pages.map(p=>p.html||'').join('\n');

   if(candidate.publication_status==='draft')failPub(entry.week,'manifest says published but week JSON is draft');
   for(const re of banned)if(re.test(allHtml))failPub(entry.week,'placeholder/generic copy detected: '+re);
   if(!String(entry.hero_image||'').trim()||!String(candidate.hero_image||'').trim()){
     failPub(entry.week,'hero image missing');
   }

   const front=[
     ['rendezvous-1',5],['replay-1',2],['plateformes-gratuites',1],
     ['plateformes-abonnement',3],['sorties-physiques',1],
     ['sorties-streaming',2],['avant-disparition',1],
     ['radar-torrent',3],['radar-1',3]
   ];
   const strictSections=entry.week>=(q.strict_section_targets_from_week||'9999-S99');
   const strictTargets=q.strict_section_targets||{};
   const toc=byId.get('sommaire')?.html||'';
   for(const id of [...front.map(x=>x[0]),...dayIds.map(d=>d+'-selection')]){
     if(!toc.includes('href="#'+id+'"')&&!toc.includes("href='#"+id+"'")){
       failPub(entry.week,'TOC missing #'+id);
     }
   }
   for(const [base,min] of front){
     const html=pages.filter(p=>p.id===base||p.id.startsWith(base+'-')).map(p=>p.html||'').join('\n');
     const count=articleCount(html);
     const target=Number(strictSections?(strictTargets[base]??min):min);
     const shortage=candidate.section_shortages?.[base];
     if(count<target&&!shortage){
       failPub(entry.week,base+' has '+count+' cards; expected '+target+' or an explicit section_shortages reason');
     }
     if(strictSections&&count<target&&shortage){
       if(typeof shortage!=='object'||Array.isArray(shortage)){
         failPub(entry.week,base+' shortage must be structured from S42 onward (reason + searched_sources + verified_count)');
       }else{
         if(!String(shortage.reason||'').trim())failPub(entry.week,base+' shortage.reason missing');
         if(!Array.isArray(shortage.searched_sources)||shortage.searched_sources.length<2)failPub(entry.week,base+' shortage.searched_sources must contain at least 2 sources');
         if(!Number.isInteger(shortage.verified_count)||shortage.verified_count!==count)failPub(entry.week,base+' shortage.verified_count must equal rendered card count '+count);
       }
     }
   }

   const publicTitles=[];
   for(const day of dayIds){
     const p=byId.get(day+'-selection');
     if(!p){failPub(entry.week,'missing '+day+'-selection');continue}
     const ts=h3Titles(p.html).slice(0,3);
     if(ts.length!==3)failPub(entry.week,day+' must expose exactly 3 developed choices, found '+ts.length);
     publicTitles.push(...ts);
   }

   // Repeated daily headliners are normally reruns and should have been
   // deduplicated during the inventory/filter stage.
   const counts=new Map();
   for(const t of publicTitles)counts.set(norm(t),(counts.get(norm(t))||0)+1);
   const duplicates=[...counts.entries()].filter(([,n])=>n>1).map(([k,n])=>k+' ×'+n);
   if(duplicates.length)failPub(entry.week,'developed daily choices repeat across days: '+duplicates.join(', '));

   const unique=[...new Set(publicTitles.map(norm))];
   let withImage=0,withMeta=0,withRatings=0,known=0;
   for(const key of unique){
     const w=worksByTitle.get(key);
     if(!w){failPub(entry.week,'daily developed title absent from works.json: '+key);continue}
     known++;
     if(String(w.image||'').trim())withImage++;
     if(String(w.director||w.creator||'').trim()&&String(w.year||'').trim())withMeta++;
     if(w.ratings&&(w.ratings.imdb||w.ratings.senscritique))withRatings++;
   }
   const ratio=(n,d)=>d?n/d:0;
   if(ratio(withImage,known)<minImage){
     failPub(entry.week,'real image coverage too low for daily choices: '+withImage+'/'+known+' < '+Math.round(minImage*100)+'%');
   }
   if(ratio(withMeta,known)<minMeta){
     failPub(entry.week,'director/year metadata coverage too low: '+withMeta+'/'+known+' < '+Math.round(minMeta*100)+'%');
   }
   if(ratio(withRatings,known)<minRatings){
     failPub(entry.week,'verified ratings coverage too low: '+withRatings+'/'+known+' < '+Math.round(minRatings*100)+'%');
   }

   // Reserve candidates must point to canonical catalogue records and must
   // carry real editorial reasons rather than a template sentence.
   const fingerprints=[];
   for(const day of dayIds){
     const pool=candidate.personalization?.pools?.[day+'-selection'];
     if(!pool)continue;
     const cs=pool.candidates||[];
     for(const c of cs){
       const canonical=worksByTitle.get(norm(c.title));
       if(canonical&&c.work_id!==canonical.id){
         failPub(entry.week,day+' uses non-canonical work_id for '+c.title+' ('+c.work_id+' instead of '+canonical.id+')');
       }
       for(const re of banned)if(re.test(String(c.why||''))){
         failPub(entry.week,day+' reserve contains generic rationale for '+c.title);
       }
     }
     fingerprints.push(cs.slice(0,10).map(c=>(c.time||'')+'|'+(c.channel||'')).join(' > '));
   }
   const fpCounts=new Map();
   for(const fp of fingerprints)if(fp)fpCounts.set(fp,(fpCounts.get(fp)||0)+1);
   const repeated=Math.max(0,...fpCounts.values());
   if(repeated>=4){
     failPub(entry.week,'same ranked time/channel template reused on '+repeated+' days; probable synthetic schedule');
   }

   // A coverage declaration is not evidence of an inventory. Keep the raw
   // collected schedule so the "inventory-first" claim can be audited.
   if(q.raw_inventory_required!==false){
     const invPath='data/inventory/'+entry.week+'.json';
     if(!fs.existsSync(invPath)){
       failPub(entry.week,'raw inventory file missing: '+invPath);
     }else{
       const inv=read(invPath);
       if(!Array.isArray(inv.days)||inv.days.length!==7){
         failPub(entry.week,'raw inventory must contain 7 days');
       }else{
         for(const day of inv.days){
           const items=day.items||[];
           if(items.length<minInventory){
             failPub(entry.week,'raw inventory '+(day.date||'?')+' too shallow: '+items.length+' items < '+minInventory);
           }
           const scanned=new Set((day.channels_scanned||[]).map(norm));
           const missing=config.required_core_channels.filter(ch=>!scanned.has(norm(ch)));
           if(missing.length){
             failPub(entry.week,'raw inventory '+(day.date||'?')+' missing scanned channels: '+missing.join(', '));
           }
           const sourcePages=day.source_pages||[];
           const minSources=Number(q.raw_inventory_source_pages_min??2);
           if(sourcePages.length<minSources){
             failPub(entry.week,'raw inventory '+(day.date||'?')+' lacks source pages: '+sourcePages.length+' < '+minSources);
           }
           const malformed=items.filter(x=>!x.title||!x.channel||!x.start||!(x.source||x.source_url));
           if(malformed.length){
             failPub(entry.week,'raw inventory '+(day.date||'?')+' has '+malformed.length+' items without title/channel/start/source evidence');
           }

           // S42+: a bare declaration that every channel was "scanned" is no
           // longer evidence. Every required channel must carry its own source
           // URL(s), and the per-channel counts must reconcile with the item
           // ledger. This prevents a shallow candidate list from masquerading
           // as a full-week inventory.
           if(entry.week>=(q.strict_inventory_from_week||'9999-S99')){
             const strictMin=Number(q.strict_inventory_min_items_per_day??30);
             if(items.length<strictMin){
               failPub(entry.week,'strict raw inventory '+(day.date||'?')+' too shallow: '+items.length+' < '+strictMin);
             }
             const srcObj=day.channel_sources||{};
             const cntObj=day.channel_counts||{};
             const srcByNorm=new Map(Object.entries(srcObj).map(([k,v])=>[norm(k),v]));
             const cntByNorm=new Map(Object.entries(cntObj).map(([k,v])=>[norm(k),v]));
             for(const channel of config.required_core_channels){
               const key=norm(channel),raw=srcByNorm.get(key);
               const urls=Array.isArray(raw)?raw:[raw].filter(Boolean);
               if(!urls.length||urls.some(u=>!/^https?:\/\//i.test(String(u)))){
                 failPub(entry.week,'strict raw inventory '+(day.date||'?')+' missing valid channel_sources for '+channel);
               }
               const actual=items.filter(x=>norm(x.channel)===key).length;
               const declared=cntByNorm.get(key);
               if(!Number.isInteger(declared)||declared<0){
                 failPub(entry.week,'strict raw inventory '+(day.date||'?')+' missing integer channel_counts for '+channel);
               }else if(declared!==actual){
                 failPub(entry.week,'strict raw inventory '+(day.date||'?')+' channel_counts mismatch for '+channel+': declared '+declared+', items '+actual);
               }
             }
             const overnight=items.filter(x=>/^0[0-5]:[0-5]\d$/.test(String(x.start||''))).length;
             const minOvernight=Number(q.strict_inventory_min_overnight_items_per_day??1);
             if(overnight<minOvernight){
               failPub(entry.week,'strict raw inventory '+(day.date||'?')+' has no credible 00:00–05:59 coverage');
             }
             const seen=new Set(),dups=[];
             for(const x of items){
               const k=norm(x.title)+'|'+norm(x.channel)+'|'+String(x.start||'');
               if(seen.has(k))dups.push(k);else seen.add(k);
             }
             if(dups.length)failPub(entry.week,'strict raw inventory '+(day.date||'?')+' contains duplicate programme rows: '+dups.slice(0,5).join(', '));
           }
         }
       }
     }
   }
 }
}

if(process.exitCode)process.exit(process.exitCode);
console.log('✓ Editorial validation passed');
