import fs from 'node:fs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const manifest=read('data/manifest.json');
const pconfig=read('data/personalization-config.json');
const worksData=read('data/works.json');
const linksData=read('data/links.json');
const latest=process.env.SELECTION_TV_VALIDATE_WEEK||manifest.latest;
const week=read('data/weeks/'+latest+'.json');
const policy=pconfig.reserve_readiness||{};
const strict=latest>=(policy.enabled_from_week||'9999-S99');

const works=worksData.works||[];
const byId=new Map(works.filter(w=>w?.id).map(w=>[w.id,w]));
const byTitle=new Map(works.filter(w=>w?.title).map(w=>[norm(w.title),w]));
const linksByTitle=new Map(Object.entries(linksData.links||{}).map(([k,v])=>[norm(k),v||{}]));

const failures=[];
const warnings=[];
const fail=msg=>(strict?failures:warnings).push(msg);

function strongIdentity(title,work){
  const central=linksByTitle.get(norm(title))||{};
  const local=work?.links||{};
  const l={...local,...central};
  const imdb=String(l.imdb||'');
  const tmdb=String(l.tmdb||'');
  const sc=String(l.sc||'');
  const allocine=String(l.allocine||'');
  const official=String(l.official||'');
  if(/^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/tt\d+\/?(?:[?#].*)?$/.test(imdb))return true;
  if(/^https:\/\/www\.themoviedb\.org\/(?:movie|tv)\/\d+(?:-[^?#/]+)?\/?(?:[?#].*)?$/.test(tmdb))return true;
  if(/^https:\/\/www\.senscritique\.com\/(?:film|serie)\/[^?#]+\/\d+\/?(?:[?#].*)?$/.test(sc))return true;
  if(/^https:\/\/(?:www\.)?allocine\.fr\/(?:film|series)\/fiche[^?#]*?(?:cfilm|cserie)=?\d+/i.test(allocine))return true;
  if(official && /^https?:\/\//i.test(official) &&
     !/(?:tv-programme\.com|programme-tv\.com|programme-television\.org|linternaute\.com\/television|television\.telerama\.fr|forums\.lenodal\.com)/i.test(official))return true;
  return false;
}

function specificUnavailableReason(value){
  const s=String(value||'').trim();
  return s.length>=24 && !/indisponible|non disponible|pas de note$|non v[ée]rifi|non indispensables|[àa] v[ée]rifier|pas recherch/i.test(s);
}

const pools=week.personalization?.pools||{};
const dailyIds=['samedi-selection','dimanche-selection','lundi-selection','mardi-selection','mercredi-selection','jeudi-selection','vendredi-selection'];
let totalCandidates=0,totalReady=0,totalReserves=0,totalReadyReserves=0;

for(const id of dailyIds){
  const pool=pools[id];
  if(!pool){fail(id+': pool absent');continue}
  const candidates=pool.candidates||[];
  const target=Number(pool.target||0);
  const desiredReserve=Number(pool.desired_reserve||0);
  const minimum=Number(policy.daily_total_minimum??10);
  const desired=Number(policy.daily_total_desired??15);

  if(strict && target!==Number(policy.daily_target??3))fail(id+': target='+target+' au lieu de '+Number(policy.daily_target??3));
  if(strict && desiredReserve!==Number(policy.daily_reserve_target??7))fail(id+': desired_reserve='+desiredReserve+' au lieu de '+Number(policy.daily_reserve_target??7));

  if(candidates.length<minimum){
    const shortage=pool.shortage_reason;
    if(!strict){
      warnings.push(id+': seulement '+candidates.length+' candidats (< '+minimum+')');
    }else if(!shortage || typeof shortage!=='object' || Array.isArray(shortage)){
      failures.push(id+': '+candidates.length+' candidats (< '+minimum+') et shortage_reason non structuré');
    }else{
      const reason=String(shortage.reason||'').trim();
      const sources=shortage.searched_sources||[];
      const eligible=Number(shortage.eligible_count);
      if(reason.length<30)failures.push(id+': shortage_reason.reason insuffisant');
      if(!Array.isArray(sources)||sources.length<2)failures.push(id+': shortage_reason.searched_sources doit contenir au moins 2 sources');
      if(!Number.isInteger(eligible)||eligible!==candidates.length)failures.push(id+': shortage_reason.eligible_count doit valoir '+candidates.length);
    }
  }else if(strict && candidates.length<desired && !pool.shortage_reason){
    warnings.push(id+': '+candidates.length+' candidats prêts; objectif éditorial '+desired+' non atteint mais minimum satisfait');
  }

  const ranks=new Set();
  for(const c of candidates){
    totalCandidates++;
    const label=id+' #'+String(c.rank||'?')+' '+String(c.title||'?');
    if(!c.title) {fail(label+': titre absent');continue}
    if(!Number.isInteger(c.rank)||c.rank<1||ranks.has(c.rank))fail(label+': rang invalide/dupliqué');
    ranks.add(c.rank);

    const work=byId.get(c.work_id)||byTitle.get(norm(c.title));
    let ready=true;
    const problem=msg=>{ready=false;fail(label+': '+msg)};

    if(!work)problem('œuvre canonique absente de works.json');
    else{
      if(c.work_id!==work.id)problem('work_id non canonique ('+String(c.work_id||'')+' != '+work.id+')');
      if(policy.require_real_image!==false && !String(work.image||'').trim())problem('affiche/key art absent');
      if(policy.require_real_image!==false && !String(work.image_source_url||'').trim())problem('image_source_url absent');
      if(policy.require_real_image!==false && !String(work.image_checked||'').trim())problem('image_checked absent');
      if(policy.require_director_or_creator!==false && !String(work.director||work.creator||'').trim())problem('réalisateur/créateur absent');
      if(policy.require_year!==false && !String(work.year||'').trim())problem('année absente');
      if(policy.require_country!==false && !String(work.country||'').trim())problem('pays absent');
      if(policy.require_duration!==false && !String(work.duration||'').trim())problem('durée absente');
      if(policy.require_genre!==false && !String(work.genre||'').trim())problem('genre absent');
      if(policy.require_rating_or_specific_reason!==false){
        const r=work.ratings||{};
        if(!r.imdb&&!r.senscritique&&!r.sc&&!specificUnavailableReason(work.ratings_unavailable_reason)){
          problem('aucune note vérifiée et aucune raison spécifique d’indisponibilité');
        }
      }
      if(policy.require_exact_identity_link!==false && !strongIdentity(c.title,work))problem('aucun lien d’identité exact fort');
    }

    if(policy.require_time_and_channel!==false){
      if(!String(c.time||'').trim())problem('horaire absent');
      if(!String(c.channel||'').trim())problem('chaîne absente');
    }
    if(policy.require_summary!==false && String(c.summary||'').trim().length<45)problem('synopsis de réserve absent/trop court');
    if(policy.require_editorial_why!==false && String(c.why||'').trim().length<45)problem('justification éditoriale absente/trop courte');

    if(ready)totalReady++;
    if(Number(c.rank)>target){
      totalReserves++;
      if(ready)totalReadyReserves++;
    }
  }
}

const sectionPolicy=pconfig.section_reserve_pools||{};
const sectionStrict=latest>=(sectionPolicy.enabled_from_week||'9999-S99');
if(sectionStrict){
  const pages=week.pages||[];
  const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const cardTitles=(html,cardType)=>{
    const cls=cardType==='release-card'?'release-card':'week-card';
    const re=new RegExp('<article class="[^"]*\\b'+cls+'\\b[^"]*"[^>]*>[\\s\\S]*?<h3>([\\s\\S]*?)<\\/h3>','g');
    return [...String(html||'').matchAll(re)].map(m=>clean(m[1])).filter(Boolean);
  };
  for(const [sectionName,rule] of Object.entries(sectionPolicy.sections||{})){
    const prefix=String(rule.page_id_prefix||'');
    const cardType=String(rule.card_type||'');
    const matching=pages.filter(p=>String(p.id||'').startsWith(prefix)&&cardTitles(p.html,cardType).length);
    if(!matching.length){
      failures.push(sectionName+': aucune page correspondante '+prefix+' avec '+cardType);
      continue;
    }
    for(const page of matching){
      const id=page.id;
      const primaryTitles=cardTitles(page.html,cardType);
      const pool=pools[id];
      if(!pool){failures.push(id+': pool de rubrique absent');continue}
      const target=Number(pool.target||0);
      const candidates=pool.candidates||[];
      const minimumReserve=Number(rule.minimum_reserve_per_page||0);
      if(pool.card_type!==cardType)failures.push(id+': card_type='+String(pool.card_type||'')+' au lieu de '+cardType);
      if(target!==primaryTitles.length)failures.push(id+': target='+target+' doit égaler les '+primaryTitles.length+' cartes initiales de la page');

      const candidateTitles=new Set(candidates.map(x=>norm(x.title)));
      for(const title of primaryTitles){
        if(!candidateTitles.has(norm(title)))failures.push(id+': recommandation initiale absente du pool: '+title);
      }

      if(candidates.length<target+minimumReserve){
        const shortage=pool.shortage_reason;
        if(!shortage||typeof shortage!=='object'||Array.isArray(shortage)){
          failures.push(id+': '+candidates.length+' candidats pour target '+target+'; au moins '+minimumReserve+' réserves attendues');
        }else{
          const reason=String(shortage.reason||'').trim();
          const sources=shortage.searched_sources||[];
          const eligible=Number(shortage.eligible_count);
          if(reason.length<30)failures.push(id+': shortage_reason.reason insuffisant');
          if(!Array.isArray(sources)||sources.length<2)failures.push(id+': shortage_reason.searched_sources doit contenir au moins 2 sources');
          if(!Number.isInteger(eligible)||eligible!==candidates.length)failures.push(id+': shortage_reason.eligible_count doit valoir '+candidates.length);
        }
      }

      const ranks=new Set();
      for(const cand of candidates){
        const label=id+' #'+String(cand.rank||'?')+' '+String(cand.title||'?');
        if(!cand.title){failures.push(label+': titre absent');continue}
        if(!Number.isInteger(cand.rank)||cand.rank<1||ranks.has(cand.rank))failures.push(label+': rang invalide/dupliqué');
        ranks.add(cand.rank);
        const work=byId.get(cand.work_id)||byTitle.get(norm(cand.title));
        if(!work){failures.push(label+': œuvre canonique absente de works.json');continue}
        if(cand.work_id!==work.id)failures.push(label+': work_id non canonique');
        if(!String(work.image||'').trim())failures.push(label+': affiche/key art absent');
        if(!String(work.image_source_url||'').trim())failures.push(label+': image_source_url absent');
        if(!String(work.image_checked||'').trim())failures.push(label+': image_checked absent');
        if(!String(work.director||work.creator||'').trim())failures.push(label+': réalisateur/créateur absent');
        if(!String(work.year||'').trim())failures.push(label+': année absente');
        const rating=work.ratings||{};
        if(!rating.imdb&&!rating.senscritique&&!rating.sc&&!specificUnavailableReason(work.ratings_unavailable_reason)){
          failures.push(label+': aucune note vérifiée et aucune raison spécifique d’indisponibilité');
        }
        if(!strongIdentity(cand.title,work))failures.push(label+': aucun lien d’identité exact fort');

        // S42 readiness is shared by all cards that can enter the viewport,
        // including physical releases (the browser uses the same thresholds).
        if(strict){
          for(const field of ['country','duration','genre']){
            if(!String(work[field]||'').trim())failures.push(label+': '+field+' absent');
          }
          if(String(cand.summary||'').trim().length<45)failures.push(label+': synopsis absent/trop court');
          if(String(cand.why||'').trim().length<45)failures.push(label+': justification absente/trop courte');
        }
        if(Number(cand.rank)>target){
          if(cardType==='week-card'){
            if(!String(cand.time||'').trim()||!String(cand.channel||'').trim())failures.push(label+': horaire/chaîne absents pour une réserve rendez-vous');
            if(String(cand.summary||'').trim().length<45)failures.push(label+': synopsis de réserve absent/trop court');
            if(String(cand.why||'').trim().length<45)failures.push(label+': justification éditoriale absente/trop courte');
          }
          if(cardType==='release-card'){
            if(!String(cand.release_label||'').trim())failures.push(label+': libellé de sortie physique absent');
            if(!/^https?:\/\//.test(String(cand.release_url||'')))failures.push(label+': lien direct de l’édition absent');
            if(!String(cand.editor||'').trim())failures.push(label+': éditeur absent');
          }
        }
      }
    }
  }
}

const readiness=totalCandidates?Math.round(totalReady*100/totalCandidates):0;
const reserveReadiness=totalReserves?Math.round(totalReadyReserves*100/totalReserves):0;
console.log('Reserve readiness '+latest+': '+totalReady+'/'+totalCandidates+' candidats complets ('+readiness+'%), réserves '+totalReadyReserves+'/'+totalReserves+' ('+reserveReadiness+'%)');

for(const w of warnings.slice(0,80))console.warn('! '+w);
if(failures.length){
  for(const x of failures.slice(0,120))console.error('✗ '+x);
  console.error('✗ Reserve readiness: '+failures.length+' problème(s)');
  process.exit(1);
}
if(!strict && warnings.length)console.log('✓ Semaine antérieure au blocage strict; diagnostic de réserve seulement');
else console.log('✓ Reserve readiness validation passed');
