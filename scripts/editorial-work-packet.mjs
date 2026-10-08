// Read-only extraction of a small editorial work packet from one immutable SHA.
// Matching a catalogue title is an identity lead, never proof of reuse/quality.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const normalizedTitle = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const array = value => Array.isArray(value) ? value : [];
const sameTitle = (a, b) => normalizedTitle(a) !== '' && normalizedTitle(a) === normalizedTitle(b);

export function buildWorkPacket({week, sha, research, inventory, coverage, works, links, manifest, issue, files}, {title, limit = 12} = {}) {
  assert.match(week, /^\d{4}-S\d{2}$/);
  assert(Number.isInteger(limit) && limit > 0 && limit <= 40, 'limit must be 1..40');
  for (const [name, data] of Object.entries({research, inventory, coverage, issue})) {
    if (data) assert.equal(data.week, week, `${name} belongs to another week`);
  }
  const catalogue = array(works?.works);
  const dossiers = [...array(coverage?.documentary_discovery?.candidates), ...array(coverage?.cinema_discovery?.candidates)];
  const observations = array(inventory?.days).flatMap(day => array(day.items).map(item => ({...item, date: day.date})));
  const attempts = array(research?.research_attempts);
  const matches = name => catalogue.filter(work => [work.title, ...array(work.aliases)].some(alias => sameTitle(alias, name)));
  const packet = {
    week, source_sha: sha, stage: research?.stage || null, checkpoint_at: research?.updated_at || null,
    publication_ready: false,
    policy: 'Extraction only. Catalogue fields need provenance review; all cycle-specific availability, ratings, image health, editorial selection and publication gates still apply.',
    remaining: array(research?.remaining),
    delivery: {files, public_latest: manifest?.latest || null, candidate_status: issue?.publication_status || null},
    last_run: array(research?.run_metrics).slice(-1).map(run => ({date: run.date, elapsed_seconds: run.elapsed_seconds,
      stop_reason: run.stop_reason || 'not_recorded', complete_cards: run.newly_verified_complete_cards ?? null}))[0] || null
  };
  if (title) {
    const candidates = matches(title);
    const ids = new Set(candidates.map(work => work.id).filter(Boolean));
    const records = array(research?.verification_records).filter(record =>
      sameTitle(record.title, title) || sameTitle(record.applies_to?.title, title) ||
      (record.work_id && ids.has(record.work_id)));
    packet.work = {
      requested_title: title,
      identity_status: candidates.length > 1 ? 'ambiguous_catalogue_matches' : candidates.length === 1 ? 'catalogue_lead_needs_confirmation' : 'no_catalogue_match',
      canonical_candidates: candidates,
      exact_link_records: Object.entries(links?.links || {}).filter(([name]) => sameTitle(name, title) || candidates.some(work => sameTitle(name, work.title)))
        .map(([name, value]) => ({title: name, links: value})),
      schedule_observations: observations.filter(item => sameTitle(item.title, title)),
      research_dossiers: dossiers.filter(item => sameTitle(item.title, title)),
      verification_records: records,
      research_attempts: attempts.filter(attempt => sameTitle(attempt.object?.title, title)),
      no_automatic_reuse: true
    };
    packet.work.found = Object.values(packet.work).some(value => Array.isArray(value) && value.length > 0);
    packet.work.next_action = candidates.length > 1 ? 'Resolve identity/version before reusing any catalogue field.' :
      'Review saved evidence, complete missing fields and draft/review the card; do not repeat verified searches without a freshness or contradiction reason.';
  } else {
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
    packet.paused_or_excluded = attempts.filter(attempt => /^(paused_|excluded_)/.test(attempt.status || ''))
      .map(attempt => ({id: attempt.id, title: attempt.object?.title, status: attempt.status,
        blocking_scope: attempt.blocking_scope, resume_condition: attempt.resume_condition}));
    // Excluding one offer must not hide other broadcasts of the same film.
    const paused = new Set(packet.paused_or_excluded.filter(item => /^paused_/.test(item.status))
      .map(item => normalizedTitle(item.title)));
    const leads = new Map();
    for (const item of observations) {
      if (paused.has(normalizedTitle(item.title))) continue;
      const candidates = matches(item.title);
      if (!candidates.length) continue;
      const key = normalizedTitle(item.title);
      if (!leads.has(key)) leads.set(key, {title: item.title, canonical_candidates: candidates.map(work => ({
        id: work.id, title: work.title, year: work.year, director: work.director || work.creator,
        fields_present: ['director','year','country','genre','duration','image','ratings'].filter(field => work[field])})),
        identity_status: candidates.length > 1 ? 'ambiguous_catalogue_matches' : 'catalogue_lead_needs_confirmation', observations: 0});
      leads.get(key).observations++;
    }
    packet.catalogue_lead_count = leads.size;
    // Alphabetical presentation; deliberately no mechanical artistic ranking.
    packet.catalogue_leads = [...leads.values()].sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit);
    packet.catalogue_leads_are_recommendations = false;
    packet.catalogue_leads_truncated = leads.size > limit;
  }
  return packet;
}

export function packetFromGit(week, ref, options = {}, cwd = process.cwd()) {
  assert.match(week, /^\d{4}-S\d{2}$/);
  assert(typeof ref === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) && !ref.includes('..'), 'invalid ref');
  const git = args => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore','pipe','pipe']});
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  assert.match(sha, /^[a-f0-9]{40}$/);
  const read = name => {
    const filename = `data/${name}.json`;
    if (!git(['ls-tree', '--name-only', sha, '--', filename]).trim()) return null;
    // Invalid JSON is a real failure, never treated as a missing file.
    return JSON.parse(git(['show', `${sha}:${filename}`]));
  };
  const files = [`data/works.json`, `data/links.json`, `data/releases.json`, `data/manifest.json`,
    ...['inventory','coverage','research','weeks','radar-reserves'].map(name => `data/${name}/${week}.json`),
    `semaines/${week}/index.html`].map(path => ({path, exists: Boolean(git(['ls-tree','--name-only',sha,'--',path]).trim())}));
  const research = read(`research/${week}`), inventory = read(`inventory/${week}`), coverage = read(`coverage/${week}`);
  assert(research && inventory && coverage, 'research, inventory and coverage checkpoints required');
  return buildWorkPacket({week, sha, research, inventory, coverage, works: read('works'), links: read('links'),
    manifest: read('manifest'), issue: read(`weeks/${week}`), files}, options);
}

function main() {
  const [week, ...args] = process.argv.slice(2);
  let ref, title, limit = 12;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    assert(value, 'Usage: WEEK --ref REF [--title TITLE] [--limit 1..40]');
    if (flag === '--ref') ref = value;
    else if (flag === '--title') title = value;
    else if (flag === '--limit') limit = Number(value);
    else throw Error('Unknown flag: ' + flag);
  }
  assert(ref, '--ref required; use an exact candidate ref, never infer a stale checkout');
  console.log(JSON.stringify(packetFromGit(week, ref, {title, limit}), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
