// Resolve posters at selection time from exact identity links only.
// Every candidate passes the same no-Referer probe as validate-image-sources.mjs;
// search pages, image search engines and challenged pages are never used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {probeRemoteImage,hasImageSignature,visualWorkTitles,normTitle} from './image-health.mjs';
import {decodeHtmlEntities} from './html-text.mjs';
import {digest,validateBundle} from './editorial-handoff.mjs';

const array=value=>Array.isArray(value)?value:[];
const host=url=>{try{return new URL(url).host}catch{return null}};
const USER_AGENT='Mozilla/5.0 (compatible; SelectionTV-poster-resolver/1.0; +https://github.com/kingrabbit89/selection-tv)';

// Fixed order. Official programme images come last: they are landscape art.
export const LADDER=['senscritique','imdb','tmdb','arte','francetvpro','tv5monde'];

// Only canonical work pages count as identity. Guides, grids without a
// programme id, search results and review pages never match.
export const IDENTITY_PATTERNS={
  senscritique:[/^https:\/\/www\.senscritique\.com\/(film|serie)\/[^/?#]+\/(\d+)\/?$/,m=>({id:m[2],kind:m[1]})],
  imdb:[/^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/(tt\d+)\/?$/,m=>({id:m[1]})],
  tmdb:[/^https:\/\/www\.themoviedb\.org\/(movie|tv)\/(\d+)(?:-[^/?#]*)?\/?$/,m=>({id:m[2],kind:m[1]})],
  arte:[/^https:\/\/(?:www\.arte\.tv\/[a-z]{2}\/videos|api(?:-cdn)?\.arte\.tv\/api\/player\/v2\/config\/[a-z]{2})\/(\d{6}-\d{3}-[A-Z])(?:\/[^?#]*)?$/,m=>({id:m[1]})],
  francetvpro:[/^https:\/\/www\.francetvpro\.fr\/contenu-de-presse\/(\d+)\/?$/,m=>({id:m[1]})],
  // The official grid lists a whole day; the fragment pins the programme id.
  tv5monde:[/^https:\/\/www\.tv5mondeplus\.com\/api\/psi\/programs-grid\?((?=[^#]*\bchannel=\d+)(?=[^#]*\bday=\d{4}-\d{2}-\d{2})[^#]+)#program=(\d+)$/,
    m=>({id:m[2],grid:'https://www.tv5mondeplus.com/api/psi/programs-grid?'+m[1]})]
};
// TMDb numbers movies and series separately: movie/5 and tv/5 are two works.
const refId=ref=>ref.grid?ref.grid+'#'+ref.id:(ref.kind?ref.kind+'/':'')+ref.id;

// links.json is keyed by title: a key shared by several works is not an identity.
export function linkClaims(works){
  const claims=new Map();
  for(const work of works)for(const name of [work.title,...array(work.aliases)]){
    const key=normTitle(name);if(!key)continue;
    if(!claims.has(key))claims.set(key,new Set());
    claims.get(key).add(work.id);
  }
  return claims;
}

export function exactIdentity(work,{links={},claims=linkClaims([work]),patterns=IDENTITY_PATTERNS}={}){
  const names=new Set([work.title,...array(work.aliases)].map(normTitle).filter(Boolean));
  const sources=[],notes=[];
  for(const [key,value] of Object.entries(work.links||{}))sources.push({origin:'works.json#links.'+key,value});
  for(const [title,entry] of Object.entries(links)){
    const key=normTitle(title);if(!names.has(key))continue;
    if((claims.get(key)?.size||0)>1){notes.push('links.json key shared by several works, ignored: '+title);continue;}
    for(const [kind,value] of Object.entries(entry||{}))sources.push({origin:'links.json#'+title+'.'+kind,value});
  }
  const found={};
  for(const {origin,value} of sources){
    if(typeof value!=='string')continue;
    for(const [kind,[pattern,pick]] of Object.entries(patterns)){
      const match=value.trim().match(pattern);
      if(match)(found[kind]||=[]).push({...pick(match),url:value.trim(),origin});
    }
  }
  const identity={},conflicts=[];
  for(const [kind,list] of Object.entries(found)){
    const ids=[...new Set(list.map(refId))];
    if(ids.length>1)conflicts.push({kind,ids});else identity[kind]=list[0];
  }
  return {identity,conflicts,notes};
}

// works.json carries its own links too: an identifier that several works claim
// (two seasons on the series page) identifies none of them. A work that names
// two ids of one kind still claims both.
export function identityOwners(works,{links={},claims=linkClaims(works),patterns=IDENTITY_PATTERNS}={}){
  const owners=new Map();
  for(const work of works){
    const {identity,conflicts}=exactIdentity(work,{links,claims,patterns});
    const ids=[...Object.entries(identity).map(([kind,ref])=>kind+':'+refId(ref)),
      ...conflicts.flatMap(({kind,ids})=>ids.map(id=>kind+':'+id))];
    for(const id of ids){
      if(!owners.has(id))owners.set(id,new Set());
      owners.get(id).add(work.id);
    }
  }
  return owners;
}
export function workIdentity(work,{links={},claims=linkClaims([work]),owners=new Map(),patterns=IDENTITY_PATTERNS}={}){
  const {identity,conflicts,notes}=exactIdentity(work,{links,claims,patterns});
  for(const [kind,ref] of Object.entries(identity)){
    const others=[...(owners.get(kind+':'+refId(ref))||[])].filter(id=>id!==work.id);
    if(!others.length)continue;
    delete identity[kind];
    notes.push(`${kind} ${refId(ref)} also claimed by ${others.join(', ')}, ignored`);
  }
  return {identity,conflicts,notes};
}

// One operation at a time per host, starts at least intervalMs apart; hosts
// run in parallel. Queue time stays outside each operation's own timeout.
export function hostPacer({intervalMs=1200,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const tails=new Map(),last=new Map();
  return (url,task)=>{
    const key=host(url)||url;
    const run=(tails.get(key)||Promise.resolve()).then(async()=>{
      const wait=(last.get(key)??-Infinity)+intervalMs-now();
      if(wait>0)await sleep(wait);
      last.set(key,now());
      return task();
    });
    tails.set(key,run.then(()=>{},()=>{}));
    return run;
  };
}

async function readText(res,maxBytes){
  const reader=res.body?.getReader();if(!reader)return '';
  const chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;if(size>maxBytes)throw Error('page larger than '+maxBytes+' bytes');
      chunks.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{})}
  return Buffer.concat(chunks).toString('utf8');
}

// One plain request. A bot challenge is reported, never retried or bypassed.
export function fetchDocument(url,ctx,options={}){
  return ctx.pace(url,()=>fetchDocumentNow(url,ctx,options));
}
async function fetchDocumentNow(url,ctx,{accept='text/html,application/xhtml+xml',headers={},maxBytes=6*1024*1024,timeoutMs=15000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await ctx.fetch(url,{redirect:'follow',signal:controller.signal,
      headers:{'User-Agent':ctx.userAgent||USER_AGENT,'Accept':accept,'Accept-Language':'fr-FR,fr;q=0.9,en;q=0.5',...headers}});
    const waf=res.headers.get('x-amzn-waf-action')||res.headers.get('cf-mitigated');
    if(waf||res.status===202){await res.body?.cancel();return {ok:false,status:res.status,challenge:true,why:'bot challenge ('+(waf||'HTTP 202')+'), not bypassed'};}
    if(!res.ok){await res.body?.cancel();return {ok:false,status:res.status,why:'HTTP '+res.status};}
    return {ok:true,status:res.status,final:res.url||url,text:await readText(res,maxBytes)};
  }catch(error){return {ok:false,why:error.name==='AbortError'?'timeout':error.message}}
  finally{clearTimeout(timer)}
}
export async function fetchJson(url,ctx,options={}){
  const page=await fetchDocument(url,ctx,{accept:'application/json',...options});
  if(!page.ok)return page;
  try{return {...page,json:JSON.parse(page.text)}}catch{return {ok:false,status:page.status,why:'invalid JSON'}}
}

export function metaContent(html,property){
  for(const [tag] of String(html).matchAll(/<meta\b[^>]*>/gi)){
    const name=(tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)||[])[1];
    if(name?.toLowerCase()!==property)continue;
    const content=(tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)||[])[1];
    if(content)return decodeHtmlEntities(content).trim();
  }
  return null;
}
export function jsonLd(html){
  const items=[];
  for(const [,body] of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const value=JSON.parse(body);items.push(...(Array.isArray(value)?value:value['@graph']?array(value['@graph']):[value]))}catch{}
  }
  return items;
}
const imageOf=value=>typeof value==='string'?value:Array.isArray(value)?imageOf(value[0]):value?.url||value?.contentUrl||null;
const uniqueCandidates=list=>list.filter((c,i)=>c.url&&list.findIndex(x=>x.url===c.url)===i);

// Rung 1. The JSON-LD image is the poster; og:image is a landscape still.
async function senscritique(ref,ctx){
  const page=await fetchDocument(ref.url,ctx);
  if(!page.ok)return page;
  const exact=new RegExp('/'+ref.id+'/?$');
  if(!exact.test(new URL(page.final).pathname))return {why:'redirected away from the exact page: '+page.final};
  const item=jsonLd(page.text).find(x=>exact.test(String(x.url||'')));
  const year=Number(String(item?.datePublished||'').slice(0,4)),expected=Number(ctx.work.year)||0;
  if(ref.kind==='film'&&year&&expected&&Math.abs(year-expected)>2)
    return {why:`year mismatch: SensCritique ${year}, catalogue ${expected}`};
  const candidates=[],poster=imageOf(item?.image);
  if(/^https:\/\/media\.senscritique\.com\/media\//.test(poster||'')){
    candidates.push({url:poster.replace(/(\/media\/\d+\/)\d+(?:x\d+)?\//,'$1600/'),image_type:'poster'},{url:poster,image_type:'poster'});
  }
  const still=metaContent(page.text,'og:image');
  if(/^https:\/\/media\.senscritique\.com\/media\//.test(still||''))candidates.push({url:still,image_type:'still'});
  if(!candidates.length)return {why:item?'no SensCritique image':'exact SensCritique JSON-LD missing'};
  return {source_url:ref.url,candidates:uniqueCandidates(candidates)};
}

// Rung 2. IMDb usually answers scripts with an AWS WAF challenge: reported only.
async function imdb(ref,ctx){
  const url=`https://www.imdb.com/title/${ref.id}/`;
  const page=await fetchDocument(url,ctx);
  if(!page.ok)return page;
  const canonical=metaContent(page.text,'og:url')||page.final;
  if(!canonical.includes('/title/'+ref.id))return {why:'IMDb page is not '+ref.id+': '+canonical};
  const poster=metaContent(page.text,'og:image');
  if(!/^https:\/\/m\.media-amazon\.com\/images\/M\//.test(poster||''))return {why:'no IMDb poster in og:image'};
  return {source_url:url,candidates:uniqueCandidates([
    {url:poster.replace(/\._V1_[^/]*?\.(jpe?g|png)$/i,'._V1_UX600_.$1'),image_type:'poster'},{url:poster,image_type:'poster'}])};
}

// Rung 3. TMDb API, French poster first. The key never enters the report.
async function tmdb(identity,ctx){
  const call=(route,params)=>{
    const url=new URL('https://api.themoviedb.org/3'+route),headers={};
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    if(/^eyJ/.test(ctx.tmdbKey))headers.Authorization='Bearer '+ctx.tmdbKey;else url.searchParams.set('api_key',ctx.tmdbKey);
    return fetchJson(url.href,ctx,{headers});
  };
  let ref=identity.tmdb;
  if(!ref){
    const found=await call(`/find/${identity.imdb.id}`,{external_source:'imdb_id'});
    if(!found.ok)return {why:'TMDb find: '+found.why,status:found.status};
    const hits=[...array(found.json.movie_results).map(x=>({kind:'movie',id:String(x.id)})),
      ...array(found.json.tv_results).map(x=>({kind:'tv',id:String(x.id)}))];
    if(hits.length!==1)return {why:hits.length?'TMDb maps this IMDb id to several works':'IMDb id unknown to TMDb'};
    ref=hits[0];
  }
  const images=await call(`/${ref.kind}/${ref.id}/images`,{include_image_language:'fr,null,en'});
  if(!images.ok)return {why:'TMDb images: '+images.why,status:images.status};
  const rank=poster=>({fr:0,null:1,en:2})[String(poster.iso_639_1)]??3;
  const posters=array(images.json.posters).filter(p=>/^\/[\w.-]+$/.test(p.file_path||''))
    .sort((a,b)=>rank(a)-rank(b)||(b.vote_average||0)-(a.vote_average||0)||(b.vote_count||0)-(a.vote_count||0));
  if(!posters.length)return {why:'TMDb has no poster'};
  return {source_url:`https://www.themoviedb.org/${ref.kind}/${ref.id}`,
    candidates:posters.slice(0,2).map(p=>({url:'https://image.tmdb.org/t/p/w500'+p.file_path,image_type:'poster',language:p.iso_639_1??null}))};
}

// Rung 4: official programme images from the sources the collector reads.
async function arte(ref,ctx){
  const config=await fetchJson(`https://api-cdn.arte.tv/api/player/v2/config/fr/${ref.id}`,ctx);
  if(!config.ok)return config;
  const metadata=config.json?.data?.attributes?.metadata;
  if(metadata?.providerId!==ref.id)return {why:'ARTE config does not describe '+ref.id};
  const urls=array(metadata.images).map(image=>image?.url).filter(url=>/^https:\/\/api-cdn\.arte\.tv\/img\//.test(url||''));
  if(!urls.length)return {why:'ARTE config has no image'};
  return {source_url:/\/videos\//.test(ref.url)?ref.url:`https://www.arte.tv/fr/videos/${ref.id}/`,
    candidates:[{url:urls[0],image_type:'official-program-art'}]};
}
async function francetvpro(ref,ctx){
  const page=await fetchDocument(ref.url,ctx);
  if(!page.ok)return page;
  const canonical=metaContent(page.text,'og:url')||page.final;
  if(!canonical.includes('/contenu-de-presse/'+ref.id))return {why:'FranceTVPro page is not '+ref.id};
  const image=metaContent(page.text,'og:image');
  if(!/^https:\/\/www\.francetvpro\.fr\/sites\/default\/files\/(?:styles\/[^/]+\/public\/)?telechargements\//.test(image||''))
    return {why:'no FranceTVPro press image'};
  // og:image is a LinkedIn crop; the press download itself is larger.
  const original=image.replace(/\/styles\/[^/]+\/public\//,'/').replace(/\?itok=[^&]*$/,'').replace(/(\.(?:jpe?g|png))\.webp$/i,'$1');
  return {source_url:ref.url,candidates:uniqueCandidates([{url:original,image_type:'official-program-art'},{url:image,image_type:'official-program-art'}])};
}
async function tv5monde(ref,ctx){
  const grid=await fetchJson(ref.grid,ctx);
  if(!grid.ok)return grid;
  const program=array(grid.json?.data?.programs).find(item=>String(item.id)===ref.id);
  if(!program)return {why:'programme '+ref.id+' absent from the official TV5MONDE grid'};
  if(String(program.channelId??'')!==new URL(ref.grid).searchParams.get('channel'))return {why:'programme '+ref.id+' belongs to another TV5MONDE channel'};
  if(!/^https:\/\/psi\.tv5monde\.com\//.test(program.image||''))return {why:'no TV5MONDE programme image'};
  return {source_url:ref.url,candidates:[{url:program.image,image_type:'official-program-art'}]};
}

const RUNGS={senscritique:(id,ctx)=>senscritique(id.senscritique,ctx),imdb:(id,ctx)=>imdb(id.imdb,ctx),tmdb,
  arte:(id,ctx)=>arte(id.arte,ctx),francetvpro:(id,ctx)=>francetvpro(id.francetvpro,ctx),tv5monde:(id,ctx)=>tv5monde(id.tv5monde,ctx)};
function unusable(rung,identity,ctx){
  if(rung==='tmdb'){
    if(!identity.tmdb&&!identity.imdb)return 'no TMDb or IMDb identity';
    return ctx.tmdbKey?null:'TMDB_API_KEY not set';
  }
  return identity[rung]?null:'no exact '+rung+' link';
}

// Walk the ladder; keep the first working candidate of each rung, one per host.
async function climb(identity,ctx,{want,avoidHosts,avoidUrls}){
  const found=[],attempts=[];
  for(const rung of LADDER){
    if(found.length>=want)break;
    const skip=unusable(rung,identity,ctx);
    if(skip){attempts.push({rung,skipped:skip});continue;}
    let answer;
    try{answer=await RUNGS[rung](identity,ctx)}catch(error){answer={why:error.message}}
    if(!answer.candidates){attempts.push({rung,ok:false,status:answer.status??null,why:answer.why});continue;}
    for(const candidate of answer.candidates){
      const where=host(candidate.url);
      if(avoidUrls.has(candidate.url)||avoidHosts.has(where)||found.some(item=>host(item.url)===where)){
        attempts.push({rung,url:candidate.url,ok:false,why:'host or URL already used by this work'});continue;
      }
      const probe=await ctx.probe(candidate.url);
      attempts.push({rung,url:candidate.url,ok:probe.ok,status:probe.status??null,why:probe.why});
      if(probe.ok){found.push({rung,...candidate,source_url:answer.source_url,content_type:probe.type||null});break;}
    }
  }
  return {found,attempts};
}

// complete: give missing images and missing fallbacks a source.
// repair: probe current images and replace a primary that fails without Referer.
export async function resolveWork(work,{identity,conflicts=[],notes=[]},ctx,{complete=true,repair=false}={}){
  const result={work_id:work.id,title:work.title,status:'unchanged',conflicts,notes:[...notes],attempts:[]};
  const fallbacks=array(work.image_fallbacks).filter(Boolean);
  const okByUrl=new Map();
  if(repair&&work.image){
    for(const url of [...new Set([work.image,...fallbacks])]){
      const probe=await ctx.probeAny(url);
      okByUrl.set(url,probe.ok);
      (result.current||=[]).push({url,ok:probe.ok,status:probe.status??null,why:probe.why});
    }
  }
  const needPrimary=!work.image||okByUrl.get(work.image)===false;
  const needFallbacks=!needPrimary&&complete&&!fallbacks.length;
  if(!needPrimary&&!needFallbacks)return result;
  const settle=why=>{
    result.why=why;
    if(needPrimary)result.status=!work.image&&work.image_exception_reason?'exception_kept':'unresolved';
    if(needPrimary&&work.image&&fallbacks.some(url=>okByUrl.get(url)))result.notes.push('current primary fails but an existing fallback still works');
    return result;
  };
  if(!Object.keys(identity).length)return settle('no exact identity link (SensCritique, IMDb, TMDb or official programme page)');
  const keptHost=needPrimary?null:host(work.image);
  const climbed=await climb(identity,{...ctx,work},{want:needPrimary?3:2,
    avoidHosts:new Set(keptHost?[keptHost]:[]),avoidUrls:new Set(work.image?[work.image]:[])});
  result.attempts=climbed.attempts;
  if(!climbed.found.length)return settle(needPrimary?'no ladder source produced a working image':'no second source produced a working image');
  if(!needPrimary){
    result.status='fallbacks_added';
    result.fallbacks=climbed.found.slice(0,2);
    result.update={image_fallbacks:result.fallbacks.map(item=>item.url)};
    return result;
  }
  const [primary,...others]=climbed.found;
  // Previous fallbacks stay after the new ones unless a probe just failed them.
  const retained=fallbacks.filter(url=>!repair||okByUrl.get(url));
  const nextFallbacks=[...new Set([...others.slice(0,2).map(item=>item.url),...retained])].filter(url=>url!==primary.url);
  result.status=work.image?'repaired':'resolved';
  if(work.image)result.replaced={url:work.image,...result.current?.find(item=>item.url===work.image)};
  result.chosen=primary;result.fallbacks=others.slice(0,2);
  result.update={image:primary.url,image_type:primary.image_type,image_source_url:primary.source_url,
    image_checked:ctx.today,image_strategy:'resolver:'+primary.rung};
  if(nextFallbacks.length)result.update.image_fallbacks=nextFallbacks;else if(work.image_fallbacks)result.remove=['image_fallbacks'];
  return result;
}

function localProbe(url,root){
  const file=path.join(root,url.replace(/^\.\//,''));
  const ok=fs.existsSync(file)&&hasImageSignature(fs.readFileSync(file));
  return {ok,url,why:ok?'local image':'missing/non-image local file'};
}

export async function resolvePosters({works,links={},targets,complete=true,repair=false,fetcher=fetch,tmdbKey=null,
  today=new Date().toISOString().slice(0,10),intervalMs=1200,concurrency=4,sleep,now,probeDelay,root=process.cwd()}){
  assert(Array.isArray(works)&&Array.isArray(targets),'works and targets required');
  assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
  const pace=hostPacer({intervalMs,...(sleep?{sleep}:{}),...(now?{now}:{})});
  const probe=url=>pace(url,()=>probeRemoteImage(url,{fetcher,...(probeDelay?{delay:probeDelay}:{})}));
  const ctx={fetch:fetcher,pace,tmdbKey,today,probe,probeAny:url=>/^https?:\/\//i.test(url)?probe(url):localProbe(url,root)};
  const claims=linkClaims(works),owners=identityOwners(works,{links,claims}),results=new Array(targets.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},async()=>{
    while(next<targets.length){
      const index=next++,work=targets[index];
      results[index]=await resolveWork(work,workIdentity(work,{links,claims,owners}),ctx,{complete,repair});
    }
  }));
  return results;
}

export function applyResolutions(doc,results,{today}={}){
  const next=structuredClone(doc),byId=new Map(array(next.works).map(work=>[work.id,work]));let changed=0;
  for(const result of results){
    const work=result.update&&byId.get(result.work_id);if(!work)continue;
    Object.assign(work,result.update);
    for(const key of result.remove||[])delete work[key];
    changed++;
  }
  if(changed&&today)next.updated=today;
  return {doc:next,changed};
}

export function summarize(results){
  const counts={};for(const result of results)counts[result.status]=(counts[result.status]||0)+1;
  return {works:results.length,...counts};
}

// Same visual set as validate-image-sources.mjs for this issue.
export function weekTargets({week,issue,works,config,radar}){
  const from=config?.quality_gates?.remote_image_health_from_week||'9999-S99';
  const titles=visualWorkTitles(issue,{legacyGridOnly:week<from,radar});
  const byTitle=new Map(works.map(work=>[normTitle(work.title),work]));
  const targets=[],missing=[],seen=new Set();
  for(const title of titles){
    const work=byTitle.get(normTitle(title));
    if(!work){missing.push(title);continue;}
    if(!seen.has(work.id)){seen.add(work.id);targets.push(work);}
  }
  return {targets,missing};
}

// works.json change for the production flow: a reviewed handoff, never a write.
export function buildPosterHandoff(context,results,{today}={}){
  assert.match(context.sha||'',/^[a-f0-9]{40}$/,'immutable source SHA required');
  assert(typeof context.works_source_content==='string','exact original works.json bytes required');
  assert.deepEqual(JSON.parse(context.works_source_content),context.works,'works.json does not match the exact base content');
  const {doc,changed}=applyResolutions(context.works,results,{today});
  if(!changed)return {bundle:null,changed};
  const research=context.research;
  if(research?.stage==='ready'||research?.editorial_review_completed===true)
    return {bundle:null,changed,refused:'ready or sealed checkpoint: reopen it before changing works.json'};
  const content=JSON.stringify(doc,null,2)+'\n';
  const bundle={schema_version:1,week:context.week,base_sha:context.sha,stage:research?.stage||'inventory',remaining:[...array(research?.remaining)],
    files:[{path:'data/works.json',base_sha256:digest(context.works_source_content),content,
      content_sha256:digest(content),content_bytes:Buffer.byteLength(content,'utf8')}]};
  validateBundle(bundle);
  return {bundle,changed};
}

export function parseCli(args){
  const options={works:[],repair:false,dryRun:false,all:false,intervalMs:1200};
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(flag==='--repair'){options.repair=true;continue;}
    if(flag==='--dry-run'){options.dryRun=true;continue;}
    if(flag==='--all'){options.all=true;continue;}
    assert(['--week','--work','--report','--pace-ms'].includes(flag),'unknown flag '+flag);
    const value=args[++index];assert(value&&!value.startsWith('--'),'missing value '+flag);
    if(flag==='--week'){assert.match(value,/^\d{4}-S\d{2}$/,'--week YYYY-Sxx');options.week=value;}
    else if(flag==='--work')options.works.push(value);
    else if(flag==='--report')options.report=value;
    else{options.intervalMs=Number(value);assert(Number.isInteger(options.intervalMs)&&options.intervalMs>=0,'--pace-ms must be a nonnegative integer');}
  }
  assert([options.week,options.works.length||null,options.all||null].filter(Boolean).length===1,
    'Usage: poster-resolver.mjs (--week YYYY-Sxx | --work ID... | --all) [--repair] [--dry-run] [--report FILE] [--pace-ms N]');
  return options;
}

async function main(){
  const options=parseCli(process.argv.slice(2));
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const catalogue=read('data/works.json'),works=array(catalogue.works),links=read('data/links.json').links||{};
  let targets,missing=[];
  if(options.week){
    const radarPath=`data/radar-reserves/${options.week}.json`;
    ({targets,missing}=weekTargets({week:options.week,issue:read(`data/weeks/${options.week}.json`),works,
      config:read('data/editorial-config.json'),radar:()=>fs.existsSync(radarPath)?read(radarPath):null}));
  }else if(options.works.length){
    const byId=new Map(works.map(work=>[work.id,work]));
    targets=options.works.map(id=>{assert(byId.has(id),'unknown work id '+id);return byId.get(id);});
  }else targets=works.filter(work=>options.repair?work.image:true);
  const today=process.env.SELECTION_TV_TODAY||new Date().toISOString().slice(0,10);
  const results=await resolvePosters({works,links,targets,complete:!options.repair,repair:options.repair,
    tmdbKey:process.env.TMDB_API_KEY||null,today,intervalMs:options.intervalMs});
  for(const title of missing)console.error('✗ '+title+': missing works.json record');
  for(const result of results){
    if(result.status==='unchanged'&&!result.why)continue;
    const mark={resolved:'+',repaired:'↺',fallbacks_added:'+',unresolved:'✗',exception_kept:'·',unchanged:'·'}[result.status];
    console.log(`${mark} ${result.work_id}: ${result.status}${result.update?.image?' → '+result.update.image:''}`+
      `${result.update?.image_fallbacks?' (+'+result.update.image_fallbacks.length+' fallback(s))':''}${result.why?' — '+result.why:''}`);
    for(const attempt of result.status==='unresolved'?result.attempts:[])
      console.log(`    ${attempt.rung}: ${attempt.skipped?'skipped, '+attempt.skipped:(attempt.url?attempt.url+' => ':'')+(attempt.status??'')+' '+(attempt.why||'')}`);
    for(const note of result.status==='unchanged'?[]:result.notes)console.log('    note: '+note);
  }
  const {doc,changed}=applyResolutions(catalogue,results,{today});
  const summary={...summarize(results),missing_records:missing.length,changed,written:!options.dryRun&&changed>0};
  if(options.report)fs.writeFileSync(options.report,JSON.stringify({generated_at:new Date().toISOString(),options:{...options,report:undefined},summary,results},null,2)+'\n');
  if(!options.dryRun&&changed)fs.writeFileSync('data/works.json',JSON.stringify(doc,null,2)+'\n');
  console.log(JSON.stringify(summary));
  if(summary.unresolved||missing.length)process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
