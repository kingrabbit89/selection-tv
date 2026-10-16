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
const WEEKDAYS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const frenchWeekday = date => WEEKDAYS[new Date(day(date)+'T12:00:00Z').getUTCDay()];
// Official TV5MONDE+ guide API, France Belgique Suisse Monaco feed (channel 6),
// 10 programmes per page. Broadcast days run from about 04:00 to 04:00.
export const TV5MONDE_MAX_PAGES = 10;
export const tv5mondeUrl = (date,page) =>
  `https://www.tv5mondeplus.com/api/psi/programs-grid?language=fr&timezone=Europe%2FParis&channel=6&day=${day(date)}&page=${page}&limit=10`;
// Télé 7 Jours channel slugs for the issue's channels. Three slugs keep their
// former brand names; their grids were checked against the same channel for
// S43 (Ciné+ Club = Ciné+ Festival, Ciné+ Famiz = Ciné+ Family, OCS = Ciné+ OCS).
// TV5MONDE is deliberately absent: Télé 7 Jours lists the Europe feed, not FBS.
export const TELE7JOURS_CHANNELS = Object.freeze({
  'tf1':'TF1','france-2':'France 2','france-3':'France 3','france-4':'France 4','france-5':'France 5','m6':'M6','arte':'Arte',
  'w9':'W9','tmc':'TMC','tfx':'TFX','6ter':'6ter','gulli':'Gulli','paris-premiere':'Paris Première','rmc-story':'RMC Story',
  'rmc-decouverte':'RMC Découverte','rtl-9':'RTL9','canal':'Canal+','canal-cinema-s':'Canal+ Cinéma','canal-box-office':'Canal+ Box Office',
  'canal-grand-ecran':'Canal+ Grand Écran','tcm-cinema':'TCM Cinéma','action':'Action','cine-classic':'Ciné+ Classic',
  'cine-club':'Ciné+ Festival','cine-emotion':'Ciné+ Emotion','cine-frisson':'Ciné+ Frisson','cine-famiz':'Ciné+ Family','ocs':'Ciné+ OCS'});
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
  } else if(source.adapter==='tv5monde-psi-json') {
    const page=Number(url.searchParams.get('page'));
    assert(Number.isInteger(page)&&page>=1&&page<=TV5MONDE_MAX_PAGES,'TV5MONDE page must be 1..'+TV5MONDE_MAX_PAGES);
    assert.equal(source.url,tv5mondeUrl(source.date,page),'TV5MONDE URL must be the official FBS grid endpoint for this date');
    assert.equal(source.channel,'TV5MONDE','TV5MONDE channel mismatch');
  } else if(source.adapter==='tele7jours-html') {
    assert.equal(url.hostname,'www.programme-television.org','Télé 7 Jours adapter requires www.programme-television.org');
    const match=url.pathname.match(/^\/tv\/chaines\/([a-z0-9-]+)\/([a-z]+)(-prochain)?$/);
    assert(match&&TELE7JOURS_CHANNELS[match[1]],'unsupported Télé 7 Jours channel/path');
    assert.equal(TELE7JOURS_CHANNELS[match[1]],source.channel,'Télé 7 Jours channel mismatch');
    assert.equal(match[2],frenchWeekday(source.date),'Télé 7 Jours weekday/date mismatch');
    assert(!url.search&&!url.hash,'Télé 7 Jours URL must not carry parameters');
  } else throw Error('unsupported adapter: '+source.adapter);
  return url;
}
const sourceLabels={'arte-guide-html':'ARTE — guide officiel','francetvpro-grid-html':'FranceTVPro — grille officielle',
  'francetvpro-grid-xml':'FranceTVPro — grille officielle','tv5monde-psi-json':'TV5MONDE — guide officiel (flux FBS)',
  'tele7jours-html':'Télé 7 Jours — grille Web datée'};
function observation(source,date,start,title) {
  day(date);assert.match(start,/^(?:[01]\d|2[0-3]):[0-5]\d$/,'invalid start');
  assert(title.trim(),'missing title');
  return {date,title:title.trim(),start,channel:source.channel,source:sourceLabels[source.adapter],source_url:source.url};
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
  const observations=[],details=[],errors=[],warnings=[];let pagination=null;
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
  } else if(source.adapter==='tv5monde-psi-json') {
    let json;try{json=JSON.parse(body);}catch{throw Error('TV5MONDE JSON response missing');}
    assert.equal(json?.success,true,'TV5MONDE response not successful');
    const page=Number(new URL(source.url).searchParams.get('page')),programs=json.data?.programs,meta=json.data?.pagination;
    assert(Array.isArray(programs)&&meta&&typeof meta==='object','TV5MONDE programs/pagination missing');
    assert.equal(Number(meta.page),page,'TV5MONDE page mismatch');
    if(!programs.length) {
      // The API answers pages after the last one with an empty list and zero totals.
      assert(page>1&&Number(meta.total_products)===0,'TV5MONDE first page is empty');
      return {observations,details,errors,warnings:['Page after the last TV5MONDE page for this broadcast day.'],status:'beyond_last_page',pagination:{page,total_pages:0,total_products:0}};
    }
    assert(Number.isInteger(meta.total_pages)&&Number.isInteger(meta.total_products)&&page<=meta.total_pages,'TV5MONDE page outside its pagination');
    pagination={page,total_pages:meta.total_pages,total_products:meta.total_products};
    for(const [index,item] of programs.entries()) {
      try {
        assert.equal(item?.channelId,6,'TV5MONDE programme outside the FBS channel');
        const iso=String(item.publishDate||''),{date,start}=paris(iso);
        assert([source.date,addDay(source.date,1)].includes(date),'programme outside this broadcast day');
        assert(date===source.date||start<'06:00','unexpected daytime event on the next civil day');
        const title=plain(String(item.title??'')),subtitle=plain(String(item.episodeTitle??''));
        keep(observation(source,date,start,title+(subtitle?' '+subtitle:'')),{row:index,provider_id:item.id??null,origin_id:item.originId??null,title,subtitle,
          category:item.category||null,slot_duration:item.duration||null,source_datetime:iso,date_basis:'explicit offset converted to Europe/Paris'});
      }catch(error){errors.push({row:index,message:error.message});}
    }
    warnings.push('TV5MONDE broadcast days start around 04:00: acquire every page up to total_pages, and the previous day for the requested civil day’s early night.');
  } else if(source.adapter==='tele7jours-html') {
    const canonical=[...body.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a.rel==='canonical');
    // Observed canonical links vary only in slug case (/TF1/ vs /tf1/).
    assert(canonical?.href&&canonical.href.toLowerCase()===source.url.toLowerCase(),'Télé 7 Jours canonical channel/day missing or mismatched');
    const pageTitle=plain(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').toLowerCase().replace(/\s+/g,' ');
    const target=new Date(source.date+'T12:00:00Z'),dom=target.getUTCDate(),month=MONTHS[target.getUTCMonth()];
    const labels=[`${frenchWeekday(source.date)} ${dom} ${month}`,...(dom===1?[`${frenchWeekday(source.date)} 1er ${month}`]:[])];
    assert(labels.some(label=>pageTitle.includes(' '+label+' |')),'Télé 7 Jours page date does not match '+source.date);
    const rows=body.split(/<li\b[^>]*class=["']tvgrid-broadcast__item["'][^>]*>/i).slice(1);
    assert(rows.length,'Télé 7 Jours schedule rows missing');
    const times=(body.match(/class=["']tvgrid-broadcast__details-time["']/gi)||[]).length;
    if(times!==rows.length)errors.push({message:'truncated Télé 7 Jours schedule rows',expected_rows:times,parsed_rows:rows.length});
    let date=source.date,previous=-1,rollovers=0;
    for(const [index,text] of rows.entries()) {
      try {
        const start=plain(text.match(/class=["']tvgrid-broadcast__details-time["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
        assert.match(start,/^(?:[01]\d|2[0-3]):[0-5]\d$/,'Télé 7 Jours time missing');
        const minutes=Number(start.slice(0,2))*60+Number(start.slice(3));
        if(minutes<previous){rollovers++;assert.equal(rollovers,1,'unexpected multiple day rollovers');assert(minutes<480&&previous>=1080,'unrecognized Télé 7 Jours ordering');date=addDay(source.date,1);}
        previous=minutes;
        const title=plain(text.match(/class=["']tvgrid-broadcast__details-title["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
        const episode=plain(text.match(/class=["']tvgrid-broadcast__details-season["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
        const info=plain(text.match(/class=["']tvgrid-broadcast__subdetails["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
        const link=[...text.matchAll(/<a\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a.href?.startsWith('/'));
        keep(observation(source,date,start,title+(episode?' '+episode:'')),{row:index,title,subtitle:episode,duration_genre:info||null,
          programme_url:link?new URL(link.href,source.url).href:null,date_basis:'Télé 7 Jours broadcast-day ordered rollover, date verified in the page title'});
      }catch(error){errors.push({row:index,message:error.message});}
    }
    warnings.push('Télé 7 Jours pages cover a broadcast day starting in the early morning; acquire the previous day for the requested civil day’s early night.');
    warnings.push('Third-party guide: its upstream provider is unknown; agreement with another aggregator is not independence.');
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
  return {observations,details,errors,warnings,status:observations.length?(errors.length?'partial':'parsed'):'unparsed',...(pagination?{pagination}:{})};
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
// A 429 retry waits for Retry-After (seconds) or an exponential delay, both
// capped, instead of hammering a guide that asked the collector to slow down.
const retryDelay=(error,attempt,maxWaitMs)=>{
  const header=Number(error.retry_after);
  return Math.min(maxWaitMs,Number.isFinite(header)&&header>=0?header*1000:2000*2**attempt);
};
async function fetchSource(source,{fetchImpl,timeoutMs,retries,maxBytes,pace=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxRetryWaitMs=30000}) {
  let last;
  for(let attempt=0;attempt<=retries;attempt++) {
    const abort=new AbortController();let timer;
    try {
      await pace(source.url);
      const result=await Promise.race([
        (async()=>{
          const response=await fetchImpl(source.url,{signal:abort.signal,redirect:'follow',headers:{'User-Agent':'SelectionTVSourceCollector/1.0','Accept':'text/html,application/xml,text/xml,application/json'}});
          if(!response.ok){const error=Error('HTTP '+response.status);error.http_status=response.status;error.retry_after=response.headers?.get?.('retry-after')??null;throw error;}
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
      if(error.http_status===429&&attempt<retries)await sleep(retryDelay(error,attempt,maxRetryWaitMs));
    } finally {clearTimeout(timer);abort.abort();}
  }
  throw last;
}
async function atomic(file,content) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+process.pid+'.'+sha(String(Math.random())).slice(0,8)+'.tmp';
  try{await fs.writeFile(temp,content);await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}

export async function collectSources(plan,{fetchImpl=globalThis.fetch,cacheDir,snapshotDir,concurrency=3,timeoutMs=15000,retries=1,maxBytes=4*1024*1024,cacheMaxAgeMs=3600000,refresh=false,now=()=>new Date(),
  minIntervalMs=0,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxRetryWaitMs=30000}={}) {
  assert(Number.isInteger(minIntervalMs)&&minIntervalMs>=0&&minIntervalMs<=60000,'minIntervalMs must be 0..60000');
  // Optional politeness: requests to one host start at least minIntervalMs apart.
  const nextSlot=new Map();
  const pace=async url=>{if(!minIntervalMs)return;const host=new URL(url).hostname,at=Math.max(Date.now(),nextSlot.get(host)||0);
    nextSlot.set(host,at+minIntervalMs);const wait=at-Date.now();if(wait>0)await sleep(wait);};
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
            const fetched=await fetchSource(source,{fetchImpl,timeoutMs,retries,maxBytes,pace,sleep,maxRetryWaitMs});bytes=fetched.bytes;
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

// Explicit TV5MONDE plan: the previous broadcast day (civil early night of the
// first date) and the seven issue days, pages 1..pages. Pages after the last
// one are answered empty and reported as beyond_last_page.
export function tv5mondeSources(from,{pages=6}={}) {
  day(from);assert(Number.isInteger(pages)&&pages>=1&&pages<=TV5MONDE_MAX_PAGES,'pages must be 1..'+TV5MONDE_MAX_PAGES);
  const sources=[];
  for(let n=-1;n<7;n++){const date=addDay(from,n);for(let page=1;page<=pages;page++)
    sources.push({id:`tv5monde-${date}-p${page}`,adapter:'tv5monde-psi-json',url:tv5mondeUrl(date,page),channel:'TV5MONDE',date});}
  return sources;
}

// Every TV5MONDE broadcast day needs all its pages; a plan that stopped early
// or a page that failed leaves a real gap, never an empty schedule.
export function paginationGaps(sourceResults) {
  const byDate=new Map();
  for(const row of sourceResults||[])if(row.adapter==='tv5monde-psi-json'){const page=Number(new URL(row.url).searchParams.get('page'));
    if(!byDate.has(row.date))byDate.set(row.date,new Map());byDate.get(row.date).set(page,row);}
  const gaps=[];
  for(const [date,pages] of byDate) {
    const first=pages.get(1),total=first?.pagination?.total_pages;
    if(!first||!['parsed','partial'].includes(first.status)||!Number.isInteger(total)){gaps.push({date,reason:'first page unavailable',pages:[1]});continue;}
    const missing=[];for(let page=1;page<=total;page++)if(!['parsed','partial'].includes(pages.get(page)?.status))missing.push(page);
    if(missing.length)gaps.push({date,reason:'pages missing or unparsed',pages:missing});
    const seen=[...pages.values()].filter(r=>Number(new URL(r.url).searchParams.get('page'))<=total).reduce((n,r)=>n+(r.observations_count||0),0);
    if(!missing.length&&seen!==first.pagination.total_products)gaps.push({date,reason:'observation count differs from total_products',expected:first.pagination.total_products,parsed:seen});
  }
  return gaps;
}

// Télé 7 Jours only publishes relative day pages: "<weekday>" is the next
// occurrence 1 to 7 days ahead, "<weekday>-prochain" the one 8 to 13 days ahead
// (observed 2026-10-16). The page title is the date proof checked by the
// adapter (tomorrow's page carries no date and is refused); dates out of reach
// are listed, never guessed.
export function tele7joursSources(from,{today,channels=Object.values(TELE7JOURS_CHANNELS)}={}) {
  day(from);day(today);
  const slugs=Object.fromEntries(Object.entries(TELE7JOURS_CHANNELS).map(([slug,name])=>[name,slug]));
  const sources=[],unreachable=[];
  for(let n=-1;n<7;n++){
    const date=addDay(from,n),offset=Math.round((Date.parse(date)-Date.parse(today))/86400000);
    if(offset<1||offset>13){unreachable.push(date);continue;}
    const suffix=frenchWeekday(date)+(offset>7?'-prochain':'');
    for(const channel of channels){const slug=slugs[channel];assert(slug,'no Télé 7 Jours slug for '+channel);
      sources.push({id:`t7j-${slug}-${date}`,adapter:'tele7jours-html',url:`https://www.programme-television.org/tv/chaines/${slug}/${suffix}`,channel,date});}
  }
  return {sources,unreachable,note:'Relative day pages; each page title must prove its date. Dates outside the 1..13-day window must be acquired on another day or from another source.'};
}
