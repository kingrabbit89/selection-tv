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
 return {context:[el.querySelector('.slot')?.textContent,el.querySelector('.where')?.textContent,el.querySelector('.service')?.textContent,el.querySelector('.chan')?.textContent].filter(Boolean).join(' · '),badge:el.querySelector('.badge')?.textContent?.trim()||''};
}
const candidates=()=>[...document.querySelectorAll('article.week-card,article.feature,article.list-card,article.platform,table.schedule tbody tr')];

function attachSeenButton(el,explicitCandidate=null){
 const title=explicitCandidate?.title||titleOf(el);if(!title)return;
 const wid=explicitCandidate?.work_id||workIdForTitle(title);
 let box=el.querySelector('.program-actions');
 if(!box){box=document.createElement('div');box.className='program-actions';const target=el.querySelector('.reason')||el.querySelector('.interest')||el;target.append(box)}
 let b=box.querySelector('button.seen-btn');
 if(!b){b=document.createElement('button');b.type='button';b.className='seen-btn';box.append(b)}
 const on=isSeen(title,wid);b.textContent=on?'✓ Vu':'Vu';b.classList.toggle('seen-on',on);b.title=on?'Marqué comme vu — cliquer pour annuler':'Marquer comme déjà vu';
 b.onclick=()=>setSeen(title,wid,explicitCandidate?{context:[explicitCandidate.time,explicitCandidate.channel].filter(Boolean).join(' · '),badge:explicitCandidate.quality||''}:metaOf(el));
}
function linkEntries(L){
 const names={official:'Page officielle',allocine:'AlloCiné',imdb:'IMDb',sc:'SensCritique',wiki:'Wikipedia'};
 return ['official','allocine','imdb','sc','wiki'].filter(k=>L?.[k]).map(k=>[names[k],L[k]]);
}
function saveButton(box,c){
 const key=norm(c.title);let b=box.querySelector('button.save');
 if(!b){b=document.createElement('button');b.type='button';b.className='save';box.append(b)}
 const refresh=()=>{const x=loadStore()[key],on=(x?.status||'')==='a-recuperer';b.textContent=on?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',on)};
 b.onclick=()=>{const all=loadStore(),cur=all[key];if(cur?.status==='a-recuperer')delete all[key];else all[key]={...(cur||{}),title:c.title,work_id:c.work_id||null,context:[c.time,c.channel].filter(Boolean).join(' · '),badge:c.quality||'',page:document.title,url:location.href,added:new Date().toISOString(),status:'a-recuperer'};saveStore(all);refresh()};refresh();
}
function renderReserve(c){
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
 const box=document.createElement('div');box.className='program-actions';
 for(const [label,url] of linkEntries(c.links||{})){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label;box.append(a)}
 article.append(box);saveButton(box,c);attachSeenButton(article,c);
 return article;
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
       container.append(renderReserve(c));visible++;replacements++;
     }
   }
   let note=page.querySelector('.reserve-summary');
   const unseenAvailable=(pool.candidates||[]).filter(c=>!isSeen(c.title,c.work_id)).length;
   if(personalized&&(hiddenPrimary||replacements)){
     if(!note){note=document.createElement('div');note.className='seen-summary reserve-summary';const anchor=page.querySelector('.rule')||page.querySelector('.topbar');anchor?.insertAdjacentElement('afterend',note)}
     if(note)note.textContent=hiddenPrimary+' choix principal'+(hiddenPrimary>1?'aux':'')+' déjà vu'+(hiddenPrimary>1?'s':'')+(replacements?' · '+replacements+' remplacé'+(replacements>1?'s':'')+' par la réserve éditoriale':'')+(visible<pool.target?' · seulement '+unseenAvailable+' choix non vus dépassent le seuil éditorial':'')+'.';
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
 migrateLegacy();
 const h=hideSeen();
 for(const el of candidates()){
   const title=titleOf(el);if(!title)continue;
   // Daily developed pages are managed by ranked pools; everything else is simply hidden.
   const inPool=poolList.some(p=>el.closest('.page')?.id===p.page_id);
   if(!inPool)el.classList.toggle('seen-hidden',h&&isSeen(title,workIdForTitle(title)));
   attachSeenButton(el);
 }
 applyPools();updateToggle();
 const c=document.getElementById('savedCount');if(c)c.textContent=Object.values(loadStore()).filter(x=>(x.status||'a-recuperer')==='a-recuperer').length;
 setTimeout(()=>{try{window.dispatchEvent(new Event('resize'))}catch(e){}},20);
}
window.addEventListener('storage',e=>{if([STORE,SEEN,PREF].includes(e.key))apply()});
document.addEventListener('selectiontv:seenchange',()=>setTimeout(apply,0));
apply();setTimeout(apply,300);setTimeout(apply,1200);
})();