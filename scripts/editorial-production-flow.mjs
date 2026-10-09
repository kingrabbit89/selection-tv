// Prepare one immutable editorial work batch; never write candidate/public data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collectSources} from './editorial-source-collector.mjs';
import {buildProductionPlan, productionContextFromGit} from './editorial-production-plan.mjs';
import {buildSourceInventoryHandoff} from './editorial-source-import.mjs';
import {buildTeleramaHandoff} from './editorial-telerama-import.mjs';
import {addDays, weekForSaturday} from './week-calendar.mjs';

export function issueStart(week) {
  assert.match(week || '', /^\d{4}-S\d{2}$/);
  const year = Number(week.slice(0,4)), number = Number(week.slice(6));
  const jan4 = `${year}-01-04`;
  const weekday = new Date(jan4+'T12:00:00Z').getUTCDay() || 7;
  const from = addDays(jan4, 1-weekday+(number-1)*7-2);
  assert.equal(weekForSaturday(from), week, 'invalid issue week');
  return from;
}

// Official formats verified against real responses. This seed covers five
// channels only; the required wider inventory and independent recall remain.
export function officialSourcePlan(week) {
  const from=issueStart(week),sources=[];
  for(let offset=-1;offset<7;offset++) {
    const date=addDays(from,offset);
    sources.push({id:`arte-${date}`,adapter:'arte-guide-html',channel:'Arte',date,
      url:`https://www.arte.tv/fr/guide/${date.replaceAll('-','')}/`});
  }
  for(const number of [2,3,4,5]) for(const date of [addDays(from,-7),from])
    sources.push({id:`france-${number}-${date}`,adapter:'francetvpro-grid-xml',
      channel:`France ${number}`,date,url:`https://www.francetvpro.fr/grille-xml/france-${number}/${date.split('-').reverse().join('-')}`});
  return {schema_version:1,week,sources,note:'Five official channels only; raw observations, no coverage certification.'};
}

export async function extractTeleramaPdf({week,pdf,out,libraryFileId,cwd=process.cwd()}) {
  const args=[path.join(cwd,'scripts/editorial-telerama-pdf.py'),path.resolve(pdf),'--week',week,'--output',path.resolve(out)];
  if(libraryFileId)args.push('--library-file-id',libraryFileId);
  await promisify(execFile)('python3',args,{cwd,timeout:180000,maxBuffer:2*1024*1024});
  return JSON.parse(fs.readFileSync(out,'utf8'));
}

export async function prepareProductionFlow({week, ref, outDir, sourcePlan = null,
  sourceReport = null, collectOfficial = false, cacheDir = null, refresh = false, limit = 6, offset = 0, cwd = process.cwd(),
  teleramaPdf=null,teleramaReport=null,teleramaLibraryId=null,teleramaEditorial=null,useTelerama=true},
  {readContext = productionContextFromGit, collect = collectSources, buildPlan = buildProductionPlan,extractPdf=extractTeleramaPdf} = {}) {
  assert(outDir && typeof outDir === 'string', 'outDir required');
  assert(!fs.existsSync(outDir), 'output directory must be new; preserve the previous batch');
  assert(!(sourcePlan && sourceReport), 'use sourcePlan or sourceReport, not both');
  assert(!(teleramaPdf && teleramaReport),'use Telerama PDF or report, not both');
  assert(useTelerama || !(teleramaPdf || teleramaReport || teleramaEditorial),'cannot import Telerama while disabling the supplement');
  assert(!teleramaLibraryId || teleramaPdf,'library reference requires a PDF input');
  assert(!collectOfficial || !(sourcePlan || sourceReport),'official seed cannot be mixed with another source input');
  if(collectOfficial) sourcePlan=officialSourcePlan(week);
  assert(!refresh || sourcePlan,'refresh requires explicit collection');
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 40, 'limit must be 1..40');
  assert(Number.isInteger(offset) && offset >= 0, 'offset must be nonnegative');
  const context = readContext(week, ref, cwd);
  assert.equal(context.week, week);
  assert.match(context.sha || '', /^[a-f0-9]{40}$/, 'immutable source SHA required');
  const from = issueStart(week), to = addDays(from,6);
  let paperReport=teleramaReport;
  if(teleramaPdf) {
    fs.mkdirSync(outDir,{recursive:true});
    paperReport=await extractPdf({week,pdf:teleramaPdf,out:path.join(outDir,'telerama-report.json'),
      libraryFileId:teleramaLibraryId,cwd});
  }
  const paperImport=paperReport?buildTeleramaHandoff(context,paperReport,{from,
    base_research_content:context.research_source_content,generated_at:new Date().toISOString()}):null;
  let report = sourceReport;
  if (sourcePlan) {
    assert(Array.isArray(sourcePlan.sources) && sourcePlan.sources.length, 'explicit source plan required');
    if (sourcePlan.week !== undefined) assert.equal(sourcePlan.week, week, 'source plan belongs to another week');
    for (const source of sourcePlan.sources) {
      const precedingXml=source.adapter==='francetvpro-grid-xml' && source.date===addDays(from,-7);
      assert(typeof source.date === 'string' && (precedingXml || source.date >= addDays(from,-1) && source.date <= to),
        'source page date must cover this week or its first overnight');
    }
    report = await collect(sourcePlan, {cacheDir, snapshotDir:path.join(outDir,'sources'), refresh});
  }
  if (report) {
    if (report.week !== undefined) assert.equal(report.week, week, 'source report belongs to another week');
    assert(Array.isArray(report.observations), 'source report observations required');
  }
  const inventoryImport=report ? buildSourceInventoryHandoff(context,report,{from,
    base_inventory_content:context.inventory_source_content ?? (context.inventory ? undefined : null),
    generated_at:new Date().toISOString()}) : null;
  const plan = buildPlan(context, {observations:report?.observations || [],sourceReport:report,
    observations_provenance:report ? {path:path.join(outDir,'source-report.json'),source_sha:null} : undefined,
    useTelerama,editorialReports:teleramaEditorial?[{report:teleramaEditorial,
      provenance:{source_sha:null,path:path.join(outDir,'telerama-editorial.json'),json_pointer:''}}]:[],
    supplementaryReports:paperImport?.added?[{report:paperReport,
      provenance:{path:path.join(outDir,'telerama-report.json'),source_sha:null,json_pointer:''}}]:[],
    limit, offset, compact:true});
  assert.equal(plan.source_sha, context.sha, 'batch source SHA changed');
  assert.equal(plan.publication_ready, false, 'preparation must not certify publication');
  fs.mkdirSync(outDir,{recursive:true});
  if(teleramaEditorial)fs.writeFileSync(path.join(outDir,'telerama-editorial.json'),JSON.stringify(teleramaEditorial,null,2)+'\n');
  if (report) fs.writeFileSync(path.join(outDir,'source-report.json'),JSON.stringify(report,null,2)+'\n');
  if(paperReport) {
    fs.writeFileSync(path.join(outDir,'telerama-report.json'),JSON.stringify(paperReport,null,2)+'\n');
    if(paperImport.bundle.files.length) fs.writeFileSync(path.join(outDir,'telerama-handoff.json'),JSON.stringify(paperImport.bundle,null,2)+'\n');
  }
  if(inventoryImport) {
    fs.writeFileSync(path.join(outDir,'inventory-normalization.json'),JSON.stringify(inventoryImport.report,null,2)+'\n');
    if(inventoryImport.bundle.files.length) fs.writeFileSync(path.join(outDir,'inventory-handoff.json'),JSON.stringify(inventoryImport.bundle,null,2)+'\n');
  }
  fs.writeFileSync(path.join(outDir,'work-batch.json'),JSON.stringify(plan,null,2)+'\n');
  const summary = {week,source_sha:context.sha,publication_ready:false,
    source_mode:sourcePlan ? 'collected_explicit_sources' : report ? 'saved_source_report' : 'saved_inventory',
    collected_observations:report?.observations.length || 0,
    source_results:report?.source_results?.map(row => ({id:row.id,status:row.status,observations_count:row.observations_count})) || [],
    queue_total:plan.queue_total,batch_items:plan.queue.length,next_offset:plan.next_offset,
    classifications:plan.queue.reduce((counts,item) => {counts[item.classification]=(counts[item.classification]||0)+1;return counts;},{}),
    scope_deficits:plan.scope_deficits,work_batch:path.join(outDir,'work-batch.json')};
  if(inventoryImport) summary.inventory_import={added_observations:inventoryImport.report.added_observations,
    duplicate_observations:inventoryImport.report.duplicate_observations,excluded_observations:inventoryImport.report.excluded_observations,
    conflicting_events:inventoryImport.report.conflicting_events.length,
    handoff:inventoryImport.bundle.files.length ? path.join(outDir,'inventory-handoff.json') : null};
  if(plan.supplementary_sources?.length)summary.supplementary_sources=plan.supplementary_sources;
  if(plan.editorial_review_summary)summary.editorial_review=plan.editorial_review_summary;
  if(paperImport)summary.telerama_import={added:paperImport.added,observations:paperReport.observations.length,
    sha256:paperReport.source.sha256,coverage_certified:false,
    handoff:paperImport.bundle.files.length?path.join(outDir,'telerama-handoff.json'):null};
  fs.writeFileSync(path.join(outDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  return {summary,plan,source_report:report,inventory_import:inventoryImport,telerama_report:paperReport,telerama_import:paperImport};
}

export function parseCli(args) {
  const options = {week:args[0],limit:6,offset:0};
  for (let index=1; index<args.length; index++) {
    const flag=args[index];
    if (flag==='--refresh') {options.refresh=true;continue;}
    if (flag==='--collect-official') {options.collectOfficial=true;continue;}
    if (flag==='--without-telerama') {options.useTelerama=false;continue;}
    assert(['--ref','--out-dir','--source-plan','--source-report','--cache-dir','--limit','--offset',
      '--telerama-pdf','--telerama-report','--telerama-library-id','--telerama-editorial'].includes(flag), 'unknown flag '+flag);
    const value=args[++index]; assert(value && !value.startsWith('--'), 'missing value '+flag);
    const key={'--ref':'ref','--out-dir':'outDir','--source-plan':'sourcePlanPath','--source-report':'sourceReportPath',
      '--cache-dir':'cacheDir','--limit':'limit','--offset':'offset','--telerama-pdf':'teleramaPdf',
      '--telerama-report':'teleramaReportPath','--telerama-library-id':'teleramaLibraryId','--telerama-editorial':'teleramaEditorialPath'}[flag];
    options[key]=['limit','offset'].includes(key) ? Number(value) : value;
  }
  assert(options.ref && options.outDir, '--ref and --out-dir required');
  if (options.sourcePlanPath) options.sourcePlan=JSON.parse(fs.readFileSync(options.sourcePlanPath,'utf8'));
  if (options.sourceReportPath) options.sourceReport=JSON.parse(fs.readFileSync(options.sourceReportPath,'utf8'));
  if (options.teleramaReportPath) options.teleramaReport=JSON.parse(fs.readFileSync(options.teleramaReportPath,'utf8'));
  if (options.teleramaEditorialPath) options.teleramaEditorial=JSON.parse(fs.readFileSync(options.teleramaEditorialPath,'utf8'));
  return options;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {summary}=await prepareProductionFlow(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify(summary));
}
