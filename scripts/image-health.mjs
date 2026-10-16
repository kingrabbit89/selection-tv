import {htmlText} from './html-text.mjs';

export const normTitle=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();

// Titles shown as posters for one issue. validate-image-sources.mjs and
// poster-resolver.mjs share this set so selection and seal see the same works.
export function visualWorkTitles(week,{legacyGridOnly=false,radar=null}={}){
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
       const title=htmlText((m[2].match(/<h3>([\s\S]*?)<\/h3>/)||[])[1]);
       if(title)visualTitles.add(title);
     }
   }
   // Android TV promotes each commented-grid table row to a poster tile.
   // Probe those canonical images too, even though the desktop magazine keeps
   // the same entries as text rows.
   if(/-grille(?:-2)?$/.test(page.id||'')){
     for(const row of html.matchAll(/<td class="prog">([^<]+)<\/td>/g)){
       const title=htmlText(row[1]);
       if(title)visualTitles.add(title);
     }
   }
 }
 if(!legacyGridOnly){
   for(const pool of Object.values(week.personalization?.pools||{})){
     for(const c of pool.candidates||[])if(c.title)visualTitles.add(c.title);
   }
   const rr=typeof radar==='function'?radar():radar;
   if(rr){
     for(const key of ['popular_scan','popular_deep','hd1','hd2']){
       for(const c of rr[key]?.candidates||[])if(c.title)visualTitles.add(c.title);
     }
   }
 }
 return visualTitles;
}

// Check response bytes, not filename suffixes (CDNs can return HTML at .jpg URLs).
export function hasImageSignature(bytes){
 const b=Buffer.from(bytes);
 return (b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)||
   b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
   /^GIF8[79]a/.test(b.toString('ascii',0,6))||
   (b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')||
   (b.toString('ascii',4,8)==='ftyp'&&/avif|avis/.test(b.toString('ascii',8,32)))||
   /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(b.toString('utf8').replace(/^\uFEFF/,''));
}
export async function probeRemoteImage(url,{fetcher=fetch,attempts=3,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let last;
 for(let attempt=0;attempt<attempts;attempt++){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
   try{
     const res=await fetcher(url,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0','Accept':'image/*'}});
     const type=res.headers.get('content-type')||'';
     if(!res.ok){
       await res.body?.cancel();last={ok:false,url,status:res.status,type,why:'HTTP error'};
       if(res.status<500&&res.status!==429)return last;
     }else{
       const reader=res.body?.getReader();let bytes=Buffer.alloc(0);
       if(reader){try{while(bytes.length<512){const chunk=await reader.read();if(chunk.done)break;bytes=Buffer.concat([bytes,Buffer.from(chunk.value)]);}}finally{await reader.cancel()}}
       const ok=hasImageSignature(bytes);
       return {ok,url,status:res.status,type,final:res.url,why:ok?'image signature':'non-image response bytes'};
     }
   }catch(error){last={ok:false,url,why:error.name==='AbortError'?'timeout':error.message}}
   finally{clearTimeout(timer)}
   if(attempt+1<attempts)await delay(500*(attempt+1));
 }
 return last;
}
