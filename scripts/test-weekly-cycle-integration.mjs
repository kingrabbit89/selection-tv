import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {addDays, calendarTarget, validateCandidateCalendar} from './week-calendar.mjs';
import {allowedPaths, digest, planImport} from './editorial-handoff.mjs';
import {inputSnapshot, buildReport, validators} from './preparation-gaps.mjs';
import {reviewedCandidate, checksPass} from './weekly-publisher.mjs';
import {inspectWeek, watchdogTarget} from './weekly-watchdog.mjs';
import {validateTransition} from './validate-promotion-transition.mjs';
import {testEnvironment} from './run-test-isolation.mjs';

// Synthetic lifecycle integration, not a factual/editorial review. The real
// CLI programs write only to a disposable Git repository. No GitHub API,
// remote push, public deployment, copied production checkpoint or network.
const sequences = [
  {name: 'S42 to S43 to S44', previous: '2026-10-03', zone: 'UTC', cycles: [
    ['2026-10-09', '2026-S42', '2026-10-10'], ['2026-10-16', '2026-S43', '2026-10-17'], ['2026-10-23', '2026-S44', '2026-10-24']]},
  {name: 'ISO week 53 and year rollover', previous: '2026-12-19', zone: 'Pacific/Kiritimati', cycles: [
    ['2026-12-25', '2026-S53', '2026-12-26'], ['2027-01-01', '2027-S01', '2027-01-02'], ['2027-01-08', '2027-S02', '2027-01-09']]},
  {name: 'spring daylight-saving transition', previous: '2026-03-14', zone: 'America/Los_Angeles', cycles: [
    ['2026-03-20', '2026-S13', '2026-03-21'], ['2026-03-27', '2026-S14', '2026-03-28'], ['2026-04-03', '2026-S15', '2026-04-04']]},
  {name: 'autumn daylight-saving transition', previous: '2026-10-17', zone: 'Europe/Paris', cycles: [
    ['2026-10-23', '2026-S44', '2026-10-24'], ['2026-10-30', '2026-S45', '2026-10-31'], ['2026-11-06', '2026-S46', '2026-11-07']]}
];

function sandbox(t, previous) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-week-sequence-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const env = testEnvironment();
  const git = (...args) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const write = (p, value) => {fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true}); fs.writeFileSync(path.join(root, p), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');};
  const read = p => fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null;
  const json = p => JSON.parse(read(p));
  const commit = label => {git('add', 'data', 'semaines'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', label); return git('rev-parse', 'HEAD');};
  const run = (script, args, overrides) => spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args],
    {cwd: root, env: testEnvironment(process.env, overrides), encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024});
  const target = calendarTarget(previous);
  write('data/manifest.json', {latest: target.week, weeks: [{...target, status: 'published'}]});
  write(`data/weeks/${target.week}.json`, {...target, publication_status: 'published', pages: []});
  write(`semaines/${target.week}/index.html`, '<!-- synthetic public fixture -->');
  git('init', '-q'); commit('synthetic previous issue');
  return {root, git, write, read, json, commit, run};
}
const success = run => {assert.equal(run.status, 0, run.error?.message || run.stderr || run.stdout); return run.stdout;};
const parseEnv = text => Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => {const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];}));

for (const sequence of sequences) test(`successive synthetic CLI cycles: ${sequence.name}`, async t => {
  const f = sandbox(t, sequence.previous);
  let lastReport = null, oldHandoff = null;
  for (const [today, week, from] of sequence.cycles) {
    const base = f.git('rev-parse', 'HEAD'), before = f.json('data/manifest.json');
    const previousEntry = before.weeks.find(row => row.week === before.latest);
    const outputFile = path.join(f.root, 'output'), envFile = path.join(f.root, 'env');
    const env = {TZ: sequence.zone, SELECTION_TV_TODAY: today, GITHUB_HEAD_REF: 'auto/' + week,
      BASE_SHA: base, GITHUB_OUTPUT: outputFile, GITHUB_ENV: envFile};
    const target = JSON.parse(success(f.run('./next-target.mjs', [], env)));
    assert.equal(target.week, week); assert.equal(target.from, from); assert.equal(target.to, addDays(from, 6));
    assert.equal(target.manifest_latest, before.latest); assert.equal(target.already_present, false);
    f.write('output', ''); success(f.run('./next-target.mjs', ['--github-output'], env));
    assert.equal(parseEnv(f.read('output')).week, week);
    assert.equal(parseEnv(f.read('output')).branch, 'auto/' + week);
    for (const date of [addDays(today, -1), today, from]) assert.equal(calendarTarget(date).week, week);
    assert.deepEqual(validateCandidateCalendar(previousEntry, target, today), []);
    if (oldHandoff) assert.throws(() => planImport(oldHandoff, f.read), /published|stale/);

    const progress = {schema_version: 1, week, stage: 'enrichment', remaining: ['Synthetic fixture still incomplete'],
      editorial_review_completed: false, editorial_review: {completed: false}};
    const data = {
      'data/manifest.json': {...before, weeks: [{week, from, to: target.to, status: 'draft'}, ...before.weeks]},
      'data/works.json': {works: []}, 'data/links.json': {}, 'data/releases.json': {},
      [`data/weeks/${week}.json`]: {week, from, to: target.to, publication_status: 'draft', pages: []},
      [`data/inventory/${week}.json`]: {week, days: []}, [`data/coverage/${week}.json`]: {week, days: [], full_week_reaudit_completed: false},
      [`data/radar-reserves/${week}.json`]: {week}, [`data/research/${week}.json`]: progress,
      [`semaines/${week}/index.html`]: '<!-- synthetic draft ' + week + ' -->'
    };
    const bundle = {schema_version: 1, week, base_sha: base, stage: 'enrichment', remaining: progress.remaining,
      files: Object.entries(data).map(([p, value]) => ({path: p, base_sha256: digest(f.read(p)),
        content: typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'}))};
    f.write('handoff.json', bundle);
    success(f.run('./editorial-handoff.mjs', ['check', 'handoff.json'], env));
    success(f.run('./editorial-handoff.mjs', ['apply', 'handoff.json'], env));
    assert.match(success(f.run('./editorial-handoff.mjs', ['apply', 'handoff.json'], env)), /0 file\(s\)/);
    f.commit('synthetic ' + week + ' preparation');
    assert.equal(f.json('data/manifest.json').latest, before.latest);
    assert.equal(f.json(`data/weeks/${before.latest}.json`).publication_status, 'published');
    f.write('env', ''); success(f.run('./validation-context.mjs', [], env));
    assert.deepEqual(parseEnv(f.read('env')), {SELECTION_TV_PREPARATION_WEEK: week});
    const preparationEnv = {...env, ...parseEnv(f.read('env'))};
    const blocked = f.run('./validation-context.mjs', ['--require-ready'], preparationEnv);
    assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /Publication blocked/);
    assert.notEqual(f.run('./seal-editorial-review.mjs', [week, '--review-completed'], env).status, 0);

    if (lastReport) {
      f.write('preparation-gaps.json', lastReport);
      const stale = success(f.run('./generation-report.mjs', [], preparationEnv));
      assert(stale.startsWith('# Sélection TV · rapport de génération ' + week + '\n'));
      assert.match(stale, /Contrôles actuels indisponibles/);
      assert.doesNotMatch(stale, /0 message\(s\) bloquant/);
    }
    // Zero synthetic validator results exercise the report binding, not the
    // editorial validators; the unfinished candidate must still be rejected.
    const report = buildReport({week, from, sections: [], progress,
      results: validators.map(validator => ({validator, status: 0, output: '✓ synthetic fixture'})),
      snapshot: inputSnapshot(week, {root: f.root, env: preparationEnv})});
    f.write('preparation-gaps.json', report);
    const current = success(f.run('./generation-report.mjs', [], preparationEnv));
    assert.match(current, /0 message\(s\) bloquant/);
    assert.match(current, /Revue éditoriale déclarée achevée : non/);
    assert.notEqual(f.run('./validation-context.mjs', ['--require-ready'], preparationEnv).status, 0);

    // Explicitly complete ONLY the disposable test fixture. No real content
    // is fabricated or certified; all real publication validators remain.
    f.write(`data/research/${week}.json`, {...progress, remaining: []});
    success(f.run('./seal-editorial-review.mjs', [week, '--review-completed'], env));
    const sealed = f.json(`data/research/${week}.json`);
    assert.equal(sealed.editorial_review.completed, true);
    reviewedCandidate(week, sealed, f.read, [...allowedPaths(week)]);
    const weekPath = `data/weeks/${week}.json`, savedBytes = f.read(weekPath);
    f.write(weekPath, {...f.json(weekPath), pages: [{id: 'changed'}]});
    assert.throws(() => reviewedCandidate(week, sealed, f.read, [weekPath]), /stale/);
    f.write(weekPath, savedBytes);
    f.write('env', ''); success(f.run('./validation-context.mjs', [], env));
    assert.deepEqual(parseEnv(f.read('env')), {SELECTION_TV_VALIDATE_WEEK: week, SELECTION_TV_CANDIDATE: '1'});
    const readyEnv = {...env, ...parseEnv(f.read('env'))};
    success(f.run('./validation-context.mjs', ['--require-ready'], readyEnv));
    f.commit('synthetic ' + week + ' sealed fixture');
    const draftManifest = f.json('data/manifest.json'), draftWeek = f.json(weekPath);
    success(f.run('./promote-week.mjs', [week], readyEnv));
    assert.equal(validateTransition(draftManifest, f.json('data/manifest.json'), draftWeek, f.json(weekPath),
      ['data/manifest.json', weekPath], 'promote/' + week), week);
    const publishedBytes = f.read('data/manifest.json');
    assert.match(success(f.run('./promote-week.mjs', [week], readyEnv)), /already promoted/);
    assert.equal(f.read('data/manifest.json'), publishedBytes);
    f.commit('synthetic ' + week + ' publication transition');
    assert.equal(watchdogTarget(addDays(from, 1)), week);
    const watch = verify => inspectWeek({week, manifest: f.json('data/manifest.json'), prs: [], verify});
    assert.equal((await watch(async () => {throw Error('synthetic unavailable deployment');})).reason, 'deployment-failed');
    assert.equal((await watch(async targetWeek => assert.equal(targetWeek, week))).reason, 'deployed');
    assert.equal(JSON.parse(success(f.run('./next-target.mjs', [], env))).already_present, true);
    lastReport = report; oldHandoff = bundle;
  }
});

test('missed cycle cannot be promoted later and does not displace the next calendar target', t => {
  const f = sandbox(t, '2026-10-03');
  const entry = {week: '2026-S42', from: '2026-10-10', to: '2026-10-16', status: 'draft'};
  const manifest = f.json('data/manifest.json'); manifest.weeks.unshift(entry);
  f.write('data/manifest.json', manifest); f.write('data/weeks/2026-S42.json', {week: entry.week, publication_status: 'draft'});
  const env = {SELECTION_TV_TODAY: '2026-10-16'}, before = f.read('data/manifest.json');
  const run = f.run('./promote-week.mjs', ['2026-S42'], env);
  assert.notEqual(run.status, 0); assert.match(run.stderr, /obsolete backlog/);
  assert.equal(f.read('data/manifest.json'), before);
  assert.equal(JSON.parse(success(f.run('./next-target.mjs', [], env))).week, '2026-S43');
});

test('every required check must succeed before an automatic merge', () => {
  const checks = ['data-and-policy', 'browser-presentation'].map((name, i) => ({id: i + 1, name,
    app: {id: 1, slug: 'github-actions'}, status: 'completed', conclusion: 'success'}));
  assert(checksPass(checks));
  for (const conclusion of ['failure', 'skipped', null]) assert(!checksPass([...checks,
    {id: 3, name: 'supplementary-isolation', app: {id: 1, slug: 'github-actions'}, status: 'completed', conclusion}]));
});
