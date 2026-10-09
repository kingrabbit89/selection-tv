import fs from 'node:fs';
import {inputSnapshot, matchingReport, validators} from './preparation-gaps.mjs';
import {buildTaskBoard, editorialReviewState, taskBoardMarkdown} from './editorial-task-board.mjs';

const manifest=JSON.parse(fs.readFileSync('data/manifest.json','utf8'));
const target=process.env.SELECTION_TV_PREPARATION_WEEK||process.env.SELECTION_TV_VALIDATE_WEEK||manifest.latest;
const safe=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}};
const week=safe('data/weeks/'+target+'.json');
const inventory=safe('data/inventory/'+target+'.json');
const coverage=safe('data/coverage/'+target+'.json');
const works=safe('data/works.json')?.works||[];
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const byTitle=new Map(works.filter(x=>x?.title).map(x=>[norm(x.title),x]));

const lines=[];
lines.push('# Sélection TV · rapport de génération '+target,'');
const entry=(manifest.weeks||[]).find(x=>x.week===target);
lines.push('- Statut manifeste : '+(entry?.status||'absent'));
lines.push('- publication_status : '+(week?.publication_status||'absent'));
lines.push('- manifest.latest : '+manifest.latest);
const progress=safe('data/research/'+target+'.json');
if(progress){
  lines.push('- Étape de recherche : '+progress.stage);
  lines.push('- Revue éditoriale déclarée achevée : '+(editorialReviewState(progress).declared_completed?'oui':'non')+' (ce rapport ne la certifie pas)');
  lines.push('- Suivi éditorial déclaré : '+(progress.remaining?.length??'?')+' paragraphes à réconcilier avec les preuves ; ce nombre ne mesure pas les tâches actives');
  if(process.env.SELECTION_TV_PREPARATION_WEEK)lines.push('- Préparation en cours : les tests navigateur portent sur le numéro publié ; la fusion reste bloquée.');
  for(const task of progress.remaining||[])lines.push('  - '+task);
}
lines.push('- Pages : '+(week?.pages?.length||0));
lines.push('');
const gapReport=safe('preparation-gaps.json');
let accepted=false;
try {accepted=matchingReport(gapReport,inputSnapshot(target));} catch {}
const taskBoard=buildTaskBoard({progress,
  gaps:accepted?gapReport.gaps:[],observationsAvailable:accepted&&gapReport.validator_results.length>0,
  observationsComplete:accepted&&validators.every(name=>gapReport.validator_results.some(result=>result.validator===name))&&
    !gapReport.validator_results.some(result=>result.execution_error)&&gapReport.task_board?.calculated.status!=='partial'});
lines.push(taskBoardMarkdown(taskBoard));
if(!accepted)lines.push('Rapport de contrôles absent, illisible ou issu d’autres entrées/exécution : les paragraphes déclarés ne permettent pas de calculer les blocages actuels.','');

lines.push('## Inventaire','');
lines.push('| Date | Lignes brutes | Sources | Chaînes | Nuit 00–05 |');
lines.push('|---|---:|---:|---:|---:|');
for(const d of inventory?.days||[]){
  const items=d.items||[];
  const overnight=items.filter(x=>/^(?:0[0-5]):[0-5]\d$/.test(String(x.start||x.time||''))).length;
  lines.push('| '+String(d.date||'')+' | '+items.length+' | '+(d.source_pages||[]).length+' | '+(d.channels_scanned||[]).length+' | '+overnight+' |');
}
lines.push('');

lines.push('## Réserves quotidiennes','');
lines.push('| Pool | Candidats | Affiches | Métadonnées | Ratings/raison |');
lines.push('|---|---:|---:|---:|---:|');
for(const [id,pool] of Object.entries(week?.personalization?.pools||{})){
  if(!/-selection$/.test(id))continue;
  const cs=pool.candidates||[];
  let images=0,meta=0,ratings=0;
  for(const c of cs){
    const w=byTitle.get(norm(c.title));
    if(w?.image)images++;
    if(w&&(w.director||w.creator)&&w.year&&w.country&&w.duration&&w.genre)meta++;
    if(w?.ratings&&Object.keys(w.ratings).length||w?.ratings_unavailable_reason)ratings++;
  }
  lines.push('| '+id+' | '+cs.length+' | '+images+'/'+cs.length+' | '+meta+'/'+cs.length+' | '+ratings+'/'+cs.length+' |');
}
lines.push('');

lines.push('## Couverture','');
lines.push('- Audit 7 jours : '+(coverage?.full_week_reaudit_completed===true?'oui':'non'));
lines.push('- Jours de couverture : '+(coverage?.days?.length||0));
const shortages=week?.section_shortages||{};
lines.push('- Pénuries de rubriques déclarées : '+Object.keys(shortages).length);
lines.push('- Exceptions de fraîcheur : '+(week?.freshness_exceptions?.length||0));

const out=lines.join('\n')+'\n';
process.stdout.write(out);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,out);
