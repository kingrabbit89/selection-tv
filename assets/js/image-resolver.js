(()=>{
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const CARD_SELECTOR='article.week-card,article.feature,article.list-card,article.platform,article.release-card,article.expire-card,article.radar-card,article.torrent-card,article.card,article.listitem,article.radarcard';
const uniq=a=>[...new Set(a.filter(Boolean))];
const titleOf=card=>(card.dataset.title||card.querySelector('h3')?.textContent||'').trim();
let map=new Map();

function record(title){return map.get(norm(title))||null}
function sources(title,extra=[]){
 const w=record(title);
 return uniq([w?.image,...(w?.image_fallbacks||[]),...extra]);
}
function fallbackFor(img,card,title){
 const fb=document.createElement('div');
 fb.className='canonical-image-fallback '+[...img.classList].join(' ');
 fb.textContent=title;
 img.replaceWith(fb);
 card.classList.add('image-missing');
 card.dataset.imageFallback='1';
}
function bind(img,title,card,extra=[]){
 const list=sources(title,[...extra,img.getAttribute('src')]);
 if(!list.length)return false;
 img.removeAttribute('onerror');
 let index=0;
 const current=img.getAttribute('src');
 const found=list.indexOf(current);
 if(found>=0)index=found;
 else{index=0;img.src=list[0]}
 img.loading='lazy';
 img.addEventListener('error',()=>{
   index++;
   if(index<list.length){img.src=list[index];return}
   fallbackFor(img,card,title);
   setTimeout(()=>window.SelectionTVLayout?.schedule?.(),20);
 });
 return true;
}
function makeImg(title,cls=''){
 const img=document.createElement('img');
 if(cls)img.className=cls;
 img.alt='Affiche de '+title;
 img.loading='lazy';
 return img;
}
function inject(card,title,w){
 if(!w?.image)return false;
 card.querySelectorAll('.replacement-fallback,.radar-reserve-fallback,.release-fallback').forEach(x=>x.remove());
 let img;
 if(card.matches('.listitem')){
   img=makeImg(title,'archive-list-thumb');
   card.classList.add('has-visual');
   card.prepend(img);
 }else if(card.matches('.card,.radarcard')){
   card.querySelectorAll(':scope>.poster-fallback').forEach(x=>x.remove());
   img=makeImg(title);
   card.prepend(img);
 }else if(card.matches('.list-card')){
   img=makeImg(title,'section-thumb');
   const num=card.querySelector(':scope>.num');
   num?num.insertAdjacentElement('afterend',img):card.prepend(img);
 }else if(card.matches('.platform')){
   img=makeImg(title,'platform-thumb');
   card.classList.add('has-visual');
   let copy=card.querySelector(':scope>.platform-copy');
   if(!copy){
     copy=document.createElement('div');copy.className='platform-copy';
     while(card.firstChild)copy.append(card.firstChild);
     card.append(img,copy);
   }else card.prepend(img);
 }else if(card.matches('.release-card')){
   img=makeImg(title);
   card.prepend(img);
 }else if(card.matches('.expire-card')){
   img=makeImg(title,'expire-thumb');
   card.prepend(img);
 }else if(card.matches('.feature')){
   let visual=card.querySelector(':scope>.visual');
   if(!visual){visual=document.createElement('div');visual.className='visual';card.prepend(visual)}
   img=makeImg(title,'poster');visual.prepend(img);
 }else{
   img=makeImg(title);card.prepend(img);
 }
 img.src=w.image;
 bind(img,title,card);
 return true;
}
function hydrate(card){
 if(!(card instanceof Element)||!card.matches(CARD_SELECTOR)||card.dataset.imageResolved==='1')return;
 const title=titleOf(card);if(!title)return;
 const w=record(title),existing=card.querySelector('img');
 if(existing){
   bind(existing,title,card);
   card.dataset.imageResolved='1';
   return;
 }
 if(w?.image){
   inject(card,title,w);
   card.dataset.imageResolved='1';
   return;
 }
 if(w?.image_exception_reason){
   card.classList.add('image-exception');
   card.dataset.imageException=w.image_exception_reason;
 }else card.classList.add('image-missing');
 card.dataset.imageResolved='1';
}
function hydrateCover(hero){
 if(!(hero instanceof Element)||hero.dataset.imageResolved==='1')return;
 const title=(hero.querySelector('h2')?.textContent||'').trim(),img=hero.querySelector('img');
 if(!title||!img)return;
 bind(img,title,hero);hero.dataset.imageResolved='1';
}
function hydrateTree(root=document){
 if(root instanceof Element&&root.matches(CARD_SELECTOR))hydrate(root);
 if(root instanceof Element&&root.matches('.coverhero'))hydrateCover(root);
 root.querySelectorAll?.(CARD_SELECTOR).forEach(hydrate);
 root.querySelectorAll?.('.coverhero').forEach(hydrateCover);
}
window.SelectionTVImageMap=map;
window.SelectionTVImageSources=(title,extra=[])=>sources(title,extra);
window.SelectionTVBindImage=(img,title,card,extra=[])=>bind(img,title,card,extra);
window.SelectionTVImageFor=title=>record(title);
window.SelectionTVImagesReady=(async()=>{
 try{
   const res=await fetch('../../data/works.json?v=20260924-imagecanon2',{cache:'no-store'});
   if(!res.ok)throw new Error('HTTP '+res.status);
   const data=await res.json();
   map=new Map((data.works||[]).map(w=>[norm(w.title),w]));
   window.SelectionTVImageMap=map;
   hydrateTree(document);
   const book=document.querySelector('.book');
   if(book){
     const observer=new MutationObserver(records=>{
       for(const rec of records)for(const node of rec.addedNodes)if(node instanceof Element)hydrateTree(node);
       setTimeout(()=>window.SelectionTVLayout?.schedule?.(),20);
     });
     observer.observe(book,{childList:true,subtree:true});
     window.SelectionTVImageObserver=observer;
   }
   document.dispatchEvent(new CustomEvent('selectiontv:imagesready'));
   setTimeout(()=>window.dispatchEvent(new Event('resize')),40);
 }catch(err){
   console.warn('Selection TV: chargement des visuels canoniques impossible',err);
 }
})();
})();