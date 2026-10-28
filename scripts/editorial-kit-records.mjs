// Production kit, records side: review notes of the Télérama import, the
// grid transcription review, the shortlist with its compact evidence and the
// coverage passes. Decisions and their motives come from the producer's
// input files; the tool only matches them to saved slots and reviews.
import assert from 'node:assert/strict';
import {array, compact, dossierForWork, inventorySlot, isoInstant, norm, slug, teleramaReview} from './editorial-kit-common.mjs';
import {checkShortlist} from './editorial-progress.mjs';
import {compactRecordErrors} from './editorial-evidence.mjs';
import {coverageAuthorityErrors, inventoryReviewIndex} from './inventory-evidence.mjs';

const SUMMARY_MAX = 700;
// Apostrophe style and spacing are not title corrections; guillemets or words are.
const typography = value => String(value).replace(/[’']/g, "'").replace(/s+/g, ' ').trim();

// Reviewed notes {pdf_page, title, raw_title?, author, summary, basis?,
// reviewed_at?} written after reading each daily review. A note whose title
// differs from the extraction records it as reviewed_title, raw title kept.
export function mergeReviewNotes(raw, notes, {now}) {
  const report = structuredClone(raw), used = new Set(), unreviewed = [];
  const list = array(notes?.reviews);
  list.forEach((note, index) => {
    assert(Number.isInteger(note.pdf_page) && note.title && note.author && note.summary, `note ${index}: pdf_page, title, author and summary required`);
    assert(note.summary.length <= SUMMARY_MAX, `note ${index} (${note.title}): summary over ${SUMMARY_MAX} characters`);
  });
  for (const review of report.reviews) {
    const matches = list.map((note, index) => ({note, index})).filter(({note}) => note.pdf_page === review.pdf_page &&
      [note.raw_title, note.title].filter(Boolean).some(title => compact(title) === compact(review.title)));
    assert(matches.length <= 1, `review p. ${review.pdf_page} « ${review.title} » matches ${matches.length} notes`);
    if (!matches.length) {unreviewed.push(`p. ${review.pdf_page} ${review.title}`); continue;}
    const {note, index} = matches[0];
    used.add(index);
    let basis = note.basis || `Lecture visuelle de la critique et de son en-tête, PDF fourni p. ${review.pdf_page} ; appréciation native et signature vérifiées, paraphrase originale.`;
    if (typography(note.title) !== typography(review.title)) {
      review.reviewed_title = note.title;
      if (!note.basis) basis += ' Titre de l’extraction corrigé après comparaison avec la page ; titre brut conservé.';
    }
    Object.assign(review, {author: note.author, review_summary: note.summary, summary_reviewed: true,
      summary_reviewed_at: note.reviewed_at || now, requires_title_review: false, summary_basis: basis});
  }
  const unused = list.filter((_, index) => !used.has(index)).map(note => `p. ${note.pdf_page} ${note.title}`);
  assert(!unused.length, 'notes matching no extracted review (fix the title or re-extract the page): ' + unused.join(' ; '));
  report.summary = {...report.summary, reviews: report.reviews.length, summaries_reviewed: report.reviews.filter(review => review.summary_reviewed).length};
  report.warnings = [...new Set([...array(report.warnings), ...array(notes?.warnings)])];
  return {report, unreviewed};
}

const parseExtracted = value => {
  if (value && typeof value === 'object') return value;
  const [date, start, channel, ...title] = String(value || '').split(' | ');
  return {date, start, channel, title: title.join(' | ')};
};
const previousDate = date => new Date(Date.parse(date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);

// The transcription review written after re-reading the PDF pages, applied to
// the inventory itself (corrections, additions with page and position) and
// recorded in coverage.grid_inventory.transcription_review.
export function applyGridReview(inventoryIn, coverageIn, review) {
  const inventory = structuredClone(inventoryIn), coverage = structuredClone(coverageIn), problems = [], globalChanges = [];
  assert(coverage.grid_inventory, 'coverage.grid_inventory missing: import the grid inventory first');
  assert(isoInstant(review.reviewed_at) && String(review.method || '').trim(), 'grid review needs reviewed_at and method');
  const template = inventory.days.flatMap(day => day.items).find(item => item.source_type === 'telerama_pdf');
  assert(template, 'inventory has no Télérama PDF row');
  let pageCorrections = 0, added = 0;
  for (const page of array(review.pages)) for (const misread of array(page.misreads)) {
    const extracted = parseExtracted(misread.extracted);
    const item = inventory.days.find(day => day.date === extracted.date)?.items
      .find(row => row.start === extracted.start && row.channel === extracted.channel && row.title === extracted.title);
    if (!item) {problems.push('misread not found in inventory: ' + JSON.stringify(extracted)); continue;}
    item.title = misread.correct.title; pageCorrections++;
  }
  // The same extraction faults elsewhere in the grid, as listed by the reviewer.
  const rules = array(review.replacements).map(rule => [new RegExp(rule.find, rule.flags || 'gu'), rule.replace]);
  if (review.fix_broken_hyphenation) rules.push([/(\p{L})- (\p{L})/gu, '$1-$2']);
  for (const day of inventory.days) for (const item of day.items) {
    let title = item.title;
    for (const [pattern, replacement] of rules) title = title.replace(pattern, replacement);
    if (title !== item.title) {globalChanges.push(`${day.date} ${item.start} ${item.channel} : « ${item.title} » → « ${title} »`); item.title = title;}
  }
  const additions = [...array(review.sampled_rows).filter(row => row.decision === 'added'), ...array(review.pages).flatMap(page => array(page.omissions))];
  for (const row of additions) {
    const day = inventory.days.find(entry => entry.date === row.date);
    assert(day, 'added row outside the inventory dates: ' + row.date);
    assert(Number.isInteger(row.pdf_page) && Array.isArray(row.bbox) && row.bbox.length === 4, `added row ${row.date} ${row.start} ${row.title}: pdf_page and bbox required`);
    if (day.items.some(item => item.start === row.start && item.channel === row.channel && item.title === row.title)) continue;
    const overnight = /^0[0-5]:/.test(row.start);
    day.items.push({title: row.title, start: row.start, channel: row.channel, source: template.source, source_type: 'telerama_pdf',
      source_ref: template.source_ref, pdf_page: row.pdf_page, bbox: row.bbox, printed_page: row.printed_page ?? row.pdf_page,
      grid_date: overnight ? previousDate(row.date) : row.date, overnight});
    day.items.sort((a, b) => a.start.localeCompare(b.start) || a.channel.localeCompare(b.channel, 'fr'));
    added++;
  }
  let rows = 0;
  for (const day of inventory.days) {
    const counts = {};
    for (const item of day.items) counts[item.channel] = (counts[item.channel] || 0) + 1;
    day.channel_counts = Object.fromEntries([...new Set([...Object.keys(day.channel_counts || {}), ...Object.keys(counts)])].map(channel => [channel, counts[channel] || 0]));
    const keys = new Set();
    for (const item of day.items) {
      const key = [item.title.toLowerCase(), item.channel, item.start].join('|');
      if (keys.has(key)) problems.push(`duplicate row ${day.date} ${key}`);
      keys.add(key);
    }
    rows += day.items.length;
  }
  const grid = coverage.grid_inventory;
  grid.rows = rows;
  const conflicts = array(review.slot_conflicts).map(conflict => `Créneau à deux titres ${conflict.channel} ${conflict.date} ${conflict.start} ` +
    `(${array(conflict.titles).join(' / ')}) : ${String(conflict.printed || '').trim()} ${conflict.decision || (conflict.resolution === 'keep both' ? 'Les deux lignes sont conservées.' : conflict.resolution || '')}`.trim());
  grid.transcription_review = {reviewed_at: new Date(review.reviewed_at).toISOString(), method: review.method,
    pages_reread: review.pages_reread || array(review.pages).map(page => page.pdf_page),
    sampled_rows: array(review.sampled_rows).map(({date, pdf_page, title, start, channel, decision, note, extracted_title, bbox}) =>
      ({date, pdf_page, title, start, channel, decision, ...(note ? {note} : {}), ...(extracted_title ? {extracted_title} : {}), ...(bbox ? {bbox} : {})})),
    discrepancies: [...array(review.discrepancies ?? review.discrepancies_fr),
      ...(rules.length ? [`Passe de correction appliquée à l’inventaire entier pour les mêmes défauts d’extraction${review.replacements_label ? ` (${review.replacements_label})` : ''} hors pages relues : ${globalChanges.length} titres corrigés.`] : []),
      ...conflicts, ...(review.impact_review ? [review.impact_review] : [])],
    corrections_applied: {page_corrections: pageCorrections, global_corrections: globalChanges.length, rows_added: added}};
  const authority = {source_ref: grid.source_ref};
  const errors = coverageAuthorityErrors(coverage, authority, {dates: inventory.days.map(day => day.date), index: inventoryReviewIndex(inventory, authority)});
  return {inventory, coverage, problems, errors, globalChanges};
}

const dayOfPool = poolId => poolId.match(/^(samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi)-selection$/)?.[1] || null;
// Every candidate of the draft's pools with its civil date when it has a slot.
export function poolCandidates(issue, dates) {
  return Object.entries(issue?.personalization?.pools || {}).flatMap(([poolId, pool]) => array(pool.candidates).map(candidate => {
    const day = dayOfPool(poolId);
    return {poolId, day, candidate, date: candidate.date || (day ? dates.dateOf(day) : null)};
  }));
}

const placementLabel = ({poolId, candidate}) => `${poolId} rang ${candidate.rank}${candidate.time ? ` (${candidate.time} ${candidate.channel})` : ''}`;

// Shortlist entries of the drafted cards, with their sourced signals, plus
// the producer's rejections and deferrals; compact identity and broadcast
// records. Saved entries the tool does not rebuild are kept.
export function buildShortlist(context, {decisions = {}, dossiers = [], sameChannel, checked, now}) {
  const {week, dates, issue, works, editorial, editorialSha, inventory, pdfSha, research} = context;
  const byId = new Map(works.map(work => [work.id, work]));
  const entries = [], records = [], problems = [];
  const reviewPath = `data/editorial-inputs/${week}/telerama-editorial.json`;
  for (const {poolId, day, candidate, date} of poolCandidates(issue, dates)) {
    const work = byId.get(candidate.work_id);
    const titles = [candidate.title, ...array(work?.aliases)];
    const signals = [];
    const review = candidate.time ? teleramaReview(editorial, {date, time: candidate.time, channel: candidate.channel, titles}, sameChannel) : null;
    if (review && editorialSha) {
      const r = review.review;
      signals.push({kind: 'provided_magazine_criticism', note: `Télérama « ${r.native_rating?.label} »${r.author ? ` (${r.author})` : ''} : ${r.review_summary || ''}`.slice(0, 400),
        publisher: 'Télérama', source_ref: r.source_ref, pdf_page: r.pdf_page, bbox: r.bbox,
        provenance: {source_sha: editorialSha, path: reviewPath, json_pointer: '/reviews/' + review.index}});
    }
    const dossier = dossierForWork(dossiers, work, {keys: ['works']});
    for (const signal of array(dossier?.critical_signals).filter(signal => signal.source_url).slice(0, 2)) {
      signals.push({kind: signal.kind || 'critique', note: String(signal.note).slice(0, 300), source_url: signal.source_url});
    }
    if (!signals.length && candidate.signal && candidate.signal_source_url) signals.push({kind: 'popularity_signal', note: candidate.signal, source_url: candidate.signal_source_url});
    if (!signals.length && candidate.added && candidate.added_source_url) signals.push({kind: 'hd_edition', note: candidate.added, source_url: candidate.added_source_url});
    if (!signals.length) problems.push(`${poolId} ${candidate.work_id}: aucun signal sourcé (critique Télérama du créneau, dossier ou signal de rubrique)`);
    entries.push({id: `sl-${poolId}-${candidate.work_id}`, title: candidate.title, work_id: candidate.work_id, scope: day ? {day} : {rubrique: poolId},
      status: 'card_drafted', signals, decision_note: `${placementLabel({poolId, candidate})} ; carte rédigée le ${checked}.`});
    if (date && candidate.time && candidate.channel) {
      const slot = inventorySlot(inventory, {date, time: candidate.time, channel: candidate.channel, titles}, sameChannel);
      if (slot.item) records.push({work_id: candidate.work_id, url: `sha256:${pdfSha}#page=${slot.item.pdf_page}`, checked_at: now,
        field: 'broadcast.start', result: 'verified', value: candidate.time, applies_to: {date, channel: candidate.channel, start: candidate.time}});
      else if (poolId.endsWith('-selection') || poolId.startsWith('rendezvous-')) problems.push(`${poolId} ${candidate.work_id}: créneau ${date} ${candidate.time} ${candidate.channel} absent de l'inventaire (${slot.basis})`);
    }
  }
  for (const decision of array(decisions.shortlist)) {
    assert(decision.title && ['rejected', 'deferred'].includes(decision.status) && decision.note, 'shortlist decision needs title, status rejected|deferred and note');
    entries.push({id: 'sl-x-' + slug(decision.title), title: decision.title, ...(decision.work_id ? {work_id: decision.work_id} : {}),
      scope: decision.scope || {rubrique: 'pistes-ecartees'}, status: decision.status, signals: [], decision_note: decision.note});
  }
  // Identity: the exact page read by the research agent, at the dossier's real time.
  const undated = [];
  for (const id of new Set(entries.map(entry => entry.work_id).filter(Boolean))) {
    const work = byId.get(id), dossier = dossierForWork(dossiers, work, {keys: ['works']}), url = work?.links?.sc || work?.links?.official || work?.links?.imdb;
    if (!work || !url) continue;
    if (!isoInstant(dossier?._at)) {undated.push(id); continue;}
    records.push({work_id: id, url, checked_at: new Date(dossier._at).toISOString().replace(/\.\d+Z$/, 'Z'), field: 'identity', result: 'verified',
      value: `${work.year} · ${work.director || work.creator}`});
  }
  const rebuilt = new Set(entries.map(entry => entry.id));
  const saved = array(research?.shortlist?.entries).filter(entry => !rebuilt.has(entry.id));
  // Only a card entry of a pool this draft still has is stale; radar and hand-kept entries stay.
  const pools = Object.keys(issue?.personalization?.pools || {});
  const kept = saved.filter(entry => !['card_drafted', 'card_complete'].includes(entry.status) || !pools.some(id => entry.id.startsWith(`sl-${id}-`)));
  const dropped = saved.filter(entry => !kept.includes(entry)).map(entry => entry.id);
  const key = record => [record.work_id, record.field, record.url, JSON.stringify(record.applies_to || null)].join('|');
  const existing = array(research?.verification_records), known = new Set(existing.map(key));
  const fresh = records.filter(record => !known.has(key(record)) && known.add(key(record)));
  const next = {...structuredClone(research), shortlist: {...(research?.shortlist || {}), entries: [...kept, ...entries]},
    verification_records: [...existing, ...fresh], updated_at: now};
  const errors = [];
  try {checkShortlist(next);} catch (error) {errors.push(error.message);}
  fresh.forEach((record, index) => compactRecordErrors(record).forEach(error => errors.push(`record ${index}: ${error}`)));
  return {research: next, problems, errors, report: {entries: entries.length, kept: kept.length, dropped, new_records: fresh.length,
    broadcast_records: fresh.filter(record => record.field === 'broadcast.start').length,
    telerama_signals: entries.filter(entry => entry.signals.some(signal => signal.publisher === 'Télérama')).length, undated_identity: undated}};
}

const parseSlot = value => {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (.+)$/);
  return match ? {date: match[1], time: match[2], channel: match[3]} : null;
};

// Placements of a title or a slot in the draft's pools. A card titled in the
// original language also matches through the printed title of its slot.
function placements(candidates, {titles = [], slots = []}, sameChannel) {
  const wanted = titles.filter(Boolean).map(norm);
  return [...new Set(candidates.filter(({candidate, date, printed}) => [candidate.title, printed].some(title => title && wanted.includes(norm(title))) ||
    slots.some(slot => slot && slot.date === date && slot.time === candidate.time && sameChannel(slot.channel, candidate.channel)))
    .map(row => ({label: placementLabel(row), title: row.candidate.title})).map(JSON.stringify))].map(JSON.parse);
}

// Documentary pass and editorial reminder of data/coverage/YYYY-Sxx.json.
// Placements are matched in the pools; every other decision is a motive
// written by the producer (decisions.reasons, by title or /reviews/N).
export function buildCoveragePass(context, {docDossier, decisions = {}, checked, sameChannel}) {
  const {week, dates, issue, editorial, coverage, inventory} = context;
  const documentary = decisions.documentary || {};
  assert(String(documentary.scope || '').trim() && array(documentary.limits).length, 'decisions.documentary needs scope and limits');
  const candidates = poolCandidates(issue, dates).map(row => ({...row, printed: row.date && row.candidate.time ? inventorySlot(inventory,
    {date: row.date, time: row.candidate.time, channel: row.candidate.channel, titles: [row.candidate.title]}, sameChannel).item?.title : null}));
  const reasons = new Map(Object.entries(decisions.reasons || {}).map(([key, value]) => [key.startsWith('/reviews/') ? key : norm(key), value]));
  const open = [];
  const docWorks = array(docDossier?.works).map(work => {
    const titles = [work.query, work.identity?.title_fr];
    return {work, placed: placements(candidates, {titles, slots: array(work.slots).map(parseSlot)}, sameChannel)};
  });
  const retained = docWorks.filter(row => row.placed.length).map(({work, placed}) => ({title: work.query, placements: placed.map(p => p.label)}));
  const examined = docWorks.filter(row => !row.placed.length && row.work.role !== 'proposition').map(({work}) => {
    const decision = reasons.get(norm(work.query)) || reasons.get(norm(work.identity?.title_fr)) || null;
    if (!decision) open.push(`documentaire « ${work.query} »`);
    return {title: work.query, slots: array(work.slots), decision};
  });
  const proposals = docWorks.filter(row => row.work.role === 'proposition').map(({work}) =>
    ({title: work.query, availability: work.availability || null, signals: array(work.critical_signals).map(signal => ({note: signal.note, source_url: signal.source_url}))}));
  const daily = candidates.filter(row => row.poolId.endsWith('-selection')).map(row => row.candidate);
  const docs = daily.filter(candidate => candidate.quality === 'DOC');
  const reviews = array(editorial?.reviews);
  const reminder = reviews.map((review, index) => {
    const title = review.reviewed_title || review.title;
    const placed = placements(candidates, {titles: [title, review.title], slots: [{date: review.date, time: review.start, channel: review.channel}]}, sameChannel);
    const renamed = placed.find(p => norm(p.title) !== norm(title));
    const decision = placed.length ? 'retenu : ' + placed.map(p => p.label).join(' ; ') + (renamed ? `, sous le titre « ${renamed.title} »` : '')
      : reasons.get('/reviews/' + index) || reasons.get(norm(title)) || null;
    if (!decision) open.push(`critique /reviews/${index} « ${title} » (${review.native_rating?.label}, ${review.date} ${review.start} ${review.channel})`);
    return {review: '/reviews/' + index, title, rating: review.native_rating?.label, slot: `${review.date} ${review.start} ${review.channel}`, decision};
  });
  const next = structuredClone(coverage);
  next.documentary_pass = {checked_at: checked, scope: documentary.scope, sources_consulted: array(docDossier?.sources_consulted), retained,
    examined_not_retained: examined, additional_proposals: proposals, also_noted: array(docDossier?.other_leads), limits: documentary.limits,
    distribution: {daily_cards: daily.length, daily_distinct_works: new Set(daily.map(c => c.work_id)).size, documentary_cards: docs.length,
      documentary_distinct_works: new Set(docs.map(c => c.work_id)).size, ...(documentary.distribution_note ? {note: documentary.distribution_note} : {})}};
  const reviewed = reviews.filter(review => review.summary_reviewed).length;
  next.editorial_reminder = {checked_at: checked, source: `data/editorial-inputs/${week}/telerama-editorial.json (${reviewed} critiques relues` +
    `${decisions.reminder?.source_note ? ' ; ' + decisions.reminder.source_note : ''})`, decisions: reminder};
  return {coverage: next, open, report: {documentaries_retained: retained.length, documentary_cards: docs.length, reviews: reviews.length}};
}

// The week's research checkpoint at the start of a session: the publication
// requirements still to meet, written for this week's dates, PDF and public
// issue. Every item stays in remaining until its deliverable proves it.
export function initialResearch({week, range, baseSha, pdfSha, latest, now}) {
  assert.match(pdfSha || '', /^[a-f0-9]{64}$/, 'telerama.json with the PDF SHA-256 must be saved on the base first');
  const remaining = [
    `Constituer et sauvegarder l’inventaire primaire des sept jours du ${range} depuis la grille imprimée du Télérama fourni (mode telerama-grid-authority, empreinte sha256:${pdfSha}), avec au moins 30 lignes par jour, une ligne de nuit par jour, toutes les chaînes actives obligatoires, pages, comptes par chaîne, portée imprimée et limites consignées.`,
    'Effectuer et sauvegarder la revue de transcription par sondage de l’inventaire de grille (au moins 7 pages relues en entier, au moins 35 lignes dont 3 par jour, décisions matches/corrected/added, créneaux à deux titres relus) dans coverage.grid_inventory.transcription_review, puis la revue d’impact des conflits publiés.',
    'Effectuer le rappel éditorial et la prospection documentaire dédiée Arte, France 5, France 2/3/4, france.tv, TV5MONDE et autres sources pertinentes, avec offres linéaires/replay/exclusivités/expirations, décisions et preuves critiques exactes sauvegardées dans le bilan de couverture.',
    'Constituer puis tenir une présélection sourcée par jour et par rubrique, environ 1,5 à 2 fois les positions à pourvoir sans titre faible, en priorisant les appréciations Télérama positives importées et en conservant alternatives, rejets et reports.',
    'Vérifier complètement chaque choix, réserve, ligne de grille et proposition de rubrique au niveau 3 : identité et version, diffusion (grille Télérama relue sur son périmètre, sinon preuve Web admissible), disponibilité ou expiration, réception critique, métadonnées, notes ou raison spécifique, liens directs exacts et visuel réel.',
    'Produire trois choix développés par jour et au moins dix candidats complets distincts par jour, objectif quinze si la qualité le permet, avec synopsis et justification propres, pools de réserves publiables et toute pénurie structurée réellement sourcée.',
    'Compléter les rubriques obligatoires et leurs seuils sans remplissage faible : rendez-vous, replay, plateformes gratuites et abonnement film-first, sorties physiques et streaming, expirations et sommaire, avec pagination lisible et réserves effectives lorsqu’elles sont requises.',
    'Compléter les radars selon les seuils inchangés : popularité avec cinq choix, cinq cartes de sillonnage et au moins cinq réserves distinctes, puis radar 1080p avec dix choix visibles et une réserve distincte visant dix œuvres, sans compter les primaires comme réserves.',
    'Appliquer la déduplication, la fraîcheur inter-numéros et l’équilibre cinéma/documentaire/rubriques ; conserver toute exception de fraîcheur ou pénurie sous forme structurée, précise et sourcée.',
    `Construire et revoir tous les livrables autorisés de ${week}, ainsi que les enrichissements vérifiés de works, links et releases, en gardant manifest.latest à ${latest} et tous les statuts ${week} en draft.`,
    'Exécuter les contrôles pertinents de données, liens, fraîcheur, réserves, images et présentation sur la tête exacte, inspecter les pages modifiées, résoudre les causes réelles sans baisser les critères et conserver les résultats liés au SHA et à sa base.',
    'Après résolution réelle de remaining, effectuer la revue éditoriale complète des livrables, sceller les empreintes exactes, passer stage à ready, puis laisser la fusion candidate et la promotion protégées suivre leurs contrôles et leur publication vérifiée.'];
  return {schema_version: 1, week, stage: 'inventory', status: 'in_progress', base_sha: baseSha, remaining, completed_batches: [], blockers: [],
    research_attempts: [], verification_records: [], shortlist: {entries: []},
    resume: {candidate_branch: 'auto/' + week, main_sha: baseSha, first_incomplete_stage: 'inventory',
      next_actions: ['Construire l’inventaire de grille depuis le PDF Télérama et sa revue de transcription, puis la présélection.']},
    run_metrics: [], updated_at: now};
}
