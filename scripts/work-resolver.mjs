// Pre-fill card metadata from exact identity pages only, with the same link
// ladder as poster-resolver.mjs. Every proposal names its source; sources that
// disagree are reported, never settled. Editorial copy and the identity check
// itself stay research work.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {normTitle} from './image-health.mjs';
import {IDENTITY_PATTERNS,exactIdentity,linkClaims,hostPacer,fetchDocument,fetchJson,jsonLd,metaContent,weekTargets} from './poster-resolver.mjs';

const array=value=>Array.isArray(value)?value:value===undefined||value===null?[]:[value];
const unique=list=>[...new Set(list)];
const USER_AGENT='Mozilla/5.0 (compatible; SelectionTV-work-resolver/1.0; +https://github.com/kingrabbit89/selection-tv)';

// Fixed order: the first source that answers gives the spelling of a proposal.
export const LADDER=['senscritique','imdb','tmdb','wikidata','arte'];
export const FIELDS=['year','director','creator','country','duration','genre','original_title'];
export const RATINGS=['senscritique','imdb'];

// Wikidata items and Wikipedia articles are exact identities too; Wikidata is
// also reached from the exact IMDb, SensCritique or TMDb identifier.
export const PATTERNS={...IDENTITY_PATTERNS,
  wikidata:[/^https:\/\/www\.wikidata\.org\/wiki\/(Q\d+)\/?$/,m=>({id:m[1]})],
  wikipedia:[/^https:\/\/(fr|en)\.wikipedia\.org\/wiki\/([^/?#]+)$/,m=>({id:m[1]+':'+m[2],lang:m[1],page:m[2]})]};
const refId=ref=>ref.grid?ref.grid+'#'+ref.id:ref.id;

// Comparison key that keeps every script (normTitle drops Hangul, kanji…).
const key=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const filled=value=>value!==undefined&&value!==null&&(typeof value==='number'||
  (typeof value==='string'?value.trim()!=='':Array.isArray(value)?value.length>0:typeof value==='object'&&Object.values(value).some(filled)));
const plausibleYear=value=>{const year=Number(value);return Number.isInteger(year)&&year>=1880&&year<=2100?year:null;};
const yearOf=value=>plausibleYear(String(value??'').match(/^\+?(\d{4})-/)?.[1]);
const seasonTitle=title=>/\b(?:saisons?|seasons?)\s*\d|\bS\d{1,2}\b/i.test(String(title||''));
const upperFirst=text=>text.charAt(0).toLocaleUpperCase('fr')+text.slice(1);
const frDecimal=score=>(Math.round(score*10)/10).toFixed(1).replace('.',',');
const frCount=count=>Number(count).toLocaleString('fr-FR').replace(/\s/g,' ');

// The catalogue year, else the year that ends the canonical id.
export function expectedYear(work){
  return plausibleYear(String(work.year??'').match(/^\s*(\d{4})\b/)?.[1])??plausibleYear(String(work.id||'').match(/-(\d{4})$/)?.[1]);
}

export function isoMinutes(value){
  const match=String(value||'').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if(!match||!match.slice(1).some(Boolean))return null;
  const minutes=Number(match[1]||0)*60+Number(match[2]||0)+Math.round(Number(match[3]||0)/60);
  return minutes>0?minutes:null;
}
// First duration written in the catalogue: "1 h 45", "105 min (version ARTE…)".
export function catalogueMinutes(value){
  const match=String(value||'').match(/(\d+)\s*h\s*(\d{1,2})?(?!\d)|(\d+)\s*min/);
  if(!match)return null;
  return match[3]?Number(match[3]):Number(match[1])*60+Number(match[2]||0);
}
const splitNames=value=>String(value||'').split(/\s*[/,;&]\s*|\s+et\s+/).map(item=>item.trim()).filter(Boolean);

const sameSet=(a,b)=>{const x=unique(a.map(key)),y=unique(b.map(key));return x.length===y.length&&x.every(item=>y.includes(item));};
// Genre vocabularies differ between sources: one shared label is agreement.
const SAME={year:(a,b)=>a===b,director:sameSet,creator:sameSet,country:sameSet,duration:(a,b)=>a===b,
  genre:(a,b)=>a.some(item=>b.map(key).includes(key(item))),original_title:(a,b)=>key(a)===key(b)};
const FORMAT={year:String,director:v=>v.join(' / '),creator:v=>v.join(' / '),country:v=>v.join(' / '),duration:v=>v+' min',
  genre:v=>v.slice(0,3).map((item,index)=>{const label=item.toLocaleLowerCase('fr');return index?label:upperFirst(label);}).join(' / '),original_title:v=>v};
function catalogueValue(work,field){
  const raw=work[field];
  if(!filled(raw))return null;
  if(field==='year')return plausibleYear(String(raw).match(/\d{4}/)?.[0]);
  if(field==='duration')return catalogueMinutes(raw);
  if(field==='genre')return String(raw).split(/\s*\/\s*/).filter(Boolean);
  return splitNames(raw);
}

// links.json is keyed by title and works.json carries its own links: an
// identifier that several works claim identifies none of them.
export function identityOwners(works,{links={},claims=linkClaims(works)}={}){
  const owners=new Map();
  for(const work of works){
    for(const [kind,ref] of Object.entries(exactIdentity(work,{links,claims,patterns:PATTERNS}).identity)){
      const id=kind+':'+refId(ref);
      if(!owners.has(id))owners.set(id,new Set());
      owners.get(id).add(work.id);
    }
  }
  return owners;
}
export function workIdentity(work,{links={},claims=linkClaims([work]),owners=new Map()}={}){
  const {identity,conflicts,notes}=exactIdentity(work,{links,claims,patterns:PATTERNS});
  for(const [kind,ref] of Object.entries(identity)){
    const others=[...(owners.get(kind+':'+refId(ref))||[])].filter(id=>id!==work.id);
    if(!others.length)continue;
    delete identity[kind];
    notes.push(`${kind} ${refId(ref)} also identifies ${others.join(', ')}, ignored`);
  }
  return {identity,conflicts,notes};
}

// SensCritique appends an alias in parentheses: "Kane Parsons (Kane Pixels)".
const persons=value=>unique(array(value).filter(item=>item&&typeof item==='object'&&(!item['@type']||item['@type']==='Person'))
  .map(item=>String(item.name||'').replace(/\s*\([^)]*\)\s*$/,'').trim()).filter(Boolean));
const strings=value=>unique(array(value).filter(item=>typeof item==='string').map(item=>item.trim()).filter(Boolean));
function aggregate(value){
  const score=Number(value?.ratingValue),votes=Number(value?.ratingCount),scale=Number(value?.bestRating??10);
  return score>0&&Number.isInteger(votes)&&votes>0&&scale===10?{score,votes,scale}:null;
}

// SensCritique: JSON-LD of the exact film or series page.
async function senscritique(identity,ctx){
  const ref=identity.senscritique,page=await fetchDocument(ref.url,ctx);
  if(!page.ok)return page;
  const exact=new RegExp('/'+ref.id+'/?$');
  if(!exact.test(new URL(page.final).pathname))return {why:'redirected away from the exact page: '+page.final};
  const item=jsonLd(page.text).find(x=>exact.test(String(x.url||'')));
  if(!item)return {why:'exact SensCritique JSON-LD missing'};
  const series=ref.kind==='serie',alternate=strings(item.alternateName);
  return {source_url:ref.url,series,facts:{year:yearOf(item.datePublished),
    director:series?null:persons(item.director),creator:series?persons(item.creator):null,
    duration:series?null:isoMinutes(item.duration),genre:strings(item.genre),
    original_title:alternate.length===1?alternate[0]:null},
    rating:aggregate(item.aggregateRating)};
}

// IMDb usually answers scripts with an AWS WAF challenge: reported only.
// Genres are English and the name is localised, so neither is read.
async function imdb(identity,ctx){
  const ref=identity.imdb,url=`https://www.imdb.com/title/${ref.id}/`;
  const page=await fetchDocument(url,ctx);
  if(!page.ok)return page;
  const exact=new RegExp('/title/'+ref.id+'/?$');
  if(!exact.test(new URL(metaContent(page.text,'og:url')||page.final).pathname))return {why:'IMDb page is not '+ref.id};
  const item=jsonLd(page.text).find(x=>exact.test(String(x.url||'').replace(/^https:\/\/www\.imdb\.com/,'')));
  if(!item)return {why:'exact IMDb JSON-LD missing'};
  const series=/^TV(?:Mini)?Series$/.test(String(item['@type']));
  return {source_url:url,series,facts:{year:yearOf(item.datePublished),
    director:series?null:persons(item.director),creator:series?persons(item.creator):null,
    duration:series?null:isoMinutes(item.duration)},rating:aggregate(item.aggregateRating)};
}

// Country names in French; codes Intl misreads or dresses up are pinned.
const COUNTRY_NAMES={HK:'Hong Kong',SU:'URSS',XG:'RDA',DD:'RDA',CS:'Tchécoslovaquie',YU:'Yougoslavie',XC:'Tchécoslovaquie'};
const regions=new Intl.DisplayNames(['fr'],{type:'region'});
function frenchCountry({iso_3166_1:code,name}){
  if(COUNTRY_NAMES[code])return COUNTRY_NAMES[code];
  try{const label=regions.of(code);if(label&&label!==code)return label;}catch{}
  return name||code;
}

// TMDb API, French labels. The key never enters the report.
async function tmdb(identity,ctx){
  const call=(route,params)=>{
    const url=new URL('https://api.themoviedb.org/3'+route),headers={};
    for(const [name,value] of Object.entries(params))url.searchParams.set(name,value);
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
  const detail=await call(`/${ref.kind}/${ref.id}`,{language:'fr-FR',append_to_response:'credits,external_ids'});
  if(!detail.ok)return {why:'TMDb details: '+detail.why,status:detail.status};
  const item=detail.json,series=ref.kind==='tv';
  const imdbId=item.imdb_id||item.external_ids?.imdb_id||null;
  if(identity.imdb&&imdbId&&imdbId!==identity.imdb.id)return {why:`TMDb ${ref.kind}/${ref.id} points to ${imdbId}, not ${identity.imdb.id}`};
  const names=list=>unique(array(list).map(x=>String(x?.name||'').trim()).filter(Boolean));
  const countries=array(item.production_countries).length?array(item.production_countries):array(item.origin_country).map(code=>({iso_3166_1:code}));
  return {source_url:`https://www.themoviedb.org/${ref.kind}/${ref.id}`,series,facts:{
    year:yearOf(series?item.first_air_date:item.release_date),
    director:series?null:names(array(item.credits?.crew).filter(x=>x?.job==='Director')),
    creator:series?names(item.created_by):null,
    country:unique(countries.filter(x=>/^[A-Z]{2}$/.test(x?.iso_3166_1||'')).map(frenchCountry)),
    duration:!series&&Number(item.runtime)>0?Number(item.runtime):null,
    genre:names(item.genres),
    original_title:String((series?item.original_name:item.original_title)||'').trim()||null}};
}

// Wikidata, the structured data behind Wikipedia infoboxes. The item is
// reached only through exact identifiers, and they must all agree on it.
async function wikidataLabels(ids,ctx){
  const missing=unique(ids).filter(id=>!ctx.labels.has(id));
  for(let index=0;index<missing.length;index+=50){
    const chunk=missing.slice(index,index+50);
    const answer=await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(chunk.join('|'))}&props=labels&languages=${encodeURIComponent('fr|mul|en')}&format=json`,ctx);
    if(!answer.ok)throw Error('Wikidata labels: '+answer.why);
    for(const id of chunk){const labels=answer.json?.entities?.[id]?.labels||{};ctx.labels.set(id,labels.fr?.value??labels.mul?.value??labels.en?.value??null);}
  }
  return id=>ctx.labels.get(id)??null;
}
async function wikidata(identity,ctx){
  const items=new Set();
  if(identity.wikidata)items.add(identity.wikidata.id);
  if(identity.wikipedia){
    const {lang,page}=identity.wikipedia;let title;
    try{title=decodeURIComponent(page)}catch{return {why:'malformed Wikipedia link'}}
    const answer=await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=${encodeURIComponent('wikibase_item|disambiguation')}&titles=${encodeURIComponent(title)}&format=json&formatversion=2`,ctx);
    if(!answer.ok)return {why:'Wikipedia: '+answer.why,status:answer.status};
    const props=array(answer.json?.query?.pages)[0]?.pageprops;
    if(props&&'disambiguation' in props)return {why:'the Wikipedia link is a disambiguation page'};
    if(!props?.wikibase_item)return {why:'the Wikipedia page has no Wikidata item (redirect or missing page)'};
    items.add(props.wikibase_item);
  }
  const lookups=[identity.imdb&&['P345',identity.imdb.id],identity.senscritique&&['P10100',identity.senscritique.id],
    identity.tmdb&&[identity.tmdb.kind==='tv'?'P4983':'P4947',identity.tmdb.id]].filter(Boolean);
  if(lookups.length){
    const query='SELECT DISTINCT ?item WHERE { '+lookups.map(([property,value])=>`{ ?item wdt:${property} "${value}" }`).join(' UNION ')+' }';
    // The query service is slow under load; a 429 or a timeout is reported, not retried.
    const answer=await fetchJson('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(query),ctx,{accept:'application/sparql-results+json',timeoutMs:30000});
    if(!answer.ok)return {why:'Wikidata query: '+answer.why,status:answer.status};
    for(const row of array(answer.json?.results?.bindings))items.add(String(row.item?.value||'').replace(/^https?:\/\/www\.wikidata\.org\/entity\//,''));
  }
  if(!items.size)return {why:'no Wikidata item carries these exact identifiers'};
  if(items.size>1)return {why:'the exact identifiers lead to several Wikidata items: '+[...items].join(', ')};
  const id=[...items][0];
  const answer=await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`,ctx);
  if(!answer.ok)return {why:'Wikidata entity: '+answer.why,status:answer.status};
  const item=answer.json?.entities?.[id];
  if(!item)return {why:'Wikidata answered for another item than '+id};
  const values=(property,{all=false}={})=>{
    const claims=array(item.claims?.[property]).filter(c=>c?.rank!=='deprecated'&&c.mainsnak?.snaktype==='value');
    const preferred=claims.filter(c=>c.rank==='preferred');
    return (all||!preferred.length?claims:preferred).map(c=>c.mainsnak.datavalue?.value).filter(v=>v!==undefined);
  };
  for(const [property,ref] of [['P345',identity.imdb],['P10100',identity.senscritique]])
    if(ref&&values(property,{all:true}).length&&!values(property,{all:true}).includes(ref.id))
      return {why:`Wikidata ${id} carries another ${property==='P345'?'IMDb':'SensCritique'} identifier than ${ref.id}`};
  const entities=property=>values(property).map(v=>v?.id).filter(Boolean);
  const label=await wikidataLabels([...entities('P31'),...entities('P57'),...entities('P170'),...entities('P495')],ctx);
  const labels=property=>unique(entities(property).map(label).filter(Boolean));
  const series=labels('P31').some(name=>/s[ée]rie|feuilleton|[ée]mission|saison/i.test(name));
  const years=values('P577',{all:true}).filter(v=>Number(v?.precision)>=9).map(v=>yearOf(v.time)).filter(Boolean);
  const unit={Q7727:1,Q11574:1/60,Q25235:60};
  const durations=unique(values('P2047').map(v=>Math.round(Number(v?.amount)*(unit[String(v?.unit).split('/').pop()]??NaN))).filter(n=>n>0));
  const title=values('P1476').find(v=>typeof v?.text==='string');
  const notes=durations.length>1?['Wikidata lists several durations: '+durations.join(', ')+' min']:[];
  const wiki=item.sitelinks?.frwiki?.title;
  return {source_url:'https://www.wikidata.org/wiki/'+id,series,notes,facts:{
    year:years.length?Math.min(...years):null,director:series?null:labels('P57'),creator:series?labels('P170'):null,
    country:labels('P495'),duration:!series&&durations.length===1?durations[0]:null,original_title:title?.text.trim()||null},
    hints:{wikipedia:wiki?'https://fr.wikipedia.org/wiki/'+encodeURIComponent(wiki.replaceAll(' ','_')):null,
      imdb:values('P345').map(v=>`https://www.imdb.com/title/${v}/`)[0]||null,
      senscritique:values('P10100')[0]||null}};
}

// ARTE player API: the official duration of a single programme. An episode
// (-001-, -002-…) times one part, not the work.
async function arte(identity,ctx){
  const ref=identity.arte;
  if(!/-000-[A-Z]$/.test(ref.id))return {why:'ARTE id '+ref.id+' is an episode; its duration does not time the work'};
  const config=await fetchJson(`https://api-cdn.arte.tv/api/player/v2/config/fr/${ref.id}`,ctx);
  if(!config.ok)return config;
  const metadata=config.json?.data?.attributes?.metadata;
  // Off the air, the config describes the trailer (<id>_CLIP) instead.
  if(metadata?.providerId!==ref.id)return {why:'ARTE config describes '+(metadata?.providerId||'nothing')+', not the programme '+ref.id};
  if(metadata.episodic)return {why:'ARTE programme '+ref.id+' is episodic'};
  const seconds=Number(metadata.duration?.seconds);
  if(!(seconds>0))return {why:'ARTE config has no duration'};
  // Minutes rounded up, as arte.tv displays them.
  return {source_url:/\/videos\//.test(ref.url)?ref.url:`https://www.arte.tv/fr/videos/${ref.id}/`,series:false,facts:{duration:Math.ceil(seconds/60)}};
}

const READERS={senscritique,imdb,tmdb,wikidata,arte};
function unusable(source,identity,ctx){
  if(source==='tmdb'){
    if(!identity.tmdb&&!identity.imdb)return 'no TMDb or IMDb identity';
    return ctx.tmdbKey?null:'TMDB_API_KEY not set';
  }
  if(source==='wikidata')return ['wikidata','wikipedia','imdb','senscritique','tmdb'].some(kind=>identity[kind])?null:'no identifier Wikidata can resolve';
  return identity[source]?null:'no exact '+source+' link';
}

async function readSources(identity,ctx,expected){
  const answers=[],attempts=[];
  for(const source of LADDER){
    const skip=unusable(source,identity,ctx)||(ctx.challenged.has(source)?'bot challenge earlier in this run, not retried':null);
    if(skip){attempts.push({source,skipped:skip});continue;}
    let answer;
    try{answer=await READERS[source](identity,ctx)}catch(error){answer={why:error.message}}
    if(answer.challenge)ctx.challenged.add(source);
    if(!answer.facts){attempts.push({source,ok:false,status:answer.status??null,why:answer.why});continue;}
    const year=answer.facts.year;
    if(!answer.series&&year&&expected&&Math.abs(year-expected)>2){
      attempts.push({source,ok:false,why:`year mismatch: ${source} ${year}, catalogue ${expected}`});continue;
    }
    attempts.push({source,ok:true,source_url:answer.source_url,checked_at:ctx.today});
    answers.push({source,...answer});
  }
  return {answers,attempts};
}

function mergeField(field,answers,work,ctx){
  let offers=answers.filter(answer=>filled(answer.facts?.[field])).map(answer=>({source:answer.source,value:answer.facts[field],source_url:answer.source_url,series:answer.series}));
  const notes=[];
  if(field==='year'&&seasonTitle(work.title)&&offers.some(offer=>offer.series)){
    notes.push('series start year ignored: it does not date this season');
    offers=offers.filter(offer=>!offer.series);
  }
  if(!offers.length)return null;
  const [first]=offers,entry={status:null,current:work[field]??null,value:FORMAT[field](first.value),source:first.source,source_url:first.source_url,
    sources:offers.map(offer=>({source:offer.source,value:FORMAT[field](offer.value),source_url:offer.source_url,checked_at:ctx.today}))};
  if(notes.length)entry.notes=notes;
  if(!offers.every(offer=>SAME[field](offer.value,first.value))){
    entry.status='conflict';delete entry.value;delete entry.source;delete entry.source_url;
    return entry;
  }
  if(field==='original_title'){
    delete entry.current;
    const aliases=array(work.aliases).filter(filled);
    const series=String(work.title||'').replace(/\s*[—–:-]\s*(?:saisons?|seasons?)\s*\d.*$/i,'');
    if([work.title,series].some(title=>key(title)===key(first.value))){entry.status='same_as_title';return entry;}
    entry.current_aliases=aliases;
    if(aliases.some(alias=>key(alias)===key(first.value))){entry.status='agrees';return entry;}
    const owners=[...(ctx.claims.get(normTitle(first.value))||[])].filter(id=>id!==work.id);
    if(owners.length){entry.status='blocked';entry.why='title already names '+owners.join(', ');return entry;}
    if(aliases.length){entry.status='blocked';entry.why='aliases already set: add it by hand if it helps matching';return entry;}
    entry.status='proposed';return entry;
  }
  const agreement=catalogueAgreement(field,work,entry.value);
  entry.status=agreement==='empty'?'proposed':agreement;
  return entry;
}

// value is written as the catalogue writes it ("1967", "A / B", "105 min").
export function catalogueAgreement(field,work,value){
  if(!filled(work[field]))return 'empty';
  const current=catalogueValue(work,field),proposed=catalogueValue({[field]:value},field);
  return current!==null&&proposed!==null&&SAME[field](current,proposed)?'agrees':'differs';
}

function mergeRatings(answers,work,ctx){
  const ratings={};
  const present=Object.entries(work.ratings&&typeof work.ratings==='object'?work.ratings:{}).filter(([,value])=>filled(value));
  for(const name of RATINGS){
    const answer=answers.find(item=>item.source===name&&item.rating);
    if(!answer)continue;
    const {score,votes,scale}=answer.rating;
    const entry={value:frDecimal(score),score,votes,scale,source_url:answer.source_url,checked_at:ctx.today};
    const current=present.find(([label])=>label===name||(name==='senscritique'&&label==='sc'));
    if(current){
      entry.current=current[1];
      // Catalogue ratings read "7,6", "7.6" or "7,9/10 (134,8 k)".
      const written=Number(String(current[1]).match(/\d+(?:[.,]\d+)?/)?.[0].replace(',','.'));
      entry.status=written===Math.round(score*10)/10?'agrees':'differs';
    }else if(filled(work.ratings_unavailable_reason)){
      entry.status='blocked';entry.why='ratings_unavailable_reason is recorded';
    }else if(present.length||filled(work.ratings_checked)){
      entry.status='blocked';entry.why='ratings_checked dates the ratings already verified';
    }else entry.status='proposed';
    ratings[name]=entry;
  }
  return ratings;
}

// House wording, as in the existing ratings_note entries.
export function ratingsNote(ratings,today){
  const parts=[['imdb','IMDb','votes'],['senscritique','SensCritique','notes']].filter(([name])=>ratings[name])
    .map(([name,label,unit])=>`${label} ${ratings[name].value}/10 sur ${frCount(ratings[name].votes)} ${unit}`);
  return parts.length>1?`${parts.join(' et ')}, relevés le ${today} sur les fiches liées.`:`${parts[0]}, relevé le ${today} sur la fiche liée.`;
}

function buildUpdate(work,fields,ratings,today){
  const update={},sources={};
  for(const [field,entry] of Object.entries(fields)){
    if(entry.status!=='proposed')continue;
    if(field==='original_title'){update.aliases=[entry.value];sources.aliases=entry.source_url;continue;}
    update[field]=entry.value;sources[field]=entry.source_url;
    if(field==='duration'&&!filled(work.duration_source_url))update.duration_source_url=entry.source_url;
  }
  const proposed=Object.fromEntries(Object.entries(ratings).filter(([,entry])=>entry.status==='proposed'));
  if(Object.keys(proposed).length){
    update.ratings=Object.fromEntries(Object.entries(proposed).map(([name,entry])=>[name,entry.value]));
    update.ratings_checked=today;
    if(!filled(work.ratings_note))update.ratings_note=ratingsNote(proposed,today);
    for(const [name,entry] of Object.entries(proposed))sources['ratings.'+name]=entry.source_url;
  }
  if(!Object.keys(sources).length)return null;
  // Pre-filled, not yet verified: research checks these fields against their source.
  update.metadata_prefill={checked:today,tool:'work-resolver',fields:{...(work.metadata_prefill?.fields||{}),...sources}};
  return update;
}

export async function resolveWork(work,{identity,conflicts=[],notes=[]},ctx){
  const expected=expectedYear(work);
  const result={work_id:work.id,title:work.title,status:'unresolved',expected_year:expected,
    identity:Object.fromEntries(Object.entries(identity).map(([kind,ref])=>[kind,ref.url])),conflicts,notes:[...notes],attempts:[],fields:{},ratings:{}};
  if(!Object.keys(identity).length){result.why='no exact identity link (SensCritique, IMDb, TMDb, Wikidata/Wikipedia or official programme page)';return result;}
  const {answers,attempts}=await readSources(identity,{...ctx,work},expected);
  result.attempts=attempts;
  for(const answer of answers){
    result.notes.push(...array(answer.notes).map(note=>answer.source+': '+note));
    // Identifiers Wikidata knows but the catalogue lacks: to verify, never followed.
    for(const [name,value] of Object.entries(answer.hints||{}))if(value&&!identity[name])(result.links_to_verify||={})[name]=value;
  }
  if(!answers.length){
    result.why=attempts.every(attempt=>attempt.skipped)?'no metadata source reads these identities ('+Object.keys(identity).join(', ')+')':'no exact source answered';
    return result;
  }
  const kinds=unique(answers.map(answer=>answer.series?'series':'film'));
  if(kinds.length>1)result.notes.push('sources disagree on film/series: '+answers.map(answer=>answer.source+'='+(answer.series?'series':'film')).join(', '));
  for(const field of FIELDS){const entry=mergeField(field,answers,work,ctx);if(entry)result.fields[field]=entry;}
  result.ratings=mergeRatings(answers,work,ctx);
  const filmYears=answers.filter(answer=>!answer.series&&answer.facts.year).map(answer=>answer.facts.year);
  if(!expected&&filmYears.length&&Math.max(...filmYears)-Math.min(...filmYears)>2){
    result.status='identity_conflict';
    result.why='sources date the work '+unique(filmYears).join(' / ')+' and the catalogue gives no year: check the identity first';
    return result;
  }
  result.update=buildUpdate(work,result.fields,result.ratings,ctx.today);
  if(!result.update)delete result.update;
  result.status=result.update?'proposals':'complete';
  return result;
}

export async function resolveWorks({works,links={},targets,fetcher=fetch,tmdbKey=null,
  today=new Date().toISOString().slice(0,10),intervalMs=1200,concurrency=4,sleep,now}){
  assert(Array.isArray(works)&&Array.isArray(targets),'works and targets required');
  assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
  const pace=hostPacer({intervalMs,...(sleep?{sleep}:{}),...(now?{now}:{})});
  const claims=linkClaims(works),owners=identityOwners(works,{links,claims});
  const ctx={fetch:fetcher,pace,tmdbKey,today,userAgent:USER_AGENT,labels:new Map(),claims,challenged:new Set()};
  const results=new Array(targets.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},async()=>{
    while(next<targets.length){
      const index=next++,work=targets[index];
      results[index]=await resolveWork(work,workIdentity(work,{links,claims,owners}),ctx);
    }
  }));
  return results;
}

// Writes only fields that are still empty: a verified value is never replaced,
// and a field skipped for that reason keeps its provenance fields out too.
const DEPENDENTS={duration:['duration_source_url'],ratings:['ratings_checked','ratings_note']};
export function applyResolutions(doc,results,{today}={}){
  const next=structuredClone(doc),byId=new Map(array(next.works).map(work=>[work.id,work]));
  let changed=0,fields=0;const skipped=[];
  for(const result of results){
    const work=result.update&&byId.get(result.work_id);if(!work)continue;
    const held=new Set(Object.entries(DEPENDENTS).filter(([field])=>field in result.update&&filled(work[field])).flatMap(([,list])=>list));
    let wrote=0;
    for(const [field,value] of Object.entries(result.update)){
      if(field==='metadata_prefill')continue;
      if(filled(work[field])||held.has(field)){skipped.push(result.work_id+'.'+field);continue;}
      work[field]=value;wrote++;
      if(FIELDS.includes(field)||field==='aliases'||field==='ratings')fields++;
    }
    if(!wrote)continue;
    work.metadata_prefill=result.update.metadata_prefill;
    changed++;
  }
  if(changed&&today)next.updated=today;
  return {doc:next,changed,fields,skipped};
}

export function summarize(results){
  const summary={works:results.length,status:{},fields:{},proposed_by_field:{},ratings:{}};
  for(const result of results){
    summary.status[result.status]=(summary.status[result.status]||0)+1;
    for(const [field,entry] of Object.entries(result.fields)){
      summary.fields[entry.status]=(summary.fields[entry.status]||0)+1;
      if(entry.status==='proposed'&&result.status==='proposals')summary.proposed_by_field[field]=(summary.proposed_by_field[field]||0)+1;
    }
    for(const [name,entry] of Object.entries(result.ratings)){
      summary.ratings[entry.status]=(summary.ratings[entry.status]||0)+1;
      if(entry.status==='proposed'&&result.status==='proposals')summary.proposed_by_field['ratings.'+name]=(summary.proposed_by_field['ratings.'+name]||0)+1;
    }
  }
  return summary;
}

export function parseCli(args){
  const options={works:[],apply:false,intervalMs:1200};
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(flag==='--apply'){options.apply=true;continue;}
    assert(['--week','--work','--report','--pace-ms'].includes(flag),'unknown flag '+flag);
    const value=args[++index];assert(value&&!value.startsWith('--'),'missing value '+flag);
    if(flag==='--week'){assert.match(value,/^\d{4}-S\d{2}$/,'--week YYYY-Sxx');options.week=value;}
    else if(flag==='--work')options.works.push(value);
    else if(flag==='--report')options.report=value;
    else{options.intervalMs=Number(value);assert(Number.isInteger(options.intervalMs)&&options.intervalMs>=0,'--pace-ms must be a nonnegative integer');}
  }
  assert(options.week||options.works.length,'Usage: work-resolver.mjs --week YYYY-Sxx [--work ID...] [--apply] [--report FILE] [--pace-ms N]');
  return options;
}

// Same rule as the poster handoff: a sealed week is reopened before works.json changes.
export function applyRefusal(research){
  return research?.stage==='ready'||research?.editorial_review_completed===true||research?.editorial_review?.completed===true
    ?'ready or sealed checkpoint: reopen it before changing works.json':null;
}

function line(result){
  const fields=Object.entries(result.fields),ratings=Object.entries(result.ratings);
  const proposed=[...fields.filter(([,e])=>e.status==='proposed').map(([f,e])=>`${f}=${e.value} (${e.source})`),
    ...ratings.filter(([,e])=>e.status==='proposed').map(([n,e])=>`ratings.${n}=${e.value} sur ${e.votes}`)];
  const mark={proposals:'+',complete:'·',unresolved:'✗',identity_conflict:'!'}[result.status];
  const out=[`${mark} ${result.work_id}: ${result.status}${proposed.length?' — '+proposed.join(' ; '):''}${result.why?' — '+result.why:''}`];
  for(const [field,entry] of fields)if(['conflict','differs'].includes(entry.status))
    out.push(`    ${entry.status} ${field}: `+(entry.status==='differs'?`catalogue ${JSON.stringify(entry.current)} / `:'')+entry.sources.map(s=>`${s.source} ${s.value}`).join(' / '));
  for(const attempt of result.attempts)if(attempt.ok===false)out.push(`    ${attempt.source}: ${attempt.status?attempt.status+' ':''}${attempt.why}`);
  for(const note of result.notes)out.push('    note: '+note);
  return out.join('\n');
}

async function main(){
  const options=parseCli(process.argv.slice(2));
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const catalogue=read('data/works.json'),works=array(catalogue.works),links=read('data/links.json').links||{};
  const byId=new Map(works.map(work=>[work.id,work]));
  let targets,missing=[];
  if(options.week){
    const radarPath=`data/radar-reserves/${options.week}.json`;
    ({targets,missing}=weekTargets({week:options.week,issue:read(`data/weeks/${options.week}.json`),works,
      config:read('data/editorial-config.json'),radar:()=>fs.existsSync(radarPath)?read(radarPath):null}));
    if(options.works.length){
      const inWeek=new Set(targets.map(work=>work.id));
      for(const id of options.works)assert(inWeek.has(id),id+' is not a visual work of '+options.week);
      targets=targets.filter(work=>options.works.includes(work.id));
    }
    const researchPath=`data/research/${options.week}.json`;
    const refused=options.apply&&fs.existsSync(researchPath)?applyRefusal(read(researchPath)):null;
    assert(!refused,refused);
  }else targets=options.works.map(id=>{assert(byId.has(id),'unknown work id '+id);return byId.get(id);});
  const today=process.env.SELECTION_TV_TODAY||new Date().toISOString().slice(0,10);
  const results=await resolveWorks({works,links,targets,tmdbKey:process.env.TMDB_API_KEY||null,today,intervalMs:options.intervalMs});
  for(const title of missing)console.error('✗ '+title+': missing works.json record');
  for(const result of results)console.log(line(result));
  const {doc,changed,fields,skipped}=applyResolutions(catalogue,results,{today});
  const summary={...summarize(results),missing_records:missing.length,works_to_change:changed,fields_to_fill:fields,written:options.apply&&changed>0};
  if(options.report)fs.writeFileSync(options.report,JSON.stringify({generated_at:new Date().toISOString(),options:{...options,report:undefined},summary,skipped,results},null,2)+'\n');
  if(options.apply&&changed)fs.writeFileSync('data/works.json',JSON.stringify(doc,null,2)+'\n');
  console.log(JSON.stringify(summary));
  if(missing.length)process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
