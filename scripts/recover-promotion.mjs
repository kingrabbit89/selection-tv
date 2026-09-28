import assert from 'node:assert/strict';
import {validateTransition} from './validate-promotion-transition.mjs';
import {readContent,branchSha,openPR} from './github-weekly-api.mjs';

// Recover only the exact publication transaction; never revive an intentionally closed PR.
export function recoverPromotion(api,repo,week,base,head){
  const branch='promote/'+week;
  const prs=api(`pulls?state=all&base=main&head=${encodeURIComponent(repo.split('/')[0]+':'+branch)}&per_page=100`);
  const open=prs.filter(p=>p.state==='open');
  assert(open.length<=1,'Ambiguous promotion PRs');
  if(open.length)return open[0];
  assert.equal(prs.length,0,'Promotion PR was closed; explicit review required before reopening');
  const diff=api(`compare/${base}...${head}`);
  assert.equal(diff.status,'ahead','Promotion branch is stale/diverged; synchronize normally');
  assert.equal(diff.behind_by,0);
  assert.equal(diff.total_commits,1,'Orphan promotion must be a single transaction');
  const manifest=p=>JSON.parse(readContent(api,p,'data/manifest.json'));
  const data=p=>JSON.parse(readContent(api,p,`data/weeks/${week}.json`));
  const after=manifest(head);assert.equal(after.latest,week);
  validateTransition(manifest(base),after,data(base),data(head),(diff.files||[]).map(f=>f.filename),branch);
  assert.equal(branchSha(api,'main'),base,'main moved; retry after revalidation');
  assert.equal(branchSha(api,branch),head,'promotion branch moved; retry');
  return openPR(api,repo,branch,`Publier ${week}`,`Reprise de la transaction exacte sur ${base}. Attestation et contrôles obligatoires conservés ; aucune fusion dans cette étape.`);
}
