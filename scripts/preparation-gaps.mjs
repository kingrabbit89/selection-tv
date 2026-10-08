import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {addDays, calendarTarget} from './week-calendar.mjs';
import {days, lastRunGaps, shortlistSummary} from './editorial-progress.mjs';

// Informative and non-certifying: runs the existing candidate validators on a
// preparation and lists what still separates it from `ready`. It never fails
// the job, never sets a candidate flag and never replaces --require-ready.
export const validators = ['validate-publication-candidate', 'validate-editorial', 'validate-links',
  'validate-freshness', 'validate-reserves'];
export const notice = 'INFORMATIF, NON CERTIFIANT : un écart absent ne vaut ni vérification ni autorisation de publier ; la barrière --require-ready et tous les contrôles complets restent obligatoires.';

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

export function buildReport({week, from, sections, results, progress}) {
  const gaps = [];
  for (const {validator, output, status} of results) {
    const problems = parseProblems(output);
    if (status !== 0 && !problems.length) problems.push({severity: 'blocking', message: `${validator} exited ${status} without a parsable problem line`});
    for (const problem of problems) gaps.push({validator, ...problem, scope: classify(problem.message, {from, sections})});
  }
  const byScope = {};
  for (const gap of gaps) {
    const key = gap.scope.kind + (gap.scope.value ? ':' + gap.scope.value : '');
    byScope[key] = (byScope[key] || 0) + 1;
  }
  return {week, generated_at: new Date().toISOString(), notice, gap_count: gaps.filter(g => g.severity === 'blocking').length,
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
    const results = validators.map(validator => {
      const run = spawnSync(process.execPath, [`scripts/${validator}.mjs`], {env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024});
      return {validator, status: run.status ?? 1, output: (run.stdout || '') + '\n' + (run.stderr || '') + (run.error ? '\n✗ ' + run.error.message : '')};
    });
    report = buildReport({week, from, sections, results, progress: read(`data/research/${week}.json`)});
  } catch (error) {
    report = {week, notice, error: 'Gap report unavailable: ' + error.message, gaps: [], by_scope: {}, gap_count: null, warnings: null,
      process: {last_run_gaps: [], shortlist: null, structured_remaining: false}};
  }
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const text = report.error ? `## Écarts de la préparation ${week}\n\n> ${notice}\n\n${report.error}\n` : markdown(report);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
