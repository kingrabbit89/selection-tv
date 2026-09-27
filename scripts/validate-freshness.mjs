import fs from 'node:fs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

const manifest=read('data/manifest.json');
const pconfig=read('data/personalization-config.json');
const freshness=pconfig.freshness||{};
const latest=manifest.latest;

if(!freshness.enabled_from_week||latest<freshness.enabled_from_week){
  console.log('✓ Freshness validation skipped before '+(freshness.enabled_from_week||'configured week'));
  process.exit(0);
}

const current=read('data/weeks/'+latest+'.json');
const works=read('data/works.json').works||[];

function publicCore(issue){
  const out=new Set();
  for(const p of issue.pages||[]){
    const id=String(p.id||''),html=String(p.html||'');
    if(/^rendezvous-/.test(id)||/-selection$/.test(id)){
      for(const m of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)){
        const t=clean(m[1]);if(t)out.add(norm(t));
      }
    }
    if(/-grille(?:-2)?$/.test(id)){
      for(const m of html.matchAll(/<td class="prog">([^<]+)<\/td>/g)){
        const t=clean(m[1]);if(t)out.add(norm(t));
      }
    }
  }
  return out;
}

function reserveCore(issue){
  const out=new Set();
  for(const pool of Object.values(issue.personalization?.pools||{})){
    for(const c of pool?.candidates||[])if(c?.title)out.add(norm(c.title));
  }
  return out;
}

function addOccurrenceFallback(set,short){
  if(!short)return;
  for(const w of works){
    if((w.occurrences||[]).some(o=>String(o.week||'')===short))set.add(norm(w.title));
  }
}

function freshRatio(currentSet,history){
  if(!currentSet.size)return 1;
  let fresh=0;
  for(const t of currentSet)if(!history.has(t))fresh++;
  return fresh/currentSet.size;
}

const exceptions=new Map();
const allowed=new Set(freshness.allowed_exception_contexts||[]);
for(const ex of current.freshness_exceptions||[]){
  const key=norm(ex?.title),context=String(ex?.context||'').trim(),reason=String(ex?.reason||'').trim();
  if(!key)throw new Error('freshness exception without title');
  if(!allowed.has(context))throw new Error('invalid freshness exception context for '+ex.title+': '+context);
  if(reason.length<20)throw new Error('freshness exception reason too short for '+ex.title);
  exceptions.set(key,ex);
}

const entries=manifest.weeks||[];
const idx=entries.findIndex(w=>w.week===latest);
const lookback=Math.max(1,Number(freshness.history_lookback_issues||4));
const priorEntries=idx>=0?entries.slice(idx+1).filter(w=>w.status!=='draft').slice(0,lookback):[];
const prior=[];
for(const e of priorEntries){
  const path='data/weeks/'+e.week+'.json';
  if(fs.existsSync(path))prior.push({entry:e,issue:read(path)});
}

const curPublic=publicCore(current);
const curReserve=reserveCore(current);
const historyAny=new Set();
for(const p of prior){
  for(const t of publicCore(p.issue))historyAny.add(t);
  for(const t of reserveCore(p.issue))historyAny.add(t);
  addOccurrenceFallback(historyAny,String(p.entry.short||p.entry.week.split('-')[1]||''));
}

const previous=prior[0];
const prevPublic=previous?publicCore(previous.issue):new Set();
const prevAny=new Set(prevPublic);
if(previous){
  for(const t of reserveCore(previous.issue))prevAny.add(t);
  addOccurrenceFallback(prevAny,String(previous.entry.short||previous.entry.week.split('-')[1]||''));
}

const immediatePublic=[...curPublic].filter(t=>prevPublic.has(t)&&!exceptions.has(t));
const maxImmediate=Math.max(0,Number(freshness.previous_issue_public_repeat_max??0));
if(immediatePublic.length>maxImmediate){
  throw new Error('public core repeats '+immediatePublic.length+' title(s) from previous public issue (max '+maxImmediate+'): '+immediatePublic.slice(0,15).join(' | '));
}

const reservePrev=[...curReserve].filter(t=>prevAny.has(t));
const reservePrevRatio=curReserve.size?reservePrev.length/curReserve.size:0;
const maxReservePrev=Number(freshness.previous_issue_any_reserve_ratio_max??0.10);
if(reservePrevRatio>maxReservePrev){
  throw new Error('reserve repeat ratio vs previous issue is '+Math.round(reservePrevRatio*100)+'% ('+reservePrev.length+'/'+curReserve.size+'), max '+Math.round(maxReservePrev*100)+'%');
}

const publicFresh=freshRatio(curPublic,historyAny);
const reserveFresh=freshRatio(curReserve,historyAny);
const minPublic=Number(freshness.public_fresh_ratio_min??0.85);
const minReserve=Number(freshness.reserve_fresh_ratio_min??0.80);

if(publicFresh<minPublic){
  const repeats=[...curPublic].filter(t=>historyAny.has(t));
  throw new Error('public core only '+Math.round(publicFresh*100)+'% new over last '+lookback+' issues; expected '+Math.round(minPublic*100)+'%. Repeats: '+repeats.slice(0,18).join(' | '));
}
if(reserveFresh<minReserve){
  const repeats=[...curReserve].filter(t=>historyAny.has(t));
  throw new Error('reserve pools only '+Math.round(reserveFresh*100)+'% new over last '+lookback+' issues; expected '+Math.round(minReserve*100)+'%. Repeats: '+repeats.slice(0,18).join(' | '));
}

console.log('✓ Freshness '+latest+': public '+Math.round(publicFresh*100)+'% new; reserves '+Math.round(reserveFresh*100)+'% new across '+lookback+' prior issues');
