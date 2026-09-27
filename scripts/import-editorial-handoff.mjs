// Executes only trusted main code. The uploaded bundle is data, never executable.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {calendarTarget} from './week-calendar.mjs';
import {validateBundle,planImport} from './editorial-handoff.mjs';
import {github,readContent,commitFiles,branchSha,openPR} from './github-weekly-api.mjs';
const api=github(),repo=process.env.GITHUB_REPOSITORY;
const ref=process.env.BUNDLE_REF;
assert(/^handoff\/[\w.-]+$/.test(ref||''),'Use a handoff/NAME branch');
const sourceSha=branchSha(api,ref);assert(sourceSha,'Missing handoff branch');
const week=calendarTarget().week;
const bundle=validateBundle(JSON.parse(readContent(api,sourceSha,`handoffs/${week}.json`)));
assert.equal(bundle.week,week,'obsolete bundle');
const main=branchSha(api,'main'),branch=`auto/${week}`,existing=branchSha(api,branch),base=existing||main;
assert(['ahead','identical'].includes(api(`compare/${bundle.base_sha}...${base}`).status),'bundle base is not an ancestor');
const changes=planImport(bundle,p=>readContent(api,base,p));
if(changes.length){
  const sha=commitFiles(api,base,changes,`Import ${bundle.stage} handoff for ${week}`);
  if(existing)api(`git/refs/heads/${branch}`,'PATCH',{sha,force:false});
  else api('git/refs','POST',{ref:`refs/heads/${branch}`,sha});
}
assert(changes.length||existing,'Empty handoff');
const pr=openPR(api,repo,branch,`Sélection TV ${week}`,`Candidate éditoriale importée depuis ${ref} (${sourceSha}). Les contrôles complets et la revue éditoriale restent obligatoires. Aucune promotion par cet import.`);
const message=`Imported ${week}: ${pr.html_url}. ${bundle.remaining.length} remaining item(s).\nWith the built-in GITHUB_TOKEN, approve PR workflows if GitHub requests it; never bypass checks.\n`;
console.log(message);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,message);
