import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizePromotion} from './synchronize-promotion.mjs';

const week = '2026-S42', repo = 'owner/repo';
const oldBase = 'a'.repeat(40), base = 'b'.repeat(40), head = 'c'.repeat(40), newHead = 'd'.repeat(40), other = 'e'.repeat(40);
const paths = ['data/manifest.json', `data/weeks/${week}.json`];

function fixture(fault = {}) {
  const oldManifest = {latest: '2026-S41', updated: '2026-10-09', weeks: [
    {week: '2026-S41', from: '2026-10-03', status: 'published'}, {week, from: '2026-10-10', status: 'draft'}]};
  const oldWeek = {week, publication_status: 'draft', pages: ['original reviewed page']};
  const promotionManifest = structuredClone(oldManifest);
  promotionManifest.latest = week; promotionManifest.weeks[1].status = 'published';
  const promotionWeek = {...oldWeek, publication_status: 'published', ...(fault.editorial ? {pages: ['unreviewed replacement']} : {})};
  const currentManifest = {...structuredClone(oldManifest), updated: '2026-10-10'};
  const currentWeek = {...oldWeek, pages: ['newer reviewed main page']};
  if (fault.alreadyPublished) {
    currentManifest.latest = week; currentManifest.weeks[1].status = 'published'; currentWeek.publication_status = 'published';
  }
  let mainRef = base, branchRef = head, prClosed = Boolean(fault.closed);
  const mutations = [], attestations = [];
  const api = (path, method = 'GET', body) => {
    if (method !== 'GET') mutations.push({path, method, body});
    if (path === 'git/ref/heads/main') return {object: {sha: mainRef}};
    if (path === 'git/ref/heads/promote/' + week) return {object: {sha: branchRef}};
    if (path === 'pulls/42') return {state: prClosed ? 'closed' : 'open', draft: Boolean(fault.draft),
      base: {ref: 'main'}, head: {sha: branchRef, ref: fault.wrongBranch ? 'auto/' + week : 'promote/' + week,
        repo: {full_name: fault.foreign ? 'outsider/repo' : repo}}};
    if (path === `compare/${base}...${head}`) return {status: fault.fresh ? 'ahead' : 'diverged', behind_by: fault.fresh ? 0 : 1,
      merge_base_commit: {sha: oldBase}};
    if (path === `compare/${oldBase}...${head}`) return {status: 'ahead', behind_by: 0,
      files: [...paths, ...(fault.extraFile ? ['scripts/unreviewed-code.mjs'] : [])].map(filename => ({filename}))};
    if (path.startsWith('contents/')) {
      const [file, query] = path.slice('contents/'.length).split('?ref=');
      const ref = decodeURIComponent(query), manifest = file === paths[0];
      const value = ref === oldBase ? (manifest ? oldManifest : oldWeek) : ref === base ?
        (manifest ? currentManifest : currentWeek) : (manifest ? promotionManifest : promotionWeek);
      return {encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64')};
    }
    if (path === 'git/commits/' + base) return {tree: {sha: 'f'.repeat(40)}};
    if (path === 'git/trees' && method === 'POST') return {sha: '0'.repeat(40)};
    if (path === 'git/commits' && method === 'POST') {
      if (fault.mainMovedAfter) mainRef = other;
      if (fault.headMovedAfter) branchRef = other;
      if (fault.closedAfter) prClosed = true;
      return {sha: newHead, tree: {sha: body.tree}, parents: body.parents.map(sha => ({sha}))};
    }
    if (path === 'git/refs/heads/promote/' + week && method === 'PATCH') {
      assert.equal(body.force, false);
      if (fault.concurrentSibling) {branchRef = other; throw Error('Update is not a fast forward');}
      branchRef = body.sha;
      return {object: {sha: branchRef}};
    }
    throw Error('Unexpected API call: ' + method + ' ' + path);
  };
  const verifyAttestation = (target, sha) => {
    attestations.push({week: target, base: sha});
    if (fault.mainMovedBefore) mainRef = other;
    if (fault.headMovedBefore) branchRef = other;
    if (fault.closedBefore) prClosed = true;
    if (fault.attestationThrows) throw Error('Latest exact-base revalidation is red');
    return !fault.attestationFalse;
  };
  return {api, mutations, attestations, currentManifest, currentWeek, branch: () => branchRef,
    run: () => synchronizePromotion(api, repo, week, base, head, {prNumber: 42, verifyAttestation, now: new Date('2026-10-10T00:36:00Z')})};
}

test('stale pure promotion advances normally from both exact parents and keeps current main data', () => {
  const f = fixture(), result = f.run();
  assert.deepEqual(result, {sha: newHead, base, week, prNumber: 42});
  assert.deepEqual(f.attestations, [{week, base}]);
  const tree = f.mutations.find(call => call.path === 'git/trees').body;
  assert.equal(tree.base_tree, 'f'.repeat(40));
  assert.deepEqual(tree.tree.map(file => file.path), paths);
  const manifest = JSON.parse(tree.tree[0].content), data = JSON.parse(tree.tree[1].content);
  assert.deepEqual(manifest, {...f.currentManifest, latest: week,
    weeks: f.currentManifest.weeks.map(item => item.week === week ? {...item, status: 'published'} : item)});
  assert.deepEqual(data, {...f.currentWeek, publication_status: 'published'});
  assert.deepEqual(f.mutations.find(call => call.path === 'git/commits').body.parents, [head, base]);
  assert.deepEqual(f.mutations.at(-1), {path: 'git/refs/heads/promote/' + week, method: 'PATCH', body: {sha: newHead, force: false}});
  assert.equal(f.branch(), newHead);
  assert(!f.mutations.some(call => /pulls|merge|main$/.test(call.path)), 'Synchronization must not merge, reopen or replace main');
});

for (const flag of ['extraFile', 'editorial', 'closed', 'draft', 'foreign', 'wrongBranch', 'fresh',
  'alreadyPublished', 'attestationFalse', 'attestationThrows', 'mainMovedBefore', 'headMovedBefore', 'closedBefore']) {
  test('synchronization refuses ' + flag + ' before any Git write', () => {
    const f = fixture({[flag]: true});
    assert.throws(() => f.run());
    assert.deepEqual(f.mutations, []);
    assert.equal(f.branch(), flag === 'headMovedBefore' ? other : head);
  });
}

for (const flag of ['mainMovedAfter', 'headMovedAfter', 'closedAfter']) {
  test('a ' + flag + ' race leaves only unreferenced Git objects', () => {
    const f = fixture({[flag]: true});
    assert.throws(() => f.run());
    assert.deepEqual(f.mutations.map(call => call.path), ['git/trees', 'git/commits']);
    assert.equal(f.branch(), flag === 'headMovedAfter' ? other : head);
  });
}

test('a concurrent sibling update is never forced or retried over its new head', () => {
  const f = fixture({concurrentSibling: true});
  assert.throws(() => f.run(), /not a fast forward/);
  assert.equal(f.branch(), other);
  assert.equal(f.mutations.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(f.mutations.at(-1).body.force, false);
});

test('missing verifier cannot authorize a synchronization', () => {
  assert.throws(() => synchronizePromotion(() => {throw Error('Unexpected API');}, repo, week, base, head,
    {prNumber: 42}), /attestation verifier required/);
});
