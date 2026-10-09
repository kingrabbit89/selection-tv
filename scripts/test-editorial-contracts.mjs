import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sectionPageMatches,dailyReserveCandidates} from './editorial-contracts.mjs';
test('two five-card pages satisfy the ten-rendezvous family',()=>{
 const pages=[{id:'rendezvous-1',count:5},{id:'rendezvous-2',count:5},{id:'radar-1',count:5}];
 assert.equal(pages.filter(p=>sectionPageMatches(p.id,'rendezvous-1')).reduce((n,p)=>n+p.count,0),10);
 assert(sectionPageMatches('radar-2','radar-1'));
 assert(!sectionPageMatches('radar-torrent','radar-1'));
 assert(!sectionPageMatches('rendezvous-autre','rendezvous-1'));
});
test('freshness reserve ratio excludes event releases and daily primaries',()=>{
 const candidate=(title,rank)=>({title,rank});
 const issue={personalization:{pools:{'samedi-selection':{target:3,candidates:[candidate('primary',1),candidate('reserve',4)]},'sorties-physiques':{target:1,candidates:[candidate('new edition',2)]}}}};
 assert.deepEqual(dailyReserveCandidates(issue).map(c=>c.title),['reserve']);
});

const {probeRemoteImage}=await import('./image-health.mjs');
test('HTML masquerading as a jpg or image MIME is rejected',async()=>{
 const result=await probeRemoteImage('https://fixture.invalid/poster.jpg',{fetcher:async()=>new Response('<html>unavailable</html>',{headers:{'content-type':'image/jpeg'}})});
 assert.equal(result.ok,false);
});
test('transient source failure retries and accepts actual image bytes',async()=>{
 let calls=0;
 const result=await probeRemoteImage('https://fixture.invalid/poster',{delay:async()=>{},fetcher:async()=>++calls===1?new Response('busy',{status:503}):new Response(new Uint8Array([255,216,255,224]),{headers:{'content-type':'application/octet-stream'}})});
 assert.equal(calls,2);assert.equal(result.ok,true);
});

// Exercise the real validator with complete, isolated radar fixtures. Keep
// production thresholds/configuration; no network or published-week payload
// is needed to verify this reserve contract.
function radarFixture(week='2026-S42'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-tv-radars-'));
 const write=(name,value)=>{
   const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,JSON.stringify(value));
 };
 const config=JSON.parse(fs.readFileSync(new URL('../data/editorial-config.json',import.meta.url),'utf8'));
 const pconfig=JSON.parse(fs.readFileSync(new URL('../data/personalization-config.json',import.meta.url),'utf8'));
 const catalogue=[];
 const make=(prefix,count)=>Array.from({length:count},(_,i)=>{
   const title=prefix+' '+(i+1),work_id=prefix.toLowerCase().replaceAll(' ','-')+'-'+(i+1);
   const c={title,work_id,rank:i+1,image:'https://fixture.invalid/'+work_id+'.jpg',ratings:{imdb:'7.5'}};
   catalogue.push({id:work_id,...c});return c;
 });
 const ranked=rows=>rows.map((c,i)=>({...c,rank:i+1}));
 const hd=make('HD primary',10),reserves=make('HD reserve',6);
 const primary=make('Popular primary',5),scan=make('Popular scan',5),deep=make('Popular reserve',5);
 const radar={
   hd1:{page_id:'radar-1',target:5,candidates:ranked([...hd.slice(0,5),...reserves.slice(0,3)])},
   hd2:{page_id:'radar-2',target:5,candidates:ranked([...hd.slice(5),...reserves.slice(3)])},
   popular_scan:{page_id:'radar-torrent-sillonnage',target:5,candidates:scan},
   popular_deep:{target:5,candidates:deep.map((c,i)=>({...c,rank:i+6}))}
 };
 const pools={};
 for(const day of ['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'])pools[day+'-selection']={target:3,candidates:make(day+' daily',10)};
 const cards=(rows,css)=>rows.map(c=>'<article class="'+css+'"><h3>'+c.title+'</h3></article>').join('');
 const pages=[
   {id:'radar-1',html:cards(hd.slice(0,5),'radar-card')},
   {id:'radar-2',html:cards(hd.slice(5),'radar-card')},
   {id:'radar-torrent',html:cards(primary,'torrent-card')},
   {id:'radar-torrent-sillonnage',html:cards(scan,'torrent-card')}
 ];
 write('data/manifest.json',{latest:week,weeks:[]});
 write('data/editorial-config.json',config);write('data/personalization-config.json',pconfig);
 write('data/weeks/'+week+'.json',{week,pages,personalization:{schema_version:1,pools}});
 write('data/works.json',{works:catalogue});
 write('data/links.json',{links:Object.fromEntries(catalogue.map(w=>[w.title,{imdb:'https://www.imdb.com/title/tt1234567/'}]))});
 write('data/coverage/'+week+'.json',{full_week_reaudit_completed:true,days:Array.from({length:7},(_,i)=>({date:'2026-10-'+(10+i),channels_scanned:config.required_core_channels}))});
 const save=rr=>write('data/radar-reserves/'+week+'.json',rr);
 save(radar);
 const run=()=>{
   const result=spawnSync(process.execPath,[fileURLToPath(new URL('./validate-editorial.mjs',import.meta.url))],{cwd:dir,encoding:'utf8',env:{...process.env,SELECTION_TV_VALIDATE_WEEK:week,SELECTION_TV_CANDIDATE:'1'}});
   assert.ifError(result.error);return {status:result.status,output:result.stdout+result.stderr};
 };
 return {radar,hd,reserves,primary,scan,deep,save,run,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('HD radar counts the global distinct union and rejects mutual primary reserves',()=>{
 const f=radarFixture();
 try{
   const good=f.run();assert.equal(good.status,0,good.output);
   const mutual=structuredClone(f.radar);
   mutual.hd1.candidates=[...mutual.hd1.candidates.slice(0,5),...f.hd.slice(5,8).map((c,i)=>({...c,rank:i+6}))];
   mutual.hd2.candidates=[...mutual.hd2.candidates.slice(0,5),...f.hd.slice(0,3).map((c,i)=>({...c,rank:i+6}))];
   f.save(mutual);const bad=f.run();assert.equal(bad.status,1,bad.output);
   assert.match(bad.output,/HD radar distinct global candidates: 10; expected 16/);
   assert.match(bad.output,/HD radar distinct usable reserves: 0; expected 6/);
   assert.match(bad.output,/HD radar reserve duplicates a primary on another page/);
   // Six genuinely different reserve works repair the union, while an extra
   // cross-page primary remains invalid even with all sixteen works present.
   f.save(f.radar);const repaired=f.run();assert.equal(repaired.status,0,repaired.output);
   const extraPrimary=structuredClone(f.radar);extraPrimary.hd1.candidates.push({...f.hd[5],rank:9});
   f.save(extraPrimary);const extra=f.run();assert.equal(extra.status,1,extra.output);
   assert.match(extra.output,/HD radar reserve duplicates a primary on another page/);
 }finally{f.close()}
});

test('popularity reserve is distinct from scan, public primaries and itself',()=>{
 const f=radarFixture();
 try{
   for(const [candidate,message] of [[f.scan[0],/duplicates scan or public primary/],[f.primary[0],/duplicates scan or public primary/],[f.deep[1],/reserve contains duplicate works/]]){
     const duplicate=structuredClone(f.radar);duplicate.popular_deep.candidates[0]={...candidate,rank:6};
     f.save(duplicate);const result=f.run();assert.equal(result.status,1,result.output);assert.match(result.output,message);
   }
 }finally{f.close()}
});

test('documented radar shortages permit fewer genuine reserves, not overlap',()=>{
 const f=radarFixture();
 try{
   const shortage=structuredClone(f.radar);
   for(const key of ['hd1','hd2']){shortage[key].candidates=shortage[key].candidates.slice(0,5);shortage[key].shortage_reason='No additional eligible works after research';}
   shortage.popular_deep.candidates=[];shortage.popular_deep.shortage_reason='No additional eligible works after research';
   f.save(shortage);const smaller=f.run();assert.equal(smaller.status,0,smaller.output);
   shortage.hd1.candidates.push({...f.hd[5],rank:6});f.save(shortage);
   const overlap=f.run();assert.equal(overlap.status,1,overlap.output);assert.match(overlap.output,/reserve duplicates a primary/);
 }finally{f.close()}
});

test('S42 radar identity checks work without optional candidate ranks',()=>{
 const f=radarFixture();
 try{
   const unranked=structuredClone(f.radar);
   for(const pool of Object.values(unranked))for(const candidate of pool.candidates)delete candidate.rank;
   f.save(unranked);const good=f.run();assert.equal(good.status,0,good.output);
   unranked.hd1.candidates.push({...f.hd[5],rank:'not-a-rank'});
   f.save(unranked);const bad=f.run();assert.equal(bad.status,1,bad.output);assert.match(bad.output,/reserve duplicates a primary on another page/);
 }finally{f.close()}
});

test('S41 radar data keeps its historical reserve compatibility',()=>{
 const f=radarFixture('2026-S41');
 try{
   const historical=structuredClone(f.radar);
   historical.hd1.candidates=[...historical.hd1.candidates.slice(0,5),...f.hd.slice(5,8).map((c,i)=>({...c,rank:i+6}))];
   historical.hd2.candidates=[...historical.hd2.candidates.slice(0,5),...f.hd.slice(0,3).map((c,i)=>({...c,rank:i+6}))];
   historical.popular_deep.candidates=historical.popular_scan.candidates;
   for(const pool of Object.values(historical))for(const candidate of pool.candidates)delete candidate.rank;
   f.save(historical);const result=f.run();assert.equal(result.status,0,result.output);
 }finally{f.close()}
});
