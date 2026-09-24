(()=>{
const STORE='selectionTV_saved_v1';
const PREF='selectionTV_hide_seen_v1';
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return {}}};
const save=o=>localStorage.setItem(STORE,JSON.stringify(o));
const hideSeen=()=>localStorage.getItem(PREF)!=='0';
const setHide=v=>localStorage.setItem(PREF,v?'1':'0');

const titleOf=el=>{
  if(el.matches('tr')) return (el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent||'').trim();
  return (el.dataset.title||el.querySelector('h3')?.textContent||'').trim();
};
const metaOf=el=>({
  title:titleOf(el),
  context:[el.querySelector('.slot')?.textContent,el.querySelector('.where')?.textContent,el.querySelector('.service')?.textContent,el.querySelector('.chan')?.textContent].filter(Boolean).join(' · '),
  badge:el.querySelector('.badge')?.textContent?.trim()||'',
  page:document.title,
  url:location.href,
  added:new Date().toISOString()
});
const candidates=()=>[...document.querySelectorAll(
  'article.week-card,article.feature,article.list-card,article.platform,article.radar-card,article.torrent-card,article.release-card,article.expire-card,table.schedule tbody tr'
)];

function ensureButton(el){
  const title=titleOf(el); if(!title)return;
  let box=el.querySelector('.program-actions');
  if(!box){
    box=document.createElement('div');
    box.className='program-actions';
    const target=el.querySelector('.reason')||el.querySelector('.interest')||el.querySelector('.why-release')||el;
    target.append(box);
  }
  let b=box.querySelector('button.seen-btn');
  if(!b){
    b=document.createElement('button');
    b.type='button';
    b.className='seen-btn';
    box.append(b);
  }
  const key=norm(title);
  b.onclick=()=>{
    const all=load(),current=all[key];
    if(current?.status==='vu'){
      if(current.previous_status){
        all[key]={...current,status:current.previous_status};
        delete all[key].previous_status;
      }else delete all[key];
    }else{
      const m=metaOf(el);
      all[key]={...(current||{}),...m,previous_status:current?.status||null,status:'vu'};
    }
    save(all);
    apply();
  };
}

function updateSummaries(){
  document.querySelectorAll('.page').forEach(page=>{
    const hidden=[...page.querySelectorAll('.seen-hidden')].length;
    let note=page.querySelector('.seen-summary');
    if(hidden&&hideSeen()){
      if(!note){
        note=document.createElement('div');
        note.className='seen-summary';
        const anchor=page.querySelector('.rule')||page.querySelector('.topbar');
        anchor?.insertAdjacentElement('afterend',note);
      }
      if(note)note.textContent=hidden+' recommandation'+(hidden>1?'s':'')+' déjà vue'+(hidden>1?'s':'')+' masquée'+(hidden>1?'s':'')+'.';
    }else if(note)note.remove();
  });
}
function updateToggle(){
  const b=document.getElementById('seenToggle'); if(!b)return;
  b.textContent=hideSeen()?'Afficher les vus':'Masquer les vus';
  b.classList.toggle('showing-seen',!hideSeen());
  b.onclick=()=>{setHide(!hideSeen());apply()};
}
function apply(){
  const all=load(),hide=hideSeen();
  candidates().forEach(el=>{
    const title=titleOf(el); if(!title)return;
    ensureButton(el);
    const item=all[norm(title)];
    const isSeen=item?.status==='vu';
    el.classList.toggle('seen-hidden',hide&&isSeen);
    const b=el.querySelector('button.seen-btn');
    if(b){
      b.textContent=isSeen?'✓ Vu':'Vu';
      b.classList.toggle('seen-on',isSeen);
      b.title=isSeen?'Cliquer pour réafficher ce titre':'Marquer comme déjà vu';
    }
  });
  updateToggle();
  updateSummaries();
  const c=document.getElementById('savedCount');
  if(c)c.textContent=Object.values(all).filter(x=>(x.status||'a-recuperer')==='a-recuperer').length;
}
window.addEventListener('storage',e=>{if(e.key===STORE||e.key===PREF)apply()});
apply();
setTimeout(apply,250);
setTimeout(apply,1200);
})();