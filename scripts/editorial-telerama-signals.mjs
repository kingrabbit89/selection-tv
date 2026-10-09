// Publisher opinions for editorial triage, separate from facts and scores.
import assert from 'node:assert/strict';
import {addDays,weekForSaturday} from './week-calendar.mjs';
import {normalizedTitle} from './editorial-work-packet.mjs';
const ratings={r:{label:'Hélas',t_count:null},t:{label:'Bof',t_count:1},y:{label:'Bien',t_count:2},u:{label:'Très bien',t_count:3},i:{label:'Bravo',t_count:4}};
const allowed=new Set(['id','title','reviewed_title','date','grid_date','start','channel','channel_printed','programme_kind','in_daily_review_pages','native_rating','author','review_summary','summary_reviewed','summary_reviewed_at','summary_basis','pdf_page','printed_page','bbox','requires_title_review','source_url','checked_at','source_ref']);
const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function validateTeleramaEditorial(report,week,from){
  assert(report&&Object.keys(report).every(key=>['schema_version','kind','week','range','source','reviews','pages','coverage_certified','publication_ready','warnings','summary'].includes(key)),
    'unsupported editorial report fields; do not save article bodies');
  assert.equal(report?.schema_version,1,'invalid Telerama editorial schema');
  assert.equal(report.kind,'telerama_editorial','invalid editorial supplement');
  assert.equal(report.week,week,'editorial supplement belongs to another week');
  assert.equal(weekForSaturday(from),week,'invalid target week');
  assert.deepEqual(report.range,{from,to:addDays(from,6)},'editorial range mismatch');
  assert.equal(report.publication_ready,false,'editorial opinion cannot certify publication');
  assert.equal(report.coverage_certified,false,'editorial opinion cannot certify coverage');
  const source=report.source;
  assert(string(source?.filename,500),'magazine filename required');
  assert.match(source?.sha256||'',/^[a-f0-9]{64}$/,'PDF fingerprint required');
  assert(Number.isInteger(source.bytes)&&source.bytes>0&&source.bytes<=100*1024*1024,'PDF size invalid');
  assert(Number.isInteger(source.pages)&&source.pages>0&&source.pages<=600,'PDF pages invalid');
  if(source.publication_date!=null)assert.equal(addDays(source.publication_date,0),source.publication_date,'publication date invalid');
  assert(Array.isArray(report.pages)&&Array.isArray(report.reviews)&&report.reviews.length<=2000,'bounded daily reviews required');
  const pages=new Map(),ids=new Set();
  for(const page of report.pages){
    assert(Number.isInteger(page.pdf_page)&&page.pdf_page>=1&&page.pdf_page<=source.pages&&!pages.has(page.pdf_page),'invalid editorial page');
    assert(Number.isFinite(page.width)&&Number.isFinite(page.height)&&page.width>0&&page.height>0,'page dimensions required');
    pages.set(page.pdf_page,page);
  }
  for(const row of report.reviews){
    assert(Object.keys(row).every(key=>allowed.has(key)),'unsupported review fields; do not save article bodies or converted scores');
    assert(string(row.id,100)&&!ids.has(row.id),'unique review id required');ids.add(row.id);
    assert(string(row.title,500)&&string(row.channel,150),'review title and channel required');
    if(row.reviewed_title!=null)assert(string(row.reviewed_title,500),'reviewed title invalid');
    assert.match(row.date||'',/^\d{4}-\d{2}-\d{2}$/,'civil date required');
    assert.equal(addDays(row.date,0),row.date,'civil date invalid');
    assert(row.date>=from&&row.date<=report.range.to,'review outside target week');
    assert.match(row.start||'',/^(?:[01]\d|2[0-3]):[0-5]\d$/,'review start invalid');
    assert.match(row.grid_date||'',/^\d{4}-\d{2}-\d{2}$/,'printed grid date required');
    assert(row.grid_date>=from&&row.grid_date<=report.range.to,'printed grid date outside target week');
    assert.equal(addDays(row.grid_date,row.start<'06:00'?1:0),row.date,'printed and civil dates disagree');
    assert.equal(row.in_daily_review_pages,true,'daily review provenance required');
    assert(Object.hasOwn(ratings,row.native_rating?.glyph_code||''),'unknown rating glyph');
    assert.deepEqual(row.native_rating,{glyph_code:row.native_rating.glyph_code,...ratings[row.native_rating.glyph_code]},'native Telerama mark invalid');
    assert(row.source_url==null&&row.checked_at==null,'paper opinion is not a fresh Web consultation');
    assert.equal(row.source_ref,'sha256:'+source.sha256,'opinion fingerprint mismatch');
    if(row.author!=null)assert(string(row.author,200),'author invalid');
    assert(typeof row.summary_reviewed==='boolean','summary review state required');
    if(row.review_summary!=null){
      assert(string(row.review_summary,700)&&row.summary_reviewed,'only short reviewed paraphrases may be saved');
      assert(string(row.author,200)&&string(row.summary_basis,500),'summary attribution and basis required');
      assert(Number.isFinite(Date.parse(row.summary_reviewed_at)),'actual summary review time required');
    }else assert(!row.summary_reviewed,'missing summary cannot be reviewed');
    const page=pages.get(row.pdf_page);assert(page,'review page is not traced');
    assert(Array.isArray(row.bbox)&&row.bbox.length===4&&row.bbox.every(Number.isFinite)&&row.bbox[0]>=0&&row.bbox[1]>=0&&row.bbox[2]>row.bbox[0]&&row.bbox[3]>row.bbox[1]&&row.bbox[2]<=page.width&&row.bbox[3]<=page.height,'review bounds invalid');
  }
  return report;
}
export function joinTeleramaEditorial(queue,context,options,range){
  if(options.useTelerama===false)return {};
  const reports=[],known=new Map();
  if(context.prepared_telerama_editorial)reports.push({report:context.prepared_telerama_editorial,provenance:{source_sha:context.sha,path:`data/editorial-inputs/${context.week}/telerama-editorial.json`,json_pointer:''}});
  reports.push(...(Array.isArray(options.editorialReports)?options.editorialReports:[]));
  if(!reports.length)return {};
  const candidates=[];
  for(const {report,provenance={source_sha:null,path:null,json_pointer:''}} of reports){
    validateTeleramaEditorial(report,context.week,range.from);
    if(known.has(report.source.sha256)){
      assert.deepEqual(known.get(report.source.sha256),report.reviews,'different editorial extraction requires review');continue;
    }
    known.set(report.source.sha256,report.reviews);
    report.reviews.forEach((review,index)=>{
      const titles=[review.title,review.reviewed_title].filter(Boolean).map(normalizedTitle);
      const matches=queue.filter(row=>row.observations.some(slot=>slot.date===review.date&&slot.start===review.start&&slot.channel===review.channel&&titles.includes(normalizedTitle(slot.title))));
      const hint={publisher:'Télérama',...review,source_publication_date:report.source.publication_date||null,
        provenance:{...provenance,json_pointer:(provenance.json_pointer||'')+`/reviews/${index}`},source_independence:null,identity_verified:false,selection_decision:false,
        matching_queue_ids:matches.map(row=>row.id),match_basis:matches.length?'exact_title_and_civil_slot':'unmatched_review_to_reconcile'};
      for(const row of matches)row.editorial_signals=[...(row.editorial_signals||[]),hint];
      candidates.push(hint);
    });
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date)||(b.native_rating.t_count??-1)-(a.native_rating.t_count??-1)||a.start.localeCompare(b.start));
  return {editorial_review_candidates:candidates,editorial_review_summary:{reviews:candidates.length,matched_reviews:candidates.filter(row=>row.matching_queue_ids.length).length,
    unmatched_reviews:candidates.filter(row=>!row.matching_queue_ids.length).length,reviewed_summaries:candidates.filter(row=>row.summary_reviewed).length,
    ordering:'Civil day, then native publisher appreciation for triage; queue order and editorial choice remain unchanged.',publication_ready:false}};
}
