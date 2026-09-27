import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const [week,base]=process.argv.slice(2);
if(!/^\d{4}-S\d{2}$/.test(week)||!/^[a-f0-9]{40}$/.test(base))throw Error('Invalid week/base');
const repo=process.env.GITHUB_REPOSITORY;
if(!repo)throw Error('GITHUB_REPOSITORY missing');
const api=p=>JSON.parse(execFileSync('gh',['api',p],{encoding:'utf8'}));
const runs=api('repos/'+repo+'/actions/workflows/promote-validated-week.yml/runs?status=success&per_page=100').workflow_runs||[];
let verified=false;
for(const run of runs){
  const artifacts=api('repos/'+repo+'/actions/runs/'+run.id+'/artifacts').artifacts||[];
  if(!artifacts.some(a=>!a.expired&&a.name==='promotion-ready-'+week))continue;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-proof-'));
  try{
    execFileSync('gh',['run','download',String(run.id),'--repo',repo,'--name','promotion-ready-'+week,'--dir',dir],{stdio:'pipe'});
    const proof=JSON.parse(fs.readFileSync(path.join(dir,'promotion-ready.json'),'utf8'));
    if(proof.week===week&&proof.base_sha===base){verified=true;break}
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
if(!verified)throw Error('No successful post-merge revalidation attests '+week+' at base '+base+'. Run promote-validated-week on current main; never bypass this gate.');
console.log('✓ Successful post-merge revalidation matches exact promotion base '+base);
