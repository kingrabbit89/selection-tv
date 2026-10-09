import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function instant(value) {
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(value))) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour < 24 && minute < 60 && second < 60 &&
    (m[7] === undefined || Number(m[7]) < 24 && Number(m[8]) < 60) ? Date.parse(value) : null;
}
function actions(value, name) {
  if (!Array.isArray(value) || value.some(item => !text(item))) throw new Error(`${name} must be an array of nonempty exact action texts`);
  return value;
}

/** Informative scheduling only: never completes a requirement or certifies evidence.
 * Valid explicit retry gates defer exact actions until new evidence is recorded.
 * Historical observations remain historical; they are not fresh blocked checks.
 */
export function planResearchActions(progress, {now, startedAt = null} = {}) {
  if (!object(progress) || typeof progress.week !== 'string' || !/^\d{4}-S(?:0[1-9]|[1-4]\d|5[0-3])$/.test(progress.week)) throw new Error('Invalid research checkpoint/week');
  const current = instant(now);
  if (current === null) throw new Error('A valid current ISO timestamp is required');
  const remaining = actions(progress.remaining, 'remaining');
  if (progress.resume !== undefined && !object(progress.resume)) throw new Error('resume must be an object');
  const resume = progress.resume?.next_actions === undefined ? [] : actions(progress.resume.next_actions, 'resume.next_actions');
  if (progress.run_metrics !== undefined && !Array.isArray(progress.run_metrics)) throw new Error('run_metrics must be an array');
  if (progress.research_attempts !== undefined && !Array.isArray(progress.research_attempts)) throw new Error('research_attempts must be an array');
  const review_warnings = [];
  const runs = (progress.run_metrics || []).filter(object);
  const candidates = runs.filter(run => run.started_at === startedAt);
  const candidate = candidates.length === 1 ? candidates[0] : null;
  const hasPotentialHint = runs.some(run => run.next_useful_batch != null && (run.ended_at == null || instant(run.ended_at) === null || instant(run.ended_at) > current));
  let eligibility = null;
  if (instant(startedAt) === null || instant(startedAt) > current) eligibility = 'missing, invalid or future caller startedAt';
  else if (!candidate) eligibility = 'caller startedAt has no unique exact run match';
  const ended = instant(candidate?.ended_at);
  if (!eligibility && !['running', 'stopped'].includes(candidate.run_state)) eligibility = 'missing or invalid run_state';
  if (!eligibility && candidate.ended_at != null && (ended === null || ended < instant(startedAt))) eligibility = 'invalid ended_at';
  if (!eligibility && candidate.run_state === 'stopped' && candidate.ended_at == null) eligibility = 'stopped run has no dated end';
  if (!eligibility && candidate.ended_at == null && candidate.stop_reason != null) eligibility = 'undated stop_reason';
  if (eligibility && (hasPotentialHint || candidate?.next_useful_batch != null)) review_warnings.push(`Current run batch needs_review: ${eligibility}; remaining and resume preserved`);
  let batch = [];
  // Replay an observation as of its clock, before a subsequently recorded end.
  const running = !eligibility && (ended !== null && ended > current || candidate.ended_at == null && candidate.run_state === 'running');
  if (running) {
    if (text(candidate.next_useful_batch)) batch = [candidate.next_useful_batch];
    else if (candidate.next_useful_batch !== undefined && candidate.next_useful_batch !== null) {
      if (Array.isArray(candidate.next_useful_batch) && candidate.next_useful_batch.every(text)) batch = candidate.next_useful_batch;
      else review_warnings.push('Current run next_useful_batch needs review: expected exact nonempty action texts');
    }
  }
  const all_actions = [...new Set([...batch, ...resume, ...remaining])];
  const known = new Set(all_actions), waiting = new Map();
  for (const [attempt_index, attempt] of (progress.research_attempts || []).entries()) {
    if (!object(attempt) || !Object.hasOwn(attempt, 'retry_gate')) continue;
    const gate = attempt.retry_gate;
    let problem = null;
    if (!object(gate) || !['waiting_for_new_evidence', 'reopened'].includes(gate.state)) problem = 'invalid state';
    else if (!Array.isArray(gate.action_texts) || !gate.action_texts.length || gate.action_texts.some(action => !text(action) || !known.has(action))) problem = 'unmapped or invalid exact action_texts';
    else if (!text(gate.reason) || !text(gate.resume_when) || !text(gate.evidence)) problem = 'missing reason, resume_when or observed evidence';
    const observed = instant(gate?.observed_at), expires = instant(gate?.expires_at);
    if (!problem && (observed === null || observed > current)) problem = 'invalid or future observed_at';
    if (!problem && gate.expires_at !== undefined && (expires === null || expires <= current || expires <= observed)) problem = 'invalid or expired expires_at';
    const reopened = instant(gate?.reopened_at);
    if (!problem && gate.state === 'reopened' && (!text(gate.new_evidence) || gate.new_evidence === gate.evidence || reopened === null || reopened < observed)) problem = 'reopen requires dated new_evidence';
    if (problem) { review_warnings.push(`research_attempts[${attempt_index}].retry_gate needs_review: ${problem}; no action suppressed by this gate`); continue; }
    if (gate.state === 'reopened' && reopened <= current) continue;
    for (const action_text of new Set(gate.action_texts)) {
      if (!waiting.has(action_text)) waiting.set(action_text, []);
      waiting.get(action_text).push({attempt_index, effective_state:'waiting_for_new_evidence', retry_gate:structuredClone(gate)});
    }
  }
  return {all_actions, actionable_actions:all_actions.filter(action => !waiting.has(action)),
    waiting_actions:all_actions.filter(action => waiting.has(action)).map(action_text => ({action_text, gates:waiting.get(action_text)})), review_warnings};
}

export function main(argv = process.argv.slice(2)) {
  const week = argv.shift();
  if (!/^\d{4}-S(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week || '')) throw new Error('Usage: editorial-research-triage.mjs YYYY-Sxx --ref SHA [--now ISO] [--started-at ISO] [--json PATH]');
  let ref = null, now = new Date().toISOString(), startedAt = null, output = null;
  while (argv.length) {
    const flag = argv.shift(), value = argv.shift();
    if (!value || !['--ref', '--now', '--started-at', '--json'].includes(flag)) throw new Error('Unknown or incomplete CLI option');
    if (flag === '--ref') ref = value;
    if (flag === '--now') now = value;
    if (flag === '--started-at') startedAt = value;
    if (flag === '--json') output = value;
  }
  if (!/^[a-f\d]{40}$/i.test(ref || '')) throw new Error('--ref must be an immutable full Git commit SHA');
  const source_sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {encoding:'utf8'}).trim();
  const progress = JSON.parse(execFileSync('git', ['show', `${source_sha}:data/research/${week}.json`], {encoding:'utf8', maxBuffer:32 * 1024 * 1024}));
  if (progress.week !== week) throw new Error('Research checkpoint week mismatch');
  const report = {schema_version:1, week, source_sha, observed_at:now, started_at:startedAt, ...planResearchActions(progress, {now, startedAt})};
  const encoded = JSON.stringify(report, null, 2) + '\n';
  if (output) fs.writeFileSync(output, encoded, {flag:'wx'});
  else process.stdout.write(encoded);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
