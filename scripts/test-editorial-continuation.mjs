import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditRecordedRun, CONTINUATION_REVISION, PREVIOUS_CONTINUATION_REVISION, DATAFLOW_CONTINUATION_REVISION, INTEGRITY_CONTINUATION_REVISION, EFFICIENCY_CONTINUATION_REVISION, LEGACY_CONTINUATION_REVISION, decideContinuation, nextActions, parseCli} from './editorial-continuation.mjs';

const started_at = '2026-10-09T07:02:51.000Z';
const now = '2026-10-09T07:19:27.285Z';
const lease_until = '2026-10-09T08:02:51.000Z';
const progress = {week: '2026-S42', stage: 'enrichment', remaining: ['Créer les réserves.', 'Achever les choix du lundi.'],
  resume: {next_actions: ['Achever les choix du lundi.']}, run_metrics: [{started_at:'2020-01-01T00:00:00.000Z', elapsed_seconds: 2100}]};
const input = extra => ({progress, started_at, now, lease_owned:'yes', lease_until, ...extra});
const stopObservation = extra => ({reason_code:'tools_blocked', scope:'execution', observed_at:now,
  evidence:'Les outils requis pour toutes les tâches accessibles renvoient une erreur de connexion ; aucune tâche utile ne peut être poursuivie.', ...extra});
const taskChecks = extra => progress.remaining.map(task => ({task, status:'blocked', observed_at:now,
  evidence:'Dépendance exacte contrôlée indisponible ; aucune autre tâche de cette exigence ne peut progresser.', ...extra}));

test('15/17-minute batches continue to actual remaining tasks, not a batch quota', () => {
  for (const observed_at of ['2026-10-09T07:17:51.000Z', now]) {
    const decision = decideContinuation(input({now:observed_at}));
    assert.equal(decision.action, 'continue');
    assert.equal(decision.reason_code, 'next_useful_batch');
    assert.equal(decision.budget_seconds, 3300);
    assert.equal(decision.prompt_revision, CONTINUATION_REVISION);
    assert.equal(decision.reserve_seconds, 300);
    assert.equal(decision.next_actions[0], 'Achever les choix du lundi.');
    assert(decision.next_actions.includes('Créer les réserves.'));
  }
  assert.equal(decideContinuation(input()).elapsed_seconds, 996.285);
  assert.deepEqual(nextActions({...progress, remaining:[], resume:{next_actions:['Stale hint.']}}), []);
});

test('saving reserve begins at 50 minutes; 55 minutes is a soft target, not a hidden runtime limit', () => {
  assert.equal(decideContinuation(input({now:'2026-10-09T07:52:50.000Z'})).action, 'continue');
  for (const at of ['2026-10-09T07:52:51.000Z','2026-10-09T07:57:51.000Z']) {
    assert.equal(decideContinuation(input({now:at})).reason_code, 'budget_reserve_reached');
  }
  assert.equal(decideContinuation(input({now:'2026-10-09T07:37:51.000Z'})).action, 'continue');
});

test('clock/ownership/expiry uncertainty never reconstructs a start from previous metrics', () => {
  assert.equal(decideContinuation(input({started_at:null})).reason_code, 'start_time_unknown');
  assert.equal(decideContinuation(input({started_at:'bad'})).elapsed_seconds, null);
  assert.equal(decideContinuation(input({now:null})).reason_code, 'clock_unknown');
  assert.equal(decideContinuation(input({now:'2026-10-09T07:00:00.000Z'})).reason_code, 'clock_inconsistent');
  assert.equal(decideContinuation(input({lease_owned:'unknown'})).reason_code, 'lease_ownership_unknown');
  assert.equal(decideContinuation(input({lease_until:null})).reason_code, 'lease_expiry_unknown');
  assert.equal(decideContinuation({progress, now}).action, 'unknown');
  assert.equal(decideContinuation(input({now:null, lease_owned:'no'})).reason_code, 'lease_lost');
});

test('actual expired/lost leases and approaching expiry stop even when another batch exists', () => {
  assert.equal(decideContinuation(input({lease_owned:'no'})).reason_code, 'lease_lost');
  assert.equal(decideContinuation(input({lease_until:now})).reason_code, 'lease_expired');
  assert.equal(decideContinuation(input({lease_until:'2026-10-09T07:24:27.285Z'})).reason_code, 'lease_reserve_reached');
  assert.equal(decideContinuation(input({lease_until:'2026-10-09T07:24:28.285Z'})).action, 'continue');
});

test('external stop needs a recognized, dated observation with evidence from this run', () => {
  assert.equal(decideContinuation(input({external_stop:stopObservation()})).reason_code, 'tools_blocked');
  assert.equal(decideContinuation(input({external_stop:stopObservation({reason_code:'interrupted'})})).reason_code, 'external_interruption');
  for (const bad of [{evidence:''}, {observed_at:null}, {observed_at:'2026-10-09T06:50:00.000Z'},
    {observed_at:'2026-10-09T08:00:00.000Z'}, {reason_code:'quota_assumed'}, {reason_code:'checkpoint_saved'}, {scope:'one_source'}]) {
    assert.equal(decideContinuation(input({external_stop:stopObservation(bad)})).action, 'unknown');
  }
});

test('all-blocked requires exact nonempty remaining coverage and actual observed evidence', () => {
  const checks = taskChecks();
  assert.equal(decideContinuation(input({accessible_task_checks:checks})).reason_code, 'all_accessible_tasks_blocked');
  for (const bad of [[], checks.slice(1), [...checks, checks[0]], [checks[0],checks[0]],
    taskChecks({evidence:''}), taskChecks({observed_at:'2026-10-09T06:00:00.000Z'}), taskChecks({status:'unknown'})]) {
    assert.notEqual(decideContinuation(input({accessible_task_checks:bad})).reason_code, 'all_accessible_tasks_blocked');
  }
  assert.equal(decideContinuation(input({progress:{...progress,shortlist:{entries:[]}}})).action, 'continue');
  assert.equal(decideContinuation(input({progress:{...progress,remaining:['Créer les réserves.',null],resume:{}},
    accessible_task_checks:[checks[0]]})).reason_code, 'remaining_unknown');
  const independent = {...progress,resume:{next_actions:['Écrire un radar indépendant.']}};
  assert.equal(decideContinuation(input({progress:independent,accessible_task_checks:checks})).action, 'continue');
  assert.equal(decideContinuation(input({progress:independent,accessible_task_checks:[...checks,
    {task:'Écrire un radar indépendant.',status:'blocked',observed_at:now,evidence:'Dépendance du radar contrôlée indisponible.'}]})).reason_code,'all_accessible_tasks_blocked');
  assert.notEqual(decideContinuation(input({progress:{...progress,remaining:[]}})).reason_code, 'all_accessible_tasks_blocked');
  const partial = decideContinuation(input({accessible_task_checks:[checks[1]]}));
  assert.equal(partial.action, 'continue');
  assert.deepEqual(partial.next_actions, ['Créer les réserves.']);
});

test('ready requires empty remaining, completed review and explicit validated publisher handoff evidence', () => {
  const ready = {...progress, stage:'ready', remaining:[], editorial_review_completed:true};
  const handoff = {validated:true, handed_to_publisher:true, observed_at:now, evidence:'Les contrôles du SHA exact sont terminés et le publicateur protégé a reçu le numéro.'};
  assert.equal(decideContinuation(input({progress:ready,ready_handoff:handoff})).reason_code, 'ready_handed_off');
  assert.equal(decideContinuation(input({progress:ready})).action, 'unknown');
  for (const bad of [{editorial_review_completed:false}, {remaining:['Rechercher une disponibilité.']}, {stage:'enrichment'}]) {
    assert.notEqual(decideContinuation(input({progress:{...ready,...bad},ready_handoff:handoff})).reason_code, 'ready_handed_off');
  }
  for (const bad of [{validated:false}, {handed_to_publisher:false}, {evidence:''}, {observed_at:'2026-10-09T06:00:00.000Z'}]) {
    assert.notEqual(decideContinuation(input({progress:ready,ready_handoff:{...handoff,...bad}})).reason_code, 'ready_handed_off');
  }
});

test('the two real Oct 9 checkpoint-only stops are informative warnings, never hidden-cause claims', () => {
  const reasons = ['two_daily_third_choices_completed_validated_and_checkpoint_ready_for_remote_save_before_active_work_limit',
    'two_coherent_daily_batches_rendered_checked_and_ready_for_remote_save_before_active_work_limit'];
  for (const stop_reason of reasons) {
    const warnings = auditRecordedRun({prompt_revision:'production-shortlist-2026-10-08', started_at, ended_at:now,
      stop_reason, next_useful_batch:'Créer les réserves.'}, progress);
    assert(warnings.some(w => /not a reason to end/.test(w)));
    assert(!warnings.some(w => /before the .*minute work threshold/.test(w)));
    assert(warnings.every(w => !/quota (?:reached|exceeded)|runtime (?:reached|exceeded)/.test(w)));
    const olderFlow = auditRecordedRun({prompt_revision:'production-flow-2026-10-08', started_at, ended_at:now,
      stop_reason, next_useful_batch:'Créer les réserves.'}, progress);
    assert(olderFlow.some(w => /not a reason to end/.test(w)));
    assert(!olderFlow.some(w => /before the .*minute work threshold/.test(w)));
    const unknown = auditRecordedRun({started_at:null, ended_at:now, stop_reason}, progress);
    assert(!unknown.some(w => /before the 30-minute/.test(w)));
  }
});

test('legacy generic metrics stay compatible and the new revision requires a decision', () => {
  assert.deepEqual(auditRecordedRun({prompt_revision:'r', started_at:null, ended_at:null,
    stop_reason:'all_accessible_tasks_blocked', next_useful_batch:'x'}, progress), []);
  assert(auditRecordedRun({prompt_revision:CONTINUATION_REVISION}, progress).some(w => /lacks continuation_decision/.test(w)));
  assert.deepEqual(auditRecordedRun({started_at:null, stop_reason:'manual_scoped_intervention_finished; no_runtime_or_quota_limit_claimed'}, progress), []);
});

test('recorded decisions are replayed from saved observations without repairing dates', () => {
  const decision = decideContinuation(input({now:'2026-10-09T07:52:51.000Z'}));
  const run = {started_at, continuation_decision:decision, prompt_revision:CONTINUATION_REVISION, stop_reason:'budget_reserve_reached'};
  assert.deepEqual(auditRecordedRun(run, progress), []);
  const arbitraryStop = {...decision, action:'stop', reason_code:'tools_blocked'};
  assert(auditRecordedRun({...run, continuation_decision:arbitraryStop}, progress).some(w => /not supported/.test(w)));
  const unknownClock = {...decision, elapsed_seconds:1800};
  assert(auditRecordedRun({...run,started_at:null,continuation_decision:unknownClock}, progress).some(w => /without a known/.test(w)));
  const continued = decideContinuation(input());
  assert(auditRecordedRun({...run, continuation_decision:continued, stop_reason:'two_coherent_daily_batches_rendered_checked_and_ready_for_remote_save_before_active_work_limit'}, progress)
    .some(w => /decision says continue/.test(w)));
  assert(auditRecordedRun({...run, continuation_decision:continued, stop_reason:'any_custom_good_reason'}, progress)
    .some(w => /terminal stop/.test(w)));
  assert(!auditRecordedRun({...run, continuation_decision:continued, run_state:'running',stop_reason:null},progress)
    .some(w => /terminal stop/.test(w)));
  assert(auditRecordedRun({...run,continuation_decision:continued,run_state:'stopped',stop_reason:'checkpoint_in_progress'},progress)
    .some(w => /terminal stop/.test(w)));
  assert(auditRecordedRun({...run, continuation_decision:continued, ended_at:'2026-10-09T07:03:51.000Z'}, progress)
    .some(w => /after ended_at/.test(w)));
  assert(auditRecordedRun({...run,continuation_decision:{...continued,observations:{...continued.observations,
    started_at:'2026-10-09T06:00:00.000Z'}}},progress).some(w => /differs from the recorded run/.test(w)));
});

test('historical 35-minute policy preserves a 30m28 stop; current policy continues on the same observations', () => {
  const snapshot = input({now:'2026-10-09T07:33:19.000Z',prompt_revision:LEGACY_CONTINUATION_REVISION});
  const historical = decideContinuation(snapshot);
  assert.equal(historical.elapsed_seconds,1828);
  assert.equal(historical.action,'stop');
  assert.equal(historical.budget_seconds,2100);
  assert.equal(historical.reason_code,'budget_reserve_reached');
  // Decisions emitted before this change had no saved prompt_revision field.
  delete historical.prompt_revision;
  const oldRun = {started_at,ended_at:snapshot.now,prompt_revision:LEGACY_CONTINUATION_REVISION,
    run_state:'stopped',stop_reason:'budget_reserve_reached',continuation_decision:historical};
  assert.deepEqual(auditRecordedRun(oldRun,progress),[]);
  const current = decideContinuation({...snapshot,prompt_revision:CONTINUATION_REVISION});
  assert.equal(current.action,'continue');
  assert.equal(current.budget_seconds,3300);
  const falselyOldBudget = {...current,action:'stop',reason_code:'budget_reserve_reached',budget_seconds:2100};
  const newRun = {...oldRun,prompt_revision:CONTINUATION_REVISION,continuation_decision:falselyOldBudget};
  assert(auditRecordedRun(newRun,progress).some(w=>/55-minute soft target/.test(w)));
  assert(auditRecordedRun(newRun,progress).some(w=>/not supported/.test(w)));
  const injected = {...historical,observations:{...historical.observations,prompt_revision:CONTINUATION_REVISION}};
  assert.deepEqual(auditRecordedRun({...oldRun,continuation_decision:injected},progress),[]);
  const contradictory = {...historical,prompt_revision:CONTINUATION_REVISION};
  assert(auditRecordedRun({...oldRun,continuation_decision:contradictory},progress).some(w=>/disagrees with the recorded run/.test(w)));
});

test('real saved 7f9 execution retains its 35-minute policy under the new helper', () => {
  // Relevant fields copied from research at dfb6c289a9d1ea19cd60c7c2ab9e5bd21dd7e2bc.
  const oldRun = {owner:'7f9c1d7e-16ae-47a1-840a-afac3ba16831',prompt_revision:LEGACY_CONTINUATION_REVISION,
    started_at:'2026-10-09T08:28:29.664Z',ended_at:'2026-10-09T08:59:15.924Z',run_state:'stopped',stop_reason:'budget_reserve_reached',
    continuation_decision:{action:'stop',reason_code:'budget_reserve_reached',observed_at:'2026-10-09T08:58:57.790Z',
      elapsed_seconds:1828.126,budget_seconds:2100,reserve_seconds:300,next_actions:['Achever deux choix développés du mercredi depuis la shortlist et les dossiers proches d’une carte.'],
      observations:{started_at:'2026-10-09T08:28:29.664Z',lease_owned:'yes',lease_until:'2026-10-09T09:50:06.000Z',
        external_stop:null,accessible_task_checks:[],ready_handoff:null}}};
  assert.deepEqual(auditRecordedRun(oldRun,progress),[]);
  const current = decideContinuation({...oldRun.continuation_decision.observations,progress,
    now:oldRun.continuation_decision.observed_at});
  assert.equal(current.elapsed_seconds,1828.126);
  assert.equal(current.action,'continue');
  assert.equal(current.budget_seconds,3300);
});

test('unknown revisions never select a budget implicitly, and the new revision saves its policy', () => {
  const unknown = decideContinuation(input({prompt_revision:'production-unknown'}));
  assert.equal(unknown.action,'unknown');
  assert.equal(unknown.reason_code,'prompt_revision_unknown');
  assert.equal(unknown.budget_seconds,null);
  const decision = decideContinuation(input());
  delete decision.prompt_revision;
  assert(auditRecordedRun({started_at,prompt_revision:CONTINUATION_REVISION,continuation_decision:decision},progress)
    .some(w=>/lacks prompt_revision/.test(w)));
  assert(auditRecordedRun({started_at,prompt_revision:'production-unknown',continuation_decision:decision},progress)
    .some(w=>/no known run prompt revision/.test(w)));
  assert(auditRecordedRun({prompt_revision:LEGACY_CONTINUATION_REVISION},progress).some(w=>/lacks continuation_decision/.test(w)));
  const legacyCheckpoint = {prompt_revision:LEGACY_CONTINUATION_REVISION,started_at,ended_at:'2026-10-09T07:37:51.000Z',
    stop_reason:'two_daily_third_choices_completed_validated_and_checkpoint_ready_for_remote_save_before_active_work_limit'};
  assert(!auditRecordedRun(legacyCheckpoint,progress).some(w=>/before the .*minute work threshold/.test(w)));
  assert(auditRecordedRun({...legacyCheckpoint,prompt_revision:CONTINUATION_REVISION},progress).some(w=>/before the 50-minute/.test(w)));
});

test('optional paper input and earlier 55-minute revisions preserve the observed work threshold', () => {
  for (const revision of [CONTINUATION_REVISION, PREVIOUS_CONTINUATION_REVISION, DATAFLOW_CONTINUATION_REVISION, INTEGRITY_CONTINUATION_REVISION, EFFICIENCY_CONTINUATION_REVISION]) {
    const before = decideContinuation(input({now:'2026-10-09T07:52:50.000Z',prompt_revision:revision}));
    const after = decideContinuation(input({now:'2026-10-09T07:52:51.000Z',prompt_revision:revision}));
    assert.equal(before.action,'continue');
    assert.equal(after.reason_code,'budget_reserve_reached');
    assert.equal(after.budget_seconds,3300);
    assert.equal(after.reserve_seconds,300);
    assert(auditRecordedRun({prompt_revision:revision},progress).some(w => /lacks continuation_decision/.test(w)));
    const run = {started_at,prompt_revision:revision,ended_at:after.observed_at,
      run_state:'stopped',stop_reason:after.reason_code,continuation_decision:after};
    assert.deepEqual(auditRecordedRun(run,progress),[]);
  }
});

test('CLI parses known clock/lease inputs and rejects accidental unsupported flags', () => {
  const args = ['2026-S42','--ref','abcd','--started-at',started_at,'--now',now,'--lease-owned','yes','--lease-until',lease_until];
  assert.equal(parseCli(args).ref,'abcd');
  assert.equal(parseCli(['2026-S42']).lease_owned,'unknown');
  assert.throws(() => parseCli(['2026-S42','--started-at','bad']), /Invalid ISO/);
  assert.throws(() => parseCli(['2026-S42','--started-at','2026-02-30T00:00:00.000Z']), /Invalid ISO/);
  assert.equal(parseCli(['2026-S42','--started-at','2026-10-08T22:22:46.029748Z']).started_at,'2026-10-08T22:22:46.029748Z');
  assert.throws(() => parseCli(['2026-S42','--lease-owned','sure']), /yes, no or unknown/);
  assert.throws(() => parseCli(['2026-S42','--ref']), /incomplete/);
  assert.throws(() => parseCli(['2026-S42','--prompt-revision',LEGACY_CONTINUATION_REVISION]), /Unknown/);
});

test('CLI pins a git checkpoint, prints a useful action and changes no working file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'editorial-continuation-'));
  const git = args => execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try {
    git(['init','-q']);
    fs.mkdirSync(path.join(dir,'data/research'),{recursive:true});
    const checkpoint = path.join(dir,'data/research/2026-S42.json');
    fs.writeFileSync(checkpoint, JSON.stringify(progress));
    git(['add','.']);
    git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','frozen checkpoint']);
    const sha = git(['rev-parse','HEAD']);
    fs.writeFileSync(checkpoint, JSON.stringify({...progress,remaining:['Working tree change.']}));
    const before = fs.readFileSync(checkpoint,'utf8'), status = git(['status','--porcelain']);
    const script = fileURLToPath(new URL('./editorial-continuation.mjs',import.meta.url));
    const result = JSON.parse(execFileSync(process.execPath,[script,'2026-S42','--ref',sha,'--started-at',started_at,
      '--now',now,'--lease-owned','yes','--lease-until',lease_until],{cwd:dir,encoding:'utf8'}));
    assert.equal(result.source_sha,sha);
    assert.equal(result.prompt_revision,CONTINUATION_REVISION);
    assert.equal(result.budget_seconds,3300);
    assert.equal(result.action,'continue');
    assert(result.next_actions.includes('Créer les réserves.'));
    assert(!result.next_actions.includes('Working tree change.'));
    assert.equal(fs.readFileSync(checkpoint,'utf8'),before);
    assert.equal(git(['status','--porcelain']),status);
    const noStart = JSON.parse(execFileSync(process.execPath,[script,'2026-S42','--ref',sha,'--now',now],{cwd:dir,encoding:'utf8'}));
    assert.equal(noStart.action,'unknown');
    assert.equal(noStart.elapsed_seconds,null);
    const finish = extra => {
      try {
        const output = execFileSync(process.execPath,[script,'2026-S42','--ref',sha,'--finish',...extra],{cwd:dir,encoding:'utf8'});
        return {status:0,decision:JSON.parse(output)};
      } catch (error) {return {status:error.status,decision:JSON.parse(error.stdout)};}
    };
    const known = ['--started-at',started_at,'--now',now,'--lease-owned','yes','--lease-until',lease_until];
    assert.equal(finish(known).status,2);
    assert.equal(finish(['--now',now]).status,2);
    const pastOldBudget = finish(['--started-at',started_at,'--now','2026-10-09T07:37:51.000Z','--lease-owned','yes','--lease-until',lease_until]);
    assert.equal(pastOldBudget.status,2);
    assert.equal(pastOldBudget.decision.action,'continue');
    const saving = finish(['--started-at',started_at,'--now','2026-10-09T07:52:51.000Z','--lease-owned','yes','--lease-until',lease_until]);
    assert.equal(saving.status,0);
    assert.equal(saving.decision.reason_code,'budget_reserve_reached');
    const expired = finish(['--started-at',started_at,'--now',now,'--lease-owned','yes','--lease-until',now]);
    assert.equal(expired.status,0);
    assert.equal(expired.decision.reason_code,'lease_expired');
    assert.equal(fs.readFileSync(checkpoint,'utf8'),before);
    assert.equal(git(['status','--porcelain']),status);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('compact priorities retain counts and all-blocked uses the full untruncated tasks', () => {
  const many = {...progress,remaining:Array.from({length:12},(_,i)=>'Tâche '+i),resume:{next_actions:['Priorité indépendante.']}};
  const decision = decideContinuation(input({progress:many}));
  assert.equal(decision.next_actions.length,5);
  assert.equal(decision.remaining_count,12);
  assert.equal(decision.next_actions_total,13);
  assert.match(decision.truncated_notice,/8 further actions/);
  const checks = nextActions(many).map(task=>({task,status:'blocked',observed_at:now,evidence:'Dépendance vérifiée.'}));
  assert.equal(decideContinuation(input({progress:many,accessible_task_checks:checks})).reason_code,'all_accessible_tasks_blocked');
  assert.equal(decideContinuation(input({progress:many,accessible_task_checks:checks.slice(0,5)})).action,'continue');
});
