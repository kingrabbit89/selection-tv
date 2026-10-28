// Production kit, catalogue side: candidate overview, dossier intake into
// data/works.json, and the fields the resolvers leave open. Identities come
// from exact links in the research dossiers; nothing is guessed from a title.
import assert from 'node:assert/strict';
import {array, dossierForWork, norm, slug, strongLinks, workForDossier} from './editorial-kit-common.mjs';

const ratingScore = {'Hélas': 0, T: 1, TT: 2, TTT: 3, TTTT: 4};

// Titles of the last published issues before the target week, for freshness.
export function recentTitles({week, manifest, readIssue, works, lookback = 4}) {
  const prior = array(manifest?.weeks).filter(entry => entry.status === 'published' && entry.week < week)
    .sort((a, b) => b.week.localeCompare(a.week)).slice(0, lookback);
  const history = new Map();
  const add = (title, label) => {if (title && !history.has(norm(title))) history.set(norm(title), label);};
  for (const entry of prior) {
    const issue = readIssue(entry.week);
    if (!issue) continue;
    for (const pool of Object.values(issue.personalization?.pools || {})) for (const candidate of array(pool.candidates)) add(candidate.title, entry.week.slice(5));
    for (const page of array(issue.pages)) for (const match of String(page.html || '').matchAll(/data-title="([^"]+)"/g)) add(match[1], entry.week.slice(5));
  }
  const shorts = new Set(prior.map(entry => entry.week.slice(5)));
  for (const work of array(works)) {
    const seen = array(work.occurrences).map(o => String(o.week || '')).filter(short => shorts.has(short));
    if (seen.length) for (const title of [work.title, ...array(work.aliases)]) add(title, 'occ ' + seen.join('/'));
  }
  return {weeks: prior.map(entry => entry.week), history};
}

// One line per printed title: rating, recent publication, catalogue match and
// slots. Sorted by native Télérama appreciation (daily review, else grid mark).
export function candidateOverview({telerama, editorial, gridRatings = {}, history = new Map(), works = []}) {
  const catalogue = new Map();
  for (const work of works) for (const title of [work.title, ...array(work.aliases), work.original_title]) if (title) catalogue.set(norm(title), work.id);
  const reviews = new Map(array(editorial?.reviews).map(review => [norm(review.reviewed_title || review.title), review]));
  const byTitle = new Map();
  array(telerama?.observations).forEach((observation, index) => {
    const key = norm(observation.title);
    const row = byTitle.get(key) || {title: observation.title, genre: observation.genre_hint || null, slots: [], grid_rating: null};
    row.slots.push(`${observation.date} ${observation.start} ${observation.channel}`);
    if (gridRatings[index] && !row.grid_rating) row.grid_rating = gridRatings[index];
    byTitle.set(key, row);
  });
  const rows = [...byTitle.entries()].map(([key, row]) => {
    const review = reviews.get(key);
    const score = review ? (review.native_rating?.t_count ?? 0) : ratingScore[row.grid_rating] ?? -1;
    return {...row, review: review ? {label: review.native_rating?.label, author: review.author || null, pdf_page: review.pdf_page} : null,
      score, recent: history.get(key) || null, catalogue_id: catalogue.get(key) || null};
  });
  rows.sort((a, b) => b.score - a.score);
  const lines = rows.map(row => `${row.title} [${row.genre || '?'}] ${row.review ? 'REV:' + row.review.label : row.grid_rating || ''}` +
    `${row.recent ? ' HIST:' + row.recent : ''}${row.catalogue_id ? ' CAT:' + row.catalogue_id : ''} :: ${row.slots.slice(0, 4).join('; ')}` +
    `${row.slots.length > 4 ? ' +' + (row.slots.length - 4) : ''}`);
  return {rows, text: lines.join('\n') + '\n'};
}

// Daily picks, in the producer's order: {date|day, time, channel, printed,
// title?, primary?, work_id?, display_channel?}.
export function normalizePicks(input, dates) {
  const list = Array.isArray(input) ? input : array(input?.picks);
  assert(list.length, 'picks.json lists no pick');
  return list.map((pick, index) => {
    const date = pick.date || (pick.day && dates.dateOf(pick.day));
    assert(date, `pick ${index}: date or day required`);
    dates.dayOf(date);
    assert.match(pick.time || '', /^(?:[01]\d|2[0-3]):[0-5]\d$/, `pick ${index}: time must be HH:MM`);
    assert(pick.channel && (pick.printed || pick.title), `pick ${index}: channel and printed title required`);
    return {...pick, date, day: dates.dayOf(date), title: pick.title || pick.printed, printed: pick.printed || pick.title, primary: pick.primary === true};
  });
}

const dossierFor = (dossiers, ...titles) => {
  const wanted = titles.filter(Boolean).map(norm);
  const matches = dossiers.filter(entry => [entry.query, entry.identity?.title_fr].some(title => title && wanted.includes(norm(title))));
  return matches.find(entry => entry._key === 'works') || matches[0] || null;
};

const newWorkId = (title, year) => year ? slug(title) + '-' + year : null;

// Maps each pick to a canonical work: explicit work_id, else the catalogue
// work of its dossier (exact link, else title and year). A title alone never
// reuses a catalogue work: homonyms and remakes are reported as clashes.
export function picksWorkPlan({picks, dossiers, catalogue}) {
  const seen = new Map();
  return picks.map(pick => {
    const key = norm(pick.title);
    // Another broadcast of a work already mapped: same identity, its own slot.
    if (seen.has(key)) {
      const {rank: _rank, display_channel: _display, ...identity} = seen.get(key);
      return {...identity, ...slotOf(pick), status: 'repeat'};
    }
    const dossier = dossierFor(dossiers, pick.title, pick.printed);
    const row = {...slotOf(pick), title: pick.title, dossier: dossier ? `${dossier._file}#${dossier._key}` : null};
    if (pick.work_id) {
      const work = catalogue.find(candidate => candidate.id === pick.work_id);
      Object.assign(row, {work_id: pick.work_id, status: work ? 'existing' : dossier ? 'new' : 'needs_dossier', basis: 'explicit'});
    } else if (!dossier) {
      const titled = catalogue.filter(work => [work.title, ...array(work.aliases)].some(alias => norm(alias) === key)).map(work => work.id);
      Object.assign(row, {work_id: null, status: 'needs_dossier', title_matches: titled});
    } else {
      const found = workForDossier(catalogue, {...dossier, identity: {...dossier.identity, title_fr: pick.title}});
      const id = found.work?.id || newWorkId(pick.title, dossier.identity?.year);
      const taken = !found.work && id && catalogue.some(work => work.id === id);
      Object.assign(row, {work_id: found.clash || taken ? null : id, basis: found.basis || null,
        status: found.work ? 'existing' : found.clash || taken ? 'clash' : id ? 'new' : 'needs_year',
        ...(found.clash ? {clash: found.clash} : taken ? {clash: [id]} : {})});
    }
    if (dossier) Object.assign(row, {links: strongLinks(dossier.links), original_title: dossier.identity?.original_title || null,
      confidence: dossier.identity_confidence || null});
    seen.set(key, row);
    return row;
  });
}
const slotOf = pick => ({date: pick.date, day: pick.day, time: pick.time, channel: pick.channel, printed: pick.printed, primary: pick.primary,
  ...(pick.display_channel ? {display_channel: pick.display_channel} : {}), ...(pick.rank ? {rank: pick.rank} : {})});

// Dossier entries of rubriques and radars chosen by the producer (file and keys).
export function sectionWorkPlan({entries, catalogue}) {
  return entries.map(entry => {
    const title = entry.identity?.title_fr || entry.query, year = entry.identity?.year;
    const found = workForDossier(catalogue, entry);
    const id = found.work?.id || newWorkId(title, year);
    const taken = !found.work && id && catalogue.some(work => work.id === id);
    return {dossier: `${entry._file}#${entry._key}`, query: entry.query, title, work_id: found.clash || taken ? null : id,
      status: found.work ? 'existing' : found.clash || taken ? 'clash' : id ? 'new' : 'needs_year', basis: found.basis || null,
      ...(found.clash ? {clash: found.clash} : taken ? {clash: [id]} : {}),
      links: strongLinks(entry.links), original_title: entry.identity?.original_title || null};
  });
}

// New works get an ID, a title, the original title as alias and exact links.
// Existing works only gain missing link keys; a different saved link is a
// conflict to resolve by hand, never overwritten.
export function applyWorkPlan(catalogue, rows) {
  const added = [], linked = [], conflicts = [];
  for (const row of rows) {
    if (!['new', 'existing'].includes(row.status) || !row.work_id || !row.links) continue;
    let work = catalogue.find(candidate => candidate.id === row.work_id);
    if (!work && row.status === 'new') {
      work = {id: row.work_id, title: row.title};
      const original = String(row.original_title || '').replace(/\s*\(.*\)$/, '').trim();
      if (original && norm(original) !== norm(row.title)) work.aliases = [original];
      work.links = {...row.links};
      catalogue.push(work); added.push(work.id);
      continue;
    }
    // Links are added only to a work matched by an exact link or chosen explicitly.
    if (!work || !['link', 'explicit'].includes(row.basis)) continue;
    for (const [key, value] of Object.entries(row.links)) {
      if (!work.links?.[key]) {work.links = {...(work.links || {}), [key]: value}; linked.push(`${work.id}.${key}`);}
      else if (work.links[key] !== value) conflicts.push(`${work.id}.${key}: ${work.links[key]} ≠ ${value}`);
    }
  }
  return {added, linked, conflicts};
}

// Fields work-resolver left in conflict or empty. Only a value read on an
// exact page is kept, with the other sources named in the field itself:
// SensCritique for the duration (the page actually read), the source whose
// year matches the canonical ID, and the dossier's country or duration.
export function fillResolverGaps(catalogue, report, dossiers) {
  const changes = [], missing = [];
  for (const result of array(report?.results)) {
    const work = catalogue.find(candidate => candidate.id === result.work_id);
    if (!work) continue;
    const dossier = dossierForWork(dossiers, work, {keys: ['works']});
    const sourceUrl = dossier?.synopsis_source_url || work.links?.sc;
    const prefill = (field, value) => {
      work.metadata_prefill ??= {checked: report.generated_at?.slice(0, 10) || null, tool: 'work-resolver', fields: {}};
      work.metadata_prefill.fields = {...(work.metadata_prefill.fields || {}), [field]: value};
    };
    const duration = result.fields?.duration;
    if (!work.duration && duration?.status === 'conflict') {
      const sc = array(duration.sources).find(source => source.source === 'senscritique');
      if (sc) {
        const others = array(duration.sources).filter(source => source !== sc).map(source => `${source.source} ${source.value}`).join(', ');
        work.duration = `${sc.value}${others ? ` (SensCritique ; ${others})` : ''}`;
        work.duration_source_url = sc.source_url || work.links?.sc;
        changes.push(`${work.id}.duration ← SensCritique ${sc.value}`);
      }
    }
    const year = result.fields?.year, expected = String(result.expected_year || work.id.match(/-(\d{4})$/)?.[1] || '');
    if (!work.year && year?.status === 'conflict' && expected) {
      const match = array(year.sources).find(source => String(source.value) === expected);
      if (match) {
        work.year = Number(expected);
        prefill('year', match.source_url);
        changes.push(`${work.id}.year ← ${match.source} ${expected} (${array(year.sources).filter(s => s !== match).map(s => `${s.source} ${s.value}`).join(', ')})`);
      }
    }
    if (!work.country && dossier?.identity?.country) {
      work.country = String(dossier.identity.country).replace(/, /g, ' / ');
      prefill('country', 'dossier:' + sourceUrl); changes.push(`${work.id}.country ← dossier`);
    }
    if (!work.duration && dossier?.identity?.duration_min) {
      work.duration = dossier.identity.duration_min + ' min';
      work.duration_source_url = sourceUrl; changes.push(`${work.id}.duration ← dossier`);
    }
    const open = ['year', 'director', 'country', 'genre', 'duration', 'image'].filter(field => !work[field] && !(field === 'director' && work.creator));
    if (open.length) missing.push({work_id: work.id, fields: open});
  }
  return {changes, missing};
}

// Resolver command lines for a list of work IDs.
export function resolverCommands(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const works = unique.map(id => '--work ' + id).join(' ');
  return [`node scripts/work-resolver.mjs ${works} --report <rapport.json>`,
    `node scripts/work-resolver.mjs ${works} --apply`, `node scripts/poster-resolver.mjs ${works}`];
}
