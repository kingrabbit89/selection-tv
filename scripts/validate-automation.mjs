import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const fail=[];
const bad=x=>fail.push(x);
const required=[
  'data/automation-config.json',
  'scripts/next-target.mjs',
  'scripts/validate-publication-candidate.mjs',
  'scripts/promote-week.mjs',
  'scripts/generation-report.mjs',
  'scripts/verify-public-deployment.mjs',
  'scripts/validate-jellyfin-web.mjs',
  '.github/workflows/validate-architecture.yml',
  '.github/workflows/promote-validated-week.yml',
  '.github/workflows/weekly-automation-watchdog.yml',
  '.github/workflows/guard-direct-publication.yml',
  'AUTOMATION.md'
];
for(const p of required)if(!fs.existsSync(p))bad('missing automation component: '+p);

if(fs.existsSync('data/automation-config.json')){
  const cfg=json('data/automation-config.json');
  if(cfg.schema_version!==1)bad('automation-config schema_version must be 1');
  if(cfg.timezone!=='Europe/Paris')bad('automation timezone must be Europe/Paris');
  if(cfg.generation?.orchestrator!=='external-research-agent')bad('weekly producer must be declared as external-research-agent');
  if(cfg.generation?.candidate_manifest_status!=='draft'||cfg.generation?.candidate_publication_status!=='draft')bad('candidate must stay draft before promotion');
  if(cfg.generation?.scheduled_day!=='Thursday'||cfg.generation?.scheduled_time_local!=='08:00')bad('generation stage must start Thursday 08:00 Europe/Paris');
  if(cfg.review?.scheduled_day!=='Friday'||cfg.review?.scheduled_time_local!=='20:00')bad('publication review must run Friday 20:00 Europe/Paris');
  const expectedPhases={
    inventory:['Thursday','08:00'],
    enrichment:['Friday','08:00'],
    preflight:['Friday','17:00'],
    publication:['Friday','20:00'],
    retry:['Saturday','08:00']
  };
  for(const [name,[day,time]] of Object.entries(expectedPhases)){
    if(cfg.phases?.[name]?.scheduled_day!==day||cfg.phases?.[name]?.scheduled_time_local!==time){
      bad('automation phase '+name+' must be '+day+' '+time+' Europe/Paris');
    }
  }
  if(cfg.watchdog?.scheduled_day!=='Saturday'||cfg.watchdog?.scheduled_time_utc!=='10:00')bad('watchdog must run Saturday 10:00 UTC after retry');
  if(cfg.generation?.never_promote_before_green_ci!==true)bad('fail-closed promotion flag must be true');

  const kotlin=fs.existsSync('integrations/androidtv/SelectionTvFragment.kt')?read('integrations/androidtv/SelectionTvFragment.kt'):'';
  const tvjs=fs.existsSync('assets/js/android-tv-mode.js')?read('assets/js/android-tv-mode.js'):'';
  const k=Number((kotlin.match(/BRIDGE_PROTOCOL_VERSION\s*=\s*(\d+)/)||[])[1]);
  const j=Number((tvjs.match(/REQUIRED_ANDROID_PROTOCOL\s*=\s*(\d+)/)||[])[1]);
  const c=Number(cfg.android_tv?.minimum_supported_bridge_protocol);
  if(!k||!j||!c||k!==j||j!==c)bad('Android TV bridge protocol mismatch: kotlin='+k+', js='+j+', config='+c);
  const androidWorkflow=fs.existsSync('.github/workflows/build-selection-tv-androidtv.yml')?read('.github/workflows/build-selection-tv-androidtv.yml'):'';
  const pinned=String(cfg.android_tv?.upstream_tag||'');
  if(!pinned||!androidWorkflow.includes('branch '+pinned))bad('Android TV workflow pin does not match automation-config upstream_tag '+pinned);
}

for(const p of [
  'scripts/validate-editorial.mjs',
  'scripts/validate-reserves.mjs',
  'scripts/validate-freshness.mjs',
  'scripts/validate-image-sources.mjs',
  'scripts/validate-layout.mjs'
]){
  if(fs.existsSync(p)&&!read(p).includes('SELECTION_TV_VALIDATE_WEEK'))bad(p+' does not support explicit candidate validation');
}

if(fs.existsSync('assets/js/issue-loader.js')){
  const src=read('assets/js/issue-loader.js');
  if(!src.includes("query.get('preview')==='1'")||!src.includes('localhost|127\\.0\\.0\\.1'))bad('draft preview must exist and remain localhost-only');
}

if(fs.existsSync('.github/workflows/validate-architecture.yml')){
  const wf=read('.github/workflows/validate-architecture.yml');
  for(const token of ['validate-automation.mjs','validate-publication-candidate.mjs',"startsWith(github.head_ref, 'auto/')"]){
    if(!wf.includes(token))bad('main validation workflow missing '+token);
  }
}
if(fs.existsSync('.github/workflows/promote-validated-week.yml')){
  const wf=read('.github/workflows/promote-validated-week.yml');
  for(const token of ['validate-image-sources.mjs','validate-layout.mjs','promote-week.mjs','git push origin HEAD:main','verify-public-deployment.mjs']){
    if(!wf.includes(token))bad('promotion workflow missing '+token);
  }
}
if(fs.existsSync('.github/workflows/guard-direct-publication.yml')){
  const wf=read('.github/workflows/guard-direct-publication.yml');
  for(const token of ["github.actor != 'github-actions[bot]'",'fetch-depth: 0','git checkout "$BEFORE" -- data/manifest.json','git push origin HEAD:main']){
    if(!wf.includes(token))bad('direct-publication guard missing '+token);
  }
}
if(fs.existsSync('.github/workflows/weekly-automation-watchdog.yml')){
  const wf=read('.github/workflows/weekly-automation-watchdog.yml');
  if(!wf.includes('schedule:')||!wf.includes('next-target.mjs'))bad('weekly watchdog is not scheduled or cannot resolve target');
  if(!wf.includes('0 10 * * 6'))bad('weekly watchdog cron must run Saturday 10:00 UTC after retry');
}

function targetOn(date){
  return JSON.parse(execFileSync(process.execPath,['scripts/next-target.mjs'],{
    encoding:'utf8',
    env:{...process.env,SELECTION_TV_TODAY:date}
  }));
}
if(fs.existsSync('scripts/next-target.mjs')){
  const sep=targetOn('2026-09-27');
  const oct=targetOn('2026-10-04');
  if(sep.week!=='2026-S41'||sep.from!=='2026-10-03')bad('calendar target regression for 2026-09-27');
  if(oct.week!=='2026-S42'||oct.from!=='2026-10-10')bad('calendar target regression for 2026-10-04');
}

function testCandidateTransaction(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-tv-auto-'));
  const write=(p,obj)=>{
    const full=path.join(dir,p);
    fs.mkdirSync(path.dirname(full),{recursive:true});
    fs.writeFileSync(full,typeof obj==='string'?obj:JSON.stringify(obj,null,2)+'\n');
  };
  try{
    const editorial=json('data/editorial-config.json');
    const automation=json('data/automation-config.json');
    write('data/editorial-config.json',editorial);
    write('data/automation-config.json',automation);
    write('data/manifest.json',{
      latest:'2026-S41',
      weeks:[
        {week:'2026-S42',from:'2026-10-10',to:'2026-10-16',status:'draft',page_count:1},
        {week:'2026-S41',from:'2026-10-03',to:'2026-10-09',status:'published',page_count:1}
      ]
    });
    write('data/weeks/2026-S42.json',{
      week:'2026-S42',page_count:1,publication_status:'draft',pages:[{id:'couverture',html:'<div></div>'}]
    });
    const channels=editorial.required_core_channels;
    const days=[];
    const coverageDays=[];
    for(let d=0;d<7;d++){
      const date=new Date(Date.UTC(2026,9,10+d)).toISOString().slice(0,10);
      const items=channels.map((channel,i)=>({
        title:'Fixture '+d+' '+i,
        channel,
        start:i===0?'00:30':'12:'+String(i%60).padStart(2,'0'),
        source:'fixture',
        source_url:'https://example.com/'+d+'/'+i
      }));
      while(items.length<30){
        const i=items.length;
        items.push({title:'Extra '+d+' '+i,channel:channels[0],start:'15:'+String(i%60).padStart(2,'0'),source:'fixture',source_url:'https://example.com/extra/'+d+'/'+i});
      }
      const counts=Object.fromEntries(channels.map(c=>[c,items.filter(x=>x.channel===c).length]));
      const sources=Object.fromEntries(channels.map(c=>[c,['https://example.com/grid/'+encodeURIComponent(c)+'/'+date]]));
      days.push({date,channels_scanned:channels,source_pages:['https://example.com/a/'+date,'https://example.com/b/'+date],channel_sources:sources,channel_counts:counts,items});
      coverageDays.push({date});
    }
    write('data/inventory/2026-S42.json',{week:'2026-S42',days});
    write('data/coverage/2026-S42.json',{week:'2026-S42',full_week_reaudit_completed:true,days:coverageDays});
    write('data/radar-reserves/2026-S42.json',{week:'2026-S42'});
    write('semaines/2026-S42/index.html','<body data-week="2026-S42"></body>');

    execFileSync(process.execPath,[path.resolve('scripts/validate-publication-candidate.mjs')],{
      cwd:dir,stdio:'pipe',
      env:{...process.env,SELECTION_TV_VALIDATE_WEEK:'2026-S42',SELECTION_TV_CANDIDATE:'1',GITHUB_HEAD_REF:'auto/2026-S42'}
    });
    const before=JSON.parse(fs.readFileSync(path.join(dir,'data/manifest.json'),'utf8'));
    if(before.latest!=='2026-S41'||before.weeks[0].status!=='draft')bad('candidate validator mutated publication state');

    execFileSync(process.execPath,[path.resolve('scripts/promote-week.mjs'),'2026-S42'],{cwd:dir,stdio:'pipe',env:process.env});
    const after=JSON.parse(fs.readFileSync(path.join(dir,'data/manifest.json'),'utf8'));
    const promoted=JSON.parse(fs.readFileSync(path.join(dir,'data/weeks/2026-S42.json'),'utf8'));
    if(after.latest!=='2026-S42'||after.weeks[0].status!=='published'||promoted.publication_status!=='published'){
      bad('promotion transaction did not atomically expose the candidate');
    }
  }catch(err){
    bad('candidate/promotion fixture failed: '+String(err?.stderr||err?.message||err));
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
if(fs.existsSync('scripts/validate-publication-candidate.mjs')&&fs.existsSync('scripts/promote-week.mjs'))testCandidateTransaction();

if(fail.length){
  fail.forEach(x=>console.error('✗ '+x));
  console.error('✗ Automation contract failed: '+fail.length+' problem(s)');
  process.exit(1);
}
console.log('✓ Weekly automation, fail-closed publication and Android TV protocol contracts are coherent');
