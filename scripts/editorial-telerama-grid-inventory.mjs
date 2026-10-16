// Build the week's raw inventory from the provided Télérama PDF's full grid
// (all programmes), as allowed from quality_gates.telerama_grid_authority_from_week.
// Every row keeps its PDF fingerprint, page and bbox; no Web URL is invented.
// The magazine prints full days and nights only for some channels: the measured
// printed scope is recorded as limits, never as complete coverage. The sampled
// transcription review stays to do (coverage.grid_inventory.transcription_review).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {digest,validateBundle} from './editorial-handoff.mjs';
import {validateTeleramaReport} from './editorial-telerama-import.mjs';
import {GRID_AUTHORITY_MODE,pageRef} from './inventory-evidence.mjs';
import {productionContextFromGit} from './editorial-production-plan.mjs';
import {issueStart,extractTeleramaPdf} from './editorial-production-flow.mjs';
import {addDays} from './week-calendar.mjs';

const array=value=>Array.isArray(value)?value:[];
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const NIGHT=/^0[0-5]:/;
const byText=(a,b)=>a.localeCompare(b,'fr');
const median=values=>{const sorted=[...values].sort((a,b)=>a<b?-1:a>b?1:0);return sorted.length?sorted[Math.floor((sorted.length-1)/2)]:null;};
const rowsOf=inventory=>array(inventory?.days).reduce((sum,day)=>sum+array(day.items).length,0);

const minutes=start=>Number(start.slice(0,2))*60+Number(start.slice(3));
const duration=value=>`${Math.floor(value/60)} h ${String(value%60).padStart(2,'0')}`;

// Measured, not certified: per channel, the days and nights printed, the usual
// first daytime start and the usual longest gap between two printed starts of
// a day. A long gap is either a long block or hours the magazine does not print.
export function printedScope(days) {
  const channels=new Map();
  for(const day of days) for(const item of day.items) {
    const entry=channels.get(item.channel)||{days:new Map(),nights:new Set()};
    const starts=entry.days.get(day.date)||new Set();starts.add(item.start);entry.days.set(day.date,starts);
    if(NIGHT.test(item.start))entry.nights.add(day.date);
    channels.set(item.channel,entry);
  }
  const scope={};
  for(const [channel,entry] of [...channels].sort(([a],[b])=>byText(a,b))) {
    const first=[],gaps=[];
    for(const starts of entry.days.values()) {
      const sorted=[...starts].sort(),daytime=sorted.find(start=>!NIGHT.test(start));
      if(daytime)first.push(daytime);
      gaps.push(sorted.slice(1).reduce((gap,start,i)=>Math.max(gap,minutes(start)-minutes(sorted[i])),0));
    }
    scope[channel]={days:entry.days.size,night_days:entry.nights.size,typical_first_daytime_start:median(first),
      typical_longest_gap_minutes:median(gaps)};
  }
  return scope;
}

export function scopeLimits(scope,warnings=[],{longGapMinutes=240}={}) {
  const entries=Object.entries(scope),limits=[];
  const add=(label,channels)=>{if(channels.length)limits.push(label+channels.join(', ')+'.');};
  add('Soirée seulement imprimée (première ligne de journée après 17:00) : ',
    entries.filter(([,value])=>value.typical_first_daytime_start>='17:00').map(([channel])=>channel));
  add(`Écart habituel de plus de ${duration(longGapMinutes)} entre deux horaires imprimés d’une journée (heures non imprimées ou longs blocs) : `,
    entries.filter(([,value])=>value.typical_longest_gap_minutes>longGapMinutes && value.typical_first_daytime_start<'17:00')
      .sort((a,b)=>b[1].typical_longest_gap_minutes-a[1].typical_longest_gap_minutes)
      .map(([channel,value])=>`${channel} (${duration(value.typical_longest_gap_minutes)})`));
  add('Aucune ligne 00:00–05:59 imprimée : ',entries.filter(([,value])=>!value.night_days).map(([channel])=>channel));
  limits.push('Le magazine n’imprime pas toutes les heures : aucune chaîne n’est relevée comme complète. Les heures non imprimées (films de nuit ou du matin des chaînes cinéma notamment) ne sont pas relevées ; les compléter par l’import Web ordinaire seulement si une piste l’exige.');
  for(const warning of warnings)if(/first Saturday|preceding-night/i.test(warning))limits.push('La nuit 00:00–05:59 du premier samedi est imprimée dans le numéro précédent.');
  return limits;
}

// A review plan to fill, not a review: one page per day re-read whole for
// omissions and five rows of that day on it checked against the print.
export function transcriptionReviewTemplate(days,{rowsPerDay=5}={}) {
  const pages=[],rows=[];
  for(const day of days) {
    const counts=new Map();
    for(const item of day.items)counts.set(item.pdf_page,(counts.get(item.pdf_page)||0)+1);
    const page=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([value])=>value).find(value=>!pages.includes(value));
    if(page===undefined)continue;
    pages.push(page);
    const onPage=day.items.filter(item=>item.pdf_page===page),picked=[],channels=new Set();
    for(let pass=0;pass<2 && picked.length<rowsPerDay;pass++)
      for(let i=0;i<onPage.length && picked.length<rowsPerDay;i+=Math.max(1,Math.floor(onPage.length/rowsPerDay))) {
        const item=onPage[i];
        if(picked.includes(item) || pass===0 && channels.has(item.channel))continue;
        picked.push(item);channels.add(item.channel);
      }
    for(const item of picked)rows.push({date:day.date,pdf_page:page,title:item.title,start:item.start,channel:item.channel,decision:null});
  }
  return {reviewed_at:null,method:null,pages_reread:pages,sampled_rows:rows,discrepancies:[]};
}

function inventoryItem(row) {
  const item={title:row.title,start:row.start,channel:row.channel,source:row.source||'Télérama magazine fourni',
    source_type:'telerama_pdf',source_ref:row.source_ref,pdf_page:row.pdf_page,bbox:row.bbox};
  if(row.printed_page!=null)item.printed_page=row.printed_page;
  if(row.grid_date)item.grid_date=row.grid_date;
  if(row.overnight!=null)item.overnight=row.overnight;
  if(row.channel_printed && row.channel_printed!==row.channel)item.channel_printed=row.channel_printed;
  if(row.genre_hint)item.genre_hint=row.genre_hint;
  return item;
}

export function buildGridInventoryHandoff(context,report,{generated_at,base_inventory_content,base_coverage_content,replace_web_inventory=false}={}) {
  const week=context.week;
  assert.match(context.sha||'',/^[a-f0-9]{40}$/,'immutable source SHA required');
  const gate=context.editorial_config?.quality_gates?.telerama_grid_authority_from_week;
  assert(gate && week>=gate,'Télérama grid authority is not enabled for '+week);
  const from=issueStart(week),to=addDays(from,6);
  validateTeleramaReport(report,week,from);
  assert.equal(report.scope,'all-programmes','the grid inventory needs the all-programmes extraction (--scope all-programmes)');
  assert.equal(context.prepared_telerama_report?.source?.sha256,report.source.sha256,
    `save data/editorial-inputs/${week}/telerama.json for this PDF on main first (normal import PR)`);
  assert(Number.isFinite(Date.parse(generated_at)),'actual import time required');
  const research=context.research;
  assert(!research || research.stage!=='ready' && research.editorial_review_completed!==true && !research.editorial_review?.completed,
    'cannot import into sealed or ready research');
  for(const [name,value,base] of [['inventory',context.inventory,base_inventory_content],['coverage',context.coverage,base_coverage_content]]) {
    if(value){assert(typeof base==='string','exact original '+name+' content required');assert.deepEqual(JSON.parse(base),value,name+' does not match exact base content');}
    else assert(base===null,'new '+name+' requires absent base');
  }
  const previous=context.inventory,previousRows=rowsOf(previous);
  const superseding=previous && previous.mode!==GRID_AUTHORITY_MODE && previousRows>0;
  assert(!superseding || replace_web_inventory,
    `a Web inventory already exists (${previousRows} rows); pass --replace-web-inventory to supersede it (it stays in Git at the base SHA)`);

  const authority={source_ref:'sha256:'+report.source.sha256};
  const byDate=new Map(Array.from({length:7},(_,i)=>[addDays(from,i),[]]));
  const outside=[],duplicates=[],conflicts=[];
  for(const row of report.observations) {
    const rows=byDate.get(row.date);
    if(rows)rows.push(row);else outside.push({date:row.date,start:row.start,channel:row.channel,title:row.title,pdf_page:row.pdf_page});
  }
  const days=[];
  for(const [date,rows] of byDate) {
    const seen=new Set(),slots=new Map(),items=[];
    for(const row of [...rows].sort((a,b)=>a.start.localeCompare(b.start)||byText(a.channel,b.channel)||a.pdf_page-b.pdf_page)) {
      const key=[norm(row.title),norm(row.channel),row.start].join('|');
      if(seen.has(key)){duplicates.push({date,start:row.start,channel:row.channel,title:row.title,pdf_page:row.pdf_page});continue;}
      seen.add(key);
      const slot=norm(row.channel)+'|'+row.start,titles=slots.get(slot)||[];titles.push(row.title);slots.set(slot,titles);
      items.push(inventoryItem(row));
    }
    for(const [slot,titles] of slots)if(titles.length>1)conflicts.push({date,channel:items.find(item=>norm(item.channel)+'|'+item.start===slot).channel,start:slot.split('|')[1],titles});
    const channels=[...new Set(items.map(item=>item.channel))].sort(byText);
    const pagesOf=list=>[...new Set(list.map(item=>item.pdf_page))].sort((a,b)=>a-b).map(page=>pageRef(authority,page));
    days.push({date,status:'printed_grid',scan_window:'00:00-23:59',channels_scanned:channels,source_pages:pagesOf(items),
      channel_sources:Object.fromEntries(channels.map(channel=>[channel,pagesOf(items.filter(item=>item.channel===channel))])),
      channel_counts:Object.fromEntries(channels.map(channel=>[channel,items.filter(item=>item.channel===channel).length])),items});
  }
  const scope=printedScope(days),limits=scopeLimits(scope,array(report.warnings));
  const inventory={schema_version:1,week,range:`${from} — ${to}`,mode:GRID_AUTHORITY_MODE,
    note:'Grille complète du magazine Télérama fourni, relevée sans filtre. Chaque ligne cite l’empreinte, la page et la position du PDF ; la portée imprimée et ses limites sont dans coverage.grid_inventory.',
    source:{source_ref:authority.source_ref,filename:report.source.filename,pages:report.source.pages,
      publication_date:report.source.publication_date??null,extraction_scope:report.scope,parser:report.parser?.layout??null},
    updated_at:generated_at,days};
  if(previous?.mode===GRID_AUTHORITY_MODE) {
    // Corrections and additions from the transcription review live in the saved inventory.
    assert.equal(previous.source?.source_ref,authority.source_ref,'the saved grid inventory comes from another PDF; review it before replacing it');
    const comparable=value=>{const copy=structuredClone(value);delete copy.updated_at;return copy;};
    assert.deepEqual(comparable(previous),comparable(inventory),'the grid inventory of this PDF is already saved; apply transcription corrections in place');
  }
  const coverage=context.coverage?structuredClone(context.coverage):{schema_version:1,week,status:'draft',days:[],
    independent_crosscheck_complete:false,full_week_reaudit_completed:false};
  const savedDays=new Map(array(coverage.days).map(day=>[day.date,day]));
  coverage.days=days.map(day=>({...(savedDays.get(day.date)||{}),date:day.date,
    channels_scanned:[...new Set([...array(savedDays.get(day.date)?.channels_scanned),...day.channels_scanned])]}));
  coverage.full_week_reaudit_completed=false;
  coverage.grid_inventory={source_ref:authority.source_ref,source_path:`data/editorial-inputs/${week}/telerama.json`,
    extraction_scope:report.scope,parser:report.parser?.layout??null,
    grid_pages:report.summary?.grid_pages??new Set(days.flatMap(day=>day.items.map(item=>item.pdf_page))).size,
    rows:days.reduce((sum,day)=>sum+day.items.length,0),imported_at:generated_at,printed_scope:scope,limits,
    ...(superseding?{superseded_web_inventory:{rows:previousRows,base_sha:context.sha}}:{}),
    transcription_review:null};
  coverage.updated_at=generated_at;
  const files=[];
  if(previous?.mode!==GRID_AUTHORITY_MODE) {
    files.push({path:`data/inventory/${week}.json`,base_sha256:digest(base_inventory_content),content:JSON.stringify(inventory,null,2)+'\n'});
    files.push({path:`data/coverage/${week}.json`,base_sha256:digest(base_coverage_content),content:JSON.stringify(coverage,null,2)+'\n'});
  }
  const remaining=array(research?.remaining).length?[...research.remaining]:
    ['Relire la transcription de la grille Télérama par sondage et la consigner dans coverage.grid_inventory.transcription_review, puis poursuivre la sélection.'];
  const bundle={schema_version:1,week,base_sha:context.sha,stage:research?.stage||'inventory',remaining,files};
  if(files.length)validateBundle(bundle);
  return {bundle,inventory,coverage,report:{publication_ready:false,coverage_certified:false,week,source_ref:authority.source_ref,
    rows:coverage.grid_inventory.rows,rows_per_day:Object.fromEntries(days.map(day=>[day.date,day.items.length])),
    channels:Object.keys(scope).length,printed_scope:scope,limits,duplicate_rows:duplicates,slot_conflicts:conflicts,outside_week:outside.length,
    superseded_web_rows:superseding?previousRows:0,transcription_review_template:transcriptionReviewTemplate(days),
    note:'Raw printed grid only. Fill coverage.grid_inventory.transcription_review after re-reading the pages; slot conflicts stay to review.'}};
}

export function parseCli(args) {
  const options={week:args[0]};
  for(let index=1;index<args.length;index++) {
    const flag=args[index];
    if(flag==='--replace-web-inventory'){options.replaceWebInventory=true;continue;}
    assert(['--ref','--out-dir','--report','--telerama-pdf'].includes(flag),'unknown flag '+flag);
    const value=args[++index];assert(value && !value.startsWith('--'),'missing value '+flag);
    options[{'--ref':'ref','--out-dir':'outDir','--report':'reportPath','--telerama-pdf':'teleramaPdf'}[flag]]=value;
  }
  assert(options.ref && options.outDir,'--ref and --out-dir required');
  assert(Boolean(options.reportPath)!==Boolean(options.teleramaPdf),'use --report or --telerama-pdf');
  return options;
}

async function main() {
  const options=parseCli(process.argv.slice(2));
  assert(!fs.existsSync(options.outDir),'output directory must be new');
  fs.mkdirSync(options.outDir,{recursive:true});
  const context=productionContextFromGit(options.week,options.ref);
  const report=options.reportPath?JSON.parse(fs.readFileSync(options.reportPath,'utf8')):
    await extractTeleramaPdf({week:options.week,pdf:options.teleramaPdf,out:path.join(options.outDir,'telerama-grid-report.json'),scope:'all-programmes'});
  const raw=p=>execFileSync('git',['ls-tree',context.sha,'--',p],{encoding:'utf8'}).trim()?execFileSync('git',['show',`${context.sha}:${p}`],{encoding:'utf8',maxBuffer:64*1024*1024}):null;
  const result=buildGridInventoryHandoff(context,report,{generated_at:new Date().toISOString(),
    base_inventory_content:raw(`data/inventory/${options.week}.json`),base_coverage_content:raw(`data/coverage/${options.week}.json`),
    replace_web_inventory:options.replaceWebInventory===true});
  fs.writeFileSync(path.join(options.outDir,'grid-inventory-report.json'),JSON.stringify(result.report,null,2)+'\n');
  if(result.bundle.files.length)fs.writeFileSync(path.join(options.outDir,'grid-inventory-handoff.json'),JSON.stringify(result.bundle,null,2)+'\n');
  console.log(JSON.stringify({week:options.week,source_sha:context.sha,rows:result.report.rows,rows_per_day:result.report.rows_per_day,
    channels:result.report.channels,duplicate_rows:result.report.duplicate_rows.length,slot_conflicts:result.report.slot_conflicts.length,
    outside_week:result.report.outside_week,superseded_web_rows:result.report.superseded_web_rows,
    handoff:result.bundle.files.length?path.join(options.outDir,'grid-inventory-handoff.json'):null}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
