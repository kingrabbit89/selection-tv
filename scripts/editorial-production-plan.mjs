// Read-only delta preparation. Saved facts are hints/evidence to review, never
// new consultations, editorial choices, complete cards or publication proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {htmlText} from './html-text.mjs';
import {normalizedTitle} from './editorial-work-packet.mjs';
import {addDays, weekForSaturday} from './week-calendar.mjs';
import {dailyReserveCandidates, sectionPageMatches} from './editorial-contracts.mjs';
import {validateTeleramaReport,teleramaExtractionContent} from './editorial-telerama-import.mjs';
import {joinTeleramaEditorial} from './editorial-telerama-signals.mjs';

const days = ['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'];
const array = value => Array.isArray(value) ? value : [];
const present = value => value !== null && value !== undefined && value !== '';
const token = value => String(value).replace(/~/g,'~0').replace(/\//g,'~1');
const stableFields = ['director','year','country','genre'];
const factFields = [...stableFields,'duration','image','ratings','ratings_unavailable_reason'];
const freshnessTitle = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const provenance = (sha,path,json_pointer,origin='git_snapshot') => ({source_sha:sha || null,path:path || null,json_pointer,origin});
const unique = values => [...new Set(values)];
const fieldsFor = field => field === 'director' ? ['director','directors','creator'] : field === 'country' ? ['country','countries'] : [field];
const recordId = (...values) => createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0,20);

function rangeFor(week, context, options) {
  const entry = array(context.manifest?.weeks).find(item => item.week === week);
  let from = options.from || context.from || context.currentissue?.from || context.issue?.from || entry?.from;
  if (!from) {
    const [year,number] = week.split('-S').map(Number);
    const jan4 = `${year}-01-04`, weekday = new Date(jan4+'T12:00:00Z').getUTCDay() || 7;
    from = addDays(jan4, 1-weekday+(number-1)*7-2);
  }
  assert.equal(weekForSaturday(from),week,'target range belongs to another week');
  return {from,to:addDays(from,6)};
}

function catalogueIndex(works) {
  const byId = new Map(), byTitle = new Map();
  for (const [index,work] of works.entries()) {
    const entry = {work,index};
    if (work.id) {
      assert(!byId.has(work.id),'duplicate canonical work ID: '+work.id);
      byId.set(work.id,entry);
    }
    for (const title of [work.title,...array(work.aliases)]) {
      const key = normalizedTitle(title); if (!key) continue;
      const entries = byTitle.get(key) || [];
      if (!entries.some(item => item.index === index)) entries.push(entry);
      byTitle.set(key,entries);
    }
  }
  return {byId,byTitle};
}

function identityFor(observation, index) {
  const candidates = index.byTitle.get(normalizedTitle(observation.title)) || [];
  if (observation.work_id) {
    const explicit = index.byId.get(observation.work_id);
    if (!explicit || !candidates.includes(explicit)) return {candidates,conflict:'explicit_work_id_does_not_match_title'};
    return {candidates:[explicit],explicit:true};
  }
  let narrowed = candidates;
  // Exact supplied identity fields can narrow a lead; they still need review.
  if (observation.year) narrowed = narrowed.filter(item => String(item.work.year) === String(observation.year));
  if (observation.director) narrowed = narrowed.filter(item => [item.work.director,item.work.creator,...array(item.work.directors)]
    .some(director=>normalizedTitle(director)===normalizedTitle(observation.director)));
  if (candidates.length && !narrowed.length) return {candidates,conflict:'supplied_identity_fields_disagree_with_catalogue'};
  return {candidates:narrowed,explicit:false};
}

function scopedTo(scope, observation, week) {
  if (!scope || typeof scope !== 'object') return true;
  if (scope.week && scope.week !== week) return false;
  const constraints = [[scope.date || scope.grid_date || scope.dates,observation.date],
    [scope.start || scope.starts,observation.start],[scope.channel || scope.channels,observation.channel],
    [scope.day,observation.day],[scope.version,observation.version]];
  return constraints.every(([expected,actual]) => !present(expected) || (Array.isArray(expected) ? expected.includes(actual) : expected === actual));
}

function namedMatch(item, group, names, ids) {
  const id = item.work_id || item.applies_to?.work_id || item.object?.work_id;
  if (id) return ids.has(id);
  return [item.title,item.applies_to?.title,item.object?.title,...array(item.applies_to?.titles)]
    .some(title => names.has(normalizedTitle(title)));
}

function namedLookup(rows,field) {
  const byId=new Map(),byTitle=new Map(),order=new Map();
  const add=(map,key,row)=>{if(!key)return;const values=map.get(key)||[];values.push(row);map.set(key,values);};
  rows.forEach((row,i)=>{
    order.set(row,i);const item=row[field],id=item.work_id || item.applies_to?.work_id || item.object?.work_id;
    if(id){add(byId,id,row);return;}
    for(const title of unique([item.title,item.applies_to?.title,item.object?.title,...array(item.applies_to?.titles)])) {
      add(byTitle,normalizedTitle(title),row);
    }
  });
  return (names,ids)=>unique([...ids].flatMap(id=>byId.get(id)||[]).concat([...names].flatMap(name=>byTitle.get(name)||[])))
    .sort((a,b)=>order.get(a)-order.get(b));
}

function pauseFor(attempt, observation, names, ids, week) {
  if (!/^(paused_|excluded_)/.test(attempt.status || '') || !namedMatch(attempt,null,names,ids)) return false;
  const object = attempt.object || {};
  if (!scopedTo(object,observation,week)) return false;
  const broadcastScoped = ['date','start','channel','day'].some(field => present(object[field]));
  if (!broadcastScoped && /excluded_/.test(attempt.status)) return false; // Excluded offer != all broadcasts.
  if (!broadcastScoped && (present(object.offer) || present(object.platform))) return false;
  if (!broadcastScoped && present(object.version)) return present(observation.version) && observation.version === object.version;
  return true;
}

function indexedRows(context) {
  const sha = context.sha, week = context.week, rows = [], dossiers = [], cards = [];
  array(context.research?.verification_records).forEach((record,index) => rows.push({record,
    provenance:provenance(sha,`data/research/${week}.json`,`/verification_records/${index}`)}));
  for (const [field,path] of [['research_dossiers',`data/research/${week}.json`],['dossiers',`data/research/${week}.json`]]) {
    array(context.research?.[field]).forEach((dossier,index) => dossiers.push({dossier,
      provenance:provenance(sha,path,`/${field}/${index}`)}));
  }
  for (const family of ['documentary_discovery','cinema_discovery']) {
    array(context.coverage?.[family]?.candidates).forEach((dossier,index) => dossiers.push({dossier,
      provenance:provenance(sha,`data/coverage/${week}.json`,`/${family}/candidates/${index}`)}));
  }
  const issues = [{entry:{week},issue:context.currentissue || context.issue,current:true},
    ...array(context.historicalissues || context.historicalIssues).map(item => ({...item,current:false}))];
  for (const {entry,issue,current} of issues) {
    if (!issue) continue;
    if (issue.week) assert.equal(issue.week,entry.week,'historical issue week mismatch');
    for (const [poolId,pool] of Object.entries(issue.personalization?.pools || {})) {
      array(pool.candidates).forEach((candidate,index) => cards.push({candidate,pool_id:poolId,current,week:entry.week,
        pool_target:Number(pool.target || 0),provenance:provenance(sha,`data/weeks/${entry.week}.json`,
          `/personalization/pools/${token(poolId)}/candidates/${index}`)}));
    }
    // Text exists outside pools too. Keep exact article offsets and page pointer.
    array(issue.pages).forEach((page,index) => {
      for (const match of String(page.html || '').matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)) {
        const title = htmlText(match[0].match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
        if (!title) continue;
        const work_id = match[0].match(/data-work-id=["']([^"']+)["']/)?.[1];
        cards.push({candidate:{title,work_id},html:match[0],html_offset:match.index,page_id:page.id,current,week:entry.week,
          provenance:provenance(sha,`data/weeks/${entry.week}.json`,`/pages/${index}/html`)});
      }
    });
  }
  return {rows,dossiers,cards,issues,findRows:namedLookup(rows,'record'),findDossiers:namedLookup(dossiers,'dossier'),
    findCards:namedLookup(cards,'candidate')};
}

function exposureIndex(issues, catalogue, lookback) {
  const result = new Map(), prior = issues.filter(item => !item.current && item.entry?.status !== 'draft').slice(0,lookback);
  const add = (title,week,scope) => {
    const key = freshnessTitle(title); if (!key) return;
    const values = result.get(key) || [];
    let value = values.find(item => item.week === week);
    if (!value) {value={week,scopes:[]}; values.push(value);}
    if (!value.scopes.includes(scope)) value.scopes.push(scope);
    result.set(key,values);
  };
  for (const {entry,issue} of prior) {
    if (!issue) continue;
    for (const page of array(issue.pages)) {
      if (/^rendezvous-/.test(page.id) || /-selection$/.test(page.id)) {
        for (const match of String(page.html || '').matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)) add(htmlText(match[1]),entry.week,'public');
      }
      if (/-grille(?:-2)?$/.test(page.id)) for (const match of String(page.html || '').matchAll(/<td class="prog">([^<]+)<\/td>/g)) add(htmlText(match[1]),entry.week,'public');
    }
    for (const candidate of dailyReserveCandidates(issue)) add(candidate.title,entry.week,'daily_reserve');
    const short = entry.short || entry.week?.split('-')[1];
    for (const work of catalogue) if (array(work.occurrences).some(item => item.week === short)) add(work.title,entry.week,'catalogue_occurrence_fallback');
  }
  return {prior,get:title => result.get(freshnessTitle(title)) || []};
}

function deficitsFor(context, range, options) {
  const issue = context.currentissue || context.issue || {}, personalization = context.personalization_config || {};
  const policy = options.daily_policy || personalization.reserve_readiness || {};
  const target = Number(policy.daily_target ?? personalization.daily_developed?.target ?? 3);
  const minimum = Number(policy.daily_total_minimum ?? personalization.daily_developed?.minimum_total_candidates ?? 10);
  assert(Number.isInteger(target) && target > 0 && Number.isInteger(minimum) && minimum >= target,'invalid daily production targets');
  const scopes = days.map((day,index) => {
    const id = day+'-selection', pool = issue.personalization?.pools?.[id], page = array(issue.pages).find(item => item.id === id);
    const publicCount = [...String(page?.html || '').matchAll(/<article\b[^>]*\bclass=["'][^"']*\bfeature\b[^"']*["']/g)].length;
    const candidates = array(pool?.candidates), reserveCount = candidates.filter(item => Number(item.rank)>target).length;
    return {scope:day,kind:'day',date:addDays(range.from,index),public_target:target,public_materialized:publicCount,
      missing_public:Math.max(0,target-publicCount),pool_minimum:minimum,pool_materialized:candidates.length,
      missing_pool:Math.max(0,minimum-candidates.length),reserve_materialized:reserveCount,
      shortage_recorded:Boolean(pool?.shortage_reason),note:'Rendered/pool counts are production facts, not complete-card certification.'};
  });
  for (const [id,target] of Object.entries(context.editorial_config?.quality_gates?.strict_section_targets || {})) {
    const pages = array(issue.pages).filter(page => sectionPageMatches(page.id,id));
    const count = pages.reduce((sum,page) => sum+[...String(page.html || '').matchAll(/<article\b/g)].length,0);
    scopes.push({scope:id,kind:'rubrique',public_target:Number(target),public_materialized:count,
      missing_public:Math.max(0,Number(target)-count),shortage_recorded:Boolean(issue.section_shortages?.[id]),
      note:'Section counts do not certify offers, quality or reserves.'});
  }
  return scopes;
}

export function buildProductionPlan(context, options={}) {
  const {week,sha} = context;
  assert.match(week || '',/^\d{4}-S\d{2}$/,'invalid week');
  assert.match(sha || '',/^[a-f0-9]{40}$/,'immutable source SHA required');
  const limit = options.limit ?? 12, offset = options.offset ?? 0;
  assert(Number.isInteger(limit) && limit>0 && limit<=200,'limit must be 1..200');
  assert(Number.isInteger(offset) && offset>=0,'offset must be nonnegative');
  for (const [name,value] of Object.entries({inventory:context.inventory,coverage:context.coverage,research:context.research,currentissue:context.currentissue || context.issue})) {
    if (value?.week) assert.equal(value.week,week,name+' belongs to another week');
  }
  const range = rangeFor(week,context,options), catalogue = array(context.works?.works || context.works);
  const index = catalogueIndex(catalogue), saved = indexedRows(context);
  const freshness = context.personalization_config?.freshness || context.freshness || {};
  const history = exposureIndex(saved.issues,catalogue,Number(freshness.history_lookback_issues || 4));
  const scopeDeficits = deficitsFor(context,range,options), observations = [], warnings = [];
  const add = (item,source) => {
    if (!item || !String(item.title || '').trim()) {warnings.push({reason:'observation_title_missing',provenance:source}); return;}
    const observation = {...item,start:item.start || item.time,provenance:source};
    const day = days[Array.from({length:7},(_,i)=>addDays(range.from,i)).indexOf(observation.date)];
    observation.day = day || null;
    const rubric = observation.scope?.rubrique || observation.rubrique;
    const intention = observation.editorial_intention === true;
    observation.scope_key = rubric || day || (intention && observation.scope?.day);
    if (!observation.scope_key || (observation.date && !day)) {warnings.push({reason:'observation_outside_target_week',date:observation.date,provenance:source}); return;}
    if (!rubric && !intention && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(observation.start || '') || !String(observation.channel || '').trim())) {
      warnings.push({reason:'observation_slot_incomplete',provenance:source}); return;
    }
    observations.push(observation);
  };
  array(context.inventory?.days).forEach((day,di)=>array(day.items).forEach((item,ii)=>add({...item,date:day.date},
    provenance(sha,`data/inventory/${week}.json`,`/days/${di}/items/${ii}`))));
  const supplied = options.observations || options.collectedObservations || context.collectedObservations || context.collected_observations || [];
  const suppliedSource = options.observations_provenance || context.observations_provenance || {};
  array(supplied).forEach((item,i)=>add(item,provenance(suppliedSource.source_sha,suppliedSource.path,`/observations/${i}`,'supplied_observations')));
  const paperSources=[],paperExtractions=new Map();
  const addPaperReport=(report,source)=>{
    validateTeleramaReport(report,week,range.from);
    const fingerprint=report.source.sha256,extraction=teleramaExtractionContent(report);
    if(paperExtractions.has(fingerprint)) {
      assert.deepEqual(paperExtractions.get(fingerprint),extraction,
        'this PDF has a different extraction; review the existing supplement before replacing it');
      return;
    }
    paperExtractions.set(fingerprint,extraction);
    report.observations.forEach((item,index)=>add(item,{...source,
      json_pointer:(source.json_pointer || '')+`/observations/${index}`,origin:'supplementary_pdf'}));
    paperSources.push({sha256:report.source.sha256,filename:report.source.filename,observations:report.observations.length,
      publication_date:report.source.publication_date || null,provenance:source,coverage_certified:false});
  };
  array(options.useTelerama===false?[]:context.research?.supplementary_sources).forEach((entry,index)=>{
    if(entry.kind==='telerama_pdf') addPaperReport(entry.report,
      provenance(sha,`data/research/${week}.json`,`/supplementary_sources/${index}/report`));
  });
  if(options.useTelerama!==false && context.prepared_telerama_report)
    addPaperReport(context.prepared_telerama_report,provenance(sha,`data/editorial-inputs/${week}/telerama.json`,''));
  array(options.useTelerama===false?[]:options.supplementaryReports).forEach(({report,provenance:source})=>addPaperReport(report,
    {source_sha:null,path:null,json_pointer:'',...source}));
  // Editorial intentions orient a scope. Null slots are deliberate, never
  // inferred broadcast times or evidence of an offer.
  array(context.research?.shortlist?.entries).forEach((entry,i)=>{
    if (['rejected','deferred'].includes(entry.status)) return;
    if (!entry.scope?.rubrique && observations.some(item=>item.scope_key===entry.scope?.day && normalizedTitle(item.title)===normalizedTitle(entry.title))) return;
    add({title:entry.title,work_id:entry.work_id,scope:entry.scope,date:null,start:null,channel:null,editorial_intention:true},
      provenance(sha,`data/research/${week}.json`,`/shortlist/entries/${i}`));
  });
  const slots = new Map();
  for (const observation of observations) {
    const key = JSON.stringify([observation.scope_key,observation.date,observation.start,observation.channel,String(observation.title).normalize('NFC').trim()]);
    const slot = slots.get(key) || {observation,origins:[],versions:[],ids:[],identity_hints:[]};
    slot.origins.push({source_url:observation.source_url || null,source_urls:array(observation.source_urls),checked_at:observation.checked_at || null,
      source_family:observation.source_family || null,source_independence:observation.source_independence ?? null,
      source_type:observation.source_type || null,source_id:observation.source_id || null,
      evidence_origin:observation.evidence_origin || null,evidence_pointer:observation.evidence_pointer || null,
      page_date:observation.page_date || null,provenance:observation.provenance});
    if(observation.source_type==='telerama_pdf') Object.assign(slot.origins.at(-1),{
      source_ref:observation.source_ref,pdf_page:observation.pdf_page,printed_page:observation.printed_page ?? null,
      bbox:observation.bbox,printed_date:observation.printed_date || null,date_basis:observation.date_basis || null,
      grid_date:observation.grid_date || null,overnight:observation.overnight ?? null,
      channel_printed:observation.channel_printed || observation.channel,genre_hint:observation.genre_hint || null,
      requires_title_review:observation.requires_title_review ?? true,
      broadcast_freshness_verified:false});
    if (observation.version) slot.versions.push(observation.version);
    if (observation.work_id) slot.ids.push(observation.work_id);
    slot.identity_hints.push(identityFor(observation,index));
    slots.set(key,slot);
  }
  // A brand/collection name at the same civil slot can contradict the saved
  // film title. This is event-scoped evidence, never a new catalogue alias.
  const events = new Map();
  for (const slot of slots.values()) {
    const o=slot.observation; if (o.editorial_intention) continue;
    const key=JSON.stringify([o.scope_key,o.date,o.start,o.channel]);
    const same=events.get(key)||[]; same.push(slot); events.set(key,same);
  }
  for (const [eventKey,eventSlots] of events) if (eventSlots.length>1) {
    const titles=unique(eventSlots.map(slot=>slot.observation.title));
    // Legitimate catalogue aliases still preserve both observations without
    // a title conflict when they identify the very same canonical work.
    const candidates=eventSlots.flatMap(slot=>slot.identity_hints.flatMap(hint=>hint.candidates));
    const candidateIds=unique(candidates.map(item=>item.work.id));
    const resolvedAlias=candidateIds.length===1 && eventSlots.every(slot=>slot.identity_hints.every(hint=>hint.candidates.length===1 && !hint.conflict));
    if (resolvedAlias) continue;
    for (const slot of eventSlots) {slot.event_key=eventKey;slot.event_titles=titles;slot.event_candidates=candidates;}
  }
  const groups = new Map();
  for (const slot of slots.values()) {
    const candidates = unique([...(slot.event_candidates || []),...slot.identity_hints.flatMap(hint=>hint.candidates)]);
    const id = candidates.length === 1 ? 'id:'+candidates[0].work.id : 'title:'+normalizedTitle(slot.observation.title);
    const key = slot.event_key ? 'event:'+slot.event_key : slot.observation.scope_key+'|'+id;
    const group = groups.get(key) || {key,title:slot.observation.title,scope:slot.observation.scope_key,candidates:[],slots:[]};
    for (const item of candidates) if (!group.candidates.some(existing => existing.index === item.index)) group.candidates.push(item);
    group.slots.push(slot); groups.set(key,group);
  }
  const attempts = array(context.research?.research_attempts), shortlist = array(context.research?.shortlist?.entries), queue = [];
  for (const group of groups.values()) {
    const ids = new Set(group.candidates.map(item=>item.work.id).filter(Boolean));
    const names = new Set([group.title,...group.candidates.flatMap(item=>[item.work.title,...array(item.work.aliases)])].map(normalizedTitle).filter(Boolean));
    const ambiguous = group.candidates.length>1;
    const matches = item => namedMatch(item,group,names,ids);
    const stableField = field => /^(?:title|original_title|director|directors|creator|year|country|countries|genre)(?:\.|$)/.test(field);
    const records = saved.findRows(names,ids).flatMap(item=>{
      const record=item.record;
      if(group.slots.some(slot=>scopedTo(record.applies_to,slot.observation,week)))return [item];
      const fields=record.stability==='stable'?array(record.fields).filter(stableField):[];
      if(!fields.length)return [];
      return [{...item,record:{...record,fields,fields_excluded_due_to_scope:array(record.fields).filter(field=>!stableField(field)),
        stable_identity_fields_reused_outside_original_scope:true}}];
    });
    const dossiers = saved.findDossiers(names,ids);
    const copies = saved.findCards(names,ids);
    const currentCards = copies.filter(item=>item.current && !item.html && [group.scope,group.scope+'-selection'].includes(item.pool_id));
    const blocked = group.slots.flatMap(slot=>attempts.filter(attempt=>pauseFor(attempt,slot.observation,names,ids,week))
      .map(attempt=>({date:slot.observation.date,start:slot.observation.start,channel:slot.observation.channel,
        status:attempt.status,attempt_id:attempt.id || null,resume_condition:attempt.resume_condition || null})));
    const allPaused = group.slots.every(slot=>blocked.some(item=>item.date===slot.observation.date && item.start===slot.observation.start && item.channel===slot.observation.channel));
    const conflicts = records.filter(({record})=>/conflict|contradict/.test(record.status || ''));
    const conflictingRequirements = [];
    if (ambiguous) conflictingRequirements.push('resolve_same_title_identity_or_remake');
    for (const slot of group.slots) {
      if(slot.event_titles) conflictingRequirements.push('resolve_scoped_event_title_conflict');
      if (slot.identity_hints.some(item=>item.conflict)) conflictingRequirements.push(...slot.identity_hints.map(item=>item.conflict).filter(Boolean));
      if (unique(slot.versions).length>1 || unique(slot.ids).length>1) conflictingRequirements.push('resolve_duplicate_slot_version_or_identity_conflict');
    }
    conflicts.forEach(({record})=>array(record.fields).forEach(field=>conflictingRequirements.push('resolve_saved_conflict:'+field)));
    const facts = [], texts = [], missing = [];
    for (const candidate of group.candidates) {
      for (const field of factFields) {
        const value = fieldsFor(field).map(key=>candidate.work[key]).find(present);
        if (!present(value)) continue;
        const evidence = records.filter(({record})=>array(record.fields).some(name=>fieldsFor(field).some(key=>name===key || name.startsWith(key+'.')))
          && (!ambiguous || record.work_id===candidate.work.id || record.applies_to?.work_id===candidate.work.id));
        facts.push({work_id:candidate.work.id,field,value,cache_kind:stableFields.includes(field)?'stable_metadata_hint':'dynamic_or_versioned_hint',
          certification:'not_certified_by_this_plan',checked_at:candidate.work[field+'_checked'] || null,
          provenance:provenance(sha,'data/works.json',`/works/${candidate.index}/${token(fieldsFor(field).find(key=>present(candidate.work[key])))}`),
          evidence:evidence.map(({record,provenance})=>({provenance,status:record.status,stability:record.stability || null,
            checked_at:record.checked_at || null,source_urls:array(record.source_urls)}))});
      }
    }
    for (const {dossier,provenance:source} of dossiers) {
      const identity = dossier.identity_research;
      if (identity) for (const field of [...stableFields,'duration']) {
        const keys = field==='duration'?['duration','duration_minutes','duration_observations']:fieldsFor(field);
        const key = keys.find(key=>present(identity[key])); if (!key) continue;
        facts.push({work_id:dossier.work_id || null,field,value:identity[key],cache_kind:'research_hint_needs_identity_version_review',
          certification:'not_certified_by_this_plan',
          checked_at:identity.checked_at || null,source_urls:array(identity.source_urls),
          provenance:{...source,json_pointer:source.json_pointer+'/identity_research/'+key}});
      }
    }
    for (const copy of copies.filter(item=>!item.html)) for (const field of factFields) {
      const key=fieldsFor(field).find(key=>present(copy.candidate[key])); if(!key)continue;
      facts.push({field,work_id:copy.candidate.work_id || null,value:copy.candidate[key],original_week:copy.week,
        cache_kind:'saved_card_hint_needs_identity_version_review',certification:'not_certified_by_this_plan',
        identity_scope:copy.candidate.work_id?'explicit_work_id':'unresolved_title_only',
        checked_at:copy.candidate[field+'_checked'] || null,
        provenance:{...copy.provenance,json_pointer:copy.provenance.json_pointer+'/'+key}});
    }
    for (const copy of copies) for (const field of ['summary','why','meta']) if (present(copy.candidate[field])) {
      texts.push({field,value:copy.candidate[field],work_id:copy.candidate.work_id || null,original_week:copy.week,
        current:copy.current,checked_at:copy.candidate[field+'_checked'] || null,
        provenance:{...copy.provenance,json_pointer:copy.provenance.json_pointer+'/'+field},
        reuse_condition:'Review identity/version and wording; prior-week text is not current broadcast/offer evidence.'});
    }
    for (const copy of copies.filter(item=>item.html)) texts.push({field:'article_html',...(options.compact?{value_omitted:true,characters:copy.html.length}:{value:copy.html}),original_week:copy.week,current:copy.current,
      provenance:copy.provenance,html_offset:copy.html_offset,reuse_condition:'Saved incomplete articles remain incomplete; strip/review old day, time and offer claims before reuse.'});
    if (!group.candidates.length) missing.push('establish_canonical_identity');
    for (const field of stableFields) if (!facts.some(fact=>fact.field===field)) missing.push('find_metadata:'+field);
    if (!facts.some(fact=>fact.field==='duration')) missing.push('find_exact_version_duration');
    if (!facts.some(fact=>fact.field==='image')) missing.push('find_exact_visual');
    if (!facts.some(fact=>['ratings','ratings_unavailable_reason'].includes(fact.field))) missing.push('find_ratings_or_document_specific_unavailability');
    const exactLinks = Object.entries(context.links?.links || {}).filter(([title])=>names.has(normalizedTitle(title)));
    if (!exactLinks.length && !group.candidates.some(item=>Object.keys(item.work.links || {}).length)) missing.push('find_exact_identity_link');
    if (!texts.some(item=>item.field==='summary') && !copies.some(item=>item.html)) missing.push('write_synopsis_from_saved_or_new_facts');
    if (!texts.some(item=>item.field==='why') && !copies.some(item=>item.html)) missing.push('write_editorial_justification_after_selection');
    const hasSaved = group.candidates.length || facts.length || dossiers.some(({dossier})=>dossier.identity_research || array(dossier.critical_evidence).length) || copies.length;
    const materialized = currentCards.some(({candidate})=>group.slots.some(slot=>candidate.time===slot.observation.start && candidate.channel===slot.observation.channel &&
      (!slot.observation.work_id || candidate.work_id===slot.observation.work_id))) ||
      (!days.includes(group.scope) && copies.some(item=>item.current && item.html && sectionPageMatches(item.page_id,group.scope)));
    const classification = allPaused?'paused_scoped':conflictingRequirements.length?'conflicted':materialized?'already_materialized':hasSaved?'reusable_needs_broadcast_review':'new_identity';
    const scopedShortlist=shortlist.filter(entry=>matches(entry) && (!entry.scope?.day || entry.scope.day===group.scope) &&
      (!entry.scope?.rubrique || entry.scope.rubrique===group.scope));
    const triageOnly=classification==='new_identity' && !scopedShortlist.some(entry=>!['rejected','deferred'].includes(entry.status));
    const dynamic = ['review_identity_match_and_exact_version','review_current_broadcast_sources_and_independence','image_health_preflight',
      'review_current_ratings_or_saved_specific_unavailability','editorial_selection_and_card_review'];
    for (const field of stableFields) if (facts.some(fact=>fact.field===field) && !facts.some(fact=>fact.field===field &&
      (array(fact.evidence).some(proof=>proof.stability==='stable' && /^verified(?:_|$)/.test(proof.status || '') && proof.source_urls.length) || array(fact.source_urls).length))) {
      dynamic.push('review_saved_field_provenance:'+field);
    }
    if (dossiers.some(({dossier})=>dossier.availability_research || dossier.offer)) dynamic.push('review_current_offer_territory_version_and_expiry_if_used');
    queue.push({id:'delta-'+recordId(week,group.key),scope:group.scope,title:group.title,classification,
      work_stage:triageOnly?'editorial_triage_before_full_enrichment':'preparation_or_review',
      enrichment_requirements_conditional_on_editorial_selection:triageOnly,
      next_actions:triageOnly?['editorial_triage_before_full_enrichment']:unique([...conflictingRequirements,...missing,...dynamic]),
      canonical_candidates:group.candidates.map(({work})=>({work_id:work.id,title:work.title,year:work.year,director:work.director || work.creator,
        identity_status:'saved_catalogue_lead_needs_confirmation'})),
      observations:group.slots.map(slot=>({title:slot.observation.title,date:slot.observation.date,start:slot.observation.start,channel:slot.observation.channel,
        editorial_intention:slot.observation.editorial_intention===true,versions:unique(slot.versions),source_records:slot.origins})),missing_requirements:unique(missing),dynamic_requirements:dynamic,
      scoped_event_title_conflicts:unique(group.slots.flatMap(slot=>slot.event_titles || [])),
      conflicting_requirements:unique(conflictingRequirements),cached_facts:facts,saved_texts:texts,
      saved_dossiers:dossiers.filter(({dossier})=>dossier.identity_research || array(dossier.critical_evidence).length || dossier.dossier_completeness)
        .map(({dossier,provenance})=>({title:dossier.title,work_id:dossier.work_id || null,status:dossier.status || dossier.decision || null,
          provenance,critical_evidence_count:array(dossier.critical_evidence).length})),
      saved_verification_records:records.map(({record,provenance})=>({fields:record.fields,status:record.status,stability:record.stability || null,
        fields_excluded_due_to_scope:record.fields_excluded_due_to_scope || [],
        stable_identity_fields_reused_outside_original_scope:record.stable_identity_fields_reused_outside_original_scope===true,
        checked_at:record.checked_at || null,source_urls:array(record.source_urls),applies_to:record.applies_to,provenance})),
      cached_links:exactLinks.map(([title,value])=>({title,value,certification:'not_certified_by_this_plan',
        provenance:provenance(sha,'data/links.json','/links/'+token(title))})),
      current_cards:currentCards.map(item=>({rank:item.candidate.rank,work_id:item.candidate.work_id,provenance:item.provenance})),
      historical_exposure:history.get(group.title),canonical_historical_exposure:group.candidates.map(item=>({work_id:item.work.id,exposure:history.get(item.work.title)})),
      shortlist:scopedShortlist,blocked_observations:blocked,
      facts_are_not_fresh_checks:true,automatic_selection:false});
  }
  const byScope = new Map(scopeDeficits.map(item=>[item.scope,item]));
  queue.sort((a,b)=>{
    const deficit = item => (byScope.get(item.scope)?.missing_public || 0)+(byScope.get(item.scope)?.missing_pool || 0);
    const declared = item => item.shortlist.some(entry=>!['rejected','deferred'].includes(entry.status))?1:0;
    const inactive = item => ['already_materialized','paused_scoped'].includes(item.classification)?1:0;
    const supplied = item => item.observations.some(observation=>observation.source_records.some(source=>source.provenance.origin==='supplied_observations'))?1:0;
    const triage = item => item.work_stage==='editorial_triage_before_full_enrichment'?1:0;
    return inactive(a)-inactive(b) || triage(a)-triage(b) || deficit(b)-deficit(a) || declared(b)-declared(a) || supplied(b)-supplied(a) || days.indexOf(a.scope)-days.indexOf(b.scope) || a.title.localeCompare(b.title);
  });
  const editorial=joinTeleramaEditorial(queue,context,options,range);
  const selected = options.scope ? queue.filter(item=>item.scope===options.scope) : queue;
  const byClassification = Object.fromEntries(['already_materialized','reusable_needs_broadcast_review','new_identity','conflicted','paused_scoped']
    .map(kind=>[kind,queue.filter(item=>item.classification===kind).length]));
  const report=options.sourceReport || {};
  const sourceResults=array(report.source_results).map(source=>({
    id:source.id,url:source.url,adapter:source.adapter,channel:source.channel,date:source.date,status:source.status,
    observations_count:source.observations_count,evidence:source.evidence?{fetched_at:source.evidence.fetched_at,
      sha256:source.evidence.sha256,mode:source.evidence.mode}:null,errors:array(source.errors),warnings:array(source.warnings)}));
  const derivedSourceGaps=sourceResults.filter(source=>source.status!=='parsed' || source.errors.length || source.warnings.length)
    .map(source=>({source_id:source.id,url:source.url,status:source.status,errors:source.errors,warnings:source.warnings,
      note:'A parsed source is an observation, not independent coverage certification.'}));
  return {schema_version:1,week,source_sha:sha,range,plan_kind:'delta_preparation',publication_ready:false,automatic_selection:false,
    policy:'Pointers and cached values preserve original proof dates. This plan never selects, updates facts, confirms independence, completes a card or replaces publication gates.',
    summary:{input_observations:observations.length,deduplicated_slots:slots.size,duplicate_slots_removed:observations.length-slots.size,
      excluded_observations:warnings.length,work_day_groups:queue.length,classification_counts:byClassification},scope_deficits:scopeDeficits,
    remaining_requirements:array(context.research?.remaining),source_gaps:[...array(report.gaps),...derivedSourceGaps],
    source_capture:{retrieval_performed:report.retrieval_performed ?? null,observed_at:report.observed_at || null,
      source_sha:report.source_sha || null,source_results:sourceResults,
      sources:array(report.sources),availability:report.availability || null,coverage_certified:false},warnings,
    freshness_policy:{...freshness,historical_weeks:history.prior.map(item=>item.entry.week),note:'Historical exposure is information, not automatic eligibility or disqualification.'},
    ...(paperSources.length?{supplementary_sources:paperSources}:{}),
    ...editorial,
    queue_order:'Preparation before raw-title triage; production deficits, explicitly saved shortlist, supplied observations, then day/title; materialized/paused last; no artistic ranking.',
    queue:selected.slice(offset,offset+limit),queue_total:selected.length,next_offset:offset+limit<selected.length?offset+limit:null};
}

export function productionContextFromGit(week,ref,cwd=process.cwd(),runGit) {
  assert.match(week || '',/^\d{4}-S\d{2}$/,'invalid week');
  assert(typeof ref==='string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) && !ref.includes('..'),'invalid ref');
  const git = runGit || (args=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));
  const sha = git(['rev-parse','--verify',ref+'^{commit}']).trim(); assert.match(sha,/^[a-f0-9]{40}$/);
  const available = new Set(git(['ls-tree','-r','--name-only',sha,'--','data']).trim().split('\n'));
  const rawCache=new Map();
  const raw = path => {
    if(!available.has(path))return null;
    if(!rawCache.has(path))rawCache.set(path,git(['show',sha+':'+path]));
    return rawCache.get(path);
  };
  const read = path => {const content=raw(path);return content===null?null:JSON.parse(content);};
  const manifest = read('data/manifest.json'), personalization_config = read('data/personalization-config.json');
  const lookback = Math.max(Number(personalization_config?.freshness?.history_lookback_issues || 4),Number(personalization_config?.freshness?.ranking_memory_issues || 8));
  const historicalissues = array(manifest?.weeks).filter(entry=>entry.week<week && entry.status!=='draft').slice(0,lookback)
    .map(entry=>({entry,issue:read(`data/weeks/${entry.week}.json`)})).filter(item=>item.issue);
  return {week,sha,manifest,personalization_config,editorial_config:read('data/editorial-config.json'),historicalissues,
    inventory:read(`data/inventory/${week}.json`),inventory_source_content:raw(`data/inventory/${week}.json`),
    coverage:read(`data/coverage/${week}.json`),research:read(`data/research/${week}.json`),research_source_content:raw(`data/research/${week}.json`),
    prepared_telerama_report:read(`data/editorial-inputs/${week}/telerama.json`),
    prepared_telerama_editorial:read(`data/editorial-inputs/${week}/telerama-editorial.json`),
    currentissue:read(`data/weeks/${week}.json`),works:read('data/works.json'),links:read('data/links.json')};
}

function main() {
  const [week,...args]=process.argv.slice(2); let ref,sources,out,limit=12,offset=0,scope,compact=false;
  for (let i=0;i<args.length;i++) {
    const flag=args[i]; if(flag==='--compact'){compact=true;continue;}
    const value=args[++i]; assert(value,'missing value for '+flag);
    if(flag==='--ref')ref=value; else if(flag==='--sources')sources=value; else if(flag==='--out')out=value;
    else if(flag==='--limit')limit=Number(value); else if(flag==='--offset')offset=Number(value); else if(flag==='--scope')scope=value;
    else throw Error('Unknown flag: '+flag);
  }
  assert(ref,'Usage: WEEK --ref SHA [--sources REPORT.json] [--out FILE] [--limit N] [--offset N] [--scope DAY] [--compact]');
  const context=productionContextFromGit(week,ref), report=sources?JSON.parse(fs.readFileSync(sources,'utf8')):null;
  if(report?.week)assert.equal(report.week,week,'source report belongs to another week');
  const plan=buildProductionPlan(context,{limit,offset,scope,compact,observations:array(report?.observations),sourceReport:report,
    observations_provenance:report?{path:sources,source_sha:report.source_sha}:undefined});
  const text=JSON.stringify(plan,null,compact?0:2)+'\n'; if(out)fs.writeFileSync(out,text);else console.log(text.trimEnd());
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main();
