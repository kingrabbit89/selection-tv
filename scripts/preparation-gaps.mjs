import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {addDays, calendarTarget, parisToday} from './week-calendar.mjs';
import {days, lastRunGaps, shortlistSummary} from './editorial-progress.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildTaskBoard, taskBoardMarkdown} from './editorial-task-board.mjs';

// Informative and non-certifying: runs the existing candidate validators on a
// preparation and lists what still separates it from `ready`. It never fails
// the job, never sets a candidate flag and never replaces --require-ready.
export const validators = ['validate-publication-candidate', 'validate-editorial', 'validate-links',
  'validate-freshness', 'validate-reserves'];
export const notice = 'INFORMATIF, NON CERTIFIANT : un écart absent ne vaut ni vérification ni autorisation de publier ; la barrière --require-ready et tous les contrôles complets restent obligatoires.';

// Bind any reusable report to the actual validator inputs and CI execution.
// Reusing an older report for a newer candidate would hide current defects.
export function inputSnapshot(week, {root = '.', env = process.env} = {}) {
  const files = [];
  const collect = relative => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) for (const name of fs.readdirSync(absolute).sort()) collect(path.posix.join(relative, name));
    else if (stat.isFile()) files.push(relative);
  };
  collect('data'); collect('scripts'); collect('assets'); collect(`semaines/${week}`);
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return {week, sha256: hash.digest('hex'), run_id: env.GITHUB_RUN_ID || null,
    run_attempt: env.GITHUB_RUN_ATTEMPT || null, checkout_sha: env.GITHUB_SHA || null,
    head_ref: env.GITHUB_HEAD_REF || null, validation_date: env.SELECTION_TV_TODAY || parisToday()};
}

export function matchingReport(report, snapshot) {
  return Boolean(report && !report.error && report.week === snapshot.week && report.input_snapshot &&
    ['week', 'sha256', 'run_id', 'run_attempt', 'checkout_sha', 'head_ref', 'validation_date'].every(key => report.input_snapshot[key] === snapshot[key]) &&
    Array.isArray(report.gaps) && Array.isArray(report.validator_results));
}

export function classify(message, {from, sections = []}) {
  const dates = Object.fromEntries(days.map((day, i) => [addDays(from, i), day]));
  const lower = message.toLowerCase();
  const date = Object.keys(dates).find(d => message.includes(d));
  const day = days.find(name => new RegExp(`\\b${name}\\b`).test(lower)) || (date && dates[date]);
  const section = sections.find(id => lower.includes(id.toLowerCase()));
  if (/inventory|inventaire|coverage|couverture|channels|chaînes|reaudit|cross-check|source_pages|overnight/.test(lower)) return {kind: 'coverage', value: day || null};
  if (section && !/-selection$/.test(section)) return {kind: 'rubrique', value: section};
  if (day) return {kind: 'day', value: day};
  if (/radar|hero|toc|sommaire|artifact missing|manifest|shell|coquille/.test(lower)) return {kind: 'deliverable', value: null};
  return {kind: 'global', value: null};
}

export function parseProblems(output) {
  return output.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^[✗!]/.test(line) && !/gate failed: \d+ problem|readiness: \d+ problème/i.test(line))
    .map(line => ({severity: line.startsWith('✗') ? 'blocking' : 'warning', message: line.replace(/^[✗!]\s*/, '')}));
}

export function buildReport({week, from, sections, results, progress, snapshot = null}) {
  const gaps = [];
  let complete = true;
  for (const {validator, output, status, execution_error} of results) {
    if (execution_error) complete = false;
    const problems = parseProblems(output);
    const announced = [...String(output).matchAll(/(?:gate failed:\s*(\d+)\s*problem|Reserve readiness:\s*(\d+)\s*problème)/gi)]
      .map(match => Number(match[1] || match[2]));
    if (announced.some(total => total > problems.filter(problem => problem.severity === 'blocking').length) ||
        validator === 'validate-reserves' && problems.filter(problem => problem.severity === 'warning').length >= 80) complete = false;
    if (status !== 0 && !problems.length) {
      complete = false;
      problems.push({severity: 'blocking', message: `${validator} exited ${status} without a parsable problem line`});
    }
    for (const problem of problems) gaps.push({validator, ...problem, scope: classify(problem.message, {from, sections})});
  }
  const byScope = {};
  for (const gap of gaps) {
    const key = gap.scope.kind + (gap.scope.value ? ':' + gap.scope.value : '');
    byScope[key] = (byScope[key] || 0) + 1;
  }
  return {week, generated_at: new Date().toISOString(), notice, input_snapshot: snapshot,
    validator_results: results.map(({validator, status, execution_error}) => ({validator, status, ...(execution_error ? {execution_error} : {})})),
    task_board: buildTaskBoard({gaps, progress, observationsAvailable: results.length > 0,
      observationsComplete: complete && validators.every(name => results.some(result => result.validator === name))}),
    gap_count: gaps.filter(g => g.severity === 'blocking').length,
    warnings: gaps.filter(g => g.severity === 'warning').length, by_scope: byScope, gaps,
    process: {last_run_gaps: progress ? lastRunGaps(progress) : ['research checkpoint unreadable'],
      shortlist: progress ? shortlistSummary(progress) : null,
      structured_remaining: Array.isArray(progress?.remaining_items)}};
}

export function markdown(report) {
  const lines = [`## Écarts de la préparation ${report.week} avant ready`, '', `> ${report.notice}`, '',
    `${report.gap_count} écart(s) bloquant(s) au sens des validateurs, ${report.warnings} avertissement(s).`, '',
    '| Périmètre | Écarts |', '|---|---|',
    ...Object.entries(report.by_scope).sort().map(([key, count]) => `| ${key} | ${count} |`), ''];
  for (const gap of report.gaps.slice(0, 120)) lines.push(`- [${gap.scope.kind}${gap.scope.value ? ':' + gap.scope.value : ''}] ${gap.validator} : ${gap.message}`);
  if (report.gaps.length > 120) lines.push(`- … ${report.gaps.length - 120} autres dans l'artefact JSON.`);
  if (report.task_board) lines.push('', taskBoardMarkdown(report.task_board));
  lines.push('', '### Suivi de production');
  for (const gap of report.process.last_run_gaps) lines.push('- ' + gap);
  lines.push(`- Présélection : ${report.process.shortlist?.entries ?? 0} piste(s) ; remaining_items ${report.process.structured_remaining ? 'présent' : 'absent'}.`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const week = args.find(a => /^\d{4}-S\d{2}$/.test(a)) || process.env.SELECTION_TV_PREPARATION_WEEK;
  const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  if (!week) {console.log('No preparation week; no gap report.'); return;}
  let report;
  try {
    const read = p => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    const config = read('data/editorial-config.json') || {};
    const manifestEntry = read('data/manifest.json')?.weeks?.find(w => w.week === week);
    const from = read(`data/weeks/${week}.json`)?.from || manifestEntry?.from ||
      (calendarTarget().week === week ? calendarTarget().from : null);
    const sections = [...Object.keys(config.quality_gates?.strict_section_targets || {}), 'avant-disparition',
      ...days.flatMap(day => [day + '-selection', day + '-grille'])];
    const env = {...process.env, SELECTION_TV_VALIDATE_WEEK: week, SELECTION_TV_CANDIDATE: '1'};
    delete env.SELECTION_TV_PREPARATION_WEEK;
    const snapshot = inputSnapshot(week);
    const results = validators.map(validator => {
      const run = spawnSync(process.execPath, [`scripts/${validator}.mjs`], {env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024});
      return {validator, status: run.status ?? 1, execution_error: run.error?.message || run.signal || null,
        output: (run.stdout || '') + '\n' + (run.stderr || '') + (run.error ? '\n✗ ' + run.error.message : '')};
    });
    const inputsUnchanged = matchingReport({week, input_snapshot: snapshot, gaps: [], validator_results: []}, inputSnapshot(week));
    report = buildReport({week, from, sections, results, progress: read(`data/research/${week}.json`), snapshot: inputsUnchanged ? snapshot : null});
    if (!inputsUnchanged) report.task_board.calculated.status = 'partial';
  } catch (error) {
    report = {week, notice, error: 'Gap report unavailable: ' + error.message, gaps: [], by_scope: {}, gap_count: null, warnings: null,
      task_board: buildTaskBoard({observationsAvailable: false}),
      process: {last_run_gaps: [], shortlist: null, structured_remaining: false}};
  }
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const text = report.error ? `## Écarts de la préparation ${week}\n\n> ${notice}\n\n${report.error}\n` : markdown(report);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
