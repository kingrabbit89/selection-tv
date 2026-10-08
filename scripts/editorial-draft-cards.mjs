// Mechanical rendering of explicitly reviewed editorial decisions. No research,
// ranking, invented metadata, promotion, or repository writes are performed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {addDays, weekForSaturday} from './week-calendar.mjs';
import {digest, planImport} from './editorial-handoff.mjs';
import {normalizedTitle} from './editorial-work-packet.mjs';
import {sectionPageMatches} from './editorial-contracts.mjs';

const days = ['samedi', 'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
const qualities = new Set(['MAJEUR', 'TRÈS FORT', 'PATRIMOINE', 'DOC', 'À VOIR', 'À REVOIR']);
const fields = new Set(['id','title','aliases','director','creator','year','country','genre','duration',
  'duration_source_url','image','image_type','image_source_url','image_checked','image_fallbacks',
  'image_strategy','ratings','ratings_checked','ratings_unavailable_reason','links',
  'summary','summary_source_url','summary_checked','why']);
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text = (value, name) => {assert(typeof value === 'string' && value.trim(), name+' is required'); return value.trim();};
const url = (value, name) => {
  const result = text(value, name), parsed = new URL(result);
  assert(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password, name+' must be an HTTP(S) URL');
  return result;
};
const date = (value, name) => {assert.match(value || '', /^\d{4}-\d{2}-\d{2}$/, name+' must be YYYY-MM-DD'); assert.equal(addDays(value,0),value,name+' invalid date'); return value;};
const sameTitle = (a,b) => normalizedTitle(a) === normalizedTitle(b);
const footer = short => `<div class="footer"><span>Sélection TV · ${escape(short)}</span><span>0</span></div>`;
const badge = quality => `<span class="badge ${escape(quality.replaceAll(' ','_'))}">${escape(quality)}</span>`;

export function renderFeature(candidate) {
  return `<article class="feature" data-title="${escape(candidate.title)}" data-work-id="${escape(candidate.work_id)}"><div class="visual"><img class="poster" src="${escape(candidate.image)}" alt="${escape(candidate.title)}"><div class="fallback">${escape(candidate.title)}</div></div><div style="margin-top:2mm">${badge(candidate.quality)}</div><h3>${escape(candidate.title)}</h3><div class="slot">${escape(candidate.time)} · ${escape(candidate.channel)}</div><div class="meta">${escape(candidate.meta)}</div><h4>Ce que ça raconte</h4><p>${escape(candidate.summary)}</p><div class="interest"><h4>Pourquoi c’est intéressant</h4><p>${escape(candidate.why)}</p></div></article>`;
}

export function renderGridRow(candidate, reason) {
  return `<tr><td class="time">${escape(candidate.time)}</td><td class="chan">${escape(candidate.channel)}</td><td class="prog">${escape(candidate.title)}</td><td class="reason">${escape(reason)}</td><td class="rep">${badge(candidate.quality)}</td></tr>`;
}

// Identity, canonical fields, exact links and the explicit review shared by
// every visual card type (daily, rubriques, radars).
export function reviewedWork(entry, catalogue, centralLinks) {
  assert(entry && typeof entry === 'object' && !Array.isArray(entry), 'invalid card');
  assert.match(entry.work_id || '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'explicit canonical work_id required');
  const matches = catalogue.filter(work => work.id === entry.work_id);
  assert(matches.length <= 1, 'duplicate canonical ID in catalogue');
  const existing = matches[0];
  const supplied = entry.work || {};
  for (const field of Object.keys(supplied)) assert(fields.has(field), 'work field not supported by this helper: '+field);
  if (supplied.id !== undefined) assert.equal(supplied.id, entry.work_id, 'work ID mismatch');
  if (existing && supplied.title !== undefined) assert.equal(supplied.title, existing.title, 'renaming a canonical work requires a separate identity reconciliation');
  const work = {...existing, ...supplied, id: entry.work_id};
  const title = text(work.title, 'canonical title');
  assert(existing || !catalogue.some(candidate => [candidate.title,...(candidate.aliases || [])].some(alias => sameTitle(alias,title))),
    'new ID would duplicate an existing catalogue title/alias; resolve identity first');
  const review = entry.review;
  assert(review && typeof review === 'object', 'explicit card review required');
  for (const field of ['identity_version','canonical_fields','current_broadcast','editorial_copy']) text(review[field], 'review.'+field);
  date(review.checked_at, 'review.checked_at');
  assert(Array.isArray(review.evidence_urls) && review.evidence_urls.length > 0, 'review evidence URLs required');
  review.evidence_urls.forEach(value => url(value, 'review evidence'));
  for (const field of ['country','genre','duration']) text(work[field], 'work.'+field);
  text(work.director || work.creator, 'director/creator');
  assert(/^\d{4}$/.test(String(work.year || '')), 'four-digit work.year required');
  url(work.image, 'work.image'); url(work.image_source_url, 'work.image_source_url'); date(work.image_checked, 'work.image_checked');
  if (work.ratings && Object.values(work.ratings).some(value => String(value).trim())) date(work.ratings_checked, 'work.ratings_checked');
  else text(work.ratings_unavailable_reason, 'specific ratings_unavailable_reason');
  const exactLinks = {...(centralLinks[title] || {}), ...(work.links || {}), ...(entry.links || {})};
  assert(Object.keys(exactLinks).length > 0, 'exact identity links required');
  Object.values(exactLinks).forEach(value => url(value, 'identity link'));
  const strong = /^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/tt\d+\/?$/.test(exactLinks.imdb || '') ||
    /^https:\/\/www\.themoviedb\.org\/(?:movie|tv)\/\d+(?:-[^?#/]+)?\/?$/.test(exactLinks.tmdb || '') ||
    /^https:\/\/www\.senscritique\.com\/(?:film|serie)\/[^?#]+\/\d+\/?$/.test(exactLinks.sc || '') ||
    (Boolean(exactLinks.official) && !/(?:tv-programme\.com|programme-tv\.com|programme-television\.org|linternaute\.com\/television|television\.telerama\.fr|forums\.lenodal\.com)/i.test(exactLinks.official));
  assert(strong, 'an exact strong identity link is required; a generic TV grid is insufficient');
  return {title, work, exactLinks, review: structuredClone(review)};
}

function reviewedCandidate(entry, catalogue, centralLinks, from) {
  const {title, work, exactLinks, review} = reviewedWork(entry, catalogue, centralLinks);
  const offset = Array.from({length:7},(_,index) => addDays(from,index)).indexOf(date(entry.date,'card.date'));
  assert(offset >= 0, 'broadcast date outside issue');
  assert.match(entry.time || '', /^(?:[01]\d|2[0-3]):[0-5]\d$/, 'card.time must be HH:MM');
  text(entry.channel, 'card.channel');
  assert(Number.isInteger(entry.rank) && entry.rank > 0, 'explicit positive editorial rank required');
  assert(qualities.has(entry.quality), 'explicit editorial quality required');
  const candidate = {title, work_id:work.id, rank:entry.rank, quality:entry.quality,
    time:entry.time, channel:entry.channel, meta:[work.year,work.director || work.creator,work.country,work.duration,work.genre].join(' · '),
    summary:text(entry.summary,'authored synopsis'), why:text(entry.why,'authored editorial justification'),
    image:work.image, links:exactLinks};
  if (work.ratings) candidate.ratings = work.ratings;
  if (entry.grid_reason !== undefined) text(entry.grid_reason, 'authored grid reason');
  return {candidate, work, exactLinks, review, day:days[offset], date:entry.date, grid_reason:entry.grid_reason};
}

// Non-daily rubriques reuse the S40/S41 page templates. Every card is an
// explicit, reviewed decision: identity, offer/release/signal facts, rank and
// authored copy are supplied by the producer and only rendered here.
const frDate = value => {const [y,m,d] = date(value,'date').split('-'); return `${d}/${m}/${y}`;};
const longDate = value => new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date(value,'date')+'T12:00:00Z'));
const dayLabel = value => new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',timeZone:'UTC'}).format(new Date(date(value,'date')+'T12:00:00Z'));
const metaLine = (work, withDuration = true) => [`Réalisation : ${work.director || work.creator}`, `Sortie : ${work.year}`, `Pays : ${work.country}`,
  ...(withDuration ? [`Durée : ${work.duration}`] : []), `Genre : ${work.genre}`].join(' · ');
const art = (cls, c, body) => `<article class="${cls}" data-title="${escape(c.title)}" data-work-id="${escape(c.work_id)}">${body}</article>`;
const offer = (value, name, {dateField} = {}) => {
  assert(value && typeof value === 'object', name+' is required');
  const result = {service: text(value.service, name+'.service'), url: url(value.url, name+'.url'), checked_at: date(value.checked_at, name+'.checked_at')};
  if (dateField) result[dateField] = date(value[dateField], name+'.'+dateField);
  return result;
};

export const sectionKinds = {
  rendezvous: {pageId:n => 'rendezvous-'+n, pages:2, capacity:5, topbar:'Les rendez-vous de la semaine',
    className:'page rendezvous-page', container:'week-grid week-grid-five', card:'week-card', tv:true, pool:true},
  replay: {pageId:n => 'replay-'+n, pages:3, capacity:3, topbar:'Sélection replay', className:'page replay-page', container:'list-2 replay-list', card:'list-card'},
  platform_free: {pageId:n => n === 1 ? 'plateformes-gratuites' : 'plateformes-gratuites-'+n, pages:3, capacity:3,
    topbar:'Plateformes gratuites', className:'page', container:'platform-grid', card:'platform'},
  platform_subscription: {pageId:n => n === 1 ? 'plateformes-abonnement' : 'plateformes-abonnement-'+n, pages:4, capacity:3,
    topbar:'Plateformes avec abonnement', className:'page subscription-page', container:'platform-grid', card:'platform'},
  physical_release: {pageId:n => n === 1 ? 'sorties-physiques' : 'sorties-physiques-'+n, pages:2, capacity:4,
    topbar:'Sorties physiques à retenir', className:'page release-page physical', container:'release-grid', card:'release-card', pool:true},
  streaming_release: {pageId:n => n === 1 ? 'sorties-streaming' : 'sorties-streaming-'+n, pages:2, capacity:4,
    topbar:'Nouvelles arrivées streaming', className:'page release-page streaming', container:'release-grid', card:'release-card'},
  expiring: {pageId:n => n === 1 ? 'avant-disparition' : 'avant-disparition-'+n, pages:2, capacity:5,
    topbar:'À voir avant disparition', className:'page release-page expiring', container:'expire-grid', card:'expire-card'},
  radar_popularity: {pageId:() => 'radar-torrent', pages:1, capacity:5, topbar:'Radar popularité torrent',
    className:'page release-page torrent-page', container:'torrent-grid', card:'torrent-card', radar:'popular_deep'},
  radar_popularity_scan: {pageId:() => 'radar-torrent-sillonnage', pages:1, capacity:5, topbar:'Radar popularité · sillonnage',
    className:'page release-page torrent-page', container:'torrent-grid', card:'torrent-card', radar:'popular_scan'},
  radar_hd: {pageId:n => 'radar-'+n, pages:2, capacity:5, topbar:'Radar 1080p', className:'page', container:'radar-grid', card:'radar-card', radar:'hd'}
};
export const pageOrder = ['couverture','sommaire','rendezvous-1','rendezvous-2','replay-1','replay-2','replay-3',
  'plateformes-gratuites','plateformes-gratuites-2','plateformes-gratuites-3','plateformes-abonnement','plateformes-abonnement-2',
  'plateformes-abonnement-3','plateformes-abonnement-4','sorties-physiques','sorties-physiques-2','sorties-streaming','sorties-streaming-2',
  'avant-disparition','avant-disparition-2','radar-torrent','radar-torrent-sillonnage','radar-1','radar-2',
  ...days.flatMap(day => [day+'-selection',day+'-grille',day+'-grille-2']),'methode'];

function sectionCard(kind, entry, catalogue, centralLinks, from) {
  const {title, work, exactLinks, review} = reviewedWork(entry, catalogue, centralLinks);
  assert(Number.isInteger(entry.rank) && entry.rank > 0, 'explicit positive editorial rank required');
  const base = {title, work_id: work.id, rank: entry.rank, summary: text(entry.summary, 'authored synopsis'),
    why: text(entry.why, 'authored editorial justification'), image: work.image, links: exactLinks};
  if (work.ratings) base.ratings = work.ratings;
  let candidate;
  if (kind.tv) {
    const offset = Array.from({length:7},(_,index) => addDays(from,index)).indexOf(date(entry.date,'card.date'));
    assert(offset >= 0, 'broadcast date outside issue');
    assert.match(entry.time || '', /^(?:[01]\d|2[0-3]):[0-5]\d$/, 'card.time must be HH:MM');
    assert(qualities.has(entry.quality), 'explicit editorial quality required');
    candidate = {...base, quality: entry.quality, date: entry.date, time: entry.time, channel: text(entry.channel, 'card.channel'),
      meta: [work.year, work.director || work.creator, work.country, work.duration, work.genre].join(' · ')};
  } else if (kind.card === 'list-card') {
    const o = offer(entry.offer, 'offer', {dateField: 'available_until'});
    candidate = {...base, service: o.service, offer_url: o.url, available_until: o.available_until, offer_checked: o.checked_at};
  } else if (kind.card === 'platform') {
    const o = offer(entry.offer, 'offer');
    if (entry.offer.arrival_date !== undefined) o.arrival_date = date(entry.offer.arrival_date, 'offer.arrival_date');
    candidate = {...base, service: o.service, offer_url: o.url, offer_checked: o.checked_at};
    if (o.arrival_date) candidate.arrival_date = o.arrival_date;
  } else if (kind.card === 'release-card' && kind.pool) {
    const r = entry.release; assert(r && typeof r === 'object', 'release is required');
    assert(qualities.has(entry.quality), 'explicit editorial quality required');
    candidate = {...base, quality: entry.quality, release_date: date(r.date, 'release.date'), format: text(r.format, 'release.format'),
      editor: text(r.editor, 'release.editor'), release_url: url(r.url, 'release.url'), release_checked: date(r.checked_at, 'release.checked_at'),
      release_label: `${longDate(r.date)} · ${r.format.trim()}`};
    for (const field of ['price','restoration','bonuses']) if (r[field] !== undefined) candidate[field] = text(r[field], 'release.'+field);
  } else if (kind.card === 'release-card') {
    const o = offer(entry.offer, 'offer', {dateField: 'arrival_date'});
    candidate = {...base, service: o.service, offer_url: o.url, arrival_date: o.arrival_date, offer_checked: o.checked_at};
  } else if (kind.card === 'expire-card') {
    const o = offer(entry.offer, 'offer', {dateField: 'last_day'});
    candidate = {...base, service: o.service, offer_url: o.url, last_day: o.last_day, offer_checked: o.checked_at};
  } else if (kind.card === 'torrent-card') {
    candidate = {...base, signal: text(entry.signal, 'authored signal'), signal_source_url: url(entry.signal_source_url, 'signal_source_url'),
      meta: metaLine(work, false)};
  } else {
    candidate = {...base, added: text(entry.added, 'authored added label'), added_source_url: url(entry.added_source_url, 'added_source_url'),
      meta: metaLine(work)};
  }
  return {candidate, work, exactLinks, review};
}

export function renderSectionCard(kind, c, index) {
  const img = `<img src="${escape(c.image)}" alt="Affiche de ${escape(c.title)}" loading="lazy">`;
  switch (kind.card) {
    case 'week-card': return art('week-card', c, `${img}<div style="margin-top:1.6mm">${badge(c.quality)}</div><h3>${escape(c.title)}</h3><div class="where">${escape(dayLabel(c.date))} · ${escape(c.time)} · ${escape(c.channel)}</div><p>${escape(c.why)}</p>`);
    case 'list-card': return art('list-card', c, `<div class="num">${String(index+1).padStart(2,'0')}</div><img class="section-thumb" src="${escape(c.image)}" alt="Visuel de ${escape(c.title)}" loading="lazy"><div><h3>${escape(c.title)}</h3><div class="where">${escape(c.service)} · disponible jusqu’au ${frDate(c.available_until)}</div><p>${escape(c.why)}</p></div>`);
    case 'platform': return art('platform has-visual', c, `<img class="platform-thumb" src="${escape(c.image)}" alt="Visuel de ${escape(c.title)}" loading="lazy"><div class="platform-copy"><div class="service">${escape(c.service)}</div><h3>${escape(c.title)}</h3>${c.arrival_date ? `<div class="date">${escape(longDate(c.arrival_date))}</div>` : ''}<p>${escape(c.why)}</p></div>`);
    case 'release-card': return c.release_label
      ? art('release-card', c, `<div class="rel-date">${escape(c.release_label)}</div><h3>${escape(c.title)}</h3><div class="rel-meta">${escape([c.editor, c.price].filter(Boolean).join(' · '))}</div><p>${escape(c.restoration || c.summary)}</p><div class="why-release"><b>Pourquoi cette sortie compte</b><p>${escape(c.why)}</p></div>`)
      : art('release-card', c, `<div class="rel-date">${escape(longDate(c.arrival_date))} · ${escape(c.service)}</div><h3>${escape(c.title)}</h3><p>${escape(c.why)}</p>`);
    case 'expire-card': return art('expire-card', c, `<span class="deadline">Dernier jour : ${escape(longDate(c.last_day))}</span><h3>${escape(c.title)}</h3><p>${escape(c.why)}</p><div class="program-actions"><a href="${escape(c.offer_url)}" target="_blank" rel="noopener" class="official">${escape(c.service)}</a></div>`);
    case 'torrent-card': return art('torrent-card', c, `${img}<div class="torrent-signal">${escape(c.signal)}</div><h3>${escape(c.title)}</h3><div class="torrent-meta">${escape(c.meta)}</div><p>${escape(c.summary)}</p><div class="why2"><b>Pourquoi le retenir</b><p>${escape(c.why)}</p></div>`);
    default: return art('radar-card', c, `${img}<div class="added">${escape(c.added)}</div><h3>${escape(c.title)}</h3><div class="meta2">${escape(c.meta)}</div><p>${escape(c.summary)}</p><div class="why2"><b>Pourquoi le retenir</b><p>${escape(c.why)}</p></div>`);
  }
}

function applySections(plan, ctx) {
  const {catalogue, centralLinks, pages, pools, issue, short, range, decisions, radar} = ctx;
  const decided = new Set();
  for (const spec of plan.sections || []) {
    const kind = sectionKinds[spec?.kind];
    assert(kind, 'unsupported section kind: '+spec?.kind);
    const page = spec.page ?? 1;
    assert(Number.isInteger(page) && page >= 1 && page <= kind.pages, spec.kind+' page must be 1..'+kind.pages);
    const id = kind.pageId(page);
    assert(!decided.has(id), 'section page decided twice: '+id); decided.add(id);
    assert(!pages.has(id) || plan.replace_pages?.includes(id), 'existing section page requires explicit replace_pages authorization: '+id);
    const header = spec.header || {};
    for (const field of ['kicker','h1','deck']) text(header[field], id+'.header.'+field);
    assert(Array.isArray(spec.cards) && spec.cards.length > 0, id+': explicit card decisions required');
    const cards = spec.cards.map(entry => sectionCard(kind, entry, catalogue, centralLinks, plan.from)).sort((a,b) => a.candidate.rank-b.candidate.rank);
    assert(cards.every((card,index) => card.candidate.rank === index+1), id+': ranks must be contiguous starting at 1');
    assert.equal(new Set(cards.map(card => card.candidate.work_id)).size, cards.length, id+': duplicate work');
    const reserves = Boolean(kind.pool || kind.radar === 'popular_deep' || kind.radar === 'hd');
    const target = spec.target ?? Math.min(cards.length, kind.capacity);
    assert(Number.isInteger(target) && target >= 1 && target <= kind.capacity, id+': target must be 1..'+kind.capacity);
    assert(reserves ? target <= cards.length : target === cards.length,
      id+(reserves ? ': target exceeds decisions' : ': every decision of this rubrique is visible; put further cards on another page'));
    const visible = cards.filter(card => card.candidate.rank <= target);
    pages.set(id, {id, className: kind.className, html: `<div class="topbar">${escape(kind.topbar)}<span class="issue">${escape(range)}</span></div><div class="kicker">${escape(header.kicker.trim())}</div><div class="h1">${escape(header.h1.trim())}</div><div class="deck">${escape(header.deck.trim())}</div><div class="rule"></div><div class="${kind.container}">${visible.map((card,index) => renderSectionCard(kind, card.candidate, index)).join('')}</div>${footer(short)}`});
    const selector = `article.${kind.card}:not(.replacement-generated)`;
    if (kind.pool) {
      pools[id] = {page_id:id, container_selector:'.'+kind.container.split(' ')[0], primary_selector:selector,
        card_type:kind.card, target, desired_reserve: kind.card === 'week-card' ? 7 : 4, candidates: cards.map(card => card.candidate)};
      if (spec.shortage_reason !== undefined) pools[id].shortage_reason = structuredClone(spec.shortage_reason);
    }
    if (kind.radar) {
      const key = kind.radar === 'hd' ? 'hd'+page : kind.radar;
      const entry = kind.radar === 'popular_deep' ? {target, candidates: cards.filter(card => card.candidate.rank > target).map(card => card.candidate)}
        : {page_id:id, container_selector:'.'+kind.container, primary_selector:selector, type: kind.radar === 'hd' ? 'hd' : 'popular', target, candidates: cards.map(card => card.candidate)};
      if (spec.shortage_reason !== undefined) entry.shortage_reason = text(spec.shortage_reason, id+'.shortage_reason');
      radar.set(key, entry);
    }
    for (const card of cards) decisions.push({...card, section: id});
  }
}

function applySectionShortages(plan, {pages, issue}) {
  for (const [base, shortage] of Object.entries(plan.section_shortages || {})) {
    assert(shortage && typeof shortage === 'object' && !Array.isArray(shortage), base+' shortage must be structured (reason + searched_sources + verified_count)');
    text(shortage.reason, base+' shortage.reason');
    assert(Array.isArray(shortage.searched_sources) && shortage.searched_sources.length >= 2, base+' shortage.searched_sources must contain at least 2 sources');
    shortage.searched_sources.forEach(value => url(value, base+' searched source'));
    const count = [...pages.values()].filter(p => sectionPageMatches(p.id, base)).reduce((n,p) => n + (String(p.html).match(/<article\b/gi) || []).length, 0);
    assert.equal(shortage.verified_count, count, base+' shortage.verified_count must equal rendered card count '+count);
    issue.section_shortages = {...issue.section_shortages, [base]: structuredClone(shortage)};
  }
}

const tocLabels = [['rendezvous-1','Rendez-vous de la semaine'],['replay-1','Replay'],['plateformes-gratuites','Plateformes gratuites'],
  ['plateformes-abonnement','Plateformes avec abonnement'],['sorties-physiques','Sorties physiques'],['sorties-streaming','Nouvelles arrivées streaming'],
  ['avant-disparition','À voir avant disparition'],['radar-torrent','Radar popularité torrent'],['radar-1','Radar 1080p'],['methode','Méthode &amp; sources']];

// Mechanical navigation: links only to pages that exist, with their numbers.
export function renderToc(pageList, {short, range, from}) {
  const numbers = predicate => pageList.map((page,index) => predicate(page.id) ? index+1 : 0).filter(Boolean);
  const pagesLabel = list => list.length > 1 ? `p. ${list[0]}–${list.at(-1)}` : `p. ${list[0]}`;
  const links = tocLabels.map(([id,label]) => [id,label,numbers(pid => id === 'methode' ? pid === id : sectionPageMatches(pid, id))])
    .filter(([,,list]) => list.length).map(([id,label,list]) => `<a class="toc-link" href="#${id}"><span class="toc-label">${label}</span><span class="toc-page">${pagesLabel(list)}</span></a>`).join('');
  const dayLinks = days.map((day,index) => [day,index,numbers(pid => pid === day+'-selection' || pid.startsWith(day+'-grille'))]).filter(([,,list]) => list.length).map(([day,index,list]) => {
    const label = new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(addDays(from,index)+'T12:00:00Z'));
    return `<a class="toc-link" href="#${day}-selection"><span class="toc-label">${escape(label[0].toUpperCase()+label.slice(1))}<span class="toc-sub">${list.length > 1 ? 'sélection + grille' : 'sélection'}</span></span><span class="toc-page">${pagesLabel(list)}</span></a>`;
  }).join('');
  return `<div class="topbar">Sommaire<span class="issue">${escape(short)} · ${escape(range)}</span></div><div class="kicker">Navigation</div><div class="h1">Sommaire</div><div class="deck">Le numéro complet, puis la sélection jour par jour.</div><div class="rule"></div><div class="toc-grid"><div class="toc-group"><h3>Le numéro</h3>${links}</div><div class="toc-group"><h3>Jour par jour</h3>${dayLinks}</div></div>${footer(short)}`;
}

// Cover and hero reuse developed daily choices already decided in this draft:
// slot, image and metadata come from those reviewed records, never from the cover plan.
function applyCover(plan, {issue, pages, pools, catalogue, short, range}) {
  const cover = plan.cover;
  assert(cover && typeof cover === 'object', 'cover must be an object');
  for (const field of ['kicker','h1','deck']) text(cover[field], 'cover.'+field);
  const ids = [cover.lead_work_id, ...(cover.side_work_ids || [])];
  assert(ids.length <= 3 && new Set(ids).size === ids.length, 'cover needs a lead and at most two distinct side works');
  const daily = Object.entries(pools).filter(([id]) => id.endsWith('-selection')).flatMap(([,pool]) => (pool.candidates || []).filter(c => Number(c.rank) <= 3));
  const picks = ids.map(id => {
    const candidate = daily.find(c => c.work_id === id);
    assert(candidate, 'cover work must be a developed daily choice of this draft: '+id);
    const work = catalogue.find(w => w.id === id);
    assert(work?.image, 'cover work needs its canonical image: '+id);
    return {candidate, work};
  });
  const tile = ({candidate, work}, cls) => `<div class="${cls}"><img src="${escape(work.image)}" alt="${escape(work.title)}"><div class="cover-badge">${escape(candidate.quality)}</div><div class="overlay"><div>${escape(candidate.time)} · ${escape(candidate.channel)}</div><h2>${escape(work.title)}</h2><div>${escape([work.year, work.director || work.creator, work.country].join(' · '))}</div></div></div>`;
  pages.set('couverture', {id:'couverture', className:'page cover', html:`<div class="topbar">Sélection TV<span class="issue">Semaine ${escape(short.replace(/^S/,''))} · ${escape(range)}</span></div><div class="kicker">${escape(cover.kicker.trim())}</div><div class="h1">${escape(cover.h1.trim())}</div><div class="deck">${escape(cover.deck.trim())}</div><div class="cover-strip">${picks.map((pick,index) => tile(pick, index ? 'side' : 'big')).join('')}</div>${footer(short)}`});
  const lead = picks[0].work;
  issue.hero_image = lead.image; issue.hero_title = lead.title;
  issue.hero_meta = [lead.director || lead.creator, lead.year, lead.country].join(' · ');
}

function applyMethod(plan, {pages, short}) {
  const method = plan.methode;
  assert(method && typeof method === 'object', 'methode must be an object');
  text(method.h1, 'methode.h1');
  assert(Array.isArray(method.notes) && method.notes.length > 0, 'methode.notes required');
  const notes = method.notes.map(note => `<div class="note"><b>${escape(text(note.label,'methode note label'))}</b> ${escape(text(note.text,'methode note text'))}</div>`).join('');
  pages.set('methode', {id:'methode', className:'page', html:`<div class="topbar">Méthode &amp; sources<span class="issue">${escape(short)}</span></div><div class="kicker">Transparence éditoriale</div><div class="h1">${escape(method.h1.trim())}</div><div class="sources">${notes}</div>${footer(short)}`});
}

// Returns an ordinary enrichment handoff. It may be deliberately incomplete,
// but never labels any card or issue publication-ready or seals a review.
export function buildDraftBundle(context, plan) {
  const {sha, manifest, works, links, issue, shell, read, asset_version, radar_reserves} = context;
  assert.match(sha || '', /^[a-f0-9]{40}$/, 'immutable source SHA required');
  assert.equal(plan.schema_version, 1);
  assert.equal(plan.source_sha, sha, 'stale plan: reconcile with the current candidate before rendering');
  assert.match(plan.week || '', /^\d{4}-S\d{2}$/);
  assert.equal(weekForSaturday(date(plan.from,'issue.from')),plan.week,'week/date mismatch');
  assert(manifest.latest !== plan.week, 'cannot render into the public issue');
  assert(!manifest.weeks.some(entry => entry.week === plan.week && entry.status === 'published'), 'cannot edit a published issue');
  if (issue) {assert.equal(issue.week,plan.week); assert.equal(issue.publication_status,'draft');}
  const cardsPlan = plan.cards ?? [];
  assert(Array.isArray(cardsPlan), 'cards must be an array');
  assert(cardsPlan.length > 0 || plan.sections?.length || plan.cover || plan.methode || plan.render_toc, 'explicit card decisions required');
  assert(Array.isArray(plan.remaining) && plan.remaining.length > 0 && plan.remaining.every(value => typeof value === 'string' && value.trim()), 'unfinished work must remain explicit');
  const rendered = cardsPlan.map(entry => reviewedCandidate(entry, works.works, links.links, plan.from));
  const short = plan.week.slice(5), to = addDays(plan.from,6);
  const range = plan.range || `${plan.from} — ${to}`;
  const nextIssue = issue ? structuredClone(issue) : {schema_version:1,week:plan.week,short,range,from:plan.from,to,
    theme:'magazine',bodyClass:'magazine',title:`Sélection TV — ${range}`,path:`semaines/${plan.week}/`,
    publication_status:'draft',hero_image:'',hero_title:'',hero_meta:'',pages:[],page_count:0,
    section_shortages:{},personalization:{schema_version:1,pools:{}}};
  assert.equal(nextIssue.from,plan.from,'draft calendar mismatch');
  const pools = nextIssue.personalization?.pools;
  assert(pools && nextIssue.personalization.schema_version === 1, 'existing draft personalization schema unsupported');
  const pages = new Map(nextIssue.pages.map(page => [page.id,page]));
  const gridPageSize = plan.grid_page_size ?? 8;
  assert(Number.isInteger(gridPageSize) && gridPageSize >= 1 && gridPageSize <= 8, 'grid_page_size must be 1..8');
  for (const day of days) {
    const selected = rendered.filter(card => card.day === day).sort((a,b) => a.candidate.rank-b.candidate.rank);
    if (!selected.length) continue;
    assert.equal(new Set(selected.map(card => card.candidate.work_id)).size,selected.length,'duplicate work within a daily pool');
    assert(selected.every((card,index) => card.candidate.rank === index+1), 'daily ranks must be contiguous starting at 1');
    const id = day+'-selection';
    assert(!pools[id] || plan.replace_days?.includes(day), 'existing daily pool requires explicit replace_days authorization: '+day);
    const heading = new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(selected[0].date+'T12:00:00Z')).toUpperCase();
    const features = selected.filter(card => card.candidate.rank <= 3).map(card => renderFeature(card.candidate)).join('');
    pages.set(id,{id,className:'page',html:`<div class="topbar">Sélection du jour<span class="issue">${escape(short)} · ${escape(range)}</span></div><div class="day-head"><div><div class="kicker">Les choix développés</div><div class="h1">${escape(heading)}</div></div></div><div class="rule"></div><div class="feature-columns">${features}</div>${footer(short)}`});
    pools[id] = {page_id:id,container_selector:'.feature-columns',primary_selector:'article.feature:not(.replacement-generated)',
      card_type:'feature',target:3,desired_reserve:7,candidates:selected.map(card => card.candidate)};
    if (plan.shortage_reasons?.[day] !== undefined) pools[id].shortage_reason = plan.shortage_reasons[day];
    const grid = selected.filter(card => card.grid_reason);
    // The current reader/validators recognize two grid pages per day. Never
    // compress further content into an overflowing page or silently drop it.
    assert(grid.length <= 2*gridPageSize, 'grid needs more than two pages; author the additional pages explicitly');
    if (plan.replace_days?.includes(day)) {pages.delete(day+'-grille');pages.delete(day+'-grille-2');}
    if (grid.length) {
      for (let offset=0; offset<grid.length; offset+=gridPageSize) {
        const gridId = day+'-grille'+(offset ? '-2' : '');
        pages.set(gridId,{id:gridId,className:'page',html:`<div class="topbar">Grille filtrée<span class="issue">${escape(short)}</span></div><div class="grid-title">${escape(heading)} — la grille commentée</div><table class="schedule"><thead><tr><th>Heure</th><th>Chaîne</th><th>Programme</th><th>Pourquoi le retenir</th><th>Repère</th></tr></thead><tbody>${grid.slice(offset,offset+gridPageSize).map(card => renderGridRow(card.candidate,card.grid_reason)).join('')}</tbody></table>${footer(short)}`});
      }
    }
  }
  const sectionDecisions = [], radar = new Map();
  applySections(plan, {catalogue: works.works, centralLinks: links.links, pages, pools, issue: nextIssue, short, range, decisions: sectionDecisions, radar});
  if (plan.methode !== undefined) applyMethod(plan, {pages, short});
  const allDecisions = [...rendered, ...sectionDecisions];
  const decisionsById = new Map();
  for (const card of allDecisions) {
    const previous = decisionsById.get(card.work.id);
    if (previous) {
      assert.deepEqual(card.work,previous.work,'conflicting canonical fields for repeated work: '+card.work.id);
      assert.deepEqual(card.exactLinks,previous.exactLinks,'conflicting identity links for repeated work: '+card.work.id);
    }
    decisionsById.set(card.work.id,card);
  }
  const distinctIds = [...decisionsById.values()];
  for (let index=0; index<distinctIds.length; index++) for (const other of distinctIds.slice(index+1)) {
    assert(!sameTitle(distinctIds[index].work.title,other.work.title) || String(distinctIds[index].work.year) !== String(other.work.year),
      'two new IDs would duplicate the same title/year');
  }
  const nextWorks = structuredClone(works), nextLinks = structuredClone(links);
  for (const card of allDecisions) {
    const index = nextWorks.works.findIndex(work => work.id === card.work.id);
    if (index >= 0) nextWorks.works[index] = card.work; else nextWorks.works.push(card.work);
    nextLinks.links[card.candidate.title] = card.exactLinks;
  }
  if (plan.cover !== undefined) applyCover(plan, {issue: nextIssue, pages, pools, catalogue: nextWorks.works, short, range});
  // The sommaire is mechanical navigation: (re)built from the actual pages.
  if (plan.render_toc || pages.has('sommaire')) pages.set('sommaire', {id:'sommaire', className:'page', html:''});
  // Canonical magazine order; pages unknown to this helper keep their relative place at the end.
  const position = id => {const index = pageOrder.indexOf(id); return index < 0 ? pageOrder.length : index;};
  const originalOrder = new Map(nextIssue.pages.map((page,index) => [page.id,index]));
  nextIssue.pages = [...pages.values()].sort((a,b) => position(a.id)-position(b.id) || (originalOrder.get(a.id) ?? 1e6)-(originalOrder.get(b.id) ?? 1e6));
  if (pages.has('sommaire')) pages.get('sommaire').html = renderToc(nextIssue.pages, {short, range, from: plan.from});
  applySectionShortages(plan, {pages, issue: nextIssue});
  nextIssue.pages.forEach((page,index) => {page.html = page.html.replace(/(<div class="footer">[\s\S]*?<span>)\d+(<\/span><\/div>\s*)$/,(_all,before,after) => before+(index+1)+after);});
  nextIssue.page_count = nextIssue.pages.length;
  const nextManifest = structuredClone(manifest);
  const entry = {week:plan.week,short,range,from:plan.from,to,path:nextIssue.path,theme:nextIssue.theme,
    page_count:nextIssue.page_count,hero_image:nextIssue.hero_image,hero_title:nextIssue.hero_title,hero_meta:nextIssue.hero_meta,status:'draft'};
  const entryIndex = nextManifest.weeks.findIndex(value => value.week === plan.week);
  if (entryIndex >= 0) nextManifest.weeks[entryIndex] = {...nextManifest.weeks[entryIndex],...entry}; else nextManifest.weeks.unshift(entry);
  const entries = [['data/works.json',nextWorks],['data/links.json',nextLinks],['data/manifest.json',nextManifest],[`data/weeks/${plan.week}.json`,nextIssue]];
  if (radar.size) {
    const nextRadar = radar_reserves ? structuredClone(radar_reserves) : {schema_version:1, week:plan.week};
    assert.equal(nextRadar.week, plan.week, 'radar reserve week mismatch');
    for (const [key, value] of radar) nextRadar[key] = value;
    entries.push([`data/radar-reserves/${plan.week}.json`, nextRadar]);
  }
  const contents = new Map(entries.map(([name,value]) => [name,JSON.stringify(value,null,2)+'\n']));
  const loaderQuery = asset_version ? '?v='+asset_version : '';
  if (!shell) contents.set(`semaines/${plan.week}/index.html`,`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sélection TV — ${escape(short)}</title></head><body data-week="${plan.week}"><script src="../../assets/js/issue-loader.js${loaderQuery}"></script></body></html>\n`);
  const files = [...contents].map(([path,content]) => ({path,base_sha256:digest(read(path)),content})).filter(file => file.base_sha256 !== digest(file.content));
  const bundle = {schema_version:1,week:plan.week,base_sha:sha,stage:'enrichment',remaining:plan.remaining,files};
  planImport(bundle,read);
  return {bundle,report:{publication_ready:false,selection_finalized:false,review_sealed:false,source_sha:sha,
    authored_cards:allDecisions.length,public_daily_cards:rendered.filter(card => card.candidate.rank <= 3).length,
    section_pages:[...new Set(sectionDecisions.map(card => card.section))],radar_reserve_keys:[...radar.keys()],
    toc_rendered:pages.has('sommaire'),cover_rendered:plan.cover !== undefined,
    reviews:allDecisions.map(card => ({work_id:card.work.id,date:card.date || null,section:card.section || card.day+'-selection',...card.review})),
    notice:'Mechanical draft only. Reconcile the handoff under the editorial lease, record evidence/checkpoints, and run all full candidate/editorial/image/browser gates before publication.'}};
}

export function draftContextFromGit(week, ref, cwd = process.cwd()) {
  assert.match(week || '', /^\d{4}-S\d{2}$/);
  assert(typeof ref === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) && !ref.includes('..'),'invalid ref');
  const git = args => execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  const sha = git(['rev-parse','--verify',ref+'^{commit}']).trim();
  const read = path => git(['ls-tree','--name-only',sha,'--',path]).trim() ? git(['show',`${sha}:${path}`]) : null;
  const json = path => {const raw = read(path); return raw === null ? null : JSON.parse(raw);};
  return {sha,read,manifest:json('data/manifest.json'),works:json('data/works.json'),links:json('data/links.json'),
    issue:json(`data/weeks/${week}.json`),shell:read(`semaines/${week}/index.html`),radar_reserves:json(`data/radar-reserves/${week}.json`),
    asset_version:read('assets/js/issue-loader.js')?.match(/\?v=([a-zA-Z0-9_-]+)/)?.[1]};
}

function main() {
  const [week,...args] = process.argv.slice(2), options = {};
  for (let index=0; index<args.length; index+=2) {
    assert(['--ref','--input','--out'].includes(args[index]) && args[index+1], 'Usage: WEEK --ref REF --input REVIEWED_PLAN.json --out BUNDLE.json');
    assert(!options[args[index]],'duplicate option'); options[args[index]] = args[index+1];
  }
  assert(options['--ref'] && options['--input'] && options['--out'],'ref, input and output are required');
  assert(!fs.existsSync(options['--out']),'output already exists; choose a new local handoff filename');
  const plan = JSON.parse(fs.readFileSync(options['--input'],'utf8'));
  assert.equal(plan.week,week);
  const {bundle,report} = buildDraftBundle(draftContextFromGit(week,options['--ref']),plan);
  fs.writeFileSync(options['--out'],JSON.stringify(bundle,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
