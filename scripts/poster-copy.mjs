// Copy each work's healthy remote poster into assets/posters/<id>.webp.
// Encoding runs locally only (Pillow, scripts/poster-webp.py); CI runs --check.
// The remote original stays as image_remote and as the first image_fallbacks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {hasImageSignature} from './image-health.mjs';
import {hostPacer,applyResolutions,weekTargets} from './poster-resolver.mjs';

export const POSTER_DIR='assets/posters';
export const MAX_POSTER_BYTES=120*1024;
export const MAX_POSTER_SIZE={width:360,height:540};
const SAFE_ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const array=value=>Array.isArray(value)?value:[];
const remote=url=>/^https?:\/\//i.test(url||'');
export const isPosterPath=value=>/^assets\/posters\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(value||'');
export function posterPath(id){assert.match(id||'',SAFE_ID,'unsafe work id for a poster file: '+id);return `${POSTER_DIR}/${id}.webp`;}

// Dimensions from the RIFF/WEBP header; null when the bytes are not a WebP.
export function webpInfo(bytes){
  const b=Buffer.from(bytes);
  if(b.length<30||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP')return null;
  const chunk=b.toString('ascii',12,16);
  if(chunk==='VP8X')return {width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
  if(chunk==='VP8 '&&b[23]===0x9d&&b[24]===0x01&&b[25]===0x2a)return {width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
  if(chunk==='VP8L'&&b[20]===0x2f){const bits=b.readUInt32LE(21);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
  return null;
}

async function download(url,{fetcher,maxBytes=20*1024*1024,timeoutMs=20000,attempts=2}){
  let last;
  for(let attempt=0;attempt<attempts;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      // Same client as validate-image-sources: no Referer.
      const res=await fetcher(url,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0','Accept':'image/*'}});
      if(!res.ok){await res.body?.cancel();last={ok:false,status:res.status,why:'HTTP '+res.status};if(res.status<500&&res.status!==429)return last;continue;}
      const reader=res.body?.getReader(),chunks=[];let size=0;
      try{
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
          if(size>maxBytes)return {ok:false,status:res.status,why:'image larger than '+maxBytes+' bytes'};chunks.push(Buffer.from(value));}
      }finally{await reader.cancel().catch(()=>{})}
      const bytes=Buffer.concat(chunks);
      if(!hasImageSignature(bytes))return {ok:false,status:res.status,why:'non-image response bytes'};
      if(/^\s*(?:<\?xml|<svg)/i.test(bytes.toString('utf8',0,64)))return {ok:false,status:res.status,why:'SVG kept remote'};
      return {ok:true,status:res.status,bytes};
    }catch(error){last={ok:false,why:error.name==='AbortError'?'timeout':error.message}}
    finally{clearTimeout(timer)}
  }
  return last;
}

export async function pythonConvert(entries,{cwd=process.cwd(),scratch}){
  const {pythonCommand}=await import('./editorial-production-flow.mjs');
  const manifest=path.join(scratch,'manifest.json');
  fs.writeFileSync(manifest,JSON.stringify(entries));
  const {stdout}=await promisify(execFile)(pythonCommand(),[path.join(cwd,'scripts/poster-webp.py'),manifest],
    {cwd,timeout:20*60*1000,maxBuffer:16*1024*1024});
  return JSON.parse(stdout);
}

function sourcesOf(work){
  const local=isPosterPath(work.image);
  return [...new Set([local?work.image_remote:work.image,...array(work.image_fallbacks)].filter(remote))];
}

export async function copyPosters({works,targets,fetcher=fetch,convert=pythonConvert,root=process.cwd(),refresh=false,dryRun=false,
  intervalMs=800,concurrency=6,sleep,now}){
  const pace=hostPacer({intervalMs,...(sleep?{sleep}:{}),...(now?{now}:{})});
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'selection-posters-'));
  try{
    const results=new Array(targets.length),pending=[];let next=0;
    await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},async()=>{
      while(next<targets.length){
        const index=next++,work=targets[index],result={work_id:work.id,title:work.title,status:'skipped',attempts:[]};
        results[index]=result;
        if(!work.image){result.why='no image';continue;}
        if(!SAFE_ID.test(work.id||'')){result.why='unsafe work id';continue;}
        if(isPosterPath(work.image)&&!refresh){
          const file=path.join(root,work.image);
          if(fs.existsSync(file)&&webpInfo(fs.readFileSync(file))){result.status='kept';continue;}
        }
        const sources=sourcesOf(work);
        if(!sources.length){result.status='failed';result.why='no remote source to copy';continue;}
        for(const url of sources){
          const got=await pace(url,()=>download(url,{fetcher}));
          result.attempts.push({url,ok:got.ok,status:got.status??null,why:got.why||null});
          if(!got.ok)continue;
          const input=path.join(scratch,work.id+'.src'),output=path.join(scratch,work.id+'.webp');
          fs.writeFileSync(input,got.bytes);
          pending.push({result,work,url,input,output,bytes_in:got.bytes.length});
          break;
        }
        if(!pending.some(item=>item.result===result)){result.status='failed';result.why='no healthy remote source';}
      }
    }));
    const converted=pending.length?await convert(pending.map(item=>({in:item.input,out:item.output})),{cwd:root,scratch}):[];
    for(const item of pending){
      const {result,work,url}=item,answer=converted.find(row=>row.out===item.output);
      if(!answer?.ok){result.status='failed';result.why='conversion failed: '+(answer?.error||'no result');continue;}
      const bytes=fs.readFileSync(item.output),info=webpInfo(bytes),target=posterPath(work.id),file=path.join(root,target);
      if(!info){result.status='failed';result.why='encoder did not produce a WebP';continue;}
      const same=fs.existsSync(file)&&fs.readFileSync(file).equals(bytes);
      if(!same&&!dryRun){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
      const failed=new Set(result.attempts.filter(attempt=>!attempt.ok).map(attempt=>attempt.url));
      // The copied original leads the fallbacks; URLs that just failed are dropped.
      const previous=[...new Set([work.image,work.image_remote,...array(work.image_fallbacks)].filter(remote))];
      Object.assign(result,{status:'copied',file:target,file_changed:!same,bytes:bytes.length,width:info.width,height:info.height,
        source:url,bytes_in:item.bytes_in,
        update:{image:target,image_remote:url,image_fallbacks:[url,...previous.filter(u=>u!==url&&!failed.has(u))]}});
      // Identical values are no change: a re-run must not touch works.json.
      if(Object.entries(result.update).every(([key,value])=>JSON.stringify(work[key])===JSON.stringify(value)))delete result.update;
    }
    return results;
  }finally{fs.rmSync(scratch,{recursive:true,force:true});}
}

// CI: committed posters match the catalogue, stay small and are real WebP.
export function checkPosterAssets({works,root=process.cwd()}){
  const errors=[],referenced=new Set();let bytes=0;
  for(const work of works){
    const image=work.image||'';
    if(!image.startsWith(POSTER_DIR+'/'))continue;
    if(!isPosterPath(image)||image!==`${POSTER_DIR}/${work.id}.webp`){errors.push(`${work.id}: poster path must be ${POSTER_DIR}/${work.id}.webp, got ${image}`);continue;}
    referenced.add(image);
    const file=path.join(root,image);
    if(!fs.existsSync(file)){errors.push(`${work.id}: missing ${image}`);continue;}
    const content=fs.readFileSync(file),info=webpInfo(content);bytes+=content.length;
    if(!info)errors.push(`${work.id}: ${image} is not a WebP file`);
    else if(info.width>MAX_POSTER_SIZE.width||info.height>MAX_POSTER_SIZE.height)errors.push(`${work.id}: ${image} is ${info.width}×${info.height}, above ${MAX_POSTER_SIZE.width}×${MAX_POSTER_SIZE.height}`);
    if(content.length>MAX_POSTER_BYTES)errors.push(`${work.id}: ${image} weighs ${content.length} bytes, above ${MAX_POSTER_BYTES}`);
    if(!remote(work.image_remote))errors.push(`${work.id}: image_remote must keep the original remote URL`);
    else if(array(work.image_fallbacks)[0]!==work.image_remote)errors.push(`${work.id}: image_fallbacks must start with image_remote`);
  }
  const directory=path.join(root,POSTER_DIR);
  for(const name of fs.existsSync(directory)?fs.readdirSync(directory):[]){
    if(!referenced.has(`${POSTER_DIR}/${name}`))errors.push(`${POSTER_DIR}/${name}: not the image of any work`);
  }
  return {errors,posters:referenced.size,bytes};
}

export function parseCli(args){
  const options={works:[],dryRun:false,refresh:false,all:false,check:false,intervalMs:800};
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(['--dry-run','--refresh','--all','--check'].includes(flag)){options[{'--dry-run':'dryRun','--refresh':'refresh','--all':'all','--check':'check'}[flag]]=true;continue;}
    assert(['--week','--work','--report','--pace-ms'].includes(flag),'unknown flag '+flag);
    const value=args[++index];assert(value&&!value.startsWith('--'),'missing value '+flag);
    if(flag==='--week'){assert.match(value,/^\d{4}-S\d{2}$/,'--week YYYY-Sxx');options.week=value;}
    else if(flag==='--work')options.works.push(value);
    else if(flag==='--report')options.report=value;
    else{options.intervalMs=Number(value);assert(Number.isInteger(options.intervalMs)&&options.intervalMs>=0,'--pace-ms must be a nonnegative integer');}
  }
  assert([options.check||null,options.week,options.works.length||null,options.all||null].filter(Boolean).length===1,
    'Usage: poster-copy.mjs (--check | --week YYYY-Sxx | --work ID... | --all) [--dry-run] [--refresh] [--report FILE] [--pace-ms N]');
  return options;
}

async function main(){
  const options=parseCli(process.argv.slice(2));
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const catalogue=read('data/works.json'),works=array(catalogue.works);
  if(options.check){
    const {errors,posters,bytes}=checkPosterAssets({works});
    for(const error of errors)console.error('✗ '+error);
    if(errors.length){console.error(`✗ Local posters: ${errors.length} problem(s)`);process.exit(1);}
    console.log(`✓ Local posters: ${posters} WebP files, ${(bytes/1024/1024).toFixed(2)} MiB, each referenced by its work`);
    return;
  }
  let targets;
  if(options.week){
    const radarPath=`data/radar-reserves/${options.week}.json`;
    ({targets}=weekTargets({week:options.week,issue:read(`data/weeks/${options.week}.json`),works,
      config:read('data/editorial-config.json'),radar:()=>fs.existsSync(radarPath)?read(radarPath):null}));
  }else if(options.works.length){
    const byId=new Map(works.map(work=>[work.id,work]));
    targets=options.works.map(id=>{assert(byId.has(id),'unknown work id '+id);return byId.get(id);});
  }else targets=works.filter(work=>work.image);
  const results=await copyPosters({works,targets,refresh:options.refresh,dryRun:options.dryRun,intervalMs:options.intervalMs});
  for(const result of results){
    if(result.status==='kept'||result.status==='skipped'&&result.why==='no image')continue;
    console.log(`${{copied:'+',failed:'✗',skipped:'·'}[result.status]} ${result.work_id}: ${result.status}`+
      (result.file?` ${result.width}×${result.height} ${Math.round(result.bytes/1024)} KiB${result.file_changed?'':' (unchanged)'}`:'')+(result.why?' — '+result.why:''));
  }
  const today=process.env.SELECTION_TV_TODAY||new Date().toISOString().slice(0,10);
  const {doc,changed}=applyResolutions(catalogue,results,{today});
  const counts={};for(const result of results)counts[result.status]=(counts[result.status]||0)+1;
  const summary={works:results.length,...counts,records_changed:changed,files_written:options.dryRun?0:results.filter(r=>r.file_changed).length,
    bytes_copied:results.reduce((sum,r)=>sum+(r.bytes||0),0),written:!options.dryRun&&changed>0};
  if(options.report)fs.writeFileSync(options.report,JSON.stringify({generated_at:new Date().toISOString(),summary,results},null,2)+'\n');
  if(!options.dryRun&&changed)fs.writeFileSync('data/works.json',JSON.stringify(doc,null,2)+'\n');
  console.log(JSON.stringify(summary));
  if(counts.failed)process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
