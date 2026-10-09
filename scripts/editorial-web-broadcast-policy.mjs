// A review plan under the authorized Web contract. Counts of saved references
// are leads to review, never fresh consultation or independence certificates.
const fields=['title','channel','date','start'];
const array=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values)];
const validUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol);}catch{return false;}};
const dated=value=>typeof value==='string' && Number.isFinite(Date.parse(value));

export function webBroadcastPolicy(config,week){
  const policy=config?.web_schedule_evidence;
  if(policy?.mode!=='official_or_reviewed_concordance' || !/^\d{4}-S(?:0[1-9]|[1-4]\d|5[0-3])$/.test(policy.from_week || '') ||
    week<policy.from_week || policy.minimum_distinct_guides!==2 || !Array.isArray(policy.fields) ||
    policy.fields.length!==fields.length || !fields.every(field=>policy.fields.includes(field)))return null;
  return structuredClone(policy);
}

export function savedWebSourceDetails(observation){
  // Preserve only explicit saved claims. A hostname is not its publisher and
  // neither a parsed page nor a checked_at string proves a current reading.
  return {publisher:observation.publisher ?? observation.source_editor ?? null,
    source_label:observation.source ?? null,source_role:observation.source_role ?? null,
    grid_date:observation.grid_date ?? null,actually_read:observation.actually_read ?? observation.grid_read ?? null,
    shared_feed_key:observation.shared_feed_key ?? null,
    shared_feed_evidence:observation.shared_feed_evidence ?? null};
}

export function planWebBroadcastReview(slots,policy,{requirement_condition='if_selected_or_scoped_omission_review'}={}){
  if(!policy)return null;
  const observations=slots.filter(slot=>!slot.observation.editorial_intention).map(slot=>{
    const row=slot.observation;
    const references=slot.origins.filter(source=>source.source_type!=='telerama_pdf').map(source=>({
      source_urls:unique([source.source_url,...array(source.source_urls)].filter(validUrl)),
      publisher:source.publisher,source_role:source.source_role,source_family:source.source_family,
      checked_at:source.checked_at,page_date:source.page_date,grid_date:source.grid_date,
      actually_read:source.actually_read,shared_feed_key:source.shared_feed_key,
      shared_feed_evidence:source.shared_feed_evidence,source_independence:source.source_independence,
      provenance:source.provenance,certification:'saved_reference_needs_actual_current_grid_review'}));
    const datedReferences=references.filter(reference=>reference.source_urls.length && dated(reference.checked_at));
    const guides=datedReferences.filter(reference=>reference.source_role!=='official' && reference.source_family!=='official');
    const referenceGroups=[];
    for(const source of guides){
      const publisher=typeof source.publisher==='string' && source.publisher.trim()?source.publisher.trim():null;
      if(!publisher)continue;
      // A shared-feed assertion without its evidence still needs review. It
      // cannot silently merge sources or establish independence.
      const knownShared=typeof source.shared_feed_key==='string' && source.shared_feed_key.trim() &&
        typeof source.shared_feed_evidence==='string' && source.shared_feed_evidence.trim();
      const feed=knownShared?source.shared_feed_key.trim():null;
      const matches=referenceGroups.filter(group=>group.publishers.some(value=>value.toLocaleLowerCase('fr')===publisher.toLocaleLowerCase('fr')) ||
        feed && group.shared_feed_keys.includes(feed));
      const group=matches[0]||{publishers:[],references:[],shared_feed_keys:[],known_shared_feed:false};
      for(const other of matches.slice(1)){
        group.publishers.push(...other.publishers);group.references.push(...other.references);group.shared_feed_keys.push(...other.shared_feed_keys);
        group.known_shared_feed ||= other.known_shared_feed;referenceGroups.splice(referenceGroups.indexOf(other),1);
      }
      if(!matches.length)referenceGroups.push(group);
      group.publishers=unique([...group.publishers,publisher]);group.references.push(source);
      if(feed)group.shared_feed_keys=unique([...group.shared_feed_keys,feed]);
      group.known_shared_feed ||= Boolean(knownShared);
    }
    const official=datedReferences.filter(source=>source.source_role==='official' || source.source_family==='official');
    return {title:row.title,channel:row.channel,date:row.date,start:row.start,
      required_action:'review_current_web_broadcast_evidence',requirement_condition,
      saved_references:references,saved_dated_official_references:official,
      declared_guide_reference_groups:referenceGroups,declared_guide_reference_count:referenceGroups.length,
      route_candidates:[...(official.length?['exact_official_event_review']:[]),
        ...(referenceGroups.length>=policy.minimum_distinct_guides?['reviewed_concordant_guides']:[])],
      review_checks:['read_actual_current_grid','retain_original_consultation_dates','confirm_exact_title_channel_civil_date_start',
        'review_distinct_publishers_and_known_shared_feed','resolve_real_identity_version_or_event_conflicts'],
      upstream_provenance_requirement:'record_unknown_without_blocking_reviewed_concordance',
      source_independence_assessment:'record_separately_never_inferred_from_concordance',
      automatically_verified:false,automatic_selection:false};
  });
  return {mode:policy.mode,fields:[...fields],source_independence:'record_separately',
    accepted_routes:[{route:'exact_official_event_review',pieces:'one_exact_event_or_demonstrably_linked_official_pieces'},
      {route:'reviewed_concordant_guides',minimum_distinct_guides:policy.minimum_distinct_guides,
        requires:'distinct_publishers_actual_current_dated_readings_concordant_on_four_fields',
        known_shared_feed:'single_reference',unknown_feed_provenance:'record_without_blocking_concordance'}],
    official_corrections:'take_precedence_and_record_actual_correction',observations,
    raw_inventory_requirement_condition:'if_selected_or_scoped_omission_review',
    bounded_failure_action:'replace_with_verified_alternative_after_bounded_research',
    coverage_review:{kind:'dated_grid_comparison',scope:'all_days_required_channels_and_overnights',
      compare:'inventory_against_actual_dated_grid',other_guide:'use_when_accessible',
      unknown_provenance:'record_without_inventing_independence',full_week_completed:'only_after_actual_editorial_review',
      independent_flag:'false_when_provenance_unknown'},
    coverage_certified:false,publication_ready:false,automatically_verified:false};
}
