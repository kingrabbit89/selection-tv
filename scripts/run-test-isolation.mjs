import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// No production runner context or credentials enter a test subprocess unless
// explicitly provided by its fixture. PATH/platform paths remain usable.
export function testEnvironment(parent = process.env, overrides = {}) {
  const keep = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR',
    'COMSPEC', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH'];
  const env = Object.fromEntries(keep.filter(key => parent[key] !== undefined).map(key => [key, parent[key]]));
  return {...env, TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0', ...overrides};
}

export function discoverTests(root) {
  const directory = path.join(root, 'scripts');
  const files = fs.readdirSync(directory, {withFileTypes: true})
    .filter(entry => entry.isFile() && (/^test-.+\.mjs$/.test(entry.name) || /\.test\.mjs$/.test(entry.name)))
    .map(entry => 'scripts/' + entry.name).sort();
  assert(files.length, 'No Node tests discovered: refuse a false-green empty suite');
  return files;
}

export const scenarios = [
  {name: 'isolated', overrides: {TZ: 'UTC'}},
  {name: 'preparation-S43', overrides: {TZ: 'America/Los_Angeles',
    SELECTION_TV_PREPARATION_WEEK: '2026-S43', SELECTION_TV_TODAY: '2026-10-16',
    GITHUB_HEAD_REF: 'auto/2026-S43', GITHUB_REF: 'refs/pull/987654/merge'}},
  {name: 'validation-new-year', overrides: {TZ: 'Pacific/Kiritimati',
    SELECTION_TV_VALIDATE_WEEK: '2027-S01', SELECTION_TV_CANDIDATE: '1',
    SELECTION_TV_TODAY: '2027-01-01', GITHUB_HEAD_REF: 'auto/2027-S01'}},
  {name: 'foreign-conflicting-weeks', overrides: {TZ: 'Europe/Paris',
    SELECTION_TV_PREPARATION_WEEK: '2099-S01', SELECTION_TV_VALIDATE_WEEK: '2099-S02',
    SELECTION_TV_CANDIDATE: '1', SELECTION_TV_TODAY: '2099-01-01',
    GITHUB_HEAD_REF: 'auto/2099-S01', GITHUB_REF: 'refs/pull/987654/merge',
    BASE_SHA: 'c'.repeat(40), CANDIDATE_HEAD_SHA: 'd'.repeat(40)}}
];

function sourceDigest(root) {
  const hash = createHash('sha256');
  const walk = relative => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) for (const name of fs.readdirSync(absolute).sort()) walk(path.posix.join(relative, name));
    else if (stat.isSymbolicLink()) hash.update(relative + '\0link\0' + fs.readlinkSync(absolute));
    else if (stat.isFile()) hash.update(relative + '\0').update(fs.readFileSync(absolute)).update('\0');
  };
  for (const name of ['scripts', 'data', 'assets', 'semaines', 'integrations', '.github']) walk(name);
  return hash.digest('hex');
}

export function runScenario(root, scenario, {timeout = 180000} = {}) {
  const files = discoverTests(root), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-test-isolation-'));
  try {
    const channels = Object.fromEntries(['GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'GITHUB_PATH', 'GITHUB_STATE']
      .map(key => [key, path.join(scratch, key)]));
    for (const [key, file] of Object.entries(channels)) fs.writeFileSync(file, `sentinel ${key}\n`);
    const env = testEnvironment(process.env, {
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '987654', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_SHA: 'b'.repeat(40), ...scenario.overrides, ...channels
    });
    const before = sourceDigest(root);
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files],
      {cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024});
    const output = (run.stdout || '') + (run.stderr || '');
    const count = key => Number(output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
    const polluted = Object.entries(channels).filter(([key, file]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== `sentinel ${key}\n`).map(([key]) => key);
    const unchanged = before === sourceDigest(root);
    const result = {name: scenario.name, files: files.length, tests: count('tests'), passed: count('pass'),
      failed: count('fail'), skipped: count('skipped'), status: run.status, signal: run.signal,
      execution_error: run.error?.message || null, polluted_channels: polluted, source_unchanged: unchanged};
    result.ok = run.status === 0 && !run.error && result.tests > 0 && result.passed === result.tests &&
      result.failed === 0 && result.skipped === 0 && polluted.length === 0 && unchanged;
    return {result, output};
  } finally {fs.rmSync(scratch, {recursive: true, force: true});}
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = discoverTests(root), results = [];
  console.log(`Discovered ${files.length} Node test files (including new files automatically).`);
  for (const scenario of scenarios) {
    const {result, output} = runScenario(root, scenario);
    results.push(result);
    console.log(JSON.stringify(result));
    if (!result.ok) console.error(output);
  }
  const comparable = results.every(result => result.tests === results[0].tests && result.files === results[0].files);
  const ok = comparable && results.every(result => result.ok);
  if (!comparable) console.error('Environment-dependent test count: refuse a partial or silently skipped suite.');
  // Only this outer process may write to the real CI summary.
  const summary = `## Test isolation\n\n| Context | Files | Passed / tests | Result |\n|---|---:|---:|---|\n` +
    results.map(row => `| ${row.name} | ${row.files} | ${row.passed}/${row.tests} | ${row.ok ? 'PASS' : 'FAIL'} |`).join('\n') +
    '\n\nSynthetic tests only: no editorial verification or real publication is certified.\n';
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exitCode = ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
