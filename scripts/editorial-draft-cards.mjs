// Mechanical rendering of explicitly reviewed editorial decisions. No research,
// ranking, invented metadata, promotion, or repository writes are performed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {addDays, weekForSaturday} from './week-calendar.mjs';
import {digest, planImport} from './editorial-handoff.mjs';
import {normalizedTitle} from './editorial-work-packet.mjs';

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

function reviewedCandidate(entry, catalogue, centralLinks, from) {
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
  return {candidate, work, exactLinks, review:structuredClone(review), day:days[offset], date:entry.date, grid_reason:entry.grid_reason};
}

// Returns an ordinary enrichment handoff. It may be deliberately incomplete,
// but never labels any card or issue publication-ready or seals a review.
export function buildDraftBundle(context, plan) {
  const {sha, manifest, works, links, issue, shell, read, asset_version} = context;
  assert.match(sha || '', /^[a-f0-9]{40}$/, 'immutable source SHA required');
  assert.equal(plan.schema_version, 1);
  assert.equal(plan.source_sha, sha, 'stale plan: reconcile with the current candidate before rendering');
  assert.match(plan.week || '', /^\d{4}-S\d{2}$/);
  assert.equal(weekForSaturday(date(plan.from,'issue.from')),plan.week,'week/date mismatch');
  assert(manifest.latest !== plan.week, 'cannot render into the public issue');
  assert(!manifest.weeks.some(entry => entry.week === plan.week && entry.status === 'published'), 'cannot edit a published issue');
  if (issue) {assert.equal(issue.week,plan.week); assert.equal(issue.publication_status,'draft');}
  assert(Array.isArray(plan.cards) && plan.cards.length > 0, 'explicit card decisions required');
  assert(Array.isArray(plan.remaining) && plan.remaining.length > 0 && plan.remaining.every(value => typeof value === 'string' && value.trim()), 'unfinished work must remain explicit');
  const rendered = plan.cards.map(entry => reviewedCandidate(entry, works.works, links.links, plan.from));
  const decisionsById = new Map();
  for (const card of rendered) {
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
  for (const card of rendered) {
    const index = nextWorks.works.findIndex(work => work.id === card.work.id);
    if (index >= 0) nextWorks.works[index] = card.work; else nextWorks.works.push(card.work);
    nextLinks.links[card.candidate.title] = card.exactLinks;
  }
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
  const originalIds = new Set(nextIssue.pages.map(page => page.id));
  const appendOrder = days.flatMap(day => [day+'-selection',day+'-grille',day+'-grille-2']);
  nextIssue.pages = [...nextIssue.pages.filter(page => pages.has(page.id)).map(page => pages.get(page.id)),
    ...appendOrder.filter(id => !originalIds.has(id) && pages.has(id)).map(id => pages.get(id))];
  nextIssue.pages.forEach((page,index) => {page.html = page.html.replace(/(<div class="footer">[\s\S]*?<span>)\d+(<\/span><\/div>\s*)$/,(_all,before,after) => before+(index+1)+after);});
  nextIssue.page_count = nextIssue.pages.length;
  const nextManifest = structuredClone(manifest);
  const entry = {week:plan.week,short,range,from:plan.from,to,path:nextIssue.path,theme:nextIssue.theme,
    page_count:nextIssue.page_count,hero_image:nextIssue.hero_image,hero_title:nextIssue.hero_title,hero_meta:nextIssue.hero_meta,status:'draft'};
  const entryIndex = nextManifest.weeks.findIndex(value => value.week === plan.week);
  if (entryIndex >= 0) nextManifest.weeks[entryIndex] = {...nextManifest.weeks[entryIndex],...entry}; else nextManifest.weeks.unshift(entry);
  const contents = new Map([['data/works.json',nextWorks],['data/links.json',nextLinks],['data/manifest.json',nextManifest],[`data/weeks/${plan.week}.json`,nextIssue]].map(([name,value]) => [name,JSON.stringify(value,null,2)+'\n']));
  const loaderQuery = asset_version ? '?v='+asset_version : '';
  if (!shell) contents.set(`semaines/${plan.week}/index.html`,`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sélection TV — ${escape(short)}</title></head><body data-week="${plan.week}"><script src="../../assets/js/issue-loader.js${loaderQuery}"></script></body></html>\n`);
  const files = [...contents].map(([path,content]) => ({path,base_sha256:digest(read(path)),content})).filter(file => file.base_sha256 !== digest(file.content));
  const bundle = {schema_version:1,week:plan.week,base_sha:sha,stage:'enrichment',remaining:plan.remaining,files};
  planImport(bundle,read);
  return {bundle,report:{publication_ready:false,selection_finalized:false,review_sealed:false,source_sha:sha,
    authored_cards:rendered.length,public_daily_cards:rendered.filter(card => card.candidate.rank <= 3).length,
    reviews:rendered.map(card => ({work_id:card.work.id,date:card.date,...card.review})),
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
    issue:json(`data/weeks/${week}.json`),shell:read(`semaines/${week}/index.html`),
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
