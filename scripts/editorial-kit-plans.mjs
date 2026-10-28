// Production kit, plan side: turns the producer's decisions (work plan,
// authored copy, section choices) and the saved evidence into plans for
// scripts/editorial-draft-cards.mjs. Every text of a card comes from an input
// file; the review notes only state the provenance the tool itself matched.
import assert from 'node:assert/strict';
import {array, canonicalNote, dossierForWork, evidenceUrls, inventorySlot, isRemote, norm, planEnvelope, remoteImage,
  teleramaReview, workForDossier} from './editorial-kit-common.mjs';
import {sectionKinds} from './editorial-draft-cards.mjs';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const authored = (copy, field, label) => {
  const value = text(copy?.[field]);
  assert(value, `${label}: authored ${field} missing in the copy files`);
  return value;
};
// The work override a card needs: a localized poster renders from its remote original.
const workOverride = (work, copy) => {
  const image = remoteImage(work);
  const override = {...(copy?.work || {}), ...(image ? {image} : {})};
  return Object.keys(override).length ? {work: override} : {};
};
const reviewWith = (base, copy) => ({...base, ...(copy?.review || {})});
const dossierDate = (dossier, checked) => /^\d{4}-\d{2}-\d{2}/.test(dossier?._at || '') ? dossier._at.slice(0, 10) : checked;

// Daily choices: primaries first, then reserves, in the producer's order.
// Ranks restart at 1 every day; an explicit rank keeps its place.
export function orderDailyRows(rows) {
  const byDay = new Map();
  for (const row of rows.filter(row => row.status !== 'duplicate')) {
    if (!byDay.has(row.date)) byDay.set(row.date, []);
    byDay.get(row.date).push(row);
  }
  const ordered = [];
  for (const date of [...byDay.keys()].sort()) {
    const list = byDay.get(date);
    const sorted = list.some(row => row.rank) ? [...list].sort((a, b) => (a.rank ?? 1e6) - (b.rank ?? 1e6))
      : [...list.filter(row => row.primary), ...list.filter(row => !row.primary)];
    sorted.forEach((row, index) => ordered.push({...row, rank: index + 1}));
  }
  return ordered;
}

export function buildDayPlan(context, {rows, copyFor, dossiers = [], sameChannel, displayChannel = channel => channel, checked, gridRanks = 8, issueNumber = null, onlyDays = [], replaceDays = []}) {
  const {week, sha, remaining, works, inventory, editorial, pdfSha} = context;
  assert.match(pdfSha || '', /^[a-f0-9]{64}$/, 'PDF SHA-256 of the saved Télérama grid required');
  const byId = new Map(works.map(work => [work.id, work]));
  const cards = [], problems = [], matches = {inventory: {}, reviews: {}};
  const count = (group, basis) => {matches[group][basis] = (matches[group][basis] || 0) + 1;};
  for (const row of orderDailyRows(rows)) {
    if (onlyDays.length && !onlyDays.includes(row.day)) continue;
    const label = `${row.day} ${row.time} ${row.channel} ${row.title}`;
    const work = byId.get(row.work_id), copy = work && copyFor(work.id, row.title, row.printed, work.title);
    if (!work || !copy) {problems.push(`${label}: ${!work ? `work ${row.work_id || '(sans identité)'} absent du catalogue au --ref` : 'texte de carte absent'}`); continue;}
    const titles = [row.printed, row.title, work.title, ...array(work.aliases)];
    const slot = inventorySlot(inventory, {date: row.date, time: row.time, channel: row.channel, titles}, sameChannel);
    count('inventory', slot.basis);
    if (!slot.item && !text(copy.review?.current_broadcast)) {
      problems.push(`${label}: créneau absent de l'inventaire (${slot.basis}) ; ajouter review.current_broadcast avec sa preuve ou corriger le choix`);
      continue;
    }
    const review = teleramaReview(editorial, {date: row.date, time: row.time, channel: row.channel, titles}, sameChannel);
    count('reviews', review?.basis || 'none');
    const dossier = dossierForWork(dossiers, work, {keys: ['works']});
    const page = slot.item?.pdf_page;
    const grid = text(copy.grid_reason ?? copy.grid);
    const card = {work_id: work.id, ...workOverride(work, copy), date: row.date, time: row.time,
      channel: row.display_channel || displayChannel(row.channel), rank: row.rank, quality: authored(copy, 'quality', label),
      summary: authored(copy, 'summary', label), why: authored(copy, 'why', label),
      ...(copy.links ? {links: copy.links} : {}),
      review: reviewWith({checked_at: checked, evidence_urls: evidenceUrls(work, dossier),
        identity_version: (dossier?.version_note ? dossier.version_note.slice(0, 400) + ' ' : '') +
          `Identité ${work.year} de ${work.director || work.creator}` + (page ? ` rapprochée de la ligne imprimée Télérama p. ${page}.` : '.'),
        canonical_fields: canonicalNote(work, checked),
        current_broadcast: slot.item ? `Grille du Télérama${issueNumber ? ' n° ' + issueNumber : ''} fourni (sha256:${pdfSha}#page=${page}) : ` +
          `${row.date} ${row.time} ${slot.item.channel}, ligne de l'inventaire « ${slot.item.title} »` +
          (inventory?.mode === 'telerama-grid-authority' ? ' ; la grille imprimée fait autorité sur son périmètre (mode telerama-grid-authority).' : '.') : undefined,
        editorial_copy: `Synopsis et justification rédigés le ${checked} à partir des fiches exactes et des signaux sourcés du dossier` +
          (review ? `, et de la critique Télérama ${review.review.summary_reviewed ? 'relue ' : ''}p. ${review.review.pdf_page} (/reviews/${review.index}).` : '.')}, copy)};
    if (grid && row.rank <= gridRanks) card.grid_reason = grid;
    cards.push(card);
  }
  const extra = {cards};
  if (replaceDays.length) extra.replace_days = replaceDays;
  return {plan: planEnvelope(week, sha, remaining, extra), report: {cards: cards.length, problems, matches}};
}

// A dossier entry named by file, key and query (exact, else a unique prefix).
export function findDossierEntry(dossiers, {dossier, key, query}) {
  const keys = Array.isArray(key) ? key : String(key || '').split(',').filter(Boolean);
  const pool = dossiers.filter(entry => (!dossier || entry._file === dossier) && (!keys.length || keys.includes(entry._key)));
  const exact = pool.filter(entry => norm(entry.query) === norm(query));
  const prefixed = exact.length ? exact : pool.filter(entry => norm(entry.query).startsWith(norm(query)));
  assert.equal(prefixed.length, 1, `dossier entry ${dossier || '*'}#${keys.join(',') || '*'} « ${query} » : ${prefixed.length} correspondance(s)`);
  return prefixed[0];
}

const kindWord = work => /s[ée]rie|minis[ée]rie/i.test(work.genre || '') ? 'Série' : /docu/i.test(work.genre || '') ? 'Documentaire' : 'Film';
const identityNote = (work, dossier) => `${kindWord(work)} ${work.year} de ${work.director || work.creator} : fiche exacte ` +
  `${work.links?.sc || work.links?.imdb || work.links?.official} rapprochée du dossier de recherche` +
  (dossier?.version_note ? ` ; ${dossier.version_note.slice(0, 300).replace(/\.$/, '')}.` : '.');

// Facts proper to each section kind, read from the dossier and overridable
// card by card. Returns the card fields and the current_broadcast note.
function sectionFacts(kind, dossier, spec, checked) {
  const read = dossierDate(dossier, checked);
  const offer = {...(dossier?.offer || dossier?.availability || {}), ...(spec.offer || {})};
  const offerCard = (...fields) => {
    assert(offer.service && isRemote(offer.url), `${kind}: offer.service et offer.url requis`);
    const result = {service: offer.service, url: offer.url, checked_at: offer.checked_at || read};
    for (const field of fields) if (offer[field] !== undefined && offer[field] !== null) result[field] = offer[field];
    return result;
  };
  const label = offer.label_on_page ? ` : « ${offer.label_on_page} »` : '';
  switch (kind) {
    case 'replay': {const o = offerCard('available_until'); return {fields: {offer: o}, url: o.url, note: `Page ${o.service} lue le ${o.checked_at}${label}.`};}
    case 'platform_free': {const o = offerCard('arrival_date'); return {fields: {offer: o}, url: o.url, note: `Page ${o.service} lue le ${o.checked_at}${label}.`};}
    case 'platform_subscription': case 'streaming_release': {
      const o = offerCard('arrival_date');
      const arrival = o.arrival_date ? ` ; arrivée datée du ${o.arrival_date}${offer.arrival_source ? ` (${offer.arrival_source})` : ''}` : '';
      return {fields: {offer: o}, url: o.url, note: `Offre ${o.service} lue le ${o.checked_at}${arrival}.`};
    }
    case 'expiring': {const o = offerCard('last_day'); return {fields: {offer: o}, url: o.url, note: `Page ${o.service} lue le ${o.checked_at}${label}.`};}
    case 'physical_release': {
      // The dossier's restoration is shown on the card; price and bonuses only when the producer writes them.
      const release = {...(dossier?.release || {}), ...(spec.release || {})};
      assert(release.date && isRemote(release.url), 'physical_release: release.date et release.url requis');
      const fields = {date: release.date, format: release.format, editor: release.editor, url: release.url, checked_at: release.checked_at || read};
      if (release.restoration) fields.restoration = release.restoration;
      for (const field of ['price', 'bonuses']) if (spec.release?.[field]) fields[field] = spec.release[field];
      return {fields: {release: fields}, url: release.url, note: `Sortie physique datée du ${release.date} lue le ${fields.checked_at} sur ${release.url}.`};
    }
    case 'radar_popularity': case 'radar_popularity_scan': {
      const signal = text(spec.signal) || text(dossier?.signal), source = spec.signal_source_url || dossier?.signal_source_url;
      assert(signal && isRemote(source), `${kind}: signal et signal_source_url requis`);
      return {fields: {signal, signal_source_url: source}, url: source, note: `Signal de circulation lu le ${read} sur ${source} : ${signal}.`};
    }
    case 'radar_hd': {
      const added = text(spec.added) || text(dossier?.added), source = spec.added_source_url || dossier?.added_source_url;
      assert(added && isRemote(source), 'radar_hd: added et added_source_url requis');
      return {fields: {added, added_source_url: source}, url: source, note: `Édition lue le ${read} sur ${source} : ${added}.`};
    }
    default: throw new Error('unsupported section kind for dossier facts: ' + kind);
  }
}

// Section pages with a reserve pool must carry their visible cards plus the
// reserve minimum of data/personalization-config.json, else validate-reserves fails.
export function sectionReserveMinimum(pageId, kind, target, pconfig) {
  for (const rule of Object.values(pconfig?.section_reserve_pools?.sections || {})) {
    if (pageId.startsWith(rule.page_id_prefix) && sectionKinds[kind]?.card === rule.card_type) return target + Number(rule.minimum_reserve_per_page || 0);
  }
  return null;
}

// Dossier keys written by the research agents for each section kind.
export const SECTION_KEYS = {replay: ['replay'], platform_free: ['platform_free'], platform_subscription: ['platform_subscription'],
  physical_release: ['physical_release'], streaming_release: ['streaming_release'], expiring: ['expiring'],
  radar_popularity: ['popularity', 'popularity_reserve'], radar_popularity_scan: ['popularity_scan'], radar_hd: ['hd', 'hd_reserve']};

const radarText = card => [card.summary, card.why, card.added || card.signal].join('').length;

export function buildSectionPlan(context, {spec, copyFor, dossiers = [], dayPlan = null, checked, pconfig = {}, settings = {}, existingPages = []}) {
  const {week, sha, remaining, works} = context;
  const byId = new Map(works.map(work => [work.id, work]));
  const warnings = [], sections = [];
  for (const section of array(spec.sections)) {
    const kind = sectionKinds[section.kind];
    assert(kind, 'unsupported section kind: ' + section.kind);
    const page = section.page ?? 1, pageId = kind.pageId(page);
    const cards = array(section.cards).map((entry, index) => {
      const rank = index + 1;
      if (section.kind === 'rendezvous') return rendezvousCard(entry, rank, {dayPlan, byId});
      const named = {...entry, dossier: entry.dossier ?? section.dossier, key: entry.key ?? section.key};
      const dossier = entry.query ? findDossierEntry(dossiers, named) : null;
      const found = entry.work_id ? {work: byId.get(entry.work_id)} : dossier ? workForDossier(works, dossier) : {};
      const work = found.work;
      assert(work, `${pageId} carte ${rank}: œuvre introuvable au --ref (${entry.work_id || entry.query}${found.clash ? ', homonymes ' + found.clash.join(', ') : ''})`);
      const source = dossier || dossierForWork(dossiers, work, {keys: SECTION_KEYS[section.kind] || [], file: named.dossier || null, strict: true});
      const copy = {...(copyFor(work.id, work.title, entry.query) || {}), ...entry};
      const label = `${pageId} ${work.id}`;
      const facts = sectionFacts(section.kind, source, copy, checked);
      return {work_id: work.id, ...workOverride(work, copy), rank, summary: authored(copy, 'summary', label), why: authored(copy, 'why', label),
        ...(['physical_release'].includes(section.kind) ? {quality: authored(copy, 'quality', label)} : {}), ...facts.fields,
        ...(copy.links ? {links: copy.links} : {}),
        review: reviewWith({checked_at: checked, evidence_urls: evidenceUrls(work, source, [facts.url]), identity_version: identityNote(work, source),
          canonical_fields: canonicalNote(work, checked), current_broadcast: facts.note,
          editorial_copy: `Résumé et justification rédigés le ${checked} à partir de la fiche exacte et des signaux sourcés du dossier.`}, copy)};
    });
    const target = section.target ?? Math.min(cards.length, kind.capacity);
    const minimum = sectionReserveMinimum(pageId, section.kind, target, pconfig);
    assert(minimum === null || cards.length >= minimum,
      `${pageId}: ${cards.length} cartes ; il en faut ${minimum} (cible ${target} + réserve minimale de data/personalization-config.json)`);
    if (kind.radar) {
      const limit = Number(settings.radar_card_max_chars || 500);
      for (const card of cards.filter(card => card.rank <= target)) if (radarText(card) > limit) warnings.push(`${pageId} ${card.work_id}: ${radarText(card)} caractères visibles (> ${limit}, risque de débordement)`);
    }
    const out = {kind: section.kind, page, target, header: section.header, cards};
    if (section.shortage_reason !== undefined) out.shortage_reason = section.shortage_reason;
    sections.push(out);
  }
  warnings.push(...radarDepthWarnings(sections, pconfig));
  const extra = {};
  if (sections.length) extra.sections = sections;
  for (const field of ['cover', 'render_toc', 'methode', 'section_shortages']) if (spec[field] !== undefined) extra[field] = spec[field];
  // --replace authorizes exactly the saved pages this plan renders again.
  const rerendered = sections.map(section => sectionKinds[section.kind].pageId(section.page)).filter(id => existingPages.includes(id));
  const replace = [...new Set([...array(spec.replace_pages), ...rerendered])];
  if (replace.length) extra.replace_pages = replace;
  return {plan: planEnvelope(week, sha, remaining, extra), report: {sections: sections.map(s => `${s.kind}#${s.page}: ${s.cards.length}`), warnings}};
}

// Rendezvous reuse the day cards already decided: same slot, copy and review.
function rendezvousCard(entry, rank, {dayPlan, byId}) {
  assert(dayPlan, 'rendezvous cards are taken from the day plan: pass --day-plan');
  const matches = array(dayPlan.cards).filter(card => card.work_id === entry.work_id && (!entry.date || card.date === entry.date));
  assert.equal(matches.length, 1, `rendezvous ${entry.work_id}${entry.date ? ' ' + entry.date : ''}: ${matches.length} carte(s) du jour ; préciser date`);
  const {grid_reason: _grid, work: dayWork, rank: _rank, ...card} = structuredClone(matches[0]);
  const work = byId.get(card.work_id);
  assert(work, 'rendezvous work missing from the catalogue: ' + card.work_id);
  const {image: _image, ...rest} = dayWork || {};
  const override = {...rest, ...(remoteImage(work) ? {image: remoteImage(work)} : {})};
  return {...card, ...(Object.keys(override).length ? {work: override} : {}), ...(entry.why ? {why: entry.why} : {}), rank};
}

// Informative: HD and popularity depth measured as distinct works, as
// docs/EDITORIAL-DRAFTS.md asks before saving.
export function radarDepthWarnings(sections, pconfig) {
  const warnings = [];
  const hd = sections.filter(section => section.kind === 'radar_hd');
  const hdMin = Number(pconfig?.radar_1080p?.minimum_total_candidates || 0);
  if (hd.length === 2 && hdMin) {
    const distinct = new Set(hd.flatMap(section => section.cards.map(card => card.work_id))).size;
    if (distinct < hdMin) warnings.push(`radar 1080p : ${distinct} œuvres distinctes sur les deux pages (< ${hdMin})`);
  }
  const main = sections.find(section => section.kind === 'radar_popularity'), scan = sections.find(section => section.kind === 'radar_popularity_scan');
  const popMin = Number(pconfig?.radar_popularity?.minimum_reserve_candidates || 0);
  if (main && popMin && main.shortage_reason === undefined) {
    const taken = new Set([...main.cards.filter(card => card.rank <= main.target), ...array(scan?.cards)].map(card => card.work_id));
    const reserves = new Set(main.cards.filter(card => card.rank > main.target && !taken.has(card.work_id)).map(card => card.work_id)).size;
    if (reserves < popMin) warnings.push(`radar popularité : ${reserves} réserves distinctes (< ${popMin}) sans shortage_reason`);
  }
  return warnings;
}
