// Read-only extraction of a small editorial work packet from one immutable SHA.
// Matching a catalogue title is an identity lead, never proof of reuse/quality.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {dailyReserveCandidates} from './editorial-contracts.mjs';

export const normalizedTitle = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const array = value => Array.isArray(value) ? value : [];
const hasValue = value => value !== undefined && value !== null && value !== '';
// Keep the validator's normalization exactly, even though identity matching
// handles French ligatures more broadly.
const freshnessTitle = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanHtmlTitle = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function historicalExposure(historicalIssues, catalogue) {
  const index = new Map();
  const add = (title, week, scope) => {
    const key = freshnessTitle(title);
    if (!key) return;
    const rows = index.get(key) || [];
    let row = rows.find(item => item.week === week);
    if (!row) { row = {week, scopes: []}; rows.push(row); }
    if (!row.scopes.includes(scope)) row.scopes.push(scope);
    index.set(key, rows);
  };
  for (const {entry, issue} of historicalIssues) {
    for (const page of array(issue?.pages)) {
      const id = String(page.id || ''), html = String(page.html || '');
      if (/^rendezvous-/.test(id) || /-selection$/.test(id)) {
        for (const match of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)) add(cleanHtmlTitle(match[1]), entry.week, 'public');
      }
      if (/-grille(?:-2)?$/.test(id)) {
        for (const match of html.matchAll(/<td class="prog">([^<]+)<\/td>/g)) add(cleanHtmlTitle(match[1]), entry.week, 'public');
      }
    }
    for (const candidate of dailyReserveCandidates(issue)) add(candidate?.title, entry.week, 'daily_reserve');
    const short = String(entry.short || entry.week?.split('-')[1] || '');
    if (short) for (const work of catalogue) {
      if (array(work.occurrences).some(occurrence => String(occurrence.week || '') === short)) add(work.title, entry.week, 'catalogue_occurrence_fallback');
    }
  }
  return title => index.get(freshnessTitle(title)) || [];
}

function titleIndex(catalogue) {
  const index = new Map();
  for (const work of catalogue) for (const name of [work.title, ...array(work.aliases)]) {
    const key = normalizedTitle(name);
    if (!key) continue;
    const bucket = index.get(key) || [];
    if (!bucket.includes(work)) bucket.push(work);
    index.set(key, bucket);
  }
  return name => index.get(normalizedTitle(name)) || [];
}

// Match a broadcast constraint exactly; do not turn a version/offer-only pause
// into a ban on every airing of the same title.
function pauseCoversObservation(attempt, observation, names) {
  if (!/^paused_/.test(attempt.status || '') || !names.has(normalizedTitle(attempt.object?.title))) return false;
  const object = attempt.object || {};
  const constraints = ['date', 'start', 'channel'].filter(field => hasValue(object[field]));
  if (constraints.length) return constraints.every(field => String(object[field]) === String(observation[field]));
  if (hasValue(object.version)) return hasValue(observation.version) && object.version === observation.version;
  if (hasValue(object.offer) || hasValue(object.platform)) return false;
  return true;
}

function scopeMatchesObservation(scope, observation, week) {
  if (!scope || typeof scope !== 'object') return false;
  if (scope.week && scope.week !== week) return false;
  const channel = scope.channel || array(scope.channels);
  const date = scope.date || scope.grid_date || array(scope.dates);
  const start = scope.start || array(scope.starts);
  const constrained = [channel, date, start].some(value => Array.isArray(value) ? value.length > 0 : hasValue(value));
  if (!constrained) return false;
  return [[channel, observation.channel], [date, observation.date], [start, observation.start]].every(([expected, actual]) =>
    Array.isArray(expected) ? !expected.length || expected.includes(actual) : !hasValue(expected) || expected === actual);
}

export function buildWorkPacket({week, sha, research, inventory, coverage, works, links, manifest, issue, files, historicalIssues = [], historyMissingWeeks = [], freshness = {}}, {title, limit = 12, offset = 0, compact = false} = {}) {
  assert.match(week, /^\d{4}-S\d{2}$/);
  assert(Number.isInteger(limit) && limit > 0 && limit <= 40, 'limit must be 1..40');
  assert(Number.isInteger(offset) && offset >= 0, 'offset must be a nonnegative integer');
  for (const [name, data] of Object.entries({research, inventory, coverage, issue})) {
    if (data) assert.equal(data.week, week, `${name} belongs to another week`);
  }
  for (const {entry, issue: historicalIssue} of historicalIssues) {
    if (historicalIssue?.week) assert.equal(historicalIssue.week, entry.week, 'historical issue belongs to another week');
  }
  const catalogue = array(works?.works);
  const exposure = historicalExposure(historicalIssues, catalogue);
  const dossiers = [...array(coverage?.documentary_discovery?.candidates), ...array(coverage?.cinema_discovery?.candidates)];
  const observations = array(inventory?.days).flatMap(day => array(day.items).map(item => ({...item, date: day.date})));
  const attempts = array(research?.research_attempts);
  const matches = titleIndex(catalogue);
  const packet = {
    week, source_sha: sha, stage: research?.stage || null, checkpoint_at: research?.updated_at || null,
    publication_ready: false,
    policy: 'Extraction only. Catalogue fields need provenance review; all cycle-specific availability, ratings, image health, editorial selection and publication gates still apply.',
    remaining_count: array(research?.remaining).length,
    remaining: compact ? undefined : array(research?.remaining),
    remaining_omitted: compact,
    global_requirements_note: compact ? 'Global requirements are omitted for size, not resolved. Read the full overview before certifying coverage or publication.' : undefined,
    freshness_context: {
      historical_weeks: historicalIssues.map(item => item.entry.week),
      previous_issue: historicalIssues[0]?.entry.week || null,
      missing_issue_files: historyMissingWeeks,
      configured_rules: freshness,
      note: 'Exposure uses validate-freshness title/public/daily-reserve/occurrence semantics. It is a history warning, not identity proof, an artistic ranking or an automatic exclusion. Ratios and exceptions are decided by the unchanged validator on the complete issue.'
    },
    delivery: {files, public_latest: manifest?.latest || null, candidate_status: issue?.publication_status || null},
    last_run: array(research?.run_metrics).slice(-1).map(run => ({date: run.date, elapsed_seconds: run.elapsed_seconds,
      stage: run.stage || null, completed_batches: array(run.completed_batches),
      stop_reason: run.stop_reason || 'not_recorded', next_useful_batch: run.next_useful_batch || run.next_batch || null,
      completed_dossiers: run.newly_completed_editorial_dossiers ?? null,
      complete_cards: run.newly_verified_complete_cards ?? null}))[0] || null
  };
  if (title) {
    const candidates = matches(title);
    const ids = new Set(candidates.map(work => work.id).filter(Boolean));
    const names = new Set([title, ...candidates.flatMap(work => [work.title, ...array(work.aliases)])].map(normalizedTitle).filter(Boolean));
    const titled = value => names.has(normalizedTitle(value));
    const selectedObservations = observations.filter(item => titled(item.title) || ids.has(item.work_id));
    const allRecords = array(research?.verification_records);
    const records = allRecords.filter(record => titled(record.title) || titled(record.applies_to?.title) ||
      array(record.applies_to?.titles).some(titled) || ids.has(record.work_id) || ids.has(record.applies_to?.work_id));
    const direct = new Set(records);
    const scheduleRecords = allRecords.filter(record => !direct.has(record) &&
      typeof record.applies_to === 'object' && !record.applies_to?.title && !array(record.applies_to?.titles).length &&
      !record.work_id && !record.applies_to?.work_id && selectedObservations.some(item => scopeMatchesObservation(record.applies_to, item, week)));
    const unstructuredRecords = allRecords.filter(record => typeof record.applies_to === 'string' &&
      [record.applies_to, record.evidence_note].some(value => [...names].some(name =>
        (' ' + normalizedTitle(value) + ' ').includes(' ' + name + ' '))));
    packet.work = {
      requested_title: title,
      identity_status: candidates.length > 1 ? 'ambiguous_catalogue_matches' : candidates.length === 1 ? 'catalogue_lead_needs_confirmation' : 'no_catalogue_match',
      canonical_candidates: candidates,
      requested_title_historical_exposure: exposure(title),
      canonical_title_historical_exposure: candidates.map(work => ({work_id: work.id, title: work.title, exposure: exposure(work.title)})),
      exact_link_records: Object.entries(links?.links || {}).filter(([name]) => titled(name))
        .map(([name, value]) => ({title: name, links: value})),
      schedule_observations: selectedObservations,
      research_dossiers: dossiers.filter(item => titled(item.title) || ids.has(item.work_id)),
      official_broadcast_observations: array(coverage?.cinema_official_broadcast_observations)
        .filter(item => titled(item.title) || ids.has(item.work_id)),
      verification_records: records,
      supporting_schedule_records: scheduleRecords,
      supporting_schedule_records_note: 'Grid/channel evidence is contextual only; it does not certify work identity, exact version, independent provenance or editorial quality.',
      unstructured_applicability_records: unstructuredRecords,
      unstructured_applicability_note: 'Text matches are research leads with unstructured scope. Inspect applicability before using any claim.',
      research_attempts: attempts.filter(attempt => titled(attempt.object?.title) || ids.has(attempt.object?.work_id)),
      no_automatic_reuse: true
    };
    packet.work.found = Object.values(packet.work).some(value => Array.isArray(value) && value.length > 0);
    packet.work.next_action = candidates.length > 1 ? 'Resolve identity/version before reusing any catalogue field.' :
      'Review saved evidence, complete missing fields and draft/review the card; do not repeat verified searches without a freshness or contradiction reason.';
  } else {
    packet.priority_review = research?.priority_review || null;
    packet.saved_promising_candidates = array(research?.remaining_groups?.promising_candidates);
    packet.coverage = {full_week_reaudit_completed: coverage?.full_week_reaudit_completed === true,
      days: array(inventory?.days).map(day => ({date: day.date, entries: array(day.items).length,
        coverage_flags: array(coverage?.days).filter(row => row.date === day.date).map(row => ({
          primary_scan_complete: row.primary_scan_complete === true,
          independent_crosscheck_complete: row.independent_crosscheck_complete === true,
          editorial_reminder_complete: row.editorial_reminder_complete === true}))}))};
    packet.completed_research_dossiers = dossiers.filter(item => item.dossier_completeness?.status === 'complete_for_editorial_comparison')
      .map(item => ({title: item.title, decision: item.decision,
        publication_work_remaining: item.dossier_completeness.not_yet_publication_ready,
        detail_command_title: item.title}));
    // Raw documentary grid entries are numerous; this index shows only dossiers
    // with actual research and preserves their status without ranking them.
    const researched = new Map();
    for (const item of dossiers) {
      if (!(item.identity_research || array(item.critical_evidence).length || item.dossier_completeness)) continue;
      const key = normalizedTitle(item.title);
      const current = researched.get(key) || {title: item.title, dossier_count: 0, critical_evidence_count: 0, statuses: []};
      current.dossier_count++;
      current.critical_evidence_count += array(item.critical_evidence).length;
      const status = item.dossier_completeness?.status || item.decision || 'unclassified';
      if (!current.statuses.includes(status)) current.statuses.push(status);
      researched.set(key, current);
    }
    packet.researched_dossier_index = [...researched.values()].sort((a,b) => a.title.localeCompare(b.title));
    packet.paused_or_excluded = attempts.filter(attempt => /^(paused_|excluded_)/.test(attempt.status || ''))
      .map(attempt => ({id: attempt.id, title: attempt.object?.title, object: attempt.object, status: attempt.status,
        blocking_scope: attempt.blocking_scope, resume_condition: attempt.resume_condition}));
    // Excluding one offer must not hide other broadcasts of the same film.
    const leads = new Map();
    for (const item of observations) {
      const candidates = matches(item.title);
      if (!candidates.length) continue;
      const names = new Set([item.title, ...candidates.flatMap(work => [work.title, ...array(work.aliases)])].map(normalizedTitle).filter(Boolean));
      if (attempts.some(attempt => pauseCoversObservation(attempt, item, names))) continue;
      const key = normalizedTitle(item.title);
      if (!leads.has(key)) leads.set(key, {title: item.title, canonical_candidates: candidates.map(work => ({
        id: work.id, title: work.title, year: work.year, director: work.director || work.creator,
        historical_exposure: exposure(work.title),
        fields_present: ['director','year','country','genre','duration','image','ratings'].filter(field => work[field])})),
        historical_exposure: exposure(item.title),
        identity_status: candidates.length > 1 ? 'ambiguous_catalogue_matches' : 'catalogue_lead_needs_confirmation', observations: 0});
      leads.get(key).observations++;
    }
    packet.catalogue_lead_count = leads.size;
    const previous = historicalIssues[0]?.entry.week;
    packet.catalogue_history_summary = {
      titles_with_prior_exposure: [...leads.values()].filter(item => item.historical_exposure.length).length,
      titles_in_previous_public_issue: [...leads.values()].filter(item => item.historical_exposure.some(row => row.week === previous && row.scopes.includes('public'))).length,
      titles_in_previous_issue_any_scope: [...leads.values()].filter(item => item.historical_exposure.some(row => row.week === previous)).length,
      note: 'Counts describe saved title history only; they do not prove identity, availability or suitability.'
    };
    // Alphabetical presentation; deliberately no mechanical artistic ranking.
    packet.catalogue_leads = [...leads.values()].sort((a, b) => a.title.localeCompare(b.title)).slice(offset, offset + limit);
    packet.catalogue_lead_offset = offset;
    packet.catalogue_lead_next_offset = offset + limit < leads.size ? offset + limit : null;
    packet.catalogue_leads_are_recommendations = false;
    packet.catalogue_leads_truncated = offset > 0 || leads.size > offset + limit;
  }
  return packet;
}

export function packetFromGit(week, ref, options = {}, cwd = process.cwd()) {
  assert.match(week, /^\d{4}-S\d{2}$/);
  assert(typeof ref === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) && !ref.includes('..'), 'invalid ref');
  const git = args => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore','pipe','pipe']});
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  assert.match(sha, /^[a-f0-9]{40}$/);
  const available = new Set(git(['ls-tree', '-r', '--name-only', sha, '--', 'data', `semaines/${week}`]).trim().split('\n'));
  const read = name => {
    const filename = `data/${name}.json`;
    if (!available.has(filename)) return null;
    // Invalid JSON is a real failure, never treated as a missing file.
    return JSON.parse(git(['show', `${sha}:${filename}`]));
  };
  const files = [`data/works.json`, `data/links.json`, `data/releases.json`, `data/manifest.json`,
    ...['inventory','coverage','research','weeks','radar-reserves'].map(name => `data/${name}/${week}.json`),
    `semaines/${week}/index.html`].map(path => ({path, exists: available.has(path)}));
  const research = read(`research/${week}`), inventory = read(`inventory/${week}`), coverage = read(`coverage/${week}`);
  assert(research && inventory && coverage, 'research, inventory and coverage checkpoints required');
  const manifest = read('manifest'), freshness = read('personalization-config')?.freshness || {};
  const entries = array(manifest?.weeks), index = entries.findIndex(entry => entry.week === week);
  const lookback = Math.max(1, Number(freshness.history_lookback_issues || 4));
  // A draft may not yet be in the public manifest. In that case this is a
  // prospective history warning, not a claim that the validator has run.
  const prior = (index >= 0 ? entries.slice(index + 1) : entries.filter(entry => entry.week < week))
    .filter(entry => entry.status !== 'draft').slice(0, lookback);
  const historyReads = prior.map(entry => ({entry, issue: read(`weeks/${entry.week}`)}));
  const historicalIssues = historyReads.filter(item => item.issue);
  const historyMissingWeeks = historyReads.filter(item => !item.issue).map(item => item.entry.week);
  return buildWorkPacket({week, sha, research, inventory, coverage, works: read('works'), links: read('links'),
    manifest, issue: read(`weeks/${week}`), files, historicalIssues, historyMissingWeeks, freshness}, options);
}

function main() {
  const [week, ...args] = process.argv.slice(2);
  let ref, title, limit = 12, offset = 0, compact = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--compact') { compact = true; continue; }
    const value = args[++i];
    assert(value, 'Usage: WEEK --ref REF [--title TITLE] [--limit 1..40] [--offset N] [--compact]');
    if (flag === '--ref') ref = value;
    else if (flag === '--title') title = value;
    else if (flag === '--limit') limit = Number(value);
    else if (flag === '--offset') offset = Number(value);
    else throw Error('Unknown flag: ' + flag);
  }
  assert(ref, '--ref required; use an exact candidate ref, never infer a stale checkout');
  console.log(JSON.stringify(packetFromGit(week, ref, {title, limit, offset, compact}), null, compact ? 0 : 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
