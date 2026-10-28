// Production kit: the helper steps of a continuous session, between the
// Télérama import and the sealed candidate (AUTOMATION.md, « Kit de
// production »). Each command reads the week's saved sources and the
// producer's work directory; repository files change only with --write.
//
//   node scripts/editorial-kit.mjs <command> YYYY-Sxx --work DIR [options]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkedDate, gitReader, nowInstant, readJson, readOptional, uncommittedJson, weekDates, workDir, writeJson} from './editorial-kit-common.mjs';
import {applyWorkPlan, candidateOverview, fillResolverGaps, normalizePicks, picksWorkPlan, recentTitles, resolverCommands,
  sectionWorkPlan} from './editorial-kit-catalogue.mjs';
import {buildDayPlan, buildSectionPlan} from './editorial-kit-plans.mjs';
import {applyGridReview, buildCoveragePass, buildShortlist, initialResearch, mergeReviewNotes} from './editorial-kit-records.mjs';
import {buildDraftBundle, draftContextFromGit} from './editorial-draft-cards.mjs';

export const COMMANDS = ['init', 'candidates', 'review-notes', 'catalogue', 'fill-fields', 'day-plan', 'section-plan', 'render', 'shortlist', 'coverage-pass', 'grid-review'];
const VALUE_FLAGS = ['--work', '--ref', '--checked-at', '--sources', '--dossier', '--keys', '--report', '--days', '--spec', '--day-plan', '--plan', '--out'];
const BOOLEAN_FLAGS = ['--write', '--replace'];
const USAGE = `Usage: editorial-kit.mjs <${COMMANDS.join('|')}> YYYY-Sxx --work DIR [--ref REF] [--checked-at YYYY-MM-DD] [--write] …
(init needs no --work)`;

export function parseCli(args) {
  const [command, week, ...rest] = args;
  assert(COMMANDS.includes(command), USAGE);
  assert.match(week || '', /^\d{4}-S\d{2}$/, USAGE);
  const options = {command, week, ref: 'HEAD'};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (BOOLEAN_FLAGS.includes(flag)) {options[flag.slice(2)] = true; continue;}
    assert(VALUE_FLAGS.includes(flag), 'unknown flag ' + flag + '\n' + USAGE);
    const value = rest[++index];
    assert(value && !value.startsWith('--'), 'missing value for ' + flag);
    options[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  assert(options.work || command === 'init', '--work DIR required\n' + USAGE);
  return options;
}

const repoJson = file => readJson(path.join(process.cwd(), file));
const print = value => console.log(JSON.stringify(value, null, 2));
const fail = (message, list = []) => {console.error('✗ ' + message); list.forEach(item => console.error('  - ' + item)); process.exitCode = 1;};
const inputs = week => `data/editorial-inputs/${week}`;

// Plans are rendered from a commit: catalogue edits left in the working tree
// would be invisible to editorial-draft-cards.mjs at the same --ref.
function refContext(week, ref) {
  const reader = gitReader(ref);
  assert(!uncommittedJson(reader, 'data/works.json'), 'data/works.json differs from --ref: commit catalogue edits before building or rendering a plan');
  const research = reader.json(`data/research/${week}.json`);
  assert(research, `data/research/${week}.json missing at ${ref}`);
  const telerama = reader.json(`${inputs(week)}/telerama.json`);
  return {reader, week, sha: reader.sha, remaining: research.remaining, works: reader.json('data/works.json').works,
    inventory: reader.json(`data/inventory/${week}.json`), editorial: reader.json(`${inputs(week)}/telerama-editorial.json`),
    pdfSha: telerama?.source?.sha256 || null, research};
}

const commands = {
  init(options) {
    const week = options.week, reader = gitReader(options.ref), file = path.join(process.cwd(), `data/research/${week}.json`);
    assert(!reader.read(`data/research/${week}.json`) && !fs.existsSync(file), `data/research/${week}.json already exists: resume it, never reset it`);
    const research = initialResearch({week, range: 'du ' + weekDates(week).range, baseSha: reader.sha,
      pdfSha: reader.json(`${inputs(week)}/telerama.json`)?.source?.sha256, latest: reader.json('data/manifest.json').latest, now: nowInstant()});
    if (options.write) writeJson(file, research);
    print({written: Boolean(options.write), file, base_sha: research.base_sha, remaining: research.remaining.length});
  },

  candidates(options, work) {
    const reader = gitReader(options.ref);
    const sources = options.sources ? path.resolve(work.dir, options.sources) : null;
    const source = name => sources ? readJson(path.join(sources, name)) : reader.json(`${inputs(options.week)}/${name}`);
    const manifest = reader.json('data/manifest.json'), works = reader.json('data/works.json').works;
    const lookback = Number(reader.json('data/personalization-config.json')?.freshness?.history_lookback_issues || 4);
    const recent = recentTitles({week: options.week, manifest, readIssue: week => reader.json(`data/weeks/${week}.json`), works, lookback});
    const overview = candidateOverview({telerama: source('telerama.json'), editorial: source('telerama-editorial.json'),
      gridRatings: readOptional(work.file('grid-ratings.json')) || {}, history: recent.history, works});
    fs.mkdirSync(path.dirname(work.out('candidates.txt')), {recursive: true});
    fs.writeFileSync(work.out('candidates.txt'), overview.text);
    writeJson(work.out('candidates.json'), overview.rows);
    print({titles: overview.rows.length, history_weeks: recent.weeks, output: work.out('candidates.txt')});
  },

  'review-notes'(options, work) {
    const current = work.file('import/telerama-editorial.json'), raw = work.file('import/telerama-editorial.raw.json');
    if (!fs.existsSync(raw)) fs.copyFileSync(current, raw);
    const {report, unreviewed} = mergeReviewNotes(readJson(raw), readJson(work.file('review-notes.json')), {now: nowInstant()});
    writeJson(current, report);
    print({reviews: report.reviews.length, summaries_reviewed: report.summary.summaries_reviewed, unreviewed, output: current});
  },

  catalogue(options, work) {
    const catalogue = repoJson('data/works.json');
    const dossiers = work.dossiers();
    let rows, output;
    if (options.dossier) {
      const keys = String(options.keys || '').split(',').filter(Boolean);
      const entries = dossiers.filter(entry => entry._file === options.dossier && (!keys.length || keys.includes(entry._key)));
      assert(entries.length, `no dossier entry in ${options.dossier} for keys ${keys.join(',') || '*'}`);
      rows = sectionWorkPlan({entries, catalogue: catalogue.works});
      output = work.out('section-works.json');
      const saved = (readOptional(output) || []).filter(row => !rows.some(next => next.dossier === row.dossier && next.query === row.query));
      writeJson(output, [...saved, ...rows]);
    } else {
      const picks = normalizePicks(readJson(work.file('picks.json')), weekDates(options.week));
      rows = picksWorkPlan({picks, dossiers, catalogue: catalogue.works});
      output = work.out('works-plan.json');
      writeJson(output, rows);
    }
    const summary = {};
    for (const row of rows) summary[row.status] = (summary[row.status] || 0) + 1;
    const open = rows.filter(row => ['clash', 'needs_dossier', 'needs_year'].includes(row.status))
      .map(row => `${row.status} ${row.title}${row.clash ? ' → ' + row.clash.join(', ') : ''}${row.title_matches?.length ? ' (titre au catalogue : ' + row.title_matches.join(', ') + ')' : ''}`);
    let applied = null;
    if (options.write) {
      applied = applyWorkPlan(catalogue.works, rows);
      writeJson(path.join(process.cwd(), 'data/works.json'), catalogue);
    }
    // Resolver commands for the works this intake creates; existing works keep their reviewed fields.
    print({output, statuses: summary, open, applied, next: resolverCommands(rows.filter(row => row.status === 'new').map(row => row.work_id))});
    if (open.length) fail('identities to settle before rendering', open);
  },

  'fill-fields'(options, work) {
    assert(options.report, '--report WORK_RESOLVER_REPORT.json required');
    const catalogue = repoJson('data/works.json');
    const result = fillResolverGaps(catalogue.works, readJson(path.resolve(options.report)), work.dossiers());
    if (options.write) writeJson(path.join(process.cwd(), 'data/works.json'), catalogue);
    print({written: Boolean(options.write), ...result});
    if (result.missing.length) fail('fields still missing (research them on the exact pages)', result.missing.map(row => `${row.work_id}: ${row.fields.join(', ')}`));
  },

  'day-plan'(options, work) {
    const context = refContext(options.week, options.ref);
    const rows = readJson(work.out('works-plan.json'));
    const onlyDays = String(options.days || '').split(',').filter(Boolean);
    const issue = context.reader.json(`data/weeks/${options.week}.json`);
    const existing = Object.keys(issue?.personalization?.pools || {}).filter(id => id.endsWith('-selection')).map(id => id.replace('-selection', ''));
    const {plan, report} = buildDayPlan(context, {rows, copyFor: work.copyFor, dossiers: work.dossiers(), sameChannel: work.sameChannel,
      displayChannel: work.displayChannel,
      checked: checkedDate(options.checkedAt || work.settings.checked_at), gridRanks: Number(work.settings.grid_ranks || 8),
      issueNumber: work.settings.issue_number || null, onlyDays,
      replaceDays: options.replace ? existing.filter(day => !onlyDays.length || onlyDays.includes(day)) : []});
    const output = work.out(options.out || 'plan-days.json');
    writeJson(output, plan);
    print({output, source_sha: plan.source_sha, ...report});
    if (report.problems.length) fail('cards left out of the plan', report.problems);
  },

  'section-plan'(options, work) {
    assert(options.spec, '--spec SECTIONS.json required (path relative to --work)');
    const context = refContext(options.week, options.ref);
    const dayPlanFile = options.dayPlan ? path.resolve(work.dir, options.dayPlan) : work.out('plan-days.json');
    const spec = readJson(path.resolve(work.dir, options.spec));
    const issue = context.reader.json(`data/weeks/${options.week}.json`);
    const {plan, report} = buildSectionPlan(context, {spec, copyFor: work.copyFor, dossiers: work.dossiers(), dayPlan: readOptional(dayPlanFile),
      checked: checkedDate(options.checkedAt || work.settings.checked_at), pconfig: context.reader.json('data/personalization-config.json'),
      settings: work.settings, existingPages: options.replace ? (issue?.pages || []).map(page => page.id) : []});
    const output = work.out(options.out || 'plan-' + path.basename(options.spec));
    writeJson(output, plan);
    print({output, source_sha: plan.source_sha, ...report});
  },

  render(options, work) {
    assert(options.plan, '--plan PLAN.json required');
    const plan = readJson(path.resolve(work.dir, options.plan));
    assert.equal(plan.week, options.week);
    const context = draftContextFromGit(options.week, options.ref);
    assert(!uncommittedJson(gitReader(options.ref), 'data/works.json'), 'data/works.json differs from --ref: commit catalogue edits before rendering');
    const {bundle, report} = buildDraftBundle(context, plan);
    // A fresh name per render: a stale bundle must never be applied by mistake.
    const base = path.basename(options.plan, '.json').replace(/^plan-/, '');
    let n = 1;
    while (fs.existsSync(work.out(`bundle-${base}-${n}.json`))) n++;
    const output = work.out(`bundle-${base}-${n}.json`);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, JSON.stringify(bundle, null, 2) + '\n', {flag: 'wx'});
    writeJson(work.out(`bundle-${base}-${n}-report.json`), report);
    print({output, files: bundle.files.map(file => file.path), authored_cards: report.authored_cards, section_pages: report.section_pages,
      next: [`node scripts/editorial-handoff.mjs check ${output}`, `node scripts/editorial-handoff.mjs apply ${output}`,
        `node scripts/poster-copy.mjs --week ${options.week}   # l'apply remet les affiches rendues sur leur URL distante`]});
  },

  shortlist(options, work) {
    const week = options.week, reader = gitReader(options.ref);
    const editorialPath = `${inputs(week)}/telerama-editorial.json`;
    assert(!uncommittedJson(reader, editorialPath), editorialPath + ' differs from --ref: the review pointers must cite a committed source');
    const context = {week, dates: weekDates(week), issue: repoJson(`data/weeks/${week}.json`), works: repoJson('data/works.json').works,
      editorial: reader.json(editorialPath), editorialSha: reader.lastCommit(editorialPath), inventory: repoJson(`data/inventory/${week}.json`),
      pdfSha: reader.json(`${inputs(week)}/telerama.json`)?.source?.sha256, research: repoJson(`data/research/${week}.json`)};
    const result = buildShortlist(context, {decisions: readOptional(work.file('decisions.json')) || {}, dossiers: work.dossiers(),
      sameChannel: work.sameChannel, checked: checkedDate(options.checkedAt || work.settings.checked_at), now: nowInstant()});
    if (options.write && !result.errors.length) writeJson(path.join(process.cwd(), `data/research/${week}.json`), result.research);
    print({written: Boolean(options.write && !result.errors.length), ...result.report, problems: result.problems, errors: result.errors});
    if (result.errors.length || result.problems.length) fail('shortlist incomplete', [...result.errors, ...result.problems]);
  },

  'coverage-pass'(options, work) {
    const week = options.week;
    const context = {week, dates: weekDates(week), issue: repoJson(`data/weeks/${week}.json`), coverage: repoJson(`data/coverage/${week}.json`),
      editorial: repoJson(`${inputs(week)}/telerama-editorial.json`), inventory: repoJson(`data/inventory/${week}.json`)};
    const docDossier = readJson(path.join(work.dir, 'dossiers', options.dossier || 'DOC.json'));
    const result = buildCoveragePass(context, {docDossier, decisions: readOptional(work.file('decisions.json')) || {},
      checked: checkedDate(options.checkedAt || work.settings.checked_at), sameChannel: work.sameChannel});
    if (options.write && !result.open.length) writeJson(path.join(process.cwd(), `data/coverage/${week}.json`), result.coverage);
    print({written: Boolean(options.write && !result.open.length), ...result.report, open: result.open});
    if (result.open.length) fail('decisions to write in decisions.json (reasons) before saving', result.open);
  },

  'grid-review'(options, work) {
    const week = options.week;
    const result = applyGridReview(repoJson(`data/inventory/${week}.json`), repoJson(`data/coverage/${week}.json`), readJson(work.file('grid-review.json')));
    fs.mkdirSync(path.dirname(work.out('global-fixes.txt')), {recursive: true});
    fs.writeFileSync(work.out('global-fixes.txt'), result.globalChanges.join('\n') + '\n');
    const ok = !result.problems.length && !result.errors.length;
    if (options.write && ok) {
      writeJson(path.join(process.cwd(), `data/inventory/${week}.json`), result.inventory);
      writeJson(path.join(process.cwd(), `data/coverage/${week}.json`), result.coverage);
    }
    print({written: Boolean(options.write && ok), rows: result.coverage.grid_inventory.rows,
      corrections: result.coverage.grid_inventory.transcription_review.corrections_applied, problems: result.problems, errors: result.errors});
    if (!ok) fail('transcription review not applicable as is', [...result.problems, ...result.errors]);
  }
};


export function main(args = process.argv.slice(2)) {
  const options = parseCli(args);
  commands[options.command](options, options.work ? workDir(path.resolve(options.work)) : null);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
