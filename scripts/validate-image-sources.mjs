import fs from 'node:fs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const manifest=read('data/manifest.json');
const config=read('data/editorial-config.json');
const week=read('data/weeks/'+manifest.latest+'.json');
const works=read('data/works.json').works||[];
const byTitle=new Map(works.map(w=>[norm(w.title),w]));
const from=config.quality_gates?.remote_image_health_from_week||'9999-S99';

if(manifest.latest<from){
  console.log('✓ Remote image health check skipped before '+from);
  process.exit(0);
}

const visualTitles=new Set();
const visualClass=/\b(?:week-card|feature|list-card|platform|release-card|expire-card|radar-card|torrent-card|card|listitem|radarcard)\b/;
for(const page of week.pages||[]){
  const re=/<article class="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g;let m;
  while((m=re.exec(page.html||''))){
    if(!visualClass.test(m[1]))continue;
    const title=(m[2].match(/<h3>([\s\S]*?)<\/h3>/)||[])[1]?.replace(/<[^>]+>/g,'').trim();
    if(title)visualTitles.add(title);
  }
}
for(const pool of Object.values(week.personalization?.pools||{})){
  for(const c of pool.candidates||[])if(c.title)visualTitles.add(c.title);
}
const radarPath='data/radar-reserves/'+manifest.latest+'.json';
if(fs.existsSync(radarPath)){
  const rr=read(radarPath);
  for(const key of ['popular_scan','popular_deep','hd1','hd2']){
    for(const c of rr[key]?.candidates||[])if(c.title)visualTitles.add(c.title);
  }
}

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36';
async function probe(url){
  if(!/^https?:\/\//i.test(url)){
    const path=url.replace(/^\.\//,'');
    return fs.existsSync(path)?{ok:true,url,why:'local'}:{ok:false,url,why:'missing local file'};
  }
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),8000);
  try{
    const res=await fetch(url,{
      redirect:'follow',
      signal:ctrl.signal,
      headers:{'User-Agent':UA,'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}
    });
    const type=(res.headers.get('content-type')||'').toLowerCase();
    const ok=res.ok&&(type.startsWith('image/')||/\.(?:jpe?g|png|webp|gif|svg)(?:[?#]|$)/i.test(res.url));
    try{await res.body?.cancel()}catch{}
    return {ok,url,status:res.status,type,final:res.url,why:ok?'ok':'non-image or HTTP error'};
  }catch(err){
    return {ok:false,url,why:err?.name==='AbortError'?'timeout':String(err?.message||err)};
  }finally{clearTimeout(timer)}
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
console.log('✓ Remote image health: '+results.length+' visual works have at least one usable source or a documented exception');
