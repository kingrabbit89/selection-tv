// The user-supplied magazine is a schedule reference, not an identity,
// version, coverage or publication certificate. All observations stay intact.
import {normalizedTitle} from './editorial-work-packet.mjs';

const fields=['title','channel','date','start'];
const array=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values)];
const eventKey=row=>JSON.stringify([row.date,row.start,row.channel]);
const titleDayKey=row=>JSON.stringify([row.date,row.channel,normalizedTitle(row.title)]);

export function teleramaAuthorityPolicy(config) {
  const policy=config?.schedule_authority;
  if(policy?.provided_telerama_pdf!=='authoritative' || policy.scope!=='printed_entries_for_target_week' ||
    !Array.isArray(policy.fields) || policy.fields.length!==fields.length || !fields.every(field=>policy.fields.includes(field)))return null;
  return {...structuredClone(policy),fields:[...fields]};
}

export function teleramaGridReferences(slots) {
  const references=[];
  for(const slot of slots) for(const source of slot.origins) {
    // Only validated reports introduced by buildProductionPlan qualify. A
    // source-type label on an inventory/Web observation cannot activate this.
    if(source.source_type!=='telerama_pdf' || source.provenance?.origin!=='supplementary_pdf')continue;
    const row=slot.observation;
    const reference={title:row.title,channel:row.channel,date:row.date,start:row.start,
      sha256:source.source_ref?.replace(/^sha256:/,''),source_ref:source.source_ref,
      pdf_page:source.pdf_page,printed_page:source.printed_page,bbox:structuredClone(source.bbox),
      printed_date:source.printed_date,grid_date:source.grid_date,overnight:source.overnight,
      date_basis:source.date_basis,provenance:structuredClone(source.provenance),
      title_review_required:source.requires_title_review!==false,
      // The extraction's title-only flag is not proof that all four printed
      // fields were reviewed. Always request that explicit review.
      transcription_review_required:true,
      retained_card_day_review_required:row.scope_key==='vendredi' && new Date(row.date+'T12:00:00Z').getUTCDay()===6};
    if(!references.some(value=>JSON.stringify(value)===JSON.stringify(reference)))references.push(reference);
  }
  return references;
}

export function reviewTeleramaGrid(slots,policy) {
  if(!policy)return null;
  const references=teleramaGridReferences(slots);
  if(!references.length)return null;
  const pdfConflicts=[];
  const events=new Map(),titles=new Map();
  for(const reference of references) {
    const sameEvent=events.get(eventKey(reference))||[];sameEvent.push(reference);events.set(eventKey(reference),sameEvent);
    const sameTitle=titles.get(titleDayKey(reference))||[];sameTitle.push(reference);titles.set(titleDayKey(reference),sameTitle);
  }
  for(const values of events.values()) if(unique(values.map(row=>row.sha256)).length>1 && unique(values.map(row=>normalizedTitle(row.title))).length>1)
    pdfConflicts.push({kind:'different_pdf_titles_at_same_civil_slot',references:values});
  for(const values of titles.values()) {
    const byPdf=new Map();
    for(const row of values){const starts=byPdf.get(row.sha256)||[];starts.push(row.start);byPdf.set(row.sha256,starts);}
    if(byPdf.size>1 && unique([...byPdf.values()].map(starts=>JSON.stringify(unique(starts).sort()))).length>1)
      pdfConflicts.push({kind:'different_pdf_times_for_same_title_day_channel',references:values,
        same_event_established:false});
  }
  const observations=slots.map(slot=>{
    const row=slot.observation,exact=references.filter(reference=>eventKey(reference)===eventKey(row));
    const own=slot.origins.some(source=>source.source_type==='telerama_pdf' && source.provenance?.origin==='supplementary_pdf');
    const compatible=exact.length && exact.some(reference=>normalizedTitle(reference.title)===normalizedTitle(row.title));
    const printedReference=own || Boolean(compatible);
    return {title:row.title,channel:row.channel,date:row.date,start:row.start,
      covered_by_printed_pdf:printedReference,authoritative_references:exact,
      required_actions:printedReference?['review_telerama_grid_transcription_and_record_source']:['review_current_broadcast_sources_and_independence'],
      requirement_condition:printedReference?'if_this_printed_observation_is_used':'if_this_uncovered_observation_is_used',
      same_event_inferred:false};
  });
  const discrepancies=[];
  for(const slot of slots) {
    if(slot.origins.every(source=>source.source_type==='telerama_pdf' && source.provenance?.origin==='supplementary_pdf'))continue;
    const row=slot.observation,exact=references.filter(reference=>eventKey(reference)===eventKey(row));
    const differentTitle=exact.filter(reference=>normalizedTitle(reference.title)!==normalizedTitle(row.title));
    if(differentTitle.length)discrepancies.push({kind:'web_title_disagrees_with_printed_slot',
      observation:{title:row.title,channel:row.channel,date:row.date,start:row.start},references:differentTitle,
      review_action:'review_authoritative_pdf_grid_conflict',source_preference:'provided_telerama_pdf',automatic_identity_resolution:false});
    const differentTime=references.filter(reference=>titleDayKey(reference)===titleDayKey(row) && reference.start!==row.start);
    if(differentTime.length)discrepancies.push({kind:'web_time_differs_for_same_title_day_channel',
      observation:{title:row.title,channel:row.channel,date:row.date,start:row.start},references:differentTime,
      review_action:'compare_printed_grid_times',source_preference:'provided_telerama_pdf',same_event_established:false});
  }
  return {status:pdfConflicts.length?'conflicting_pdf_grids':'authoritative_pdf_reference',fields:[...fields],
    reference_scope:policy.scope,source_preference:pdfConflicts.length?null:'provided_telerama_pdf',
    later_official_corrections:policy.later_official_corrections,uncovered_scope:policy.uncovered_scope,
    references,transcription_review_required:references.some(reference=>reference.transcription_review_required),
    conflicting_pdf_grids:pdfConflicts,discrepancies,observation_requirements:observations,
    coverage_certified:false,broadcast_freshness_verified:false,automatic_certification:false,
    automatic_identity_resolution:false};
}

export function authoritativeTitleConflictAction(slot,review) {
  if(!review)return 'resolve_scoped_event_title_conflict';
  if(review.conflicting_pdf_grids.length)return 'review_conflicting_pdf_grids';
  const exact=review.references.filter(reference=>eventKey(reference)===eventKey(slot.observation));
  return exact.length && unique(exact.map(reference=>normalizedTitle(reference.title))).length===1?
    'review_authoritative_pdf_grid_conflict':'resolve_scoped_event_title_conflict';
}
