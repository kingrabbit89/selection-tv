// An optional paper-source supplement. It never replaces the Web inventory,
// asserts broadcaster freshness, selects a work or certifies coverage.
import assert from 'node:assert/strict';
import {digest,validateBundle} from './editorial-handoff.mjs';
import {addDays,weekForSaturday} from './week-calendar.mjs';

const array=value=>Array.isArray(value)?value:[];
export function validateTeleramaReport(report,week,from) {
  assert.equal(report?.schema_version,1,'invalid Telerama report schema');
  assert.equal(report.kind,'telerama_pdf','invalid supplement kind');
  assert.equal(report.week,week,'Telerama belongs to another week');
  assert.equal(weekForSaturday(from),week,'invalid target week');
  assert.deepEqual(report.range,{from,to:addDays(from,6)},'Telerama range does not match this issue');
  assert.equal(report.publication_ready,false,'paper import cannot certify publication');
  assert.equal(report.coverage_certified,false,'paper import cannot certify coverage');
  const source=report.source;
  assert(source && typeof source.filename==='string' && source.filename.trim(),'PDF filename required');
  assert.match(source.sha256 || '',/^[a-f0-9]{64}$/,'PDF fingerprint required');
  assert(Number.isInteger(source.bytes) && source.bytes>0 && source.bytes<=100*1024*1024,'PDF size invalid');
  assert(Number.isInteger(source.pages) && source.pages>0 && source.pages<=600,'PDF page count invalid');
  assert(Array.isArray(report.pages),'page extraction report required');
  assert(Array.isArray(report.observations) && report.observations.length<=20000,'bounded observations required');
  if(source.publication_date!=null) {
    assert.match(source.publication_date,/^\d{4}-\d{2}-\d{2}$/,'invalid magazine publication date');
    assert.equal(addDays(source.publication_date,0),source.publication_date,'invalid magazine publication date');
  }
  if(report.extracted_at!=null)assert(Number.isFinite(Date.parse(report.extracted_at)),'invalid extraction time');
  const pages=new Set();
  for(const page of report.pages) {
    assert(Number.isInteger(page.pdf_page) && page.pdf_page>=1 && page.pdf_page<=source.pages,'invalid extraction page');
    assert(!pages.has(page.pdf_page),'duplicate extraction page');pages.add(page.pdf_page);
  }
  for(const row of report.observations) {
    assert(typeof row.title==='string' && row.title.trim() && row.title.length<=500,'PDF title required');
    assert(typeof row.channel==='string' && row.channel.trim(),'PDF channel required');
    assert(row.editorial_intention!==true && row.scope==null && row.rubrique==null,'paper input must remain a raw schedule observation');
    assert.match(row.date || '',/^\d{4}-\d{2}-\d{2}$/,'PDF civil date required');
    assert.equal(addDays(row.date,0),row.date,'invalid PDF date');
    assert.match(row.start || '',/^(?:[01]\d|2[0-3]):[0-5]\d$/,'invalid PDF start');
    assert(row.date>=from && (row.date<=report.range.to || row.date===addDays(report.range.to,1) && row.start<'06:00'),
      'PDF observation outside its broadcast week');
    assert(typeof row.source==='string' && row.source.trim(),'PDF source label required');
    assert.equal(row.source_type,'telerama_pdf','invalid PDF source type');
    assert.equal(row.source_ref,'sha256:'+source.sha256,'PDF observation fingerprint mismatch');
    assert(row.source_url==null,'paper import must not invent a Web source URL');
    assert(row.source_urls==null || Array.isArray(row.source_urls) && row.source_urls.length===0,'paper import must not invent Web source URLs');
    assert(row.checked_at==null && row.source_independence==null,'paper schedule is not a fresh independent broadcast check');
    assert(Number.isInteger(row.pdf_page) && pages.has(row.pdf_page),'PDF observation page is not traced');
    assert(Array.isArray(row.bbox) && row.bbox.length===4 && row.bbox.every(Number.isFinite) &&
      row.bbox[0]>=0 && row.bbox[1]>=0 && row.bbox[2]>row.bbox[0] && row.bbox[3]>row.bbox[1],'PDF observation bounds required');
    const page=report.pages.find(page=>page.pdf_page===row.pdf_page);
    if(Number.isFinite(page.width)) assert(row.bbox[2]<=page.width,'PDF observation outside page width');
    if(Number.isFinite(page.height)) assert(row.bbox[3]<=page.height,'PDF observation outside page height');
  }
  return report;
}

export function teleramaExtractionContent(report) {
  return {kind:report.kind,week:report.week,range:report.range,
    source:{sha256:report.source.sha256,bytes:report.source.bytes,pages:report.source.pages},
    observations:report.observations,pages:report.pages};
}

export function buildTeleramaHandoff(context,report,{from,base_research_content,generated_at}={}) {
  assert.match(context.sha || '',/^[a-f0-9]{40}$/,'immutable source SHA required');
  validateTeleramaReport(report,context.week,from);
  assert(Number.isFinite(Date.parse(generated_at)),'actual import time required');
  const research=context.research;
  assert(research && research.week===context.week,'initialize the weekly research checkpoint before importing a supplement');
  assert(['inventory','enrichment'].includes(research.stage) && research.editorial_review_completed!==true && !research.editorial_review?.completed &&
    !research.review?.completed,'cannot import into sealed or ready research');
  assert(Array.isArray(research.remaining) && research.remaining.length && research.remaining.every(value=>typeof value==='string' && value.trim()),
    'unfinished requirements must remain explicit');
  assert(typeof base_research_content==='string','exact original research bytes required');
  assert.deepEqual(JSON.parse(base_research_content),research,'research does not match the exact base content');
  assert(research.supplementary_sources===undefined || Array.isArray(research.supplementary_sources),'invalid saved supplementary sources');
  const id='telerama:'+report.source.sha256;
  const existing=array(research.supplementary_sources).filter(entry=>entry.id===id);
  assert(existing.length<=1,'duplicate saved supplement identity');
  if(existing.length) {
    validateTeleramaReport(existing[0].report,context.week,from);
    assert.deepEqual(teleramaExtractionContent(existing[0].report),teleramaExtractionContent(report),
      'this PDF has a different extraction; review the existing supplement before replacing it');
    return {bundle:{schema_version:1,week:context.week,base_sha:context.sha,stage:research.stage,
      remaining:[...research.remaining],files:[]},supplement:existing[0],added:false};
  }
  const next=structuredClone(research),supplement={id,kind:'telerama_pdf',imported_at:generated_at,
    use:'Supplementary research leads; original publication/extraction dates are not broadcast verification.',
    report:structuredClone(report)};
  next.supplementary_sources=[...array(next.supplementary_sources),supplement];
  const content=JSON.stringify(next,null,2)+'\n';
  assert(Buffer.byteLength(content,'utf8')<12*1024*1024,'supplemented research exceeds checkpoint size limit');
  const bundle={schema_version:1,week:context.week,base_sha:context.sha,stage:research.stage,remaining:[...research.remaining],
    files:[{path:`data/research/${context.week}.json`,base_sha256:digest(base_research_content),content,
      content_sha256:digest(content),content_bytes:Buffer.byteLength(content,'utf8')}]};
  validateBundle(bundle);
  return {bundle,supplement,added:true};
}
