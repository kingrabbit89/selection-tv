import fs from 'node:fs';

const target=process.argv[2]||process.env.SELECTION_TV_VALIDATE_WEEK;
if(!target)throw new Error('Usage: node scripts/promote-week.mjs YYYY-Sxx');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,obj)=>fs.writeFileSync(p,JSON.stringify(obj,null,2)+'\n');

const manifest=read('data/manifest.json');
const idx=(manifest.weeks||[]).findIndex(x=>x.week===target);
if(idx<0)throw new Error('Week not found in manifest: '+target);
if(manifest.latest===target&&manifest.weeks[idx].status==='published'){
  console.log('✓ '+target+' already promoted');
  process.exit(0);
}
if(manifest.weeks[idx].status!=='draft')throw new Error('Refusing promotion: manifest candidate status is not draft');

const weekPath='data/weeks/'+target+'.json';
const week=read(weekPath);
if(week.publication_status!=='draft')throw new Error('Refusing promotion: week JSON is not draft');

manifest.weeks[idx].status='published';
manifest.latest=target;
manifest.updated=new Date().toISOString().slice(0,10);
week.publication_status='published';

write('data/manifest.json',manifest);
write(weekPath,week);
console.log('✓ Promoted '+target+' to manifest.latest');
