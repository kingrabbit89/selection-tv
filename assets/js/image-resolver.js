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
function clearFailureState(img,card){
 card.classList.remove('image-missing','image-exception');
 delete card.dataset.imageFallback;
 const visual=img.closest('.visual');
 visual?.classList.remove('broken');
}
function fallbackFor(img,card,title){
 const fb=document.createElement('div');
 fb.className='canonical-image-fallback '+[...img.classList].join(' ');
 fb.textContent=title;
 const visual=img.closest('.visual');
 img.replaceWith(fb);
 // A legacy .fallback may have been revealed by an early onerror before the
 // canonical resolver attached. Keep only one visible visual.
 if(visual)visual.querySelectorAll(':scope>.fallback').forEach(x=>x.remove());
 card.classList.add('image-missing');
 card.dataset.imageFallback='1';
}
function bind(img,title,card,extra=[]){
 const list=sources(title,[...extra,img.getAttribute('src')]);
 if(!list.length)return false;
 img.removeAttribute('onerror');
 img.loading='lazy';

 let index=0;
 let finished=false;
 const loaded=()=>{
   if(finished)return;
   finished=true;
   clearFailureState(img,card);
 };
 const failed=()=>{
   if(finished)return;
   index++;
   if(index<list.length){
     img.src=list[index];
     queueMicrotask(checkAlreadySettled);
     return;
   }
   finished=true;
   fallbackFor(img,card,title);
 };
 const checkAlreadySettled=()=>{
   if(finished||!img.complete)return;
   if(img.naturalWidth>0)loaded();
   else failed();
 };

 img.addEventListener('load',loaded);
 img.addEventListener('error',failed);

 // The catalogue is authoritative. Existing page HTML may contain a stale or
 // dead URL; always start from the canonical source, then walk fallbacks.
 const current=img.getAttribute('src');
 if(current!==list[0])img.src=list[0];
 // Crucial race fix: an image may have failed before these listeners were
 // attached (legacy inline onerror can also have marked .visual.broken).
 queueMicrotask(checkAlreadySettled);
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
 // Remove pre-rendered/static fallbacks before inserting the canonical image.
 // This is what caused Hamnet to show both its real poster and a blue block.
 card.querySelectorAll('.replacement-fallback,.radar-reserve-fallback,.release-fallback,.canonical-image-fallback').forEach(x=>x.remove());
 card.classList.remove('image-exception','image-missing');
 delete card.dataset.imageException;
 delete card.dataset.imageFallback;
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
   // A static fallback can coexist with an <img> in source HTML. If the
   // catalogue knows an image, the image is authoritative and the duplicate
   // fallback must go.
   if(w?.image)card.querySelectorAll(':scope>.canonical-image-fallback').forEach(x=>x.remove());
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
     const unresolvedCardSelector=CARD_SELECTOR.split(',').map(s=>s.trim()+':not([data-image-resolved="1"])').join(',');
     const needsHydration=node=>{
       if(!(node instanceof Element))return false;
       if(node.matches(unresolvedCardSelector)||node.matches('.coverhero:not([data-image-resolved="1"])'))return true;
       return !!node.querySelector(unresolvedCardSelector+',.coverhero:not([data-image-resolved="1"])');
     };
     const observer=new MutationObserver(records=>{
       let hydrated=false;
       for(const rec of records)for(const node of rec.addedNodes){
         if(!needsHydration(node))continue;
         hydrateTree(node);hydrated=true;
       }
       // Layout itself moves already-hydrated live nodes between pages. Do not
       // schedule another layout for those moves or the two observers loop.
       if(hydrated)setTimeout(()=>window.SelectionTVLayout?.schedule?.(),20);
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