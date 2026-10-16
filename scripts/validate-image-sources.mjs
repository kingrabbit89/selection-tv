import {probeRemoteImage,hasImageSignature,visualWorkTitles,normTitle as norm} from './image-health.mjs';
import fs from 'node:fs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read('data/manifest.json');
const targetWeek=process.env.SELECTION_TV_VALIDATE_WEEK||manifest.latest;
const config=read('data/editorial-config.json');
const week=read('data/weeks/'+targetWeek+'.json');
const works=read('data/works.json').works||[];
const byTitle=new Map(works.map(w=>[norm(w.title),w]));
const from=config.quality_gates?.remote_image_health_from_week||'9999-S99';
const legacyGridOnly=targetWeek<from;
const radarPath='data/radar-reserves/'+targetWeek+'.json';
const visualTitles=visualWorkTitles(week,{legacyGridOnly,radar:()=>fs.existsSync(radarPath)?read(radarPath):null});

async function probe(url){
  if(!/^https?:\/\//i.test(url)){
    const path=url.replace(/^\.\//,'');
    const ok=fs.existsSync(path)&&hasImageSignature(fs.readFileSync(path));
    return {ok,url,why:ok?'local image':'missing/non-image local file'};
  }
  return probeRemoteImage(url);
}

async function runOne(title){
  const w=byTitle.get(norm(title));
  if(!w)return {title,ok:false,why:'missing works.json record',attempts:[]};
  const urls=[w.image,...(w.image_fallbacks||[])].filter(Boolean);
  if(!urls.length){
    return {title,ok:!!w.image_exception_reason,why:w.image_exception_reason?'documented exception':'no image or exception',attempts:[]};
  }
  const attempts=[];
  for(const url of [...new Set(urls)]){
    const r=await probe(url);attempts.push(r);
    if(r.ok)return {title,ok:true,attempts};
  }
  return {title,ok:false,why:'all image sources failed from a no-Referer client',attempts};
}

const titles=[...visualTitles];
const results=[];
const concurrency=8;
for(let i=0;i<titles.length;i+=concurrency){
  results.push(...await Promise.all(titles.slice(i,i+concurrency).map(runOne)));
}
const failed=results.filter(x=>!x.ok);
for(const r of results){
  if(r.ok)continue;
  console.error('✗ '+r.title+': '+(r.why||'image unavailable'));
  for(const a of r.attempts||[])console.error('  - '+a.url+' => '+(a.status??'ERR')+' '+(a.type||a.why||''));
}
if(failed.length){
  console.error('✗ Remote image health: '+failed.length+'/'+results.length+' visual works have no usable source');
  process.exit(1);
}
console.log('✓ Remote image health: '+results.length+(legacyGridOnly?' Android TV grid':' visual')+' works have at least one usable source or a documented exception');
