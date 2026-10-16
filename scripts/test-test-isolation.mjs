import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {discoverTests, testEnvironment, runScenario} from './run-test-isolation.mjs';

function fixture(t, code) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-runner-fixture-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'scripts'));
  if (code) fs.writeFileSync(path.join(root, 'scripts/test-example.mjs'), code);
  return root;
}

test('test environments keep platform paths but strip caller weeks, channels, credentials and Node IPC', () => {
  const parent = {PATH: '/bin', SystemRoot: 'C:\\Windows', GITHUB_TOKEN: 'sentinel-not-a-token',
    GH_TOKEN: 'sentinel-not-a-token', SELECTION_TV_PREPARATION_WEEK: '2099-S01',
    GITHUB_STEP_SUMMARY: '/caller/summary', NODE_TEST_CONTEXT: 'child-v8', NODE_OPTIONS: '--example', BASE_SHA: 'wrong'};
  const before = structuredClone(parent), env = testEnvironment(parent, {SELECTION_TV_VALIDATE_WEEK: '2027-S01'});
  assert.equal(env.PATH, parent.PATH); assert.equal(env.SystemRoot, parent.SystemRoot);
  for (const key of Object.keys(parent).filter(key => !['PATH', 'SystemRoot'].includes(key))) assert(!Object.hasOwn(env, key), key);
  assert.equal(env.SELECTION_TV_VALIDATE_WEEK, '2027-S01'); assert.deepEqual(parent, before);
});

test('test discovery includes both naming conventions and refuses an empty suite', t => {
  const root = fixture(t);
  assert.throws(() => discoverTests(root), /No Node tests/);
  for (const name of ['test-future-cycle.mjs', 'legacy.test.mjs', 'run-test-isolation.mjs', 'validate-editorial.mjs'])
    fs.writeFileSync(path.join(root, 'scripts', name), '');
  assert.deepEqual(discoverTests(root), ['scripts/legacy.test.mjs', 'scripts/test-future-cycle.mjs']);
});

test('runner accepts real executed tests with intact caller channels and source', t => {
  const root = fixture(t, "import test from 'node:test'; test('executed', () => {});\n");
  const {result} = runScenario(root, {name: 'fixture', overrides: {SELECTION_TV_PREPARATION_WEEK: '2099-S01'}});
  assert.equal(result.ok, true); assert.equal(result.tests, 1); assert.equal(result.passed, 1);
});

for (const [name, code, check] of [
  ['failed assertion', "import test from 'node:test'; test('fails', () => {throw Error('sentinel failure')});", r => r.failed === 1],
  ['skipped test', "import test from 'node:test'; test.skip('not executed', () => {});", r => r.skipped === 1],
  ['caller channel pollution', "import test from 'node:test'; import fs from 'node:fs'; test('pollutes', () => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'fixture pollution'));", r => r.polluted_channels.includes('GITHUB_STEP_SUMMARY')],
  ['source mutation', "import test from 'node:test'; import fs from 'node:fs'; test('mutates', () => fs.writeFileSync('scripts/changed.mjs', 'changed'));", r => !r.source_unchanged]
]) test(`runner rejects ${name} rather than reporting a false green`, t => {
  const root = fixture(t, code);
  const {result} = runScenario(root, {name, overrides: {}});
  assert.equal(result.ok, false); assert(check(result));
});
