(()=>{
const WEEK=window.SELECTION_TV_WEEK_DATA||{};
const CFG=WEEK.radar_reserves||{};
const STORE='selectionTV_saved_v1',SEEN='selectionTV_seen_v2',PREF='selectionTV_hide_seen_v1';
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load=k=>{try{return JSON.parse(localStorage.getItem(k)||'{}')}catch(e){return {}}};
const hideSeen=()=>localStorage.getItem(PREF)!=='0';
const isSeen=c=>!!load(SEEN)[c.work_id||('title:'+norm(c.title))]||load(STORE)[norm(c.title)]?.status==='vu';
const byTitle=new Map(Object.values(CFG).flatMap(x=>x.candidates||[]).map(c=>[norm(c.title),c]));
function setSeen(c){
 const seen=load(SEEN),saved=load(STORE),key=norm(c.title),sid=c.work_id||('title:'+key),cur=saved[key],on=isSeen(c);
 if(on){delete seen[sid];if(cur?.status==='vu'){if(cur.previous_status){saved[key]={...cur,status:cur.previous_status};delete saved[key].previous_status}else delete saved[key]}}
 else{seen[sid]={title:c.title,work_id:c.work_id||null,seen_at:new Date().toISOString()};saved[key]={...(cur||{}),title:c.title,work_id:c.work_id||null,previous_status:cur?.status||null,status:'vu',seen_at:new Date().toISOString(),url:location.href,page:document.title}}
 localStorage.setItem(SEEN,JSON.stringify(seen));localStorage.setItem(STORE,JSON.stringify(saved));
 document.dispatchEvent(new CustomEvent('selectiontv:seenchange',{detail:{title:c.title}}));
 setTimeout(apply,40);
}
function saveButton(box,c){
 const key=norm(c.title),saved=()=>load(STORE);let b=document.createElement('button');b.type='button';b.className='save';
 const refresh=()=>{const on=saved()[key]?.status==='a-recuperer';b.textContent=on?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',on)};
 b.onclick=()=>{const all=saved(),cur=all[key];if(cur?.status==='a-recuperer')delete all[key];else all[key]={...(cur||{}),title:c.title,work_id:c.work_id||null,status:'a-recuperer',added:new Date().toISOString(),url:location.href,page:document.title};localStorage.setItem(STORE,JSON.stringify(all));refresh()};refresh();box.append(b);
}
function links(box,c){
 const names={official:'Page officielle',allocine:'AlloCiné',imdb:'IMDb',sc:'SensCritique',wiki:'Wikipedia',source:'Source'};
 for(const k of ['official','allocine','imdb','sc','wiki','source'])if(c.links?.[k]){const a=document.createElement('a');a.href=c.links[k];a.target='_blank';a.rel='noopener';a.textContent=names[k];box.append(a)}
}
function ratings(card,c){
 if(!c.ratings||(!c.ratings.imdb&&!c.ratings.sc))return;
 const box=document.createElement('div');box.className='ratings';
 if(c.ratings.imdb){const x=c.links?.imdb?document.createElement('a'):document.createElement('span');x.className='rating-pill imdb';x.textContent='IMDb '+c.ratings.imdb+'/10';if(c.links?.imdb){x.href=c.links.imdb;x.target='_blank';x.rel='noopener'}box.append(x)}
 if(c.ratings.sc){const x=c.links?.sc?document.createElement('a'):document.createElement('span');x.className='rating-pill sc';x.textContent='SensCritique '+c.ratings.sc+'/10';if(c.links?.sc){x.href=c.links.sc;x.target='_blank';x.rel='noopener'}box.append(x)}
 const d=document.createElement('span');d.className='rating-date';d.textContent='relevé 24/09/2026';box.append(d);card.append(box);
}
function visual(card,c,label){
 if(c.image){const img=document.createElement('img');img.src=c.image;img.alt='Affiche de '+c.title;img.loading='lazy';img.onerror=()=>{const f=document.createElement('div');f.className='radar-reserve-fallback';f.textContent=label+' · '+c.title;img.replaceWith(f)};card.append(img)}
 else{const f=document.createElement('div');f.className='radar-reserve-fallback';f.textContent=label+' · '+c.title;card.append(f)}
}
function card(c,type){
 const a=document.createElement('article');a.className=(type==='hd'?'radar-card':'torrent-card')+' replacement-generated';a.dataset.title=c.title;a.dataset.workId=c.work_id||'';
 visual(a,c,type==='hd'?'RÉSERVE 1080p':'RÉSERVE RADAR');
 const sig=document.createElement('div');sig.className=type==='hd'?'added':'torrent-signal';sig.textContent=c.signal||c.added||'Signal récent';a.append(sig);
 const h=document.createElement('h3');h.textContent=c.title;a.append(h);
 const m=document.createElement('div');m.className=type==='hd'?'meta2':'torrent-meta';m.textContent=c.meta||'';a.append(m);
 ratings(a,c);
 if(c.summary){const p=document.createElement('p');p.textContent=c.summary;a.append(p)}
 const why=document.createElement('div');why.className='why2';why.innerHTML='<b>Pourquoi le retenir</b><p>'+esc(c.why||'Retenu dans la réserve éditoriale.')+'</p>';a.append(why);
 const actions=document.createElement('div');actions.className='program-actions';links(actions,c);saveButton(actions,c);
 const seen=document.createElement('button');seen.type='button';seen.className='seen-btn';const ref=()=>{const on=isSeen(c);seen.textContent=on?'✓ Vu':'Vu';seen.classList.toggle('seen-on',on)};seen.onclick=()=>setSeen(c);ref();actions.append(seen);a.append(actions);
 return a;
}
function titleOf(el){return (el.dataset.title||el.querySelector('h3')?.textContent||'').trim()}
function syncSummary(){
 const body=document.querySelector('#radar-3 .radar-table tbody');if(!body)return;
 const cards=[...document.querySelectorAll('#radar-1 .radar-card:not(.seen-hidden),#radar-2 .radar-card:not(.seen-hidden)')];
 body.replaceChildren(...cards.map(x=>{const c=byTitle.get(norm(titleOf(x)))||{};const tr=document.createElement('tr');const vals=[titleOf(x),x.querySelector('.added')?.textContent||'',c.meta||x.querySelector('.meta2')?.textContent||'', '',[...x.querySelectorAll('.rating-pill')].map(y=>y.textContent.replace('/10','')).join(' · '),x.querySelector('.why2 p')?.textContent||''];vals.forEach((v,i)=>{const td=document.createElement('td');if(i===0)td.className='rt-title';td.textContent=v;tr.append(td)});return tr}));
}
function applySection(key){
 const cfg=CFG[key];if(!cfg)return;
 const page=document.getElementById(cfg.page_id),box=page?.querySelector(cfg.container_selector);if(!box)return;
 box.querySelectorAll('.replacement-generated').forEach(x=>x.remove());
 if(!hideSeen())return;
 const originals=[...box.querySelectorAll(cfg.primary_selector)];
 let visible=originals.filter(x=>!x.classList.contains('seen-hidden')).length;
 for(const c of cfg.candidates||[]){if(visible>=cfg.target)break;if(isSeen(c))continue;if(originals.some(x=>norm(titleOf(x))===norm(c.title)))continue;box.append(card(c,cfg.type));visible++}
}
function apply(){applySection('torrent');applySection('hd1');applySection('hd2');syncSummary();setTimeout(()=>window.dispatchEvent(new Event('resize')),20)}
document.addEventListener('selectiontv:seenchange',()=>setTimeout(apply,70));
document.addEventListener('click',e=>{if(e.target?.id==='seenToggle')setTimeout(apply,70)});
window.addEventListener('storage',e=>{if([STORE,SEEN,PREF].includes(e.key))apply()});
apply();setTimeout(apply,400);setTimeout(apply,1300);
})();