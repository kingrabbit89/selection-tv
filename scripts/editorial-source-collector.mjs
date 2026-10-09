// Source acquisition only: observations are leads, never editorial certification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {htmlText} from './html-text.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const day = value => {
  assert.match(value || '', /^\d{4}-\d{2}-\d{2}$/,'date must be YYYY-MM-DD');
  assert.equal(new Date(value+'T12:00:00Z').toISOString().slice(0,10),value,'invalid calendar date');
  return value;
};
const addDay = (date,n) => new Date(Date.parse(day(date)+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const dmy = date => day(date).split('-').reverse().join('-');
const channels = {'france-2':'France 2','france-3':'France 3','france-4':'France 4','france-5':'France 5','franceinfo':'Franceinfo'};
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m=>[m[1].toLowerCase(),m[3]]));
const field = (text,tag) => htmlText(text.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i'))?.[1] || '');
const plain = value => htmlText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));
function sourceIdentity(source) {
  const url=new URL(source.url);
  assert.equal(url.protocol,'https:','only explicit HTTPS source URLs are supported');
  assert(!url.username&&!url.password,'source URL credentials are forbidden');
  day(source.date);assert(typeof source.channel==='string'&&source.channel.trim(),'channel required');
  if(source.adapter==='arte-guide-html') {
    assert(['www.arte.tv','arte.tv'].includes(url.hostname),'ARTE adapter requires arte.tv');
    assert.equal(url.pathname,'/fr/guide/'+source.date.replaceAll('-','')+'/','ARTE URL/date mismatch');
    assert.equal(source.channel,'Arte','ARTE channel mismatch');
  } else if(source.adapter==='francetvpro-grid-html'||source.adapter==='francetvpro-grid-xml') {
    assert(['www.francetvpro.fr','francetvpro.fr'].includes(url.hostname),'FranceTVPro adapter requires francetvpro.fr');
    const match=url.pathname.match(source.adapter.endsWith('xml')?/^\/grille-xml\/([^/]+)\/(\d{2}-\d{2}-\d{4})\/?$/:/^\/grille\/([^/]+)\/\d{2}-\d{2}-\d{4}\/(\d{2}-\d{2}-\d{4})\/?$/);
    assert(match&&channels[match[1]],'unsupported FranceTVPro channel/path');
    assert.equal(channels[match[1]],source.channel,'FranceTVPro channel mismatch');
    assert.equal(match[2],dmy(source.date),'FranceTVPro URL/page date mismatch');
  } else throw Error('unsupported adapter: '+source.adapter);
  return url;
}
function observation(source,date,start,title) {
  day(date);assert.match(start,/^(?:[01]\d|2[0-3]):[0-5]\d$/,'invalid start');
  assert(title.trim(),'missing title');
  return {date,title:title.trim(),start,channel:source.channel,
    source:source.adapter.startsWith('arte')?'ARTE — guide officiel':'FranceTVPro — grille officielle',source_url:source.url};
}
function paris(iso) {
  assert.match(iso,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,'explicit timestamp offset required');
  day(iso.slice(0,10));const time=new Date(iso);assert(Number.isFinite(time.valueOf()),'invalid timestamp');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time).map(x=>[x.type,x.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,start:parts.hour+':'+parts.minute};
}
function assertXmlStructure(body) {
  // No external entities/DTD. Check balanced real XML tags, while CDATA and
  // comments remain text. Regex row extraction alone would accept truncation.
  const text=body.replace(/<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\?[^]*?\?>/g,'');
  const stack=[];let end=0,roots=0;
  for(const match of text.matchAll(/<([^<>]+)>/g)) {
    assert(!text.slice(end,match.index).includes('<'),'malformed XML text');end=match.index+match[0].length;
    const tag=match[1],close=tag.match(/^\/([A-Za-z_][\w:.-]*)\s*$/),open=tag.match(/^([A-Za-z_][\w:.-]*)([\s\S]*)$/);
    if(close)assert.equal(stack.pop(),close[1],'unbalanced XML closing tag');
    else {
      assert(open,'unsupported XML declaration');
      const rest=open[2].replace(/\/\s*$/,'');
      assert(/^\s*(?:[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*')\s*)*$/.test(rest),'malformed XML attributes');
      if(!stack.length)roots++;
      if(!/\/\s*$/.test(tag))stack.push(open[1]);
    }
  }
  assert(!text.slice(end).includes('<')&&stack.length===0&&roots===1,'incomplete XML document');
}

// The adapters below are tied to captured official formats. Unknown HTML,
// challenge pages and missing rows are errors, not proof of an empty schedule.
export function parseSource(body,source) {
  sourceIdentity(source);assert(typeof body==='string','source body must be text');
  const visible=htmlText(body.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,''));
  assert(!/verify you are human|site unavailable|just a moment|access denied/i.test(visible)&&!/<form\b[^>]*(?:challenge-form|cf-challenge)/i.test(body),'source challenge/unavailable page');
  const observations=[],details=[],errors=[],warnings=[];
  const keep=(o,detail)=>{observations.push(o);details.push(detail);};
  if(source.adapter==='arte-guide-html') {
    const canonical=[...body.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a.rel==='canonical');
    assert(canonical?.href===source.url,'ARTE canonical URL/date missing or mismatched');
    const rows=[...body.matchAll(/<li\b[^>]*data-testid=["']tsguide-itm["'][^>]*>([\s\S]*?)<\/li>/gi)];
    assert(rows.length,'ARTE schedule rows missing');
    const openingRows=(body.match(/<li\b[^>]*data-testid=["']tsguide-itm["'][^>]*>/gi)||[]).length;
    if(openingRows!==rows.length)errors.push({message:'truncated ARTE schedule rows',expected_rows:openingRows,parsed_rows:rows.length});
    let date=source.date,previous=-1,rollovers=0;
    for(const [index,row] of rows.entries()) {
      try {
        const text=row[1],start=plain(text.match(/<span\b[^>]*>(\d{2}:\d{2})<\/span>/)?.[1]||'');
        assert.match(start,/^(?:[01]\d|2[0-3]):[0-5]\d$/,'ARTE time missing');
        const minutes=Number(start.slice(0,2))*60+Number(start.slice(3));
        if(index===0)assert(minutes>=300,'ARTE first time is outside the observed 05:00 broadcast-day format');
        if(minutes<previous){rollovers++;assert.equal(rollovers,1,'unexpected multiple day rollovers');assert(minutes<360&&previous>=1080,'unrecognized ARTE ordering');date=addDay(source.date,1);}
        previous=minutes;
        const title=plain(text.match(/<h3\b[^>]*data-testid=["']ts-tsTitle["'][^>]*>([\s\S]*?)<\/h3>/)?.[1]||'');
        const subtitle=plain(text.match(/<p\b[^>]*data-testid=["']ts-tsSubtitle["'][^>]*>([\s\S]*?)<\/p>/)?.[1]||'');
        const link=[...text.matchAll(/<a\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a['data-testid']==='ts-tsItemLink');
        assert(link?.href?.startsWith('/fr/videos/'),'ARTE programme link missing');
        keep(observation(source,date,start,title+(subtitle?' '+subtitle:'')),{row:index,title,subtitle,programme_url:new URL(link.href,source.url).href,date_basis:'ARTE broadcast-day ordered rollover'});
      }catch(error){errors.push({row:index,message:error.message});}
    }
    warnings.push('ARTE guides cover a broadcast day starting around 05:00; fetch the previous guide to obtain the requested civil day’s early night.');
  } else if(source.adapter==='francetvpro-grid-html') {
    const canonical=[...body.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a.rel==='canonical');
    assert(canonical?.href===source.url,'FranceTVPro canonical channel/date missing or mismatched');
    const rows=body.split(/<div\b[^>]*class=["']program-item["'][^>]*>/i).slice(1);
    assert(rows.length,'FranceTVPro program-item rows missing');
    for(const [index,text]of rows.entries()) {
      try {
        const iso=attrs(text.match(/<time\b[^>]*>/i)?.[0]||'').datetime;
        const {date,start}=paris(iso||'');
        assert([source.date,addDay(source.date,1)].includes(date),'programme outside this broadcast day');
        assert(date===source.date||start<'06:00','unexpected daytime event on the next civil day');
        const match=text.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)?.find(tag=>attrs(tag)['class']?.split(/\s+/).includes('program-item__name'));
        assert(match,'FranceTVPro programme name missing');
        const title=plain(match.replace(/^<a\b[^>]*>/i,'').replace(/<\/a>$/i,''));
        const subtitle=plain(text.match(/<div\b[^>]*class=["']program-item__description["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
        keep(observation(source,date,start,title+(subtitle?' '+subtitle:'')),{row:index,title,subtitle,source_datetime:iso,date_basis:'explicit offset converted to Europe/Paris'});
      }catch(error){errors.push({row:index,message:error.message});}
    }
    assert(observations.some(o=>o.date===source.date),'no event on the requested FranceTVPro day');
    warnings.push('FranceTVPro uses broadcast days; events after midnight retain their explicit civil dates.');
  } else {
    assert(!/<!DOCTYPE/i.test(body),'XML document types are unsupported');
    assert(/^\s*(?:<\?xml[^>]*>\s*)?<response\b[^>]*>[\s\S]*<\/response>\s*$/i.test(body),'FranceTVPro response XML missing');
    assertXmlStructure(body);
    const rows=[...body.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/gi)];
    assert(rows.length,'FranceTVPro XML items missing');
    assert.equal(rows.length,(body.match(/<item\b/gi)||[]).length,'truncated XML items');
    for(const [index,row]of rows.entries()) {
      try {
        const text=row[2],iso=field(text,'diffusion_date');
        assert.match(iso,/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/,'FranceTVPro local diffusion_date missing');
        const date=day(iso.slice(0,10)),start=iso.slice(11,16);
        assert(date>=source.date&&date<=addDay(source.date,7),'XML event outside requested broadcast week');
        assert(date<addDay(source.date,7)||start<'06:00','unexpected daytime event after this broadcast week');
        const title=field(text,'title'),subtitle=field(text,'subtitle');
        keep(observation(source,date,start,title+(subtitle?' '+subtitle:'')),{row:index,provider_id:attrs('<item '+row[1]+'>').key||null,title,subtitle,source_datetime:iso,date_basis:'FranceTVPro local Europe/Paris diffusion_date',slot_duration:field(text.match(/<duration\b[^>]*>([\s\S]*?)<\/duration>/i)?.[1]||'','value')});
      }catch(error){errors.push({row:index,message:error.message});}
    }
    warnings.push('XML is a broadcast week starting around 05:00; acquire the previous week for the first civil day’s early night.');
    warnings.push('FranceTVPro XML has no channel marker; the exact approved endpoint/channel mapping supplies its channel provenance.');
  }
  return {observations,details,errors,warnings,status:observations.length?(errors.length?'partial':'parsed'):'unparsed'};
}

async function readBounded(response,maxBytes) {
  const declared=Number(response.headers?.get?.('content-length')||0);
  assert(declared<=maxBytes,'source exceeds byte limit');
  if(!response.body?.getReader){const bytes=Buffer.from(await response.text());assert(bytes.length<=maxBytes,'source exceeds byte limit');return bytes;}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=maxBytes,'source exceeds byte limit');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
async function fetchSource(source,{fetchImpl,timeoutMs,retries,maxBytes}) {
  let last;
  for(let attempt=0;attempt<=retries;attempt++) {
    const abort=new AbortController();let timer;
    try {
      const result=await Promise.race([
        (async()=>{
          const response=await fetchImpl(source.url,{signal:abort.signal,redirect:'follow',headers:{'User-Agent':'SelectionTVSourceCollector/1.0','Accept':'text/html,application/xml,text/xml'}});
          if(!response.ok){const error=Error('HTTP '+response.status);error.http_status=response.status;throw error;}
          const final=response.url||source.url;const check={...source,url:final};sourceIdentity(check);
          const bytes=await readBounded(response,maxBytes);
          return {bytes,final_url:final,http_status:response.status,content_type:response.headers?.get?.('content-type')||null};
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('source timeout'));},timeoutMs);})
      ]);
      return {...result,attempts:attempt+1};
    } catch(error) {
      last=error;
      if(error.http_status&&![408,429].includes(error.http_status)&&error.http_status<500)break;
    } finally {clearTimeout(timer);abort.abort();}
  }
  throw last;
}
async function atomic(file,content) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+process.pid+'.'+sha(String(Math.random())).slice(0,8)+'.tmp';
  try{await fs.writeFile(temp,content);await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}

export async function collectSources(plan,{fetchImpl=globalThis.fetch,cacheDir,snapshotDir,concurrency=3,timeoutMs=15000,retries=1,maxBytes=4*1024*1024,cacheMaxAgeMs=3600000,refresh=false,now=()=>new Date()}={}) {
  assert.equal(plan?.schema_version,1,'source plan schema_version must be 1');
  assert(Array.isArray(plan.sources)&&plan.sources.length<=400,'source plan requires at most 400 explicit sources');
  assert(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=8,'concurrency must be 1..8');
  assert(Number.isInteger(retries)&&retries>=0&&retries<=2,'retries must be 0..2');
  assert(timeoutMs>0&&timeoutMs<=60000&&maxBytes>0&&maxBytes<=16*1024*1024&&cacheMaxAgeMs>=0,'invalid acquisition bounds');
  const ids=new Set();for(const source of plan.sources){assert(typeof source.id==='string'&&source.id&&!ids.has(source.id),'unique source id required');ids.add(source.id);}
  const clock=()=>{const d=new Date(typeof now==='function'?now():now);assert(Number.isFinite(d.valueOf()),'invalid observed clock');return d.toISOString();};
  if(snapshotDir)await fs.mkdir(snapshotDir,{recursive:true});
  const results=new Array(plan.sources.length),acquisitions=new Map();let cursor=0;
  async function collect(source) {
    const base={id:source.id,adapter:source.adapter,url:source.url,channel:source.channel,date:source.date};
    let evidence=null;
    try {
      sourceIdentity(source);
      const key=sha(JSON.stringify([source.adapter,source.url,source.channel,source.date]));
      let bytes,metadata,mode;
      if(source.input_file) {
        bytes=await fs.readFile(source.input_file);assert(bytes.length<=maxBytes,'source exceeds byte limit');
        metadata={fetched_at:source.captured_at||null,final_url:source.url,http_status:null,content_type:null,attempts:0};
        if(metadata.fetched_at)assert(Number.isFinite(Date.parse(metadata.fetched_at)),'invalid captured_at');
        mode='provided_file';
      } else {
        if(!acquisitions.has(key))acquisitions.set(key,(async()=>{
        let bytes,metadata,mode,cached;
        if(cacheDir) {
          try {
            metadata=JSON.parse(await fs.readFile(path.join(cacheDir,key+'.json'),'utf8'));
            bytes=await fs.readFile(path.join(cacheDir,key+'.body'));
            assert(bytes.length<=maxBytes&&sha(bytes)===metadata.sha256,'cached source fingerprint mismatch');
            assert(metadata.url===source.url&&metadata.adapter===source.adapter,'cached source identity mismatch');
            const age=Date.parse(clock())-Date.parse(metadata.fetched_at);assert(Number.isFinite(age)&&age>=0,'invalid cached clock');
            cached={bytes,metadata};
            if(age<=cacheMaxAgeMs&&!refresh)mode='cache';
            else bytes=undefined;
          } catch(error){if(error.code!=='ENOENT')throw error;}
        }
        if(!bytes) {
          assert(typeof fetchImpl==='function','fetch implementation unavailable');
          try {
            const fetched=await fetchSource(source,{fetchImpl,timeoutMs,retries,maxBytes});bytes=fetched.bytes;
            metadata={...fetched,fetched_at:clock()};delete metadata.bytes;mode='network';
          }catch(error){
            if(!cached)throw error;
            bytes=cached.bytes;metadata={...cached.metadata,refresh_error:{message:error.message,http_status:error.http_status||null}};mode='stale_cache';
          }
        }
        if(cacheDir&&mode==='network') {
          await atomic(path.join(cacheDir,key+'.body'),bytes);
          await atomic(path.join(cacheDir,key+'.json'),JSON.stringify({...metadata,url:source.url,adapter:source.adapter,sha256:sha(bytes)})+'\n');
        }
        return {bytes,metadata,mode};
        })());
        ({bytes,metadata,mode}=await acquisitions.get(key));
      }
      const fingerprint=sha(bytes);
      evidence={...metadata,mode,bytes:bytes.length,sha256:fingerprint,body_path:null};
      if(snapshotDir){evidence.body_path=path.join(snapshotDir,key+'.body');await atomic(evidence.body_path,bytes);}
      const parsed=parseSource(new TextDecoder('utf-8',{fatal:true}).decode(bytes),source);
      if(mode==='stale_cache') {
        parsed.warnings.push('Fresh acquisition failed; the old cache is retained with its original fetched_at, not a successful current consultation.');
        parsed.errors.push({acquisition:true,...metadata.refresh_error});
        parsed.status='stale';
      }
      return {...base,...parsed,evidence,observations_count:parsed.observations.length,freshness_verified:false};
    } catch(error) {return {...base,status:/unsupported adapter/.test(error.message)?'unsupported':'unparsed',observations:[],details:[],observations_count:0,evidence,errors:[{message:error.message,http_status:error.http_status||null}],warnings:[],freshness_verified:false};}
  }
  await Promise.all(Array.from({length:Math.min(concurrency,plan.sources.length)},async()=>{while(cursor<plan.sources.length){const i=cursor++;results[i]=await collect(plan.sources[i]);}}));
  const observations=[],seen=new Set();for(const result of results)for(const item of result.observations){const key=JSON.stringify([item.date,item.start,item.channel,item.title,item.source_url]);if(!seen.has(key)){seen.add(key);observations.push(item);}}
  return {schema_version:1,observed_at:clock(),observations,source_results:results,publication_ready:false,coverage_certified:false,
    note:'Source observations only. No canonical identity, independent-source agreement, editorial recall or completed coverage is inferred.'};
}

// Derive explicit future URLs from observed templates; never invent a provider
// or silently re-fetch an already acquired cycle. TV-Programme remains listed
// as unsupported until its real raw format can be validated (bot wall observed).
export function sourcePlanFromInventory(inventory,{from,refresh=false}={}) {
  day(from);const oldFrom=inventory?.days?.[0]?.date;day(oldFrom);
  if(from===oldFrom&&!refresh)return {schema_version:1,sources:[],note:'This cycle is already acquired; explicit refresh is required.'};
  const templates=new Map();
  for(const row of inventory.days||[])for(const item of row.items||[]) {
    try {
      const url=new URL(item.source_url);let template,adapter;
      if(['tv-programme.com','www.tv-programme.com'].includes(url.hostname)&&/^\/[^/]+\/[a-z]+-\d{1,2}-[a-z]+-\d{4}\/$/.test(url.pathname)){template=url.origin+'/'+url.pathname.split('/')[1]+'/';adapter='tv-programme-html';}
      else if(['arte.tv','www.arte.tv'].includes(url.hostname)&&/^\/fr\/guide\/\d{8}\/$/.test(url.pathname)){template=url.origin+'/fr/guide/';adapter='arte-guide-html';}
      else continue;
      const key=adapter+'|'+item.channel+'|'+template;templates.set(key,{template,adapter,channel:item.channel});
    }catch{}
  }
  const weekdays=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const months=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  const sources=[];
  for(let n=0;n<7;n++){const date=addDay(from,n),d=new Date(date+'T12:00:00Z');for(const [index,t]of [...templates.values()].entries()) {
    const suffix=t.adapter==='arte-guide-html'?date.replaceAll('-','')+'/':`${weekdays[d.getUTCDay()]}-${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}/`;
    sources.push({id:`source-${n}-${index}`,adapter:t.adapter,url:t.template+suffix,channel:t.channel,date});
  }}
  return {schema_version:1,sources,note:'URL templates only, not fetched evidence. Unsupported providers remain explicit failures; completeness and early-night coverage are not certified.'};
}
