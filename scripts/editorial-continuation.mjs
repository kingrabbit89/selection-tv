import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// A wall-clock work target, not an execution limit or a hidden quota estimate.
// Starting another batch stops at 50 minutes to retain 5 minutes for saving.
// Historical revisions retain their own 55- or 35-minute target during audit.
export const SOFT_BUDGET_SECONDS = 55 * 60;
export const SAVE_RESERVE_SECONDS = 5 * 60;
export const CONTINUATION_REVISION = 'production-closure-2026-10-09';
export const TELERAMA_EDITORIAL_CONTINUATION_REVISION = 'production-telerama-editorial-2026-10-09';
export const PREVIOUS_CONTINUATION_REVISION = 'production-telerama-optional-2026-10-09';
export const DATAFLOW_CONTINUATION_REVISION = 'production-dataflow-2026-10-09';
export const INTEGRITY_CONTINUATION_REVISION = 'production-integrity-2026-10-09';
export const EFFICIENCY_CONTINUATION_REVISION = 'production-efficiency-2026-10-09';
export const LEGACY_CONTINUATION_REVISION = 'production-continuation-2026-10-09';
const legacyBudget = Object.freeze({budget_seconds:35 * 60, reserve_seconds:SAVE_RESERVE_SECONDS});
export const BUDGET_PROFILES = Object.freeze({
  [CONTINUATION_REVISION]:Object.freeze({budget_seconds:SOFT_BUDGET_SECONDS, reserve_seconds:SAVE_RESERVE_SECONDS}),
  [TELERAMA_EDITORIAL_CONTINUATION_REVISION]:Object.freeze({budget_seconds:SOFT_BUDGET_SECONDS, reserve_seconds:SAVE_RESERVE_SECONDS}),
  [PREVIOUS_CONTINUATION_REVISION]:Object.freeze({budget_seconds:SOFT_BUDGET_SECONDS, reserve_seconds:SAVE_RESERVE_SECONDS}),
  [DATAFLOW_CONTINUATION_REVISION]:Object.freeze({budget_seconds:SOFT_BUDGET_SECONDS, reserve_seconds:SAVE_RESERVE_SECONDS}),
  [INTEGRITY_CONTINUATION_REVISION]:Object.freeze({budget_seconds:SOFT_BUDGET_SECONDS, reserve_seconds:SAVE_RESERVE_SECONDS}),
  [EFFICIENCY_CONTINUATION_REVISION]:Object.freeze({budget_seconds:SOFT_BUDGET_SECONDS, reserve_seconds:SAVE_RESERVE_SECONDS}),
  [LEGACY_CONTINUATION_REVISION]:legacyBudget
});
const budgetProfile = revision => Object.hasOwn(BUDGET_PROFILES, revision) ? BUDGET_PROFILES[revision] : null;
const requiresDecision = revision => Object.hasOwn(BUDGET_PROFILES, revision);
const text = value => typeof value === 'string' && value.trim().length > 0;
const array = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values.filter(text))];
function iso(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour < 24 && minute < 60 && second < 60 && (match[7] === undefined || Number(match[7]) < 24 && Number(match[8]) < 60);
}
const milliseconds = value => iso(value) ? Date.parse(value) : null;

// resume supplies priorities, never completion or a replacement for remaining.
export function nextActions(progress) {
  if (!Array.isArray(progress?.remaining) || !progress.remaining.length) return [];
  return unique([...array(progress.resume?.next_actions), ...progress.remaining]);
}

function observedDuringRun(observation, started, now) {
  const at = milliseconds(observation?.observed_at);
  return text(observation?.evidence) && at !== null && started !== null && now !== null && at >= started && at <= now;
}

function readyHandedOff(progress, observation, started, now) {
  return progress?.stage === 'ready' && Array.isArray(progress.remaining) && !progress.remaining.length &&
    progress.editorial_review_completed === true && observation?.validated === true &&
    observation?.handed_to_publisher === true && observedDuringRun(observation, started, now);
}

function allTasksBlocked(progress, checks, started, now) {
  if (!Array.isArray(progress?.remaining) || !progress.remaining.length || !progress.remaining.every(text)) return false;
  // An unreviewed resume hint cannot disappear behind checked requirements.
  const tasks = nextActions(progress);
  if (!tasks.length || checks.length !== tasks.length) return false;
  const checked = checks.map(check => check?.task);
  if (new Set(checked).size !== checked.length || !tasks.every(task => checked.includes(task))) return false;
  // No empty shortlist, missing page or generic blocker certifies this condition.
  return checks.every(check => check.status === 'blocked' && observedDuringRun(check, started, now));
}

/** Pure decision over explicitly supplied observations; never reads prior runs.
 * Inputs are declarations, not independent verification of a remote lease,
 * source quality or successful publisher checks. Callers must observe them.
 * ready_handoff: {validated:true, handed_to_publisher:true, observed_at,evidence}
 * accessible_task_checks: [{task:<exact remaining text or resume hint>,status,observed_at,evidence}]
 */
export function decideContinuation({progress = {}, started_at = null, now = null,
  lease_owned = 'unknown', lease_until = null, external_stop = null,
  accessible_task_checks = [], ready_handoff = null, source_sha = null,
  prompt_revision = CONTINUATION_REVISION} = {}) {
  const profile = budgetProfile(prompt_revision);
  const current = milliseconds(now), started = milliseconds(started_at);
  const elapsed = current !== null && started !== null && current >= started ? (current - started) / 1000 : null;
  const expiry = milliseconds(lease_until);
  const actions = nextActions(progress);
  const observations = {started_at, lease_owned, lease_until, external_stop,
    accessible_task_checks: array(accessible_task_checks), ready_handoff};
  const result = (action, reason_code, next_actions = actions) => ({
    action, reason_code, observed_at: iso(now) ? now : null, elapsed_seconds: elapsed,
    prompt_revision, budget_seconds: profile?.budget_seconds ?? null, reserve_seconds: SAVE_RESERVE_SECONDS,
    week: progress.week || null, source_sha, next_actions: next_actions.slice(0, 5),
    remaining_count: array(progress.remaining).length, next_actions_total: next_actions.length,
    truncated_notice: next_actions.length > 5 ? `${next_actions.length - 5} further actions omitted from display; remaining stays authoritative and all-blocked checks use the full list.` : null,
    observations
  });
  // A directly observed loss of ownership forbids writes even without a clock.
  if (lease_owned === 'no') return result('stop', 'lease_lost');
  if (current === null) return result('unknown', 'clock_unknown');
  if (expiry !== null && current >= expiry) return result('stop', 'lease_expired');
  if (!profile) return result('unknown', 'prompt_revision_unknown');
  if (started === null) return result('unknown', 'start_time_unknown');
  if (current < started) return result('unknown', 'clock_inconsistent');
  if (external_stop !== null) {
    if (!['interrupted', 'tools_blocked'].includes(external_stop?.reason_code) ||
      (external_stop.reason_code === 'tools_blocked' && external_stop.scope !== 'execution') ||
      !observedDuringRun(external_stop, started, current)) return result('unknown', 'external_stop_unsubstantiated');
    return result('stop', external_stop.reason_code === 'interrupted' ? 'external_interruption' : 'tools_blocked');
  }
  if (readyHandedOff(progress, ready_handoff, started, current)) return result('stop', 'ready_handed_off', []);
  if (allTasksBlocked(progress, array(accessible_task_checks), started, current)) return result('stop', 'all_accessible_tasks_blocked');
  if (elapsed >= profile.budget_seconds - profile.reserve_seconds) return result('stop', 'budget_reserve_reached');
  if (lease_owned !== 'yes') return result('unknown', 'lease_ownership_unknown');
  if (expiry === null) return result('unknown', 'lease_expiry_unknown');
  if ((expiry - current) / 1000 <= SAVE_RESERVE_SECONDS) return result('stop', 'lease_reserve_reached');
  if (!Array.isArray(progress.remaining) || progress.remaining.some(task => !text(task))) return result('unknown', 'remaining_unknown');
  // A legacy ready flag cannot bypass unfinished work or the actual handoff.
  if (progress.stage === 'ready' && progress.remaining.length) return result('unknown', 'ready_requirements_unmet');
  if (!progress.remaining.length) return result('unknown', 'no_open_task_or_handoff_evidence');
  const blocked = new Set(array(accessible_task_checks)
    .filter(check => check?.status === 'blocked' && observedDuringRun(check, started, current)).map(check => check.task));
  const usable = actions.filter(task => !blocked.has(task));
  if (!usable.length) return result('unknown', 'task_checks_incomplete');
  return result('continue', 'next_useful_batch', usable);
}

const checkpointStop = reason => typeof reason === 'string' &&
  /(?:ready_for_remote_(?:save|checkpoint)|checkpoint_ready_for_remote_save|ready_for_remote_checkpoint)/.test(reason) &&
  !/(?:next_useful_batch_continued|manual_scoped_intervention)/.test(reason);

/** Informative only. Never rejects a publication or invents an unobserved cause.
 * Legacy generic metrics remain accepted; recognizable checkpoint-only stops
 * and the new revision receive more precise continuation diagnostics.
 */
export function auditRecordedRun(run = {}, progress = {}) {
  const warnings = [];
  const decision = run.continuation_decision;
  // A historical run is evaluated under its own instructions. Numeric budget
  // fields or an injected observation cannot silently select another policy.
  const profile = budgetProfile(run.prompt_revision);
  const checkpoint = checkpointStop(run.stop_reason);
  if (!decision) {
    if (requiresDecision(run.prompt_revision)) warnings.push('last run lacks continuation_decision required by its prompt revision; do not reconstruct observations');
    if (checkpoint) {
      warnings.push('last stop_reason describes a completed batch/checkpoint, which alone is not a reason to end the run; actual stop cause remains unknown');
      const start = milliseconds(run.started_at), end = milliseconds(run.ended_at);
      if (profile && start !== null && end !== null && end >= start && (end - start) / 1000 < profile.budget_seconds - profile.reserve_seconds &&
        (array(progress.remaining).length || text(run.next_useful_batch))) {
        warnings.push(`recorded checkpoint was reached before the ${(profile.budget_seconds - profile.reserve_seconds) / 60}-minute work threshold with unfinished work; no observed permissible stop is recorded (no hidden quota/runtime cause inferred)`);
      }
    }
    return warnings;
  }
  if (!decision || typeof decision !== 'object' || !['continue', 'stop', 'unknown'].includes(decision.action)) {
    return ['last continuation_decision has an invalid action; actual stop cause remains unknown'];
  }
  if (!iso(decision.observed_at)) warnings.push('last continuation_decision lacks a real observed_at; do not reconstruct it');
  if (decision.prompt_revision === undefined && [CONTINUATION_REVISION, PREVIOUS_CONTINUATION_REVISION].includes(run.prompt_revision)) {
    warnings.push('last continuation_decision lacks prompt_revision required by the efficiency policy');
  } else if (decision.prompt_revision !== undefined && decision.prompt_revision !== run.prompt_revision) {
    warnings.push('last continuation_decision prompt_revision disagrees with the recorded run; do not replace its historical policy');
  }
  if (!profile) {
    warnings.push('last continuation_decision has no known run prompt revision; do not infer its budget from numeric fields or another pass');
  } else if (decision.budget_seconds !== profile.budget_seconds || decision.reserve_seconds !== profile.reserve_seconds) {
    warnings.push(`last continuation_decision does not record the ${profile.budget_seconds / 60}-minute soft target and ${profile.reserve_seconds / 60}-minute saving reserve required by its run revision`);
  }
  if (!Array.isArray(decision.next_actions)) warnings.push('last continuation_decision lacks explicit next_actions');
  const start = milliseconds(run.started_at), at = milliseconds(decision.observed_at);
  const end = milliseconds(run.ended_at);
  if (at !== null && end !== null && at > end) warnings.push('last continuation_decision was observed after ended_at and cannot justify this recorded run');
  if (at !== null && start !== null && at < start) warnings.push('last continuation_decision was observed before started_at and cannot justify this recorded run');
  const elapsed = start !== null && at !== null && at >= start ? (at - start) / 1000 : null;
  if (elapsed === null && decision.elapsed_seconds !== null) warnings.push('last continuation_decision claims elapsed time without a known valid start/observation clock');
  if (elapsed !== null && (!Number.isFinite(decision.elapsed_seconds) || Math.abs(elapsed - decision.elapsed_seconds) > 1)) {
    warnings.push('last continuation_decision elapsed_seconds disagrees with its recorded clocks');
  }
  const facts = decision.observations;
  if (!facts || typeof facts !== 'object') {
    warnings.push('last continuation_decision lacks observed lease/stop/task inputs; actual stop cause remains unknown');
    return warnings;
  }
  if (facts.started_at !== (run.started_at ?? null)) warnings.push('last continuation_decision observations.started_at differs from the recorded run start; never substitute another pass clock');
  if (profile) {
    const replay = decideContinuation({...facts, progress, started_at: run.started_at ?? null, now: decision.observed_at,
      prompt_revision:run.prompt_revision});
    if (decision.action !== replay.action || decision.reason_code !== replay.reason_code) {
      warnings.push('last continuation_decision is not supported by its recorded clock, lease, stop and task observations; no hidden cause inferred');
    }
  }
  const intermediate = run.run_state !== 'stopped' && (run.run_state === 'running' || !text(run.stop_reason) || run.stop_reason === 'checkpoint_in_progress');
  if (decision.action === 'continue' && !intermediate && (checkpoint || requiresDecision(run.prompt_revision) || run.run_state === 'stopped')) {
    warnings.push('last decision says continue, but the run records a terminal stop; record a subsequent observed stop or continue the next useful batch');
  }
  return warnings;
}

export function parseCli(args) {
  const options = {week: null, ref: 'HEAD', started_at: null, now: null, lease_owned: 'unknown', lease_until: null,
    external_stop: null, observations_file: null, finish: false};
  const flags = {'--ref':'ref', '--started-at':'started_at', '--now':'now', '--lease-until':'lease_until',
    '--lease-owned':'lease_owned', '--observations':'observations_file', '--external-stop':'external_stop_reason',
    '--external-stop-evidence':'external_stop_evidence', '--external-stop-at':'external_stop_at'};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--finish') {options.finish = true; continue;}
    if (/^\d{4}-S\d{2}$/.test(arg) && !options.week) {options.week = arg; continue;}
    if (!(arg in flags) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Unknown or incomplete option: ' + arg);
    options[flags[arg]] = args[++i];
  }
  if (!options.week) throw Error('Usage: editorial-continuation.mjs YYYY-Sxx --ref SHA --started-at ISO --lease-owned yes --lease-until ISO [--now ISO] [--observations FILE] [--finish]');
  if (!['yes', 'no', 'unknown'].includes(options.lease_owned)) throw Error('--lease-owned must be yes, no or unknown');
  for (const key of ['started_at', 'now', 'lease_until', 'external_stop_at']) if (options[key] !== null && options[key] !== undefined && !iso(options[key])) throw Error('Invalid ISO timestamp: ' + key);
  return options;
}

export function runCli(args = process.argv.slice(2)) {
  const options = parseCli(args);
  // Pin the revision once; never combine checkpoints from moving references.
  const sha = execFileSync('git', ['rev-parse', '--verify', options.ref + '^{commit}'], {encoding: 'utf8'}).trim();
  const progress = JSON.parse(execFileSync('git', ['show', `${sha}:data/research/${options.week}.json`], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
  if (progress.week !== options.week) throw Error('Research checkpoint week mismatch');
  const observations = options.observations_file ? JSON.parse(fs.readFileSync(options.observations_file, 'utf8')) : {};
  const now = options.now || new Date().toISOString();
  // An explicit CLI observation is dated now, never inferred from an old run.
  const external_stop = options.external_stop_reason ? {reason_code: options.external_stop_reason,
    scope:'execution', observed_at: options.external_stop_at || now, evidence: options.external_stop_evidence || null} : observations.external_stop || null;
  const decision = decideContinuation({progress, source_sha: sha, started_at: options.started_at, now,
    lease_owned: options.lease_owned, lease_until: options.lease_until, external_stop,
    accessible_task_checks: observations.accessible_task_checks, ready_handoff: observations.ready_handoff});
  console.log(JSON.stringify(decision, null, 2));
  // Session-finish check only; never wire this exit status into publication CI.
  if (options.finish && decision.action !== 'stop') process.exitCode = 2;
  return decision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {runCli();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
