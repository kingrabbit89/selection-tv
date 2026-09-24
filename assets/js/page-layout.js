/* Presentation-only pagination. Move live nodes (never clone actions or content),
   then restore their exact positions before the personal selection engine runs. */
(()=>{
 const gridSelector='.week-grid,.radar-grid,.torrent-grid,.feature-columns,.hero-grid,.list-2,.platform-grid,.release-grid,.expire-grid,.cards5,.radargrid,.list2,.indexcols';
 let moves=[],styles=new Map(),labels=new Map(),continuations=[],timer,running=false;
 const originalPages=[...document.querySelectorAll('.book>.page')];
 const observer=new MutationObserver(()=>schedule());
 const observe=()=>observer.observe(document.querySelector('.book'),{childList:true,subtree:true});
 function rememberMove(node,parent,before=null){
   if(!moves.some(x=>x.node===node)){const marker=document.createComment('layout origin');node.before(marker);moves.push({node,marker})}
   parent.insertBefore(node,before);
 }
 function restore(){
   observer.disconnect();clearTimeout(timer);
   for(const {node,marker} of moves)if(marker.parentNode)marker.replaceWith(node);
   moves=[];
   for(const [el,value] of styles){if(value===null)el.removeAttribute('style');else el.setAttribute('style',value)}styles.clear();
   for(const [el,value] of labels)el.textContent=value;labels.clear();
   continuations.forEach(p=>p.remove());continuations=[];
 }
 const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none';
 const furniture='.topbar,.footer,.back-toc,.back,.page-atmosphere';
 function limit(p){const back=p.querySelector('.back-toc,.back');const f=back&&visible(back)?back:p.querySelector('.footer');return f.getBoundingClientRect().top-9}
 function bottom(p){return Math.max(...[...p.querySelectorAll('*')].filter(el=>visible(el)&&!el.closest(furniture)).map(el=>el.getBoundingClientRect().bottom))}
 const over=p=>bottom(p)>limit(p)+1;
 function columns(grid,n){if(!styles.has(grid))styles.set(grid,grid.getAttribute('style'));grid.style.gridTemplateColumns=`repeat(${n},minmax(0,1fr))`}
 function continuation(source,container){
   const p=source.cloneNode(false);p.removeAttribute('id');p.classList.remove('fit-tight','fit-tighter','fit-ultra');
   const base=source.dataset.layoutSource||source.id;
   p.dataset.layoutSource=base;p.id=base+'-suite-maquette-'+(continuations.filter(x=>x.dataset.layoutSource===base).length+1);
   const allowed='.topbar,.kicker,.h1,.h2,.day-head,.deck,.grid-title,.grid-deck,.rule';
   for(const c of source.children){if(c===container)break;if(c.matches(allowed)){const copy=c.cloneNode(true);copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id'));p.append(copy)}}
   let copy;
   if(container.matches('table')){copy=container.cloneNode(false);for(const ch of container.children)if(ch.matches('thead,colgroup'))copy.append(ch.cloneNode(true));copy.append(document.createElement('tbody'))}
   else copy=container.cloneNode(false);
   copy.removeAttribute('id');p.append(copy);
   const kicker=p.querySelector('.kicker');if(kicker&&!/suite/i.test(kicker.textContent)){const label=document.createElement('span');label.textContent=' · suite';kicker.append(label)}
   for(const c of source.children)if(c.matches('.footer,.back-toc,.back')){const f=c.cloneNode(true);f.removeAttribute('id');p.append(f)}
   source.after(p);continuations.push(p);return {page:p,container:copy};
 }
 function split(source){
   if(!visible(source)||!over(source))return;
   let page=source,container=source.querySelector(':scope>'+gridSelector.split(',').join(',:scope>')+',:scope>table.schedule,:scope>table.daytable,:scope>table.radar-table');
   if(!container)return;
   for(let pass=0;pass<30&&over(page);pass++){
     const table=container.matches('table'),parent=table?container.querySelector('tbody'):container;
     const items=[...parent.children].filter(visible);if(!items.length)break;
     let count=table?1:getComputedStyle(container).gridTemplateColumns.split(' ').length;
     // A too-tall column gains width before moving to a continuation sheet.
     if(!table&&items.length<=count&&count>1){count--;columns(container,count)}
     if(items.length===1)break;
     const paired=table&&!page.dataset.layoutSource?document.getElementById(page.id+'-2'):null;
     const next=paired&&visible(paired)?{page:paired,container:paired.querySelector('table'),existing:true}:continuation(page,container);
     const destination=table?next.container.querySelector('tbody'):next.container;
     // Trailing editorial notes belong after the final group, never under a footer.
     for(const n of [...page.children])if(!next.existing&&n!==container&&!n.matches(furniture)&&n.compareDocumentPosition(container)&Node.DOCUMENT_POSITION_PRECEDING){rememberMove(n,next.page,next.page.querySelector('.footer'))}
     do{
       const live=[...parent.children].filter(visible);if(live.length<=1)break;
       rememberMove(live.at(-1),destination,destination.firstChild);
     }while(over(page));
     if(!table&&destination.children.length===1&&destination.firstElementChild.matches('article'))destination.classList.add('layout-solo');
     page=next.page;container=next.container;
   }
 }
 function renumber(){
   const pages=[...document.querySelectorAll('.book>.page')].filter(visible);
   const set=(el,value)=>{if(!el)return;if(!labels.has(el))labels.set(el,el.textContent);el.textContent=value};
   pages.forEach((p,i)=>set(p.querySelector('.footer>span:last-child'),String(i+1)));
   for(const first of originalPages.filter(p=>/-grille$/.test(p.id))){
     const group=pages.filter(p=>p.id===first.id||p.id.startsWith(first.id+'-'));
     group.forEach((p,i)=>{const title=p.querySelector('.grid-title');if(title&&/\d+\/\d+\s*$/.test(title.textContent))set(title,title.textContent.replace(/\d+\/\d+\s*$/,`${i+1}/${group.length}`))});
   }
   for(const a of document.querySelectorAll('.toc-link,.tocbox a')){
     const target=document.getElementById(a.hash.slice(1)),index=pages.indexOf(target);
     if(index<0)continue;
     // Never touch the title/date span: only the dedicated folio marker may be renumbered.
     const folio=a.querySelector('.toc-page');
     if(folio)set(folio,folio.textContent.replace(/\d+/,String(index+1)));
   }
 }
 function layout(){
   if(running)return;running=true;restore();
   const fixed=matchMedia('print').matches||(!matchMedia('(max-width:1160px)').matches&&!document.body.classList.contains('compact-mode'));
   if(fixed){for(const p of originalPages)split(p);renumber()}
   document.body.dataset.layoutOverflow=originalPages.concat(continuations).filter(p=>visible(p)&&fixed&&over(p)).map(p=>p.id).join(' ');
   running=false;observe();
 }
 function schedule(){if(running)return;clearTimeout(timer);timer=setTimeout(layout,60)}
 window.SelectionTVLayout={restore,schedule,layout};
 window.addEventListener('resize',schedule);window.addEventListener('beforeprint',layout);window.addEventListener('afterprint',schedule);
 // Images in magazine layouts have explicit CSS geometry. Re-running the
 // whole 40-page pagination on every lazy image load/error causes scroll
 // anchoring to fight the user near the end of long issues.
 document.fonts?.ready.then(schedule);schedule();
})();
