(()=>{
const week=document.body.dataset.week;
const query=new URLSearchParams(location.search);
const androidTv=query.get('tv')==='1';
const localDraftPreview=query.get('preview')==='1'&&/^(?:localhost|127\.0\.0\.1)$/.test(location.hostname);
if(!week){document.body.innerHTML='<p style="padding:2rem">Numéro introuvable.</p>';return}
const root='../../';
const jsonUrl=root+'data/weeks/'+week+'.json';
const addCss=href=>new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.onload=resolve;l.onerror=reject;document.head.append(l)});
const addScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.append(s)});
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Method copy describes the process; the current JSON supplies publication
// state. A frozen draft paragraph must not contradict a published issue.
const hydrateMethodStatus=issue=>{
 for(const note of document.querySelectorAll('#methode .note')){
   const heading=note.querySelector('b');
   const label=heading?.textContent.replace(/\s+/g,' ').trim();let text='';
   if(label==='Inventaire')text='Les sept journées sont relevées largement, nuit comprise, avant la sélection finale. Les recoupements, rappels et contradictions sont examinés lors de la revue éditoriale.';
   if(label==='Publication protégée'){
     const state=issue.publication_status==='published'?'Ce numéro est publié. ':issue.publication_status==='draft'?'Ce numéro est en préparation. ':'';
     text=state+'La publication requiert une revue éditoriale et des contrôles de données, d’images, de liens et de rendu.';
   }
   if(text)note.replaceChildren(heading,document.createTextNode(' '+text));
 }
};
fetch(jsonUrl,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(async d=>{
 window.SELECTION_TV_WEEK_DATA=d;
 if(d.publication_status==='draft'&&!localDraftPreview){
   document.title=d.title||('Sélection TV — '+week+' · en cours');
   document.body.innerHTML='<div style="min-height:100vh;background:#171c23;color:#f8f4ec;display:grid;place-items:center;padding:2rem;font-family:Inter,Arial,sans-serif"><main style="max-width:680px;background:#f8f4ec;color:#172238;padding:2rem 2.25rem;border-top:5px solid #b53d4b"><div style="font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#b53d4b">'+esc(d.short||week)+'</div><h1 style="font-family:Georgia,serif;margin:.45rem 0 1rem">Numéro en cours de correction</h1><p style="line-height:1.55">Cette édition a été retirée du flux public après un contrôle qualité. Le dernier numéro validé reste accessible depuis l’accueil.</p><p><a href="../../" style="color:#172238;font-weight:800">← Retour à l’accueil</a></p></main></div>';
   return;
 }
 if(!androidTv){
   try{
     const lr=await fetch(root+'data/links.json?v=54808c60d56458e2',{cache:'no-store'});
     const ld=lr.ok?await lr.json():{links:{}};
     const nk=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
     window.SELECTION_TV_VERIFIED_LINKS=Object.fromEntries(Object.entries(ld.links||{}).map(([k,v])=>[nk(k),v]));
   }catch(e){window.SELECTION_TV_VERIFIED_LINKS={}}
 }
 document.title=d.title||('Sélection TV — '+week);
 if(d.bodyClass)document.body.className=d.bodyClass;
 await addCss(root+'assets/css/'+(d.theme==='magazine'?'magazine.css?v=54808c60d56458e2':'archive.css?v=54808c60d56458e2'));
 const rich=d.theme==='magazine';
 const toolbar=androidTv?'':(rich
 ? '<div class="toolbar"><b>SÉLECTION TV · '+esc(d.short||week)+'</b><span>Films · documentaires · replay · plateformes · radar 1080p</span><a class="navlink" href="../../">Accueil</a><a class="navlink" href="../../recherche.html">Recherche</a><a class="navlink" href="../../catalogue.html">Catalogue</a><a class="navlink" href="../../calendrier.html">Calendrier</a><a class="navlink" href="../../a-recuperer.html">À récupérer <span class="saved-count" id="savedCount">0</span></a><div class="issue-search"><input id="issueSearch" type="search" placeholder="Rechercher un film, réalisateur…"><div class="search-results" id="searchResults"></div></div><button class="seen-toggle" id="seenToggle" type="button">Afficher les vus</button><button class="compact-toggle" id="compactToggle" type="button">Mode compact</button><button onclick="window.print()">Imprimer / enregistrer en PDF</button></div>'
 : '<div class="toolbar"><b>SÉLECTION TV · '+esc(d.short||week)+'</b><span>'+esc(d.range||'')+'</span><span class="spacer"></span><a href="../../">Accueil</a><a href="../../recherche.html">Recherche</a><a href="../../catalogue.html">Catalogue</a><a href="../../calendrier.html">Calendrier</a><a href="../../a-recuperer.html">À récupérer</a><a href="#sommaire">Sommaire</a></div>');
 const tvSafeHtml=html=>androidTv
   ? String(html||'').replace(/\bsrc=(["'])([^"']+)\1/gi,(m,q,url)=>'data-tv-src='+q+url+q)
   : String(html||'');
 const book='<div class="book"'+(androidTv?' style="display:none!important"':'')+'>'+(d.pages||[]).map(p=>'<section class="'+esc(p.className||'page')+'" id="'+esc(p.id)+'">'+tvSafeHtml(p.html)+'</section>').join('')+'</div>';
 // Make the existing image fallback available before inserting remote images.
 window.imgFail=img=>img.closest('.visual')?.classList.add('broken');
 document.body.innerHTML=toolbar+book;
 hydrateMethodStatus(d);
 await addScript(root+'assets/js/rating-format.js?v=54808c60d56458e2');
 if(androidTv){
   // TV gets its metadata directly from works.json/links.json. Skip the browser
   // magazine enhancers, image hydrator, analytics and layout engine: on Fire TV
   // those scripts only mutated a hidden DOM and decoded images we never display.
   await addScript(root+'assets/js/android-tv-mode.js?v=54808c60d56458e2');
   return;
 }
 await addScript(root+'assets/js/analytics.js?v=54808c60d56458e2');
 await addScript(root+'assets/js/jellyfin-bridge.js?v=54808c60d56458e2');
 await addScript(root+'assets/js/'+(d.theme==='magazine'?'magazine-week.js?v=54808c60d56458e2':'archive-week.js?v=54808c60d56458e2'));
 await addScript(root+'assets/js/image-resolver.js?v=54808c60d56458e2');
 if(window.SelectionTVImagesReady)await window.SelectionTVImagesReady;
 if(d.theme==='magazine'){
   const hydrateCandidates=()=>{
     // Reserve candidates can become visible instantly after a "Vu" action.
     // Treat the permanent works catalogue as their canonical metadata source,
     // not only as an image lookup. This also repairs older S41 pool entries
     // whose weekly snapshot contained only "Diffusion vérifiée S41".
     for(const pool of Object.values(d.personalization?.pools||{})){
       for(const c of pool.candidates||[]){
         const w=window.SelectionTVImageFor?.(c.title);
         if(!w)continue;
         if(w.image)c.image=w.image;
         if(w.image_fallbacks?.length)c.image_fallbacks=[...w.image_fallbacks];
         if(w.ratings)c.ratings={...w.ratings};
         if(Array.isArray(w.aliases))c.aliases=[...w.aliases];
         const bits=[w.year,w.director||w.creator,w.country,w.duration,w.genre].filter(Boolean);
         if(bits.length>=2)c.meta=bits.join(' · ');
         c.canonical_metadata={
           director:w.director||w.creator||'',
           year:w.year||'',
           country:w.country||'',
           duration:w.duration||'',
           genre:w.genre||'',
           ratings_unavailable_reason:w.ratings_unavailable_reason||'',
           ratings_checked:w.ratings_checked||''
         };
       }
     }
   };
   hydrateCandidates();
   try{
     const rr=await fetch(root+'data/radar-reserves/'+week+'.json',{cache:'no-store'});
     if(rr.ok){
       const rd=await rr.json();
       d.personalization=d.personalization||{schema_version:1,mode:'ranked-reserve',hide_seen_default:true,pools:{}};
       d.personalization.pools=d.personalization.pools||{};
       if(rd.popular_deep)d.personalization.pools['radar-torrent']={page_id:'radar-torrent',container_selector:'.torrent-grid',primary_selector:'article.torrent-card:not(.replacement-generated)',card_type:'torrent-card',target:5,candidates:rd.popular_deep.candidates||[]};
       if(rd.hd1)d.personalization.pools['radar-1']={page_id:'radar-1',container_selector:'.radar-grid',primary_selector:'article.radar-card:not(.replacement-generated)',card_type:'radar-card',target:5,candidates:rd.hd1.candidates||[]};
       if(rd.hd2)d.personalization.pools['radar-2']={page_id:'radar-2',container_selector:'.radar-grid',primary_selector:'article.radar-card:not(.replacement-generated)',card_type:'radar-card',target:5,candidates:rd.hd2.candidates||[]};
       hydrateCandidates();
     }
   }catch(e){}
   await addScript(root+'assets/js/seen-filter.js?v=54808c60d56458e2');
 }
 await addScript(root+'assets/js/page-layout.js?v=54808c60d56458e2');
}).catch(err=>{document.body.innerHTML='<div style="padding:3rem;font-family:Arial;color:white;background:#171c23;min-height:100vh"><h1>Impossible de charger ce numéro</h1><p>'+esc(err.message)+'</p><p><a style="color:white" href="../../">Retour à l’accueil</a></p></div>'});
})();
