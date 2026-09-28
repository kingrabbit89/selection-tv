import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {calendarTarget,parisToday,addDays} from './week-calendar.mjs';
// A UTC Saturday run can finish after midnight in Paris. Keep the Saturday cycle.
export function watchdogTarget(today=parisToday()){
  const isSunday=new Date(today+'T12:00:00Z').getUTCDay()===0;
  return calendarTarget(isSunday?addDays(today,-1):today).week;
}
export async function inspectWeek({week,manifest,prs,verify}){
  const entry=manifest.weeks.find(x=>x.week===week);
  if(entry?.status==='published'&&manifest.latest===week){
    try{await verify(week);return {ok:true,reason:'deployed'}}
    catch(error){return {ok:false,reason:'deployment-failed',detail:String(error.message)}}
  }
  const pending=prs.filter(p=>p.state==='open'&&['auto/'+week,'promote/'+week].includes(p.head.ref));
  if(pending.length)return {ok:false,reason:'publication-pending',detail:pending.map(p=>p.html_url).join('\n'),pending};
  return {ok:false,reason:entry?'draft-stuck':'generation-missing'};
}
async function main(){
  const repo=process.env.GITHUB_REPOSITORY;if(!repo)throw Error('GITHUB_REPOSITORY missing');
  const api=(path,...args)=>JSON.parse(execFileSync('gh',['api',path,...args],{encoding:'utf8'}));
  const manifest=JSON.parse(fs.readFileSync('data/manifest.json'));
  const week=watchdogTarget();
  const reconcileOnly=process.env.WATCHDOG_RECONCILE_ONLY==='1';
  const prs=api('repos/'+repo+'/pulls?state=open&per_page=100');
  const title='Sélection TV automation: '+week;
  const issues=api('repos/'+repo+'/issues?state=all&per_page=100').filter(x=>!x.pull_request&&x.title===title);
  if(reconcileOnly&&!issues.some(x=>x.state==='open')){console.log('No open alert for '+week+'; no new alert from publisher event.');return;}
  const result=await inspectWeek({week,manifest,prs,verify:()=>execFileSync(process.execPath,['scripts/verify-public-deployment.mjs',week],{stdio:'pipe'})});
  const body=[week+': '+result.reason,result.detail||'', 'Run: https://github.com/'+repo+'/actions/runs/'+process.env.GITHUB_RUN_ID];
  for(const pr of result.pending||[]){
    const checks=api('repos/'+repo+'/commits/'+pr.head.sha+'/check-runs').check_runs||[];
    body.push(...checks.map(c=>'- '+c.name+': '+(c.conclusion||c.status)));
  }
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,body.join('\n')+'\n');
  if(result.ok){
    for(const issue of issues.filter(x=>x.state==='open'))api('repos/'+repo+'/issues/'+issue.number,'--method','PATCH','-f','state=closed','-f','body='+body.join('\n'));
    console.log('✓ '+week+' publicly deployed');return;
  }
  if(reconcileOnly){console.log('Existing alert remains open: '+result.reason);return;}
  const existing=issues[0];
  api('repos/'+repo+'/issues'+(existing?'/'+existing.number:''),'--method',existing?'PATCH':'POST','-f','title='+title,'-f','body='+body.join('\n'),...(existing?['-f','state=open']:[]));
  throw Error(week+': '+result.reason+'; see weekly alert');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
