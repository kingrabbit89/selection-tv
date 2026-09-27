import {probeRemoteImage,hasImageSignature} from './image-health.mjs';
import fs from 'node:fs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const manifest=read('data/manifest.json');
const targetWeek=process.env.SELECTION_TV_VALIDATE_WEEK||manifest.latest;
const config=read('data/editorial-config.json');
const week=read('data/weeks/'+targetWeek+'.json');
const works=read('data/works.json').works||[];
const byTitle=new Map(works.map(w=>[norm(w.title),w]));
const from=config.quality_gates?.remote_image_health_from_week||'9999-S99';
const legacyGridOnly=targetWeek<from;

// S41 predates the global remote-image gate, but Android TV turns its
// commented-grid rows into poster cards. Probe those rows now so the current
// Fire TV fix cannot ship with another set of dead poster URLs.
const visualTitles=new Set();
const visualClass=/\b(?:week-card|feature|list-card|platform|release-card|expire-card|radar-card|torrent-card|card|listitem|radarcard)\b/;
for(const page of week.pages||[]){
  const html=page.html||'';
  const re=/<article class="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g;let m;
  while((m=re.exec(html))){
    if(!visualClass.test(m[1]))continue;
    if(!legacyGridOnly){
      const title=(m[2].match(/<h3>([\s\S]*?)<\/h3>/)||[])[1]?.replace(/<[^>]+>/g,'').trim();
      if(title)visualTitles.add(title);
    }
  }
  // Android TV promotes each commented-grid table row to a poster tile.
  // Probe those canonical images too, even though the desktop magazine keeps
  // the same entries as text rows.
  if(/-grille(?:-2)?$/.test(page.id||'')){
    for(const row of html.matchAll(/<td class="prog">([^<]+)<\/td>/g)){
      const title=String(row[1]||'').trim();
      if(title)visualTitles.add(title);
    }
  }
}
if(!legacyGridOnly){
  for(const pool of Object.values(week.personalization?.pools||{})){
    for(const c of pool.candidates||[])if(c.title)visualTitles.add(c.title);
  }
  const radarPath='data/radar-reserves/'+targetWeek+'.json';
  if(fs.existsSync(radarPath)){
    const rr=read(radarPath);
    for(const key of ['popular_scan','popular_deep','hd1','hd2']){
      for(const c of rr[key]?.candidates||[])if(c.title)visualTitles.add(c.title);
    }
  }
}

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
