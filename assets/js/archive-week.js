
 const STORE='selectionTV_saved_v1';
 const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return{}}};
 const save=o=>localStorage.setItem(STORE,JSON.stringify(o));
 document.querySelectorAll('[data-title]').forEach(el=>{const title=el.dataset.title,key=norm(title);el.querySelectorAll('button.save').forEach(b=>{const refresh=()=>{const a=load();const on=!!a[key]&&a[key].status!=='recupere';b.textContent=on?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',on)};b.onclick=()=>{const a=load();if(a[key]&&a[key].status!=='recupere')delete a[key];else a[key]={title,context:'Semaine 37 · 5 — 11 septembre 2026',badge:'ARCHIVE',page:document.title,url:location.href,added:new Date().toISOString(),status:'a-recuperer'};save(a);refresh()};refresh()})});
 const overlaps=p=>{const f=p.querySelector('.footer');if(!f)return false;const ft=f.getBoundingClientRect().top;let m=0;[...p.children].forEach(c=>{if(c===f||c.classList.contains('topbar')||c.classList.contains('back'))return;m=Math.max(m,c.getBoundingClientRect().bottom)});return m>ft-5};
 const fit=()=>document.querySelectorAll('.page').forEach(p=>{p.classList.remove('fit-tight','fit-ultra');if(overlaps(p))p.classList.add('fit-tight');if(overlaps(p))p.classList.add('fit-ultra')});
 requestAnimationFrame(()=>requestAnimationFrame(fit));window.addEventListener('load',()=>{setTimeout(fit,150);setTimeout(fit,800)});document.fonts?.ready?.then(fit);document.querySelectorAll('img').forEach(i=>i.addEventListener('load',()=>setTimeout(fit,20),{once:true}));
 