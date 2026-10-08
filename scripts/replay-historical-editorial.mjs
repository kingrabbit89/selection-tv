// Offline replay of a frozen, published issue. The production renderer and its
// gates remain unchanged. Outputs are simulations, never importable handoffs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {buildDraftBundle, sectionKinds} from './editorial-draft-cards.mjs';
import {htmlText} from './html-text.mjs';
import {addDays} from './week-calendar.mjs';

const days = ['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
const escape = value => String(value).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notice = 'SIMULATION HISTORIQUE LOCALE — aucune nouvelle recherche, aucune sélection nouvelle, aucune validation de S42, aucune publication.';
const remaining = ['Simulation seulement : aucune publication ni certification de S42.', 'Conserver et traiter les lacunes historiques explicites avant toute nouvelle décision éditoriale.'];
const sectionFor = id => Object.entries(sectionKinds).find(([,kind]) => Array.from({length:kind.pages},(_,i) => kind.pageId(i+1)).includes(id))?.[0];
const divText = (html,cls) => htmlText(html.match(new RegExp('<div class="'+cls+'"[^>]*>([\\s\\S]*?)<\\/div>'))?.[1] || '');

export function frozenSnapshot(week, ref = 'HEAD', cwd = process.cwd()) {
  assert.match(week,/^\d{4}-S\d{2}$/,'explicit historical week required');
  const git = args => execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024});
  const sha = git(['rev-parse','--verify',ref+'^{commit}']).trim();
  const files = new Map();
  for (const name of ['data/manifest.json','data/works.json','data/links.json','data/releases.json',
    `data/weeks/${week}.json`,`data/inventory/${week}.json`,`data/coverage/${week}.json`,
    `data/radar-reserves/${week}.json`,`semaines/${week}/index.html`,'assets/css/magazine.css']) {
    try {files.set(name,git(['show',sha+':'+name]));} catch {assert(!['data/manifest.json','data/works.json','data/links.json',`data/weeks/${week}.json`].includes(name),'required snapshot missing: '+name);}
  }
  const readJson = name => files.has(name) ? JSON.parse(files.get(name)) : null;
  const issue = readJson(`data/weeks/${week}.json`), manifest = readJson('data/manifest.json');
  assert(issue.publication_status === 'published' || manifest.latest === week || manifest.weeks.some(e => e.week === week && e.status === 'published'),'historical published issue required');
  assert.equal(issue.week,week); assert.equal(issue.page_count,issue.pages.length);
  return {week,sha,files,issue,manifest,works:readJson('data/works.json'),links:readJson('data/links.json'),
    inventory:readJson(`data/inventory/${week}.json`),coverage:readJson(`data/coverage/${week}.json`),radar:readJson(`data/radar-reserves/${week}.json`)};
}

// Exact frozen titles/aliases only; ambiguous names never become inferred IDs.
function identify(snapshot, title) {
  const matches = snapshot.works.works.filter(w => [w.title,...(w.aliases || [])].includes(title));
  return matches.length === 1 ? matches[0].id : undefined;
}
function inventoryMatches(snapshot,candidate) {
  return (snapshot.inventory?.days || []).flatMap(day => (day.items || []).filter(item =>
    item.title === candidate.title && item.channel === candidate.channel && item.start === candidate.time)
    .map(item => ({date:day.date,source_url:item.source_url,source:item.source})));
}
export function historicalDecisions(snapshot) {
  const records = [], pools = snapshot.issue.personalization?.pools || {};
  for (const [page,pool] of Object.entries(pools)) for (const [index,candidate] of pool.candidates.entries()) {
    const matches = inventoryMatches(snapshot,candidate);
    const dates = [...new Set(matches.map(m => m.date))];
    const dayIndex = days.indexOf(page.replace(/-selection$/,''));
    const date = dayIndex >= 0 ? addDays(snapshot.issue.from,dayIndex) : dates.length === 1 ? dates[0] : undefined;
    const grid = snapshot.issue.pages.find(p => p.id === page.replace(/-selection$/,'-grille'));
    const row = [...(grid?.html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]).find(html =>
      htmlText(html.match(/<td class="prog"[^>]*>([\s\S]*?)<\/td>/)?.[1] || '') === candidate.title &&
      htmlText(html.match(/<td class="time"[^>]*>([\s\S]*?)<\/td>/)?.[1] || '') === candidate.time &&
      htmlText(html.match(/<td class="chan"[^>]*>([\s\S]*?)<\/td>/)?.[1] || '') === candidate.channel);
    const gridReason = htmlText(row?.match(/<td class="reason"[^>]*>([\s\S]*?)<\/td>/)?.[1] || '');
    const release = sectionFor(page) === 'physical_release' ? {date:candidate.release_date,format:candidate.format,
      editor:candidate.editor,url:candidate.release_url,checked_at:candidate.release_checked,
      ...Object.fromEntries(['price','restoration','bonuses'].filter(k => candidate[k] !== undefined).map(k => [k,candidate[k]]))} : null;
    records.push({source:`data/weeks/${snapshot.week}.json#/personalization/pools/${page}/candidates/${index}`,
      page,kind:dayIndex >= 0 ? 'daily' : sectionFor(page),role:index < Number(pool.target) ? 'selected' : 'reserve',
      source_rank:candidate.rank ?? index+1,candidate:{...candidate,...(date ? {date} : {}),
        ...(gridReason ? {grid_reason:gridReason} : {}),...(release ? {release} : {})},evidence:matches});
  }
  for (const page of snapshot.issue.pages.filter(p => !pools[p.id])) {
    const kind = sectionFor(page.id); if (!kind) continue;
    for (const [index,match] of [...page.html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].entries()) {
      const html = match[0], title = htmlText(html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] || '');
      const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => htmlText(m[1]));
      const why = htmlText(html.match(/<div class="(?:why2|interest)"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || '');
      records.push({source:`data/weeks/${snapshot.week}.json#/pages/${page.id}/article/${index}`,page:page.id,kind,role:'selected',
        source_rank:index+1,candidate:{title,work_id:identify(snapshot,title),rank:index+1,
          summary:paragraphs.length > (why ? 1 : 0) ? paragraphs[0] : '',why,added:divText(html,'added'),
          frozen_display_facts:{service:divText(html,'service'),availability:divText(html,'where'),
            arrival_or_release:divText(html,'date') || divText(html,'rel-date'),authored_paragraphs:paragraphs}},evidence:[]});
    }
  }
  for (const [key,pool] of Object.entries(snapshot.radar || {})) if (pool?.candidates) {
    const kind = key === 'popular_scan' ? 'radar_popularity_scan' : key === 'popular_deep' ? 'radar_popularity' : 'radar_hd';
    for (const [index,candidate] of pool.candidates.entries()) records.push({source:`data/radar-reserves/${snapshot.week}.json#/${key}/candidates/${index}`,
      page:pool.page_id || sectionKinds[kind].pageId(key === 'hd2' ? 2 : 1),kind,role:'radar-reserve-file',source_rank:candidate.rank ?? index+1,candidate:{...candidate,rank:candidate.rank ?? index+1},evidence:[]});
  }
  return records;
}

// A separate, private context treats the frozen issue as a historical draft.
// No handoff is written: its fictitious manifest digests cannot apply publicly.
function simulationContext(snapshot, withIssue = false) {
  const manifest = structuredClone(snapshot.manifest);
  manifest.latest = manifest.weeks.find(e => e.week !== snapshot.week && e.from < snapshot.issue.from)?.week;
  assert(manifest.latest,'a previous public week is required for isolated replay');
  const entry = manifest.weeks.find(e => e.week === snapshot.week); if (entry) entry.status = 'draft';
  const issue = withIssue ? {...structuredClone(snapshot.issue),publication_status:'draft'} : null;
  const reads = new Map(snapshot.files);
  reads.set('data/manifest.json',json(manifest));
  reads.set(`data/weeks/${snapshot.week}.json`,issue ? json(issue) : '');
  return {sha:snapshot.sha,manifest,works:snapshot.works,links:snapshot.links,issue,
    shell:snapshot.files.get(`semaines/${snapshot.week}/index.html`),read:name => reads.get(name) || '',radar_reserves:snapshot.radar};
}
function reviewEntry(snapshot,record,checkedAt) {
  const work = snapshot.works.works.find(w => w.id === record.candidate.work_id);
  const evidence = [...new Set([...record.evidence.map(m => m.source_url),work?.image_source_url,
    ...Object.values(record.candidate.links || {}),...Object.values(work?.links || {}),
    ...Object.values(snapshot.links.links[work?.title] || {})].filter(v => typeof v === 'string' && /^https?:\/\//.test(v)))];
  const note = 'Relecture technique du snapshot '+snapshot.sha+' ; aucune nouvelle consultation. Source : '+record.source;
  return {...record.candidate,review:{checked_at:checkedAt,evidence_urls:evidence,
    identity_version:note,canonical_fields:note,current_broadcast:note,editorial_copy:note}};
}
function missingFacts(snapshot,record) {
  const c = record.candidate, w = snapshot.works.works.find(w => w.id === c.work_id), missing = [];
  if (!w) missing.push('unambiguous canonical work_id');
  for (const key of ['country','genre','duration','image','image_source_url','image_checked']) if (!w?.[key]) missing.push('work.'+key);
  if (!w?.director && !w?.creator) missing.push('work.director/creator');
  if (!/^\d{4}$/.test(String(w?.year || ''))) missing.push('work.year');
  if (w?.ratings && Object.values(w.ratings).some(v => String(v).trim())) {if (!w.ratings_checked) missing.push('work.ratings_checked');}
  else if (!w?.ratings_unavailable_reason) missing.push('work.ratings_unavailable_reason');
  if (!c.summary?.trim()) missing.push('authored synopsis'); if (!c.why?.trim()) missing.push('authored editorial justification');
  if (['daily','rendezvous'].includes(record.kind) && !c.date) missing.push('unambiguous broadcast date');
  if (['replay','platform_free','platform_subscription','streaming_release','expiring'].includes(record.kind)) {
    for (const key of ['service','url','checked_at']) if (!c.offer?.[key]) missing.push('offer.'+key);
    const date = {replay:'available_until',streaming_release:'arrival_date',expiring:'last_day'}[record.kind];
    if (date && !c.offer?.[date]) missing.push('offer.'+date);
  }
  if (record.kind === 'physical_release') for (const key of ['date','format','editor','url','checked_at']) if (!c.release?.[key]) missing.push('release.'+key);
  if (record.kind?.startsWith('radar_popularity')) for (const key of ['signal','signal_source_url']) if (!c[key]) missing.push(key);
  if (record.kind === 'radar_hd') for (const key of ['added','added_source_url']) if (!c[key]) missing.push(key);
  return missing;
}
function planFor(snapshot,records,checkedAt,{probe = false} = {}) {
  const entries = records.map(record => ({...reviewEntry(snapshot,record,checkedAt),...(probe ? {rank:1} : {})}));
  const plan = {schema_version:1,week:snapshot.week,from:snapshot.issue.from,range:snapshot.issue.range,
    source_sha:snapshot.sha,remaining,render_toc:true};
  if (records[0].kind === 'daily') plan.cards = entries;
  else plan.sections = [{kind:records[0].kind,page:Number(records[0].page?.match(/-(\d+)$/)?.[1] || 1),
    header:{kicker:'Simulation historique',h1:records[0].page,deck:notice},cards:entries}];
  return plan;
}
const issueOf = result => JSON.parse(result.bundle.files.find(f => f.path.startsWith('data/weeks/')).content);

export function replaySnapshot(snapshot,{checked_at = new Date().toISOString().slice(0,10)} = {}) {
  const start = performance.now(), records = historicalDecisions(snapshot), probes = [], completeGroups = [];
  for (const record of records) {
    const missing = missingFacts(snapshot,record);
    try {
      assert(record.kind,'supported historical section required');
      const result = buildDraftBundle(simulationContext(snapshot),planFor(snapshot,[record],checked_at,{probe:true}));
      probes.push({...record,status:'rendered',missing_structured_fields:missing,technical_position:1,
        pages:issueOf(result).pages,review_scope:'frozen snapshot only; checked_at is technical replay date, not a source consultation'});
      probes.at(-1).technical_review = result.report.reviews[0];
    } catch (error) {probes.push({...record,status:'rejected',missing_structured_fields:missing,error:error.message});}
  }
  // Whole pools retain every real rank, including reserves. Nothing is selected,
  // reordered or omitted to make a complete page pass today's stronger checks.
  for (const [page,pool] of Object.entries(snapshot.issue.personalization?.pools || {})) {
    const group = records.filter(r => r.source.startsWith(`data/weeks/${snapshot.week}.json#/personalization/pools/${page}/`));
    try {
      const result = buildDraftBundle(simulationContext(snapshot),planFor(snapshot,group,checked_at));
      completeGroups.push({page,status:'rendered',candidates:pool.candidates.length,pages:issueOf(result).pages});
    } catch (error) {completeGroups.push({page,status:'rejected',candidates:pool.candidates.length,error:error.message});}
  }
  const missingCounts = {};
  for (const p of probes) for (const field of p.missing_structured_fields) missingCounts[field] = (missingCounts[field] || 0)+1;
  return {simulation:true,notice,week:snapshot.week,source_sha:snapshot.sha,technical_replay_date:checked_at,
    publication_ready:false,selection_finalized:false,new_source_consultations:0,certifies_s42:false,
    renderer:{file:'scripts/editorial-draft-cards.mjs',sha256:hash(fs.readFileSync(new URL('./editorial-draft-cards.mjs',import.meta.url)))},
    archive:{pages:snapshot.issue.pages.map(p => p.id),page_count:snapshot.issue.pages.length,
      pools:Object.fromEntries(Object.entries(snapshot.issue.personalization?.pools || {}).map(([id,p]) => [id,{target:p.target,candidates:p.candidates.length,selected:Math.min(p.target,p.candidates.length),reserves:Math.max(0,p.candidates.length-p.target)}])),
      radar_candidates:Object.fromEntries(Object.entries(snapshot.radar || {}).filter(([,v]) => v?.candidates).map(([k,v]) => [k,v.candidates.length])),
      original_consultation_markers:{coverage_rebuilt:snapshot.coverage?.rebuilt,works_updated:snapshot.works.updated},
      files:[...snapshot.files].map(([file,content]) => ({file,sha256:hash(content)}))},
    strict:{attempted:probes.length,rendered:probes.filter(p => p.status === 'rendered').length,
      rejected:probes.filter(p => p.status === 'rejected').length,missing_structured_fields:missingCounts,
      gap_scope:'Required structured builder inputs absent in the frozen JSON/explicit card. Preserved HTML display facts are not newly consulted evidence; a gap does not establish that a historical fact is false.',
      complete_groups:completeGroups,probes},
    timings:{strict_builder_ms:Math.round((performance.now()-start)*100)/100,
      meaning:'Local extraction/rendering of frozen evidence only. Historical research, image consultation and editorial decision time are not simulated.'}};
}

export function writeReplay(snapshot,report,output,cwd = process.cwd()) {
  const requested = path.resolve(output), repo = fs.realpathSync(cwd);
  let existing = requested;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const destination = path.resolve(fs.realpathSync(existing),path.relative(existing,requested));
  assert(destination !== repo && !destination.startsWith(repo+path.sep),'simulation output must be outside the source repository');
  // Refuse every existing git checkout, including another worktree.
  for (let ancestor = destination; ; ancestor = path.dirname(ancestor)) {
    assert(!fs.existsSync(path.join(ancestor,'.git')),'simulation output cannot be written inside a git checkout');
    if (path.dirname(ancestor) === ancestor) break;
  }
  assert(!fs.existsSync(destination),'use a new empty output directory'); fs.mkdirSync(destination,{recursive:true});
  for (const [name,content] of snapshot.files) {const file = path.join(destination,'frozen',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
  const css = snapshot.files.get('assets/css/magazine.css') || '';
  const pageHtml = snapshot.issue.pages.map(p => `<section id="${escape(p.id)}" class="${escape(p.className)}">${p.html}</section>`).join('\n');
  fs.writeFileSync(path.join(destination,'archive-preview.html'),`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Simulation ${escape(snapshot.week)}</title><style>${css}</style><body><p style="padding:1em;font-weight:bold">${notice} Source ${snapshot.sha}.</p>${pageHtml}</body></html>`);
  const probeHtml = report.strict.probes.filter(p => p.status === 'rendered').map((probe,index) =>
    `<div style="padding:1em;font-weight:bold">Sonde ${index+1} — ${escape(probe.candidate.title)} ; rang historique ${probe.source_rank}, position technique 1, ${escape(probe.role)}. Structure compatible seulement.</div>`+
    probe.pages.filter(p => p.id !== 'sommaire').map(p => `<section class="${escape(p.className)}">${p.html}</section>`).join('')).join('\n');
  fs.writeFileSync(path.join(destination,'strict-preview.html'),`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Sondes locales ${escape(snapshot.week)}</title><style>${css}</style><body><p style="padding:1em;font-weight:bold">${notice} Ces cartes isolées ne constituent aucun numéro final.</p>${probeHtml}</body></html>`);
  fs.writeFileSync(path.join(destination,'replay-report.json'),json(report));
  fs.writeFileSync(path.join(destination,'SIMULATION.md'),`# Simulation historique ${snapshot.week}\n\n${notice}\n\nSource immuable : ${snapshot.sha}. Le dossier frozen conserve les fichiers originaux et leurs dates. L’aperçu restitue les ${report.archive.page_count} pages originales ; il ne vérifie pas leur fraîcheur actuelle.\n\nLe builder actuel a rendu ${report.strict.rendered}/${report.strict.attempted} sondes individuelles et ${report.strict.complete_groups.filter(g => g.status === 'rendered').length}/${report.strict.complete_groups.length} pools complets. Chaque sonde garde son rang historique dans source_rank ; technical_position=1 sert uniquement au test isolé, sans nouvelle sélection. Les refus restent explicites dans replay-report.json. Aucune consultation n’a été ajoutée ; technical_replay_date date seulement cette relecture locale.\n\nTemps mesuré du rendu strict : ${report.timings.strict_builder_ms} ms. Ce temps exclut le travail historique de recherche et de décision. Aucun handoff importable ni certificat de publication n’est produit.\n`);
  return destination;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [week,ref,output] = process.argv.slice(2); assert(output,'usage: node scripts/replay-historical-editorial.mjs WEEK REF NEW_OUTPUT_DIRECTORY');
  const started = performance.now(), snapshot = frozenSnapshot(week,ref), report = replaySnapshot(snapshot);
  report.timings.snapshot_and_replay_ms = Math.round((performance.now()-started)*100)/100;
  writeReplay(snapshot,report,output);
  console.log(json({output:path.resolve(output),source_sha:snapshot.sha,archive_pages:report.archive.page_count,
    strict_probes:{attempted:report.strict.attempted,rendered:report.strict.rendered,rejected:report.strict.rejected},
    complete_pools:report.strict.complete_groups.map(g => ({page:g.page,status:g.status})),timings:report.timings}));
}
