import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const fail=[];
const bad=x=>fail.push(x);
const required=[
  'data/automation-config.json',
  'scripts/next-target.mjs',
  'scripts/validate-publication-candidate.mjs',
  'scripts/promote-week.mjs',
  '.github/workflows/validate-architecture.yml',
  '.github/workflows/promote-validated-week.yml',
  '.github/workflows/weekly-automation-watchdog.yml',
  'AUTOMATION.md'
];
for(const p of required)if(!fs.existsSync(p))bad('missing automation component: '+p);

if(fs.existsSync('data/automation-config.json')){
  const cfg=json('data/automation-config.json');
  if(cfg.schema_version!==1)bad('automation-config schema_version must be 1');
  if(cfg.timezone!=='Europe/Paris')bad('automation timezone must be Europe/Paris');
  if(cfg.generation?.orchestrator!=='external-research-agent')bad('weekly producer must be declared as external-research-agent');
  if(cfg.generation?.candidate_manifest_status!=='draft'||cfg.generation?.candidate_publication_status!=='draft')bad('candidate must stay draft before promotion');
  if(cfg.generation?.never_promote_before_green_ci!==true)bad('fail-closed promotion flag must be true');

  const kotlin=fs.existsSync('integrations/androidtv/SelectionTvFragment.kt')?read('integrations/androidtv/SelectionTvFragment.kt'):'';
  const tvjs=fs.existsSync('assets/js/android-tv-mode.js')?read('assets/js/android-tv-mode.js'):'';
  const k=Number((kotlin.match(/BRIDGE_PROTOCOL_VERSION\s*=\s*(\d+)/)||[])[1]);
  const j=Number((tvjs.match(/REQUIRED_ANDROID_PROTOCOL\s*=\s*(\d+)/)||[])[1]);
  const c=Number(cfg.android_tv?.minimum_supported_bridge_protocol);
  if(!k||!j||!c||k!==j||j!==c)bad('Android TV bridge protocol mismatch: kotlin='+k+', js='+j+', config='+c);
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
  for(const token of ['validate-image-sources.mjs','validate-layout.mjs','promote-week.mjs','git push origin HEAD:main']){
    if(!wf.includes(token))bad('promotion workflow missing '+token);
  }
}
if(fs.existsSync('.github/workflows/weekly-automation-watchdog.yml')){
  const wf=read('.github/workflows/weekly-automation-watchdog.yml');
  if(!wf.includes('schedule:')||!wf.includes('next-target.mjs'))bad('weekly watchdog is not scheduled or cannot resolve target');
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

if(fail.length){
  fail.forEach(x=>console.error('✗ '+x));
  console.error('✗ Automation contract failed: '+fail.length+' problem(s)');
  process.exit(1);
}
console.log('✓ Weekly automation, fail-closed publication and Android TV protocol contracts are coherent');
