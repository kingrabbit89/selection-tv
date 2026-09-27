import fs from 'node:fs';
import {validateCandidateCalendar} from './week-calendar.mjs';

const target=process.env.SELECTION_TV_VALIDATE_WEEK||'';
if(!target){
  console.log('✓ Candidate publication validation skipped outside an auto/* candidate');
  process.exit(0);
}
const candidateMode=process.env.SELECTION_TV_CANDIDATE==='1';
if(!candidateMode)throw new Error('SELECTION_TV_VALIDATE_WEEK requires SELECTION_TV_CANDIDATE=1');

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const exists=p=>fs.existsSync(p);
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const manifest=read('data/manifest.json');
const editorial=read('data/editorial-config.json');
const automation=read('data/automation-config.json');
const q=editorial.quality_gates||{};
const requiredChannels=editorial.required_core_channels||[];
const current=(manifest.weeks||[]).find(x=>x.week===manifest.latest);
const entry=(manifest.weeks||[]).find(x=>x.week===target);
const fail=[];
const bad=msg=>fail.push(msg);

if(!entry)bad('candidate absent from data/manifest.json: '+target);
if(target===manifest.latest)bad('candidate must not change manifest.latest before promotion');
if(entry?.status!=='draft')bad('candidate manifest status must be draft');
const branch=process.env.GITHUB_HEAD_REF||'';
if(branch&&branch!=='auto/'+target)bad('candidate PR branch must be auto/'+target+' (got '+branch+')');

const required=[
  'data/weeks/'+target+'.json',
  'data/inventory/'+target+'.json',
  'data/coverage/'+target+'.json',
  'data/radar-reserves/'+target+'.json',
  'semaines/'+target+'/index.html'
];
for(const p of required)if(!exists(p))bad('required candidate artifact missing: '+p);

try {
  const skipped=validateCandidateCalendar(current,entry);
  if(skipped.length)console.log('Calendar recovery: unpublished cycles skipped: '+skipped.join(', '));
}catch(error){bad(error.message)}

if(exists('data/weeks/'+target+'.json')){
  const week=read('data/weeks/'+target+'.json');
  if(week.week!==target)bad('week JSON id mismatch');
  if(week.publication_status!=='draft')bad('candidate week publication_status must be draft');
  if(entry&&Number(entry.page_count)!==Number(week.page_count))bad('manifest/week page_count mismatch');
}

if(exists('data/inventory/'+target+'.json')){
  const inv=read('data/inventory/'+target+'.json');
  const days=inv.days||[];
  const minItems=Number(q.strict_inventory_min_items_per_day??automation.candidate_validation.minimum_raw_inventory_items_per_day??30);
  const minSources=Number(q.raw_inventory_source_pages_min??automation.candidate_validation.minimum_source_pages_per_day??2);
  const minOvernight=Number(q.strict_inventory_min_overnight_items_per_day??automation.candidate_validation.minimum_overnight_items_per_day??1);
  if(days.length!==7)bad('inventory must contain 7 days');
  for(const day of days){
    const items=day.items||[];
    const sources=day.source_pages||[];
    const channels=new Set((day.channels_scanned||[]).map(norm));
    if(items.length<minItems)bad(day.date+': raw inventory '+items.length+' < '+minItems);
    if(sources.length<minSources)bad(day.date+': source_pages '+sources.length+' < '+minSources);
    const missing=requiredChannels.filter(c=>!channels.has(norm(c)));
    if(missing.length)bad(day.date+': required channels not scanned: '+missing.join(', '));
    if(q.strict_inventory_requires_channel_counts!==false){
      const counts=day.channel_counts;
      if(!counts||typeof counts!=='object'||Array.isArray(counts))bad(day.date+': channel_counts object missing');
      else{
        for(const c of requiredChannels){
          const key=Object.keys(counts).find(k=>norm(k)===norm(c));
          if(!key)bad(day.date+': channel_counts missing '+c);
          else if(!Number.isInteger(Number(counts[key]))||Number(counts[key])<0)bad(day.date+': invalid channel count for '+c);
        }
      }
    }
    const overnight=items.filter(x=>/^(?:0[0-5]):[0-5]\d$/.test(String(x.start||x.time||''))).length;
    if(overnight<minOvernight)bad(day.date+': overnight inventory '+overnight+' < '+minOvernight);
    for(const [i,item] of items.entries()){
      if(!String(item.title||'').trim())bad(day.date+' item '+i+': title missing');
      if(!String(item.channel||'').trim())bad(day.date+' item '+i+': channel missing');
      if(!/^\d{2}:\d{2}$/.test(String(item.start||item.time||'')))bad(day.date+' item '+i+': HH:MM start missing');
      if(!/^https?:\/\//.test(String(item.source_url||'')))bad(day.date+' item '+i+': source_url missing');
    }
  }
}

if(exists('data/coverage/'+target+'.json')){
  const cov=read('data/coverage/'+target+'.json');
  if(cov.week!==target)bad('coverage week mismatch');
  if(cov.full_week_reaudit_completed!==true)bad('coverage full_week_reaudit_completed must be true');
  if((cov.days||[]).length!==7)bad('coverage must contain 7 days');
}

if(fail.length){
  fail.forEach(x=>console.error('✗ '+x));
  console.error('✗ Candidate publication gate failed: '+fail.length+' problem(s)');
  process.exit(1);
}
console.log('✓ Candidate '+target+' is complete enough to enter full editorial/browser validation while remaining non-public');
