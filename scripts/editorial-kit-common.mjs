// Shared helpers of the production kit (scripts/editorial-kit.mjs). They read
// the week's saved sources and the producer's work directory, and match slots,
// reviews and dossiers. They never decide, rank or write editorial copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {addDays, parisToday, weekForSaturday} from './week-calendar.mjs';
import {normalizedTitle} from './editorial-work-packet.mjs';

export const days = ['samedi', 'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
export const norm = normalizedTitle;
// Titles printed with broken spacing ("Guinée- Bissau") still match.
export const compact = value => normalizedTitle(value).replace(/ /g, '');
export const isRemote = value => /^https?:\/\//i.test(value || '');
export const array = value => Array.isArray(value) ? value : [];
export const slug = value => String(value).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && addDays(value, 0) === value;
export const isoInstant = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));
export const nowInstant = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dayNumber = value => {const day = Number(value.slice(8)); return day === 1 ? '1er' : String(day);};

// Saturday→Friday dates of a week id, derived from the ISO week number.
export function weekDates(week) {
  const match = String(week || '').match(/^(\d{4})-S(\d{2})$/);
  assert(match, 'week must be YYYY-Sxx');
  const year = Number(match[1]), number = Number(match[2]);
  const jan4 = Date.UTC(year, 0, 4), weekday = new Date(jan4).getUTCDay() || 7;
  const monday = new Date(jan4 + ((number - 1) * 7 - (weekday - 1)) * 86400000).toISOString().slice(0, 10);
  const from = addDays(monday, -2);
  assert.equal(weekForSaturday(from), week, 'week does not exist: ' + week);
  const dates = days.map((_, index) => addDays(from, index));
  const [fy, fm] = [from.slice(0, 4), Number(from.slice(5, 7))], [ty, tm] = [dates[6].slice(0, 4), Number(dates[6].slice(5, 7))];
  const range = fy !== ty ? `${dayNumber(from)} ${months[fm - 1]} ${fy} au ${dayNumber(dates[6])} ${months[tm - 1]} ${ty}`
    : `${dayNumber(from)}${fm !== tm ? ' ' + months[fm - 1] : ''} au ${dayNumber(dates[6])} ${months[tm - 1]} ${ty}`;
  return {week, short: week.slice(5), from, to: dates[6], dates, range,
    dayOf: date => {const index = dates.indexOf(date); assert(index >= 0, 'date outside issue: ' + date); return days[index];},
    dateOf: day => {const index = days.indexOf(day); assert(index >= 0, 'unknown day: ' + day); return dates[index];}};
}

// The checked_at date written in reviews: explicit, else today in Paris.
export function checkedDate(value) {
  const result = value ?? parisToday();
  assert(isoDate(result), 'checked_at must be YYYY-MM-DD');
  return result;
}

export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
export const readOptional = file => fs.existsSync(file) ? readJson(file) : null;
export const listJson = (dir, pattern = /\.json$/) => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(name => pattern.test(name)).sort().map(name => path.join(dir, name)) : [];

// Repository files read at an exact commit, so plans match what
// editorial-draft-cards.mjs renders from the same --ref.
export function gitReader(ref = 'HEAD', cwd = process.cwd()) {
  assert(/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) && !ref.includes('..'), 'invalid ref');
  const git = args => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const sha = git(['rev-parse', '--verify', ref + '^{commit}']).trim();
  const read = file => git(['ls-tree', '--name-only', sha, '--', file]).trim() ? git(['show', `${sha}:${file}`]) : null;
  const json = file => {const raw = read(file); return raw === null ? null : JSON.parse(raw);};
  // Last commit (at or before sha) that wrote a path: the provenance of a saved source.
  const lastCommit = file => git(['log', '-1', '--format=%H', sha, '--', file]).trim() || null;
  return {sha, read, json, lastCommit};
}

// Working-tree copy of a JSON file differs from the commit: the render would
// silently ignore the uncommitted edit.
export function uncommittedJson(reader, file, cwd = process.cwd()) {
  const saved = reader.read(file), local = path.join(cwd, file);
  if (!fs.existsSync(local)) return false;
  const text = fs.readFileSync(local, 'utf8').replace(/\r\n/g, '\n');
  return saved === null || JSON.stringify(JSON.parse(text)) !== JSON.stringify(JSON.parse(saved));
}

// One flat list of research dossier entries, whatever the agent's layout
// (works, sections.<rubrique>, popularity*, hd*, additional_proposals).
export const DOSSIER_LISTS = ['works', 'additional_proposals', 'popularity', 'popularity_scan', 'popularity_reserve', 'hd', 'hd_reserve'];
export function flattenDossier(dossier, file) {
  const entries = [];
  for (const key of DOSSIER_LISTS) for (const entry of array(dossier?.[key])) entries.push({...entry, _file: file, _key: key, _at: dossier.generated_at});
  for (const [key, list] of Object.entries(dossier?.sections || {})) for (const entry of array(list)) entries.push({...entry, _file: file, _key: key, _at: dossier.generated_at});
  return entries;
}
export function loadDossiers(dir) {
  return listJson(dir).flatMap(file => flattenDossier(readJson(file), path.basename(file)));
}

const linkKeys = ['imdb', 'sc', 'official'];
export const strongLinks = links => Object.fromEntries(Object.entries(links || {}).filter(([key, value]) => linkKeys.includes(key) && isRemote(value)));
// A dossier belongs to a work only through an exact identity link. Among
// several, the entries of the preferred keys (the section being written) win;
// in strict mode the same key in two dossier files is ambiguous and must be named.
export function dossierForWork(entries, work, {keys = [], file = null, strict = false} = {}) {
  const links = work?.links || {};
  const linked = entries.filter(entry => (!file || entry._file === file) && ['imdb', 'sc'].some(key => links[key] && entry.links?.[key] === links[key]));
  const official = entries.filter(entry => (!file || entry._file === file) && links.official &&
    (entry.links?.official === links.official || entry.availability?.url === links.official || entry.offer?.url === links.official));
  const all = linked.length ? linked : official;
  const preferred = all.filter(entry => keys.includes(entry._key));
  assert(!strict || new Set(preferred.map(entry => entry._file)).size <= 1,
    `${work.id}: dossiers ${[...new Set(preferred.map(entry => entry._file))].join(', ')} for the same section; name the dossier file`);
  return preferred[0] || all[0] || null;
}
// The catalogue work of a dossier entry: exact link, else same title and year.
export function workForDossier(catalogue, entry) {
  const links = strongLinks(entry.links);
  const byLink = catalogue.find(work => ['imdb', 'sc'].some(key => links[key] && work.links?.[key] === links[key]));
  if (byLink) return {work: byLink, basis: 'link'};
  const title = entry.identity?.title_fr || entry.query, year = entry.identity?.year;
  const titled = catalogue.filter(work => [work.title, ...array(work.aliases)].some(alias => norm(alias) === norm(title)));
  const exact = titled.find(work => year && String(work.year || work.id.match(/-(\d{4})$/)?.[1]) === String(year));
  if (exact) return {work: exact, basis: 'title_year'};
  return titled.length ? {work: null, clash: titled.map(work => work.id)} : {work: null};
}

// Channel names compared through the producer's explicit aliases only
// ({"card name": "inventory name"}): "Canal+" never matches "Canal+ Cinéma".
export function channelMatcher(aliases = {}) {
  const canonical = new Map();
  for (const [display, inventory] of Object.entries(aliases)) canonical.set(norm(display), norm(inventory));
  const key = value => canonical.get(norm(value)) || norm(value);
  return (a, b) => key(a) === key(b);
}
// The card name of an inventory channel, from the same aliases.
export function channelDisplay(aliases = {}) {
  const display = new Map(Object.entries(aliases).map(([card, inventory]) => [norm(inventory), card]));
  return channel => display.get(norm(channel)) || channel;
}

// The inventory row of a slot: same start and channel, then the printed or
// official title; a single row at that start and channel also matches, since
// a card titled in the original language differs from the printed title.
export function inventorySlot(inventory, {date, time, channel, titles = []}, sameChannel = channelMatcher()) {
  const day = array(inventory?.days).find(entry => entry.date === date);
  const rows = array(day?.items).filter(item => item.start === time && sameChannel(item.channel, channel));
  const wanted = titles.filter(Boolean).map(compact);
  const titled = rows.find(item => wanted.includes(compact(item.title)));
  if (titled) return {item: titled, basis: 'title'};
  if (rows.length === 1) return {item: rows[0], basis: 'single_row'};
  return {item: null, basis: rows.length ? 'ambiguous' : 'absent', rows: rows.length};
}

// The Télérama daily review of a broadcast: same date and start with the same
// title; else same date, start and channel when the official title differs
// from the printed one; else same date, channel and title when the review
// header and the grid print different starts (21.05 / 21.10). Works without a
// slot never borrow a review by title alone.
export function teleramaReview(editorial, {date, time, channel, titles = []}, sameChannel = channelMatcher()) {
  if (!date || !time) return null;
  const reviews = array(editorial?.reviews).map((review, index) => ({review, index})).filter(({review}) => review.date === date);
  const wanted = titles.filter(Boolean).map(norm);
  const titled = ({review}) => [review.reviewed_title, review.title].some(title => title && wanted.includes(norm(title)));
  const onChannel = ({review}) => sameChannel(review.channel, channel) || sameChannel(review.channel_printed, channel);
  const slot = reviews.filter(({review}) => review.start === time);
  const exact = slot.find(titled);
  if (exact) return {...exact, basis: 'title'};
  const channelled = slot.filter(onChannel);
  if (channelled.length === 1) return {...channelled[0], basis: 'slot'};
  const shifted = reviews.filter(row => onChannel(row) && titled(row));
  return shifted.length === 1 ? {...shifted[0], basis: 'title_channel'} : null;
}

// Rendering needs an http(s) image. A poster already copied into
// assets/posters is re-rendered from its remote original; poster-copy.mjs
// --week must then run again after the handoff is applied.
export function remoteImage(work) {
  if (!work || isRemote(work.image)) return null;
  const remote = [work.image_remote, ...array(work.image_fallbacks)].find(isRemote);
  assert(remote, 'localized poster without a remote original: ' + work?.id);
  return remote;
}

// The work directory holds the producer's inputs (see AUTOMATION.md,
// « Kit de production »). production.json carries the week's parameters.
export function workDir(dir) {
  assert(dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory(), '--work must be an existing directory');
  const settings = readOptional(path.join(dir, 'production.json')) || {};
  const copyFiles = [...listJson(path.join(dir, 'copy')), ...listJson(dir, /^copy-.*\.json$/)];
  const copy = new Map();
  for (const file of copyFiles) for (const [key, value] of Object.entries(readJson(file))) {
    const id = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ? key : 'title:' + norm(key);
    assert(!copy.has(id), 'card copy written twice: ' + key);
    copy.set(id, value);
  }
  return {dir, settings, file: name => path.join(dir, name), out: name => path.join(dir, 'out', name),
    dossiers: () => loadDossiers(path.join(dir, 'dossiers')),
    // Authored texts are keyed by work_id, else by title.
    copyFor: (workId, ...titles) => copy.get(workId) || titles.filter(Boolean).map(title => copy.get('title:' + norm(title))).find(Boolean) || null,
    sameChannel: channelMatcher(settings.channel_aliases), displayChannel: channelDisplay(settings.channel_aliases)};
}

// Envelope shared by every plan given to editorial-draft-cards.mjs.
export function planEnvelope(week, sourceSha, remaining, extra = {}) {
  const dates = weekDates(week);
  assert.match(sourceSha || '', /^[a-f0-9]{40}$/, 'source SHA required');
  assert(array(remaining).length, 'research remaining must stay explicit; the plan cannot render a finished week');
  return {schema_version: 1, week, from: dates.from, source_sha: sourceSha, range: dates.range, remaining: [...remaining], ...extra};
}

// URLs of a review: exact identity links first, then the dossier sources.
export function evidenceUrls(work, dossier, extra = []) {
  return [...new Set([work?.links?.sc, work?.links?.official, work?.links?.imdb, ...extra, dossier?.synopsis_source_url,
    ...array(dossier?.critical_signals).map(signal => signal.source_url), ...Object.values(work?.links || {}),
    work?.image_source_url, work?.summary_source_url].filter(isRemote))].slice(0, 6);
}

// What the resolvers recorded, stated from the catalogue fields themselves.
export function canonicalNote(work, checked) {
  const prefill = work?.metadata_prefill;
  const host = value => {
    if (String(value).startsWith('dossier:')) return 'dossier de recherche';
    try {return new URL(value).hostname.replace(/^www\./, '');} catch {return null;}
  };
  const sources = [...new Set(Object.values(prefill?.fields || {}).map(host))].filter(Boolean);
  const fields = prefill ? `Champs canoniques préremplis par ${prefill.tool || 'work-resolver'} le ${prefill.checked || checked}` +
    (sources.length ? ` depuis ${sources.join(', ')}` : '') : `Champs canoniques relus sur la fiche exacte le ${checked}`;
  const poster = work?.image_source_url ? ` ; affiche de la fiche exacte (${work.image_source_url}) contrôlée le ${work.image_checked || checked}` : '';
  return fields + poster + '.';
}
