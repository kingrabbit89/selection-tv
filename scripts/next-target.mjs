import fs from 'node:fs';
import {calendarTarget} from './week-calendar.mjs';
const manifest=JSON.parse(fs.readFileSync('data/manifest.json','utf8'));
const target=calendarTarget();
const existing=(manifest.weeks||[]).find(x=>x.week===target.week)||null;
const out={...target,branch:'auto/'+target.week,manifest_latest:manifest.latest,existing_status:existing?.status||'',already_present:Boolean(existing)};
if(process.argv.includes('--github-output')){
  if(!process.env.GITHUB_OUTPUT)throw new Error('GITHUB_OUTPUT is missing');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(out).map(([k,v])=>k+'='+String(v)).join('\n')+'\n');
}else if(process.argv.includes('--shell')){
  for(const [k,v] of Object.entries(out))console.log(k.toUpperCase()+'='+String(v));
}else console.log(JSON.stringify(out,null,2));
