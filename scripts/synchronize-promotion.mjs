import assert from 'node:assert/strict';
import {branchSha, preflightCommitFiles, readContent} from './github-weekly-api.mjs';
import {validateTransition} from './validate-promotion-transition.mjs';

// Advance only an open, exact publication transaction onto an attested main.
// The old head remains a parent: a concurrent sibling update cannot be replaced
// by the final non-force reference update. This step never merges the PR.
export function synchronizePromotion(api, repo, week, base, head,
  {prNumber, verifyAttestation, now = new Date()} = {}) {
  assert.match(week || '', /^\d{4}-S\d{2}$/);
  for (const sha of [base, head]) assert.match(sha || '', /^[a-f0-9]{40}$/);
  assert(Number.isSafeInteger(prNumber) && prNumber > 0, 'Exact open promotion PR required');
  assert.equal(typeof verifyAttestation, 'function', 'Exact-base attestation verifier required');
  const branch = 'promote/' + week;
  const verifyRefs = () => {
    assert.equal(branchSha(api, 'main'), base, 'main moved; revalidate before synchronization');
    assert.equal(branchSha(api, branch), head, 'promotion branch moved; retry without replacing its head');
    const pr = api('pulls/' + prNumber);
    assert.equal(pr.state, 'open', 'Closed promotion PR must not be reopened');
    assert.equal(pr.draft, false, 'Draft promotion requires explicit review');
    assert.equal(pr.base.ref, 'main');
    assert.equal(pr.head.ref, branch);
    assert.equal(pr.head.repo?.full_name, repo, 'Foreign promotion branch');
    assert.equal(pr.head.sha, head, 'Promotion PR moved');
  };
  verifyRefs();
  const relation = api(`compare/${base}...${head}`);
  assert(['behind', 'diverged'].includes(relation.status) && relation.behind_by > 0,
    'Only a stale promotion transaction needs synchronization');
  const oldBase = relation.merge_base_commit?.sha;
  assert.match(oldBase || '', /^[a-f0-9]{40}$/, 'Original promotion base unavailable');
  const original = api(`compare/${oldBase}...${head}`);
  assert.equal(original.status, 'ahead', 'Original promotion is not ahead of its base');
  assert.equal(original.behind_by, 0);
  assert(Array.isArray(original.files), 'Original promotion diff unavailable');
  const read = (ref, file) => JSON.parse(readContent(api, ref, file));
  const weekPath = `data/weeks/${week}.json`;
  validateTransition(read(oldBase, 'data/manifest.json'), read(head, 'data/manifest.json'),
    read(oldBase, weekPath), read(head, weekPath), original.files.map(file => file.filename), branch);

  // Recreate the same status-only operation on the current, fully validated
  // data. Never transplant the old weekly payload over newer main contents.
  const manifest = read(base, 'data/manifest.json'), data = read(base, weekPath);
  const promotedManifest = structuredClone(manifest), promotedData = structuredClone(data);
  const entry = promotedManifest.weeks.find(item => item.week === week);
  assert(entry, 'Current main has no target draft');
  promotedManifest.latest = week;
  promotedManifest.updated = now.toISOString().slice(0, 10);
  entry.status = 'published';
  promotedData.publication_status = 'published';
  const paths = ['data/manifest.json', weekPath];
  validateTransition(manifest, promotedManifest, data, promotedData, paths, branch);
  assert.equal(verifyAttestation(week, base), true, 'Current exact-base attestation did not succeed');
  verifyRefs();
  const prepared = preflightCommitFiles([
    {path: paths[0], content: JSON.stringify(promotedManifest, null, 2) + '\n'},
    {path: paths[1], content: JSON.stringify(promotedData, null, 2) + '\n'}
  ]);
  const mainCommit = api('git/commits/' + base);
  const tree = api('git/trees', 'POST', {base_tree: mainCommit.tree.sha, tree: prepared.tree});
  const commit = api('git/commits', 'POST', {message: `Synchronize exact ${week} promotion with attested main ${base}`,
    tree: tree.sha, parents: [head, base]});
  assert.match(commit.sha || '', /^[a-f0-9]{40}$/);
  assert.equal(commit.tree?.sha, tree.sha, 'Unexpected synchronized tree');
  assert.deepEqual(commit.parents?.map(parent => parent.sha), [head, base], 'Unexpected synchronization parents');
  verifyRefs();
  api('git/refs/heads/' + branch, 'PATCH', {sha: commit.sha, force: false});
  assert.equal(branchSha(api, branch), commit.sha, 'Promotion reference changed after synchronization');
  return {sha: commit.sha, base, week, prNumber};
}
