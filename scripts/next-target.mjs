import fs from 'node:fs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read('data/manifest.json');
const latest=(manifest.weeks||[]).find(x=>x.week===manifest.latest);
if(!latest?.from)throw new Error('manifest.latest has no valid from date');

const parse=s=>new Date(s+'T12:00:00Z');
const fmt=d=>d.toISOString().slice(0,10);
const add=(d,n)=>new Date(d.getTime()+n*86400000);
const start=add(parse(latest.from),7);
const end=add(start,6);
const monday=add(start,2);

function isoWeek(date){
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const day=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-day);
  const isoYear=d.getUTCFullYear();
  const yearStart=new Date(Date.UTC(isoYear,0,1));
  const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
  return {year:isoYear,week};
}
const iw=isoWeek(monday);
const short='S'+String(iw.week).padStart(2,'0');
const week=iw.year+'-'+short;
const out={
  week,
  short,
  from:fmt(start),
  to:fmt(end),
  branch:'auto/'+week,
  previous:manifest.latest
};

if(process.argv.includes('--github-output')){
  if(!process.env.GITHUB_OUTPUT)throw new Error('GITHUB_OUTPUT is missing');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(out).map(([k,v])=>k+'='+v).join('\n')+'\n');
}else if(process.argv.includes('--shell')){
  for(const [k,v] of Object.entries(out))console.log(k.toUpperCase()+'='+v);
}else{
  console.log(JSON.stringify(out,null,2));
}
