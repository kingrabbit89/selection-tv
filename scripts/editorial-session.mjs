// Single continuous production session (Claude Code with a git shell): one
// run_metrics entry per session, timed by phase with the real clock.
// No pass budget, continuation decision or save cadence applies; every
// validator, the sealed review, the lease and the publication chain do.
// Before the week's checkpoint exists (Télérama import on main), the entry
// waits in a journal under the git directory and moves into
// data/research/YYYY-Sxx.json at the first command that finds the checkpoint.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {allowedPaths, isCandidatePoster} from './editorial-handoff.mjs';
import {compactEvidenceGaps} from './editorial-evidence.mjs';

export const SESSION_MODE = 'session';
export const SESSION_REVISION = 'production-session-2026-10-16';
export const SESSION_PHASES = Object.freeze(['import', 'grid_inventory', 'shortlist', 'cards', 'sections', 'checks', 'publication_chain']);
export const HANDED_OFF = 'ready_handed_off';
export const INTERRUPTED = 'interrupted_unobserved';
export const NOTE_MAX = 280;
export const DURATION_BASIS = 'Horloge réelle relevée par scripts/editorial-session.mjs à chaque transition ; les phases peuvent se chevaucher et ne s’additionnent pas.';
export const CHAIN_BASIS = 'La chaîne protégée continue sur GitHub après le dernier commit de la candidate ; sa fin se constate sur latest.html et figure dans le compte rendu de la session.';

const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  ? Date.parse(value) : null;
const open = phase => object(phase) && phase.skipped === undefined && phase.ended_at == null;

export const isSessionRun = run => object(run) && run.mode === SESSION_MODE;

export function newSessionRun(now, revision = SESSION_REVISION) {
  if (instant(now) === null) throw Error('A real ISO clock reading is required');
  return {mode: SESSION_MODE, prompt_revision: revision, started_at: now, ended_at: null, run_state: 'running',
    duration_basis: DURATION_BASIS, phases: {}, deliverables_changed: [], stop_reason: null, next_useful_batch: null};
}

function running(run) {
  if (!isSessionRun(run)) throw Error('No session entry: run `start` first');
  if (run.run_state !== 'running') throw Error('The session is stopped; `resume` it or `start` a new one');
  run.phases ??= {};
}
function knownPhase(name) {
  if (!SESSION_PHASES.includes(name)) throw Error(`Unknown phase ${name}; expected ${SESSION_PHASES.join(', ')}`);
}
// Checked before any change, so a refused note leaves the entry untouched.
function noteFor(note) {
  if (note === undefined) return undefined;
  if (!text(note) || note.length > NOTE_MAX) throw Error(`A phase note is a short text (at most ${NOTE_MAX} characters)`);
  return note.trim();
}
function annotate(phase, note) {
  if (note !== undefined) phase.note = note;
}

export function startPhase(run, name, now, note) {
  running(run); knownPhase(name); note = noteFor(note);
  const phase = run.phases[name];
  if (!phase || phase.skipped !== undefined) run.phases[name] = {started_at: now, ended_at: null};
  else if (open(phase)) throw Error(`Phase ${name} is already running since ${phase.started_at}`);
  // A phase taken up again keeps its first start; the span then covers both.
  else {phase.ended_at = null; phase.reopened_at = [...(phase.reopened_at || []), now];}
  annotate(run.phases[name], note);
}

export function endPhase(run, name, now, note) {
  running(run); knownPhase(name); note = noteFor(note);
  const phase = run.phases[name];
  if (!open(phase)) throw Error(`Phase ${name} is not running`);
  phase.ended_at = now;
  annotate(phase, note);
}

export function skipPhase(run, name, reason) {
  running(run); knownPhase(name);
  if (!text(reason)) throw Error('A skipped phase states why (e.g. import already merged by an earlier session)');
  if (run.phases[name] && run.phases[name].skipped === undefined) throw Error(`Phase ${name} has started; it cannot be skipped`);
  run.phases[name] = {skipped: reason.trim()};
}

export function finishRun(run, {now, stop_reason, next_useful_batch = null, deliverables_changed}) {
  running(run);
  if (!text(stop_reason)) throw Error('--stop-reason is required');
  if (stop_reason === HANDED_OFF) {
    const missing = SESSION_PHASES.filter(name => name !== 'publication_chain' &&
      (!run.phases[name] || open(run.phases[name])));
    const chain = run.phases.publication_chain;
    if (!open(chain)) missing.push('publication_chain (start it, then seal and push)');
    if (missing.length) throw Error('Cannot hand off; end or skip first: ' + missing.join(', '));
    chain.basis = CHAIN_BASIS;
  } else {
    if (!text(next_useful_batch)) throw Error('A session stopping before the handoff records --next (the next useful batch)');
    for (const phase of Object.values(run.phases)) if (open(phase)) phase.ended_at = now;
  }
  Object.assign(run, {ended_at: now, run_state: 'stopped', stop_reason, next_useful_batch: text(next_useful_batch) ? next_useful_batch : null});
  if (deliverables_changed) run.deliverables_changed = deliverables_changed;
}

// The same session continues after its handoff, e.g. to fix a red CI check.
export function resumeRun(run, now) {
  if (!isSessionRun(run) || run.run_state !== 'stopped' || run.stop_reason === INTERRUPTED) throw Error('Only a stopped, observed session can resume');
  Object.assign(run, {run_state: 'running', ended_at: null, stop_reason: null, resumed_at: [...(run.resumed_at || []), now]});
}

/** Informative audit of a session entry. Never certifies or blocks publication. */
export function auditSessionRun(run) {
  if (!isSessionRun(run)) return ['run is not a session entry'];
  const warnings = [], start = instant(run.started_at), end = instant(run.ended_at);
  const stopped = run.run_state === 'stopped', interrupted = run.stop_reason === INTERRUPTED;
  if (!text(run.prompt_revision)) warnings.push('session entry lacks prompt_revision');
  if (start === null) warnings.push('session entry lacks a real started_at (never reconstruct it)');
  if (!['running', 'stopped'].includes(run.run_state)) warnings.push('session run_state must be running or stopped');
  if (!Array.isArray(run.deliverables_changed)) warnings.push('session entry lacks deliverables_changed');
  if (stopped) {
    if (!text(run.stop_reason)) warnings.push('stopped session lacks stop_reason');
    if (run.ended_at == null) {if (!interrupted) warnings.push('stopped session lacks ended_at (only an unobserved interruption leaves it null)');}
    else if (end === null) warnings.push('session ended_at is not a valid ISO time');
    else if (start !== null && end < start) warnings.push('session ended_at precedes started_at');
    if (run.stop_reason !== HANDED_OFF && !interrupted && !text(run.next_useful_batch)) warnings.push('a session stopped before the handoff records next_useful_batch');
  } else if (run.ended_at != null) warnings.push('a running session has no ended_at yet');
  if (!object(run.phases)) return [...warnings, 'session entry lacks phases'];
  for (const name of Object.keys(run.phases)) if (!SESSION_PHASES.includes(name)) warnings.push('unknown phase ' + name);
  for (const name of SESSION_PHASES) {
    const phase = run.phases[name];
    if (phase === undefined) {
      if (stopped && run.stop_reason === HANDED_OFF) warnings.push(`phase ${name} is neither timed nor skipped`);
      continue;
    }
    if (!object(phase)) {warnings.push(`phase ${name} must be an object`); continue;}
    if (phase.skipped !== undefined) {if (!text(phase.skipped)) warnings.push(`phase ${name} is skipped without a reason`); continue;}
    const from = instant(phase.started_at), to = phase.ended_at == null ? null : instant(phase.ended_at);
    if (from === null && !text(phase.basis)) warnings.push(`phase ${name} lacks a real started_at (or null with a basis)`);
    if (phase.ended_at != null && to === null) warnings.push(`phase ${name} ended_at is not a valid ISO time`);
    if (from !== null && to !== null && to < from) warnings.push(`phase ${name} ends before it starts`);
    if (from !== null && start !== null && from < start) warnings.push(`phase ${name} starts before the session`);
    // The publication chain alone outlives the last commit of the candidate.
    if (name !== 'publication_chain' && to !== null && end !== null && to > end) warnings.push(`phase ${name} ends after the session`);
    if (phase.ended_at == null && stopped && !interrupted && !(name === 'publication_chain' && text(phase.basis))) warnings.push(`phase ${name} is still open in a stopped session`);
    if (phase.note !== undefined && !(typeof phase.note === 'string' && phase.note.length <= NOTE_MAX)) warnings.push(`phase ${name} note exceeds ${NOTE_MAX} characters`);
  }
  if (stopped && run.stop_reason === HANDED_OFF && instant(run.phases.publication_chain?.started_at) === null) {
    warnings.push('a handed-off session records when the publication chain started');
  }
  for (const field of ['continuation_decision', 'continuation_decisions']) {
    if (run[field] !== undefined) warnings.push(`${field} belongs to the pass mode; a session does not record it`);
  }
  return warnings;
}

const seconds = phase => {
  const from = instant(phase?.started_at), to = instant(phase?.ended_at);
  return from !== null && to !== null && to >= from ? Math.round((to - from) / 1000) : null;
};

export function sessionSummary(run) {
  if (!isSessionRun(run)) return null;
  return {mode: run.mode, prompt_revision: run.prompt_revision, run_state: run.run_state,
    started_at: run.started_at, ended_at: run.ended_at, stop_reason: run.stop_reason, next_useful_batch: run.next_useful_batch,
    phases: Object.fromEntries(SESSION_PHASES.filter(name => run.phases?.[name]).map(name => {
      const phase = run.phases[name];
      return [name, phase.skipped !== undefined ? {skipped: phase.skipped} : {started_at: phase.started_at ?? null,
        ended_at: phase.ended_at ?? null, span_seconds: seconds(phase)}];
    }))};
}

// ----- Command line -----

const git = (args, cwd) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

export function parseCli(args) {
  const [command, week, ...rest] = args;
  const usage = 'Usage: editorial-session.mjs start|phase|skip|finish|resume|check YYYY-Sxx ...';
  if (!['start', 'phase', 'skip', 'finish', 'resume', 'check'].includes(command)) throw Error(usage);
  if (!/^\d{4}-S\d{2}$/.test(week || '')) throw Error(usage);
  const options = {command, week, positional: []};
  const flags = {'--note': 'note', '--reason': 'reason', '--stop-reason': 'stop_reason', '--next': 'next_useful_batch',
    '--deliverables': 'deliverables', '--base': 'base', '--revision': 'revision', '--file': 'file', '--journal': 'journal'};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--supersede') {options.supersede = true; continue;}
    if (!arg.startsWith('--')) {options.positional.push(arg); continue;}
    if (!(arg in flags) || rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw Error('Unknown or incomplete option: ' + arg);
    options[flags[arg]] = rest[++i];
  }
  if (command === 'phase') {
    const [name, action] = options.positional;
    knownPhase(name);
    if (!['start', 'end'].includes(action)) throw Error('Usage: phase YYYY-Sxx NAME start|end [--note TEXT]');
    Object.assign(options, {name, action});
  } else if (command === 'skip') {
    knownPhase(options.positional[0]);
    options.name = options.positional[0];
  } else if (options.positional.length) throw Error('Unexpected argument: ' + options.positional[0]);
  return options;
}

function loadState(options, cwd) {
  const {week} = options;
  const checkpointPath = path.resolve(cwd, options.file || `data/research/${week}.json`);
  const journalPath = options.journal ? path.resolve(cwd, options.journal)
    : path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd), `selection-tv-session-${week}.json`);
  const progress = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
  if (progress && progress.week !== week) throw Error('The research checkpoint belongs to another week');
  if (progress && progress.run_metrics !== undefined && !Array.isArray(progress.run_metrics)) throw Error('run_metrics must be an array');
  const pending = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null;
  if (pending && (pending.week !== week || !Array.isArray(pending.runs) || !pending.runs.every(isSessionRun))) {
    throw Error('Unreadable session journal: ' + journalPath);
  }
  let adopted = false;
  if (progress && pending) {
    const runs = progress.run_metrics ??= [];
    const last = runs.at(-1);
    if (isSessionRun(last) && last.run_state === 'running' && !pending.runs.some(run => run.started_at === last.started_at)) {
      throw Error('The checkpoint already holds a running session; finish or supersede it before adopting the journal ' + journalPath);
    }
    for (const run of pending.runs) {
      const index = runs.findIndex(saved => isSessionRun(saved) && saved.started_at === run.started_at);
      if (index >= 0) runs[index] = run; else runs.push(run);
    }
    adopted = true;
  }
  return {checkpointPath, journalPath, progress, pending: progress ? null : pending, adopted};
}

function saveState(state) {
  if (state.progress) {
    fs.writeFileSync(state.checkpointPath, JSON.stringify(state.progress, null, 2) + '\n');
    if (fs.existsSync(state.journalPath)) fs.rmSync(state.journalPath);
  } else fs.writeFileSync(state.journalPath, JSON.stringify(state.pending, null, 2) + '\n');
}

const currentRun = state => state.progress ? (state.progress.run_metrics || []).at(-1) : state.pending?.runs.at(-1);

export function changedDeliverables(week, cwd, base = 'origin/main') {
  const since = git(['merge-base', base, 'HEAD'], cwd);
  const changed = [...git(['diff', '--name-only', since], cwd).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n')];
  const allowed = allowedPaths(week);
  const files = [...new Set(changed.filter(p => allowed.has(p)))].sort();
  const posters = new Set(changed.filter(isCandidatePoster)).size;
  return posters ? [...files, `assets/posters/*.webp (${posters})`] : files;
}

export function runCli(args = process.argv.slice(2), {cwd = process.cwd(), clock = () => new Date().toISOString(), log = console.log} = {}) {
  const options = parseCli(args);
  const state = loadState(options, cwd);
  if (options.command === 'check') {
    const run = currentRun(state);
    const report = {week: options.week, location: state.progress ? 'checkpoint' : state.pending ? 'journal' : null,
      session: sessionSummary(run), run_gaps: isSessionRun(run) ? auditSessionRun(run) : ['no session entry recorded'],
      evidence_gaps: state.progress ? compactEvidenceGaps(state.progress) : [],
      notice: 'Informative only: this check never certifies a card, a requirement or the publication.'};
    if (state.adopted) saveState(state);
    log(JSON.stringify(report, null, 2));
    if (report.run_gaps.length || report.evidence_gaps.length) process.exitCode = 2;
    return report;
  }
  const now = clock();
  let run = currentRun(state);
  if (options.command === 'start') {
    if (isSessionRun(run) && run.run_state === 'running') {
      if (!options.supersede) throw Error(`A session started at ${run.started_at} is still running. Continue it, or pass --supersede after a real interruption.`);
      Object.assign(run, {run_state: 'stopped', stop_reason: INTERRUPTED, ended_at: null});
    }
    run = newSessionRun(now, options.revision || SESSION_REVISION);
    if (state.progress) (state.progress.run_metrics ??= []).push(run);
    else (state.pending ??= {week: options.week, runs: []}).runs.push(run);
  } else if (options.command === 'phase') {
    (options.action === 'start' ? startPhase : endPhase)(run, options.name, now, options.note);
  } else if (options.command === 'skip') {
    skipPhase(run, options.name, options.reason);
  } else if (options.command === 'resume') {
    resumeRun(run, now);
  } else {
    const deliverables_changed = options.deliverables !== undefined
      ? options.deliverables.split(',').map(value => value.trim()).filter(Boolean)
      : changedDeliverables(options.week, cwd, options.base);
    finishRun(run, {now, stop_reason: options.stop_reason, next_useful_batch: options.next_useful_batch, deliverables_changed});
  }
  saveState(state);
  const summary = sessionSummary(run);
  log(JSON.stringify({week: options.week, location: state.progress ? 'checkpoint' : 'journal', ...summary}, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {runCli();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
