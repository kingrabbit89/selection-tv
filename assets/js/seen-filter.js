(()=>{
const STORE='selectionTV_saved_v1';
const SEEN='selectionTV_seen_v2';
const PREF='selectionTV_hide_seen_v1';
const WEEK=window.SELECTION_TV_WEEK_DATA||{};
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loadStore=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return {}}};
const saveStore=o=>{try{localStorage.setItem(STORE,JSON.stringify(o))}catch(e){}};
const loadSeen=()=>{try{return JSON.parse(localStorage.getItem(SEEN)||'{}')}catch(e){return {}}};
const saveSeen=o=>{try{localStorage.setItem(SEEN,JSON.stringify(o))}catch(e){}};
const hideSeen=()=>localStorage.getItem(PREF)!=='0';
const setHide=v=>localStorage.setItem(PREF,v?'1':'0');

const poolList=Object.values(WEEK.personalization?.pools||{});
const poolPageIds=new Set(poolList.map(p=>p.page_id));
const candidateByTitle=new Map();
for(const pool of poolList)for(const c of pool.candidates||[])if(!candidateByTitle.has(norm(c.title)))candidateByTitle.set(norm(c.title),c);

function seenKey(title,workId){return workId||('title:'+norm(title))}
function workIdForTitle(title){return candidateByTitle.get(norm(title))?.work_id||null}
function isSeen(title,workId){
 const s=loadSeen(),k=seenKey(title,workId||workIdForTitle(title));
 if(s[k])return true;
 const legacy=loadStore()[norm(title)];
 return legacy?.status==='vu';
}
function migrateLegacy(){
 const saved=loadStore(),seen=loadSeen();let changed=false;
 for(const [k,item] of Object.entries(saved)){
   if(item?.status!=='vu'||!item.title)continue;
   const wid=workIdForTitle(item.title); if(!wid)continue;
   if(!seen[wid]){seen[wid]={title:item.title,seen_at:item.seen_at||item.added||new Date().toISOString()};changed=true}
 }
 if(changed)saveSeen(seen);
}
function setSeen(title,workId,meta={}){
 const key=norm(title),saved=loadStore(),cur=saved[key],seen=loadSeen(),sid=seenKey(title,workId||workIdForTitle(title));
 if(isSeen(title,workId)){
   delete seen[sid];
   if(cur?.status==='vu'){
     if(cur.previous_status){saved[key]={...cur,status:cur.previous_status};delete saved[key].previous_status}
     else delete saved[key];
   }
 }else{
   seen[sid]={title,work_id:workId||workIdForTitle(title)||null,seen_at:new Date().toISOString()};
   saved[key]={...(cur||{}),...meta,title,work_id:workId||workIdForTitle(title)||cur?.work_id||null,previous_status:cur?.status||null,status:'vu',seen_at:new Date().toISOString(),url:cur?.url||location.href,page:cur?.page||document.title};
 }
 saveSeen(seen);saveStore(saved);
 document.dispatchEvent(new CustomEvent('selectiontv:seenchange',{detail:{title}}));
 apply();
}
function titleOf(el){
 if(el.matches('tr'))return (el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent||'').trim();
 return (el.dataset.title||el.querySelector('h3')?.textContent||'').trim();
}
function metaOf(el){
 return {context:[el.querySelector('.slot')?.textContent,el.querySelector('.where')?.textContent,el.querySelector('.service')?.textContent,el.querySelector('.chan')?.textContent,el.querySelector('.rel-date')?.textContent,el.querySelector('.deadline')?.textContent].filter(Boolean).join(' · '),badge:el.querySelector('.badge')?.textContent?.trim()||''};
}
const candidates=()=>[...document.querySelectorAll('article.week-card,article.feature,article.list-card,article.platform,article.release-card,article.expire-card,article.radar-card,article.torrent-card,table.schedule tbody tr')];

function attachSeenButton(el,explicitCandidate=null){
 const title=explicitCandidate?.title||titleOf(el);if(!title)return;
 const wid=explicitCandidate?.work_id||workIdForTitle(title);
 let box=el.querySelector('.program-actions');
 if(!box){box=document.createElement('div');box.className='program-actions';const target=el.querySelector('.reason')||el.querySelector('.interest')||el.querySelector('.why-release')||el.querySelector('.why2')||el;target.append(box)}
 let b=box.querySelector('button.seen-btn');
 if(!b){b=document.createElement('button');b.type='button';b.className='seen-btn';box.append(b)}
 const on=isSeen(title,wid);b.textContent=on?'✓ Vu':'Vu';b.classList.toggle('seen-on',on);b.title=on?'Marqué comme vu — cliquer pour annuler':'Marquer comme déjà vu';
 b.onclick=()=>setSeen(title,wid,explicitCandidate?{context:[explicitCandidate.time,explicitCandidate.channel].filter(Boolean).join(' · '),badge:explicitCandidate.quality||''}:metaOf(el));
}
function linkEntries(L){
 const names={official:'Page officielle',allocine:'AlloCiné',imdb:'IMDb',sc:'SensCritique',wiki:'Wikipedia',source:'Source'};
 return ['official','allocine','imdb','sc','wiki','source'].filter(k=>L?.[k]).map(k=>[names[k],L[k]]);
}

function mergedLinks(c){
 // Reserve/replacement cards obey the same canonical registry as normal cards.
 // No candidate-local or generated URL may override a verified work page.
 return {...(window.SELECTION_TV_VERIFIED_LINKS?.[norm(c.title)]||{})};
}
function addReserveRatings(el,c){
 const r=window.SelectionTVRatings?.[c.title]||c.ratings;if(!r||el.querySelector('.ratings'))return;
 const box=document.createElement('div');box.className='ratings';
 const L=mergedLinks(c);
 if(r.imdb){
   const x=L.imdb?document.createElement('a'):document.createElement('span');
   x.className='rating-pill imdb';x.textContent='IMDb '+r.imdb+'/10';
   if(L.imdb){x.href=L.imdb;x.target='_blank';x.rel='noopener'}
   box.append(x);
 }
 const sc=r.sc||r.senscritique;
 if(sc){
   const x=L.sc?document.createElement('a'):document.createElement('span');
   x.className='rating-pill sc';x.textContent='SensCritique '+sc+'/10';
   if(L.sc){x.href=L.sc;x.target='_blank';x.rel='noopener'}
   box.append(x);
 }
 const d=document.createElement('span');d.className='rating-date';d.textContent='relevé 24/09/2026';box.append(d);
 if(el.matches('tr'))el.querySelector('.prog')?.append(box);
 else{
   const anchor=el.querySelector('.work-meta')||el.querySelector('.meta2')||el.querySelector('.torrent-meta')||el.querySelector('.slot')||el.querySelector('.where')||el.querySelector('h3');
   anchor?.insertAdjacentElement('afterend',box);
 }
}
function saveButton(box,c){
 const key=norm(c.title);let b=box.querySelector('button.save');
 if(!b){b=document.createElement('button');b.type='button';b.className='save';box.append(b)}
 const refresh=()=>{const x=loadStore()[key],on=(x?.status||'')==='a-recuperer';b.textContent=on?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',on)};
 b.onclick=()=>{const all=loadStore(),cur=all[key];if(cur?.status==='a-recuperer')delete all[key];else all[key]={...(cur||{}),title:c.title,work_id:c.work_id||null,context:[c.time,c.channel].filter(Boolean).join(' · '),badge:c.quality||'',page:document.title,url:location.href,added:new Date().toISOString(),status:'a-recuperer'};saveStore(all);refresh()};refresh();
}
function actionBox(article,c){
 addReserveRatings(article,c);
 const box=document.createElement('div');box.className='program-actions';
 for(const [label,url] of linkEntries(mergedLinks(c))){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label;box.append(a)}
 article.append(box);saveButton(box,c);attachSeenButton(article,c);
}
function renderRadarCard(c,isTorrent=false){
 const article=document.createElement('article');article.className=(isTorrent?'torrent-card':'radar-card')+' replacement-generated';article.dataset.title=c.title;article.dataset.workId=c.work_id||'';
 if(c.image){const img=document.createElement('img');img.src=c.image;img.alt='Affiche de '+c.title;img.loading='lazy';img.onerror=()=>{const fb=document.createElement('div');fb.className='radar-reserve-fallback';fb.textContent=c.title;img.replaceWith(fb)};article.append(img)}
 else{const fb=document.createElement('div');fb.className='radar-reserve-fallback';fb.textContent=c.title;article.append(fb)}
 const signal=document.createElement('div');signal.className=isTorrent?'torrent-signal':'added';signal.textContent=c.signal||c.added||(isTorrent?'Circulation récente':'Ajout HD récent');article.append(signal);
 const h3=document.createElement('h3');h3.textContent=c.title;article.append(h3);
 if(c.meta){const meta=document.createElement('div');meta.className=isTorrent?'torrent-meta':'meta2';meta.textContent=c.meta;article.append(meta)}
 addReserveRatings(article,c);
 if(c.summary){const p=document.createElement('p');p.textContent=c.summary;article.append(p)}
 const why=document.createElement('div');why.className='why2';const b=document.createElement('b');b.textContent='Pourquoi le retenir';const p=document.createElement('p');p.textContent=c.why||'Retenu dans la réserve éditoriale.';why.append(b,p);article.append(why);
 actionBox(article,c);return article;
}
function renderReserve(c,cardType='feature'){
 if(cardType==='radar-card')return renderRadarCard(c,false);
 if(cardType==='torrent-card')return renderRadarCard(c,true);
 if(cardType==='week-card'){
   const article=document.createElement('article');article.className='week-card replacement-generated';article.dataset.title=c.title;article.dataset.workId=c.work_id||'';
   if(c.image){const img=document.createElement('img');img.src=c.image;img.alt='Visuel de '+c.title;img.loading='lazy';article.append(img)}
   else{const fb=document.createElement('div');fb.className='replacement-fallback rendezvous-fallback';fb.textContent=c.title;article.append(fb)}
   const badge=document.createElement('div');badge.style.marginTop='1.6mm';badge.innerHTML='<span class="badge À_VOIR">'+esc(c.quality||'À VOIR')+'</span>';article.append(badge);
   const h3=document.createElement('h3');h3.textContent=c.title;article.append(h3);
   if(c.meta){const meta=document.createElement('div');meta.className='work-meta';meta.textContent=c.meta;article.append(meta)}
   const where=document.createElement('div');where.className='where';where.textContent=[c.time,c.channel].filter(Boolean).join(' · ');article.append(where);
   const p=document.createElement('p');p.textContent=c.why||c.summary||'Retenu dans la réserve éditoriale de la semaine.';article.append(p);
   actionBox(article,c);return article;
 }
 const article=document.createElement('article');article.className='feature replacement-generated';article.dataset.title=c.title;article.dataset.workId=c.work_id||'';
 const visual=document.createElement('div');visual.className='visual replacement-visual';
 if(c.image){const img=document.createElement('img');img.src=c.image;img.alt='Visuel de '+c.title;img.loading='lazy';visual.append(img)}
 else{const fb=document.createElement('div');fb.className='replacement-fallback';fb.textContent=c.title;visual.append(fb)}
 article.append(visual);
 const badge=document.createElement('div');badge.style.marginTop='2mm';badge.innerHTML='<span class="badge À_VOIR">'+esc(c.quality||'À VOIR')+'</span>';article.append(badge);
 const h3=document.createElement('h3');h3.textContent=c.title;article.append(h3);
 const slot=document.createElement('div');slot.className='slot';slot.textContent=[c.time,c.channel].filter(Boolean).join(' · ');article.append(slot);
 if(c.meta){const meta=document.createElement('div');meta.className='work-meta';meta.textContent=c.meta;article.append(meta)}
 if(c.summary){const h4=document.createElement('h4');h4.textContent='Ce que ça raconte';article.append(h4);const p=document.createElement('p');p.textContent=c.summary;article.append(p)}
 const interest=document.createElement('div');interest.className='interest';const ih=document.createElement('h4');ih.textContent='Pourquoi c’est intéressant';interest.append(ih);const ip=document.createElement('p');ip.textContent=c.why||'Retenu dans la réserve éditoriale de la semaine.';interest.append(ip);article.append(interest);
 actionBox(article,c);return article;
}
function applyPools(){
 const personalized=hideSeen();
 for(const pool of poolList){
   const page=document.getElementById(pool.page_id);if(!page)continue;
   const container=page.querySelector(pool.container_selector);if(!container)continue;
   container.querySelectorAll('.replacement-generated').forEach(x=>x.remove());
   const prim=[...container.querySelectorAll(pool.primary_selector||'article.feature:not(.replacement-generated)')];
   const primaryTitles=new Set(prim.map(x=>norm(titleOf(x))));
   let visible=0,hiddenPrimary=0;
   for(const el of prim){
     const title=titleOf(el),wid=workIdForTitle(title),hide=personalized&&isSeen(title,wid);
     el.classList.toggle('seen-hidden',hide);attachSeenButton(el);
     if(hide)hiddenPrimary++;else visible++;
   }
   let replacements=0;
   if(personalized&&visible<pool.target){
     for(const c of pool.candidates||[]){
       if(visible>=pool.target)break;
       if(primaryTitles.has(norm(c.title))||isSeen(c.title,c.work_id))continue;
       container.append(renderReserve(c,pool.card_type||'feature'));visible++;replacements++;
     }
   }
   let note=page.querySelector('.reserve-summary');
   const unseenAvailable=(pool.candidates||[]).filter(c=>!isSeen(c.title,c.work_id)&&!primaryTitles.has(norm(c.title))).length;
   if(personalized&&(hiddenPrimary||replacements)){
     if(!note){note=document.createElement('div');note.className='seen-summary reserve-summary';const anchor=page.querySelector('.rule')||page.querySelector('.topbar');anchor?.insertAdjacentElement('afterend',note)}
     if(note)note.textContent=hiddenPrimary+' choix principal'+(hiddenPrimary>1?'aux':'')+' déjà vu'+(hiddenPrimary>1?'s':'')+(replacements?' · '+replacements+' remplacé'+(replacements>1?'s':'')+' par la réserve éditoriale':'')+(visible<pool.target?' · réserve insuffisante : '+unseenAvailable+' autre'+(unseenAvailable>1?'s':'')+' choix non vu'+(unseenAvailable>1?'s':''):'')+'.';
   }else if(note)note.remove();
 }
}
const GRID_DAYS=['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'];
const gridState=new Map();
const isDailyGridPageId=id=>GRID_DAYS.some(d=>id===d+'-grille'||id===d+'-grille-2');
function ensureGridState(day){
 if(gridState.has(day))return gridState.get(day);
 const p1=document.getElementById(day+'-grille'),p2=document.getElementById(day+'-grille-2');
 if(!p1||!p2)return null;
 const b1=p1.querySelector('table.schedule tbody'),b2=p2.querySelector('table.schedule tbody');
 if(!b1||!b2)return null;
 const rows1=[...b1.querySelectorAll('tr')],rows2=[...b2.querySelectorAll('tr')];
 const state={
   day,p1,p2,b1,b2,
   rows:[...rows1,...rows2],
   firstCount:rows1.length,
   title1:p1.querySelector('.grid-title')?.textContent||'',
   title2:p2.querySelector('.grid-title')?.textContent||'',
   generated:new Map()
 };
 gridState.set(day,state);return state;
}
function makeGridReserveRow(c){
 const tr=document.createElement('tr');tr.className='grid-reserve-generated';tr.dataset.title=c.title;tr.dataset.workId=c.work_id||'';
 const cls=String(c.quality||'À VOIR').replace(/\s+/g,'_');
 tr.innerHTML='<td class="time">'+esc(c.time||'')+'</td><td class="chan">'+esc(c.channel||'')+'</td><td class="prog">'+esc(c.title)+'</td><td class="reason">'+esc(c.why||c.summary||'Retenu dans la réserve éditoriale de la journée.')+'</td><td class="rep"><span class="badge '+esc(cls)+'">'+esc(c.quality||'À VOIR')+'</span></td>';
 const reason=tr.querySelector('.reason');
 const box=document.createElement('div');box.className='program-actions';reason.append(box);
 for(const [label,url] of linkEntries(mergedLinks(c))){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label;box.append(a)}
 addReserveRatings(tr,c);saveButton(box,c);attachSeenButton(tr,c);
 return tr;
}
function applyGridGroups(){
 const personalized=hideSeen();
 for(const day of GRID_DAYS){
   const s=ensureGridState(day);if(!s)continue;
   const pool=(WEEK.personalization?.pools||{})[day+'-selection'];
   const originalByTitle=new Map(s.rows.map(r=>[norm(titleOf(r)),r]));
   const title1=s.p1.querySelector('.grid-title'),title2=s.p2.querySelector('.grid-title');
   let note=s.p1.querySelector('.grid-seen-summary');

   if(!personalized){
     s.b1.replaceChildren(...s.rows.slice(0,s.firstCount));
     s.b2.replaceChildren(...s.rows.slice(s.firstCount));
     for(const r of s.rows){r.classList.remove('seen-hidden');attachSeenButton(r)}
     for(const r of s.generated.values())r.remove();
     s.p2.classList.remove('seen-page-hidden');
     if(title1)title1.textContent=s.title1;
     if(title2)title2.textContent=s.title2;
     if(note)note.remove();
     continue;
   }

   const target=s.rows.length;
   const selected=[],used=new Set();
   const take=(row,c=null)=>{
     const t=norm(c?.title||titleOf(row));if(!t||used.has(t))return;
     const title=c?.title||titleOf(row),wid=c?.work_id||workIdForTitle(title);
     if(isSeen(title,wid))return;
     row.classList.remove('seen-hidden');attachSeenButton(row,c);
     selected.push(row);used.add(t);
   };

   for(const c of pool?.candidates||[]){
     if(selected.length>=target)break;
     const key=norm(c.title);let row=originalByTitle.get(key);
     if(!row){
       row=s.generated.get(key);
       if(!row){row=makeGridReserveRow(c);s.generated.set(key,row)}
     }
     take(row,c);
   }
   for(const row of s.rows){
     if(selected.length>=target)break;
     take(row);
   }

   s.b1.replaceChildren(...selected.slice(0,s.firstCount));
   const rest=selected.slice(s.firstCount);
   s.b2.replaceChildren(...rest);
   const onePage=rest.length===0;
   s.p2.classList.toggle('seen-page-hidden',onePage);
   if(title1)title1.textContent=onePage?s.title1.replace(/\s*·\s*1\/2\s*$/,''):s.title1;
   if(title2)title2.textContent=s.title2;

   const hiddenOriginal=s.rows.filter(r=>isSeen(titleOf(r),workIdForTitle(titleOf(r)))).length;
   const replacements=selected.filter(r=>r.classList.contains('grid-reserve-generated')).length;
   if(hiddenOriginal||replacements||onePage){
     if(!note){note=document.createElement('div');note.className='seen-summary grid-seen-summary';const anchor=s.p1.querySelector('.rule')||s.p1.querySelector('.topbar');anchor?.insertAdjacentElement('afterend',note)}
     let msg=hiddenOriginal+' recommandation'+(hiddenOriginal>1?'s':'')+' déjà vue'+(hiddenOriginal>1?'s':'')+' masquée'+(hiddenOriginal>1?'s':'');
     if(replacements)msg+=' · '+replacements+' remplacée'+(replacements>1?'s':'')+' par la réserve éditoriale';
     if(onePage)msg+=' · les '+selected.length+' recommandations restantes sont regroupées sur une seule page';
     else msg+=' · les recommandations restantes sont redistribuées automatiquement entre les deux pages';
     note.textContent=msg+'.';
   }else if(note)note.remove();
 }
}

function syncRadar1080pSummary(){
 const body=document.querySelector('#radar-3 .radar-table tbody');if(!body)return;
 const cards=[...document.querySelectorAll('#radar-1 .radar-card:not(.seen-hidden),#radar-2 .radar-card:not(.seen-hidden)')];
 const parse=txt=>{const out={};for(const part of txt.split(' · ')){const i=part.indexOf(':');if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim()}return out};
 body.replaceChildren(...cards.map(card=>{
   const meta=parse(card.querySelector('.meta2')?.textContent?.trim()||''),tr=document.createElement('tr');
   const vals=[
     titleOf(card),
     (card.querySelector('.added')?.textContent||'').replace('Ajout repéré · ',''),
     [meta['Réalisation'],meta['Sortie'],meta['Pays']].filter(Boolean).join(' · '),
     [meta['Durée'],meta['Genre']].filter(Boolean).join(' · '),
     [...card.querySelectorAll('.rating-pill')].map(x=>x.textContent.replace('/10','')).join(' · '),
     card.querySelector('.why2 p')?.textContent?.trim()||''
   ];
   vals.forEach((v,i)=>{const td=document.createElement('td');if(i===0)td.className='rt-title';td.textContent=v;tr.append(td)});return tr;
 }));
 const deck=document.querySelector('#radar-3 .deck');
 if(deck&&hideSeen())deck.textContent='Vue condensée des dix titres effectivement affichés après remplacement des œuvres déjà vues.';
}

function updateSimpleSummaries(){
 for(const page of document.querySelectorAll('.page')){
   if(poolPageIds.has(page.id)||isDailyGridPageId(page.id))continue;
   const hidden=[...page.querySelectorAll('.seen-hidden')].filter(el=>candidates().includes(el)).length;
   let note=page.querySelector('.simple-seen-summary');
   if(hideSeen()&&hidden){
     if(!note){note=document.createElement('div');note.className='seen-summary simple-seen-summary';const anchor=page.querySelector('.rule')||page.querySelector('.topbar');anchor?.insertAdjacentElement('afterend',note)}
     note.textContent=hidden+' recommandation'+(hidden>1?'s':'')+' déjà vue'+(hidden>1?'s':'')+' masquée'+(hidden>1?'s':'')+' sur ce navigateur.';
   }else if(note)note.remove();
 }
}
function updateToggle(){
 const b=document.getElementById('seenToggle');if(!b)return;
 b.textContent=hideSeen()?'Afficher les vus':'Masquer les vus';
 b.classList.toggle('showing-seen',!hideSeen());
 b.onclick=()=>{setHide(!hideSeen());apply()};
}
function apply(){
 window.SelectionTVLayout?.restore();
 migrateLegacy();
 const h=hideSeen();
 for(const el of candidates()){
   const title=titleOf(el);if(!title)continue;
   const pageId=el.closest('.page')?.id||'';
   const inPool=poolPageIds.has(pageId);
   const inDailyGrid=el.matches('tr')&&isDailyGridPageId(pageId);
   if(!inPool&&!inDailyGrid)el.classList.toggle('seen-hidden',h&&isSeen(title,workIdForTitle(title)));
   attachSeenButton(el);
 }
 applyPools();applyGridGroups();syncRadar1080pSummary();updateSimpleSummaries();updateToggle();
 const c=document.getElementById('savedCount');if(c)c.textContent=Object.values(loadStore()).filter(x=>(x.status||'a-recuperer')==='a-recuperer').length;
 setTimeout(()=>{try{window.dispatchEvent(new Event('resize'))}catch(e){}},20);
}
window.addEventListener('storage',e=>{if([STORE,SEEN,PREF].includes(e.key))apply()});
document.addEventListener('selectiontv:seenchange',()=>setTimeout(apply,0));
apply();setTimeout(apply,300);setTimeout(apply,1200);
})();