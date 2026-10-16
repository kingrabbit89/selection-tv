import test from 'node:test';
import assert from 'node:assert/strict';
import {GRID_AUTHORITY_MODE,gridAuthority,itemEvidenceError,sourceRefError,sourceDiversityError,
  coverageAuthorityErrors,inventoryReviewIndex,pageRef} from './inventory-evidence.mjs';

const sha='c'.repeat(64),ref='sha256:'+sha,authority={source_ref:ref};
const config={quality_gates:{telerama_grid_authority_from_week:'2026-S44'}};
const input={week:'2026-S44',source:{sha256:sha}};
const inventory={mode:GRID_AUTHORITY_MODE};
const pdfRow=(extra={})=>({title:'Le Samouraï',channel:'Arte',start:'20:55',source_type:'telerama_pdf',source_ref:ref,pdf_page:12,bbox:[10,20,90,27],...extra});

test('grid authority needs its mode, the enabled week and the saved Télérama input of the same week',()=>{
  assert.deepEqual(gridAuthority({week:'2026-S44',inventory:{mode:'inventory-first'},config,teleramaInput:input}),{authority:null,error:null});
  assert.deepEqual(gridAuthority({week:'2026-S44',inventory,config,teleramaInput:input}),{authority,error:null});
  assert.match(gridAuthority({week:'2026-S43',inventory,config,teleramaInput:{...input,week:'2026-S43'}}).error,/not enabled for 2026-S43/);
  assert.match(gridAuthority({week:'2026-S44',inventory,config:{},teleramaInput:input}).error,/not enabled/);
  assert.match(gridAuthority({week:'2026-S44',inventory,config,teleramaInput:null}).error,/editorial-inputs\/2026-S44\/telerama\.json/);
  assert.match(gridAuthority({week:'2026-S45',inventory,config,teleramaInput:input}).error,/another week/);
});

test('rows prove themselves by a Web page or, under authority, by the provided PDF page and position',()=>{
  assert.equal(itemEvidenceError({source_url:'https://www.arte.tv/fr/guide/20261024/'},null),null);
  assert.equal(itemEvidenceError(pdfRow(),null),'source_url missing');
  assert.equal(itemEvidenceError(pdfRow(),authority),null);
  assert.match(itemEvidenceError(pdfRow({source_ref:'sha256:'+'d'.repeat(64)}),authority),/another file/);
  assert.match(itemEvidenceError(pdfRow({source_type:'web'}),authority),/evidence missing/);
  assert.match(itemEvidenceError(pdfRow({pdf_page:0}),authority),/page missing/);
  assert.match(itemEvidenceError(pdfRow({bbox:[1,2,3]}),authority),/position missing/);
  assert.equal(sourceRefError(pageRef(authority,12),authority),null);
  assert.equal(sourceRefError('https://tv.test/a',null),null);
  assert.match(sourceRefError(pageRef(authority,12),null),/http/);
  assert.match(sourceRefError('sha256:'+'d'.repeat(64)+'#page=12',authority),/PDF page reference/);
  assert.match(sourceRefError(ref+'#page=0',authority),/PDF page reference/);
});

test('source diversity keeps two Web domains, or requires the provided PDF for an authority day',()=>{
  assert.equal(sourceDiversityError(['https://a.test/1',{url:'https://www.b.test/2'}],null),null);
  assert.match(sourceDiversityError(['https://a.test/1','https://a.test/2'],null),/two distinct source domains/);
  assert.match(sourceDiversityError([pageRef(authority,3),pageRef(authority,4)],null),/two distinct source domains/);
  assert.equal(sourceDiversityError([pageRef(authority,3),pageRef(authority,4)],authority),null);
  assert.equal(sourceDiversityError([pageRef(authority,3),'https://tv.test/cine'],authority),null,'Web complements stay allowed');
  assert.match(sourceDiversityError(['https://a.test/1','https://b.test/2'],authority),/cites no page/);
  assert.match(sourceDiversityError([pageRef(authority,3),'sha256:'+'d'.repeat(64)+'#page=3'],authority),/must be provided Télérama PDF pages/);
});

const dates=['2026-10-24','2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
function reviewedFixture() {
  const days=dates.map((date,d)=>({date,items:Array.from({length:6},(_,i)=>pdfRow({title:`Programme ${d}-${i}`,start:`${18+i}:00`,pdf_page:d+1}))}));
  const inv={mode:GRID_AUTHORITY_MODE,days};
  const sampled=days.flatMap(day=>day.items.slice(0,5).map(item=>({date:day.date,pdf_page:item.pdf_page,title:item.title,start:item.start,channel:item.channel,decision:'matches'})));
  const coverage={grid_inventory:{source_ref:ref,extraction_scope:'all-programmes',grid_pages:28,limits:['Soirée seulement imprimée : Action.'],
    transcription_review:{reviewed_at:'2026-10-21T10:00:00Z',method:'Pages relues entières à l’écran contre l’extraction.',pages_reread:[1,2,3,4,5,6,7],sampled_rows:sampled,discrepancies:[]}}};
  return {inv,coverage};
}

test('the sampled transcription review must exist, be tied to the inventory and state the printed limits',()=>{
  const {inv,coverage}=reviewedFixture(),index=inventoryReviewIndex(inv,authority);
  assert.deepEqual(coverageAuthorityErrors(coverage,authority,{dates,index}),[]);
  const errors=change=>{const value=structuredClone(coverage);change(value.grid_inventory);return coverageAuthorityErrors(value,authority,{dates,index}).join(' | ');};
  assert.match(coverageAuthorityErrors({},authority,{dates,index})[0],/grid_inventory missing/);
  assert.match(errors(g=>{g.transcription_review=null;}),/transcription_review missing/);
  assert.match(errors(g=>{g.source_ref='sha256:'+'d'.repeat(64);}),/source_ref mismatch/);
  assert.match(errors(g=>{g.extraction_scope='films-docs';}),/all-programmes/);
  assert.match(errors(g=>{g.limits=[];}),/printed scope/);
  assert.match(errors(g=>{g.transcription_review.sampled_rows=g.transcription_review.sampled_rows.slice(5);}),/at least 35 sampled rows.*2026-10-24/);
  assert.match(errors(g=>{g.transcription_review.sampled_rows[0].title='Titre inventé';}),/not in the inventory/);
  assert.match(errors(g=>{g.transcription_review.sampled_rows[0].decision='corrected';}),/needs a note/);
  assert.match(errors(g=>{g.transcription_review.sampled_rows[0].decision='skipped';}),/matches, corrected or added/);
  assert.match(errors(g=>{g.transcription_review.sampled_rows[1]={...g.transcription_review.sampled_rows[0]};}),/same row twice/);
  assert.match(errors(g=>{g.transcription_review.pages_reread=[1,2,3];}),/7 whole pages/);
  assert.match(errors(g=>{g.transcription_review.pages_reread=[1,2,3,4,5,6,99];}),/absent from the inventory/);
  assert.match(errors(g=>{g.transcription_review.reviewed_at='';}),/reviewed_at/);
  assert.match(errors(g=>{delete g.transcription_review.discrepancies;}),/discrepancies/);
  const corrected=structuredClone(coverage);
  Object.assign(corrected.grid_inventory.transcription_review.sampled_rows[0],{decision:'corrected',note:'Ligature perdue à l’extraction, titre relu sur la page.'});
  assert.deepEqual(coverageAuthorityErrors(corrected,authority,{dates,index}),[]);
});
