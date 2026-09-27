import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function validateTransition(before, after, oldWeek, newWeek, files, branch='') {
  const target=after.latest;
  assert.match(target,/^\d{4}-S\d{2}$/);
  if(branch)assert.equal(branch,'promote/'+target,'publication requires promote/'+target);
  assert.deepEqual([...files].sort(),['data/manifest.json','data/weeks/'+target+'.json'].sort(),'promotion must change exactly manifest and week');
  const oldEntry=before.weeks.find(x=>x.week===target);
  const newEntry=after.weeks.find(x=>x.week===target);
  assert(oldEntry&&newEntry,'target must already exist in base');
  assert.equal(oldEntry.status,'draft');
  assert.equal(newEntry.status,'published');
  assert.equal(oldWeek.publication_status,'draft');
  assert.equal(newWeek.publication_status,'published');
  assert.equal(newWeek.week,target);
  assert.notEqual(before.latest,target);
  const previous=before.weeks.find(x=>x.week===before.latest);
  assert(newEntry.from>previous.from,'promotion cannot move backwards');
  const expectedManifest=structuredClone(before);
  expectedManifest.latest=target;
  if(Object.hasOwn(after,'updated'))expectedManifest.updated=after.updated;
  expectedManifest.weeks.find(x=>x.week===target).status='published';
  assert.deepEqual(after,expectedManifest,'manifest contains non-promotion changes');
  assert.deepEqual(newWeek,{...oldWeek,publication_status:'published'},'week contains editorial changes');
  return target;
}

export function checkRepository(base,branch='') {
  assert.match(base,/^[a-f0-9]{40}$/i,'base must be an exact commit SHA');
  const old=p=>JSON.parse(execFileSync('git',['show',base+':'+p],{encoding:'utf8'}));
  const before=old('data/manifest.json');
  const after=JSON.parse(fs.readFileSync('data/manifest.json','utf8'));
  if(before.latest===after.latest){
    assert(!branch.startsWith('promote/'),'promotion branch must advance latest');
    for(const entry of after.weeks){
      const prev=before.weeks.find(x=>x.week===entry.week);
      assert(!(entry.status==='published'&&(!prev||prev.status==='draft')),'cannot publish a week without the promotion transaction');
    }
    const changed=execFileSync('git',['diff','--name-only',base],{encoding:'utf8'}).trim().split('\n');
    for(const file of changed.filter(p=>/^data\/weeks\/\d{4}-S\d{2}\.json$/.test(p))){
      if(!fs.existsSync(file))continue;
      const current=JSON.parse(fs.readFileSync(file,'utf8'));
      if(current.publication_status!=='published')continue;
      let previous=null;
      try{previous=old(file)}catch{}
      assert(previous?.publication_status==='published','week JSON cannot become published without a promotion transaction');
    }
    return null;
  }
  const target=after.latest;
  const files=execFileSync('git',['diff','--name-only',base],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  return validateTransition(before,after,old('data/weeks/'+target+'.json'),JSON.parse(fs.readFileSync('data/weeks/'+target+'.json','utf8')),files,branch);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const target=checkRepository(process.argv[2],process.env.GITHUB_HEAD_REF||'');
  console.log(target?'✓ Exact promotion: '+target:'✓ Public edition unchanged');
}
