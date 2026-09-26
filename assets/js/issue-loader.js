(()=>{
const week=document.body.dataset.week;
const androidTv=new URLSearchParams(location.search).get('tv')==='1';
if(!week){document.body.innerHTML='<p style="padding:2rem">Numéro introuvable.</p>';return}
const root='../../';
const jsonUrl=root+'data/weeks/'+week+'.json';
const addCss=href=>new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.onload=resolve;l.onerror=reject;document.head.append(l)});
const addScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.append(s)});
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch(jsonUrl,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(async d=>{
 window.SELECTION_TV_WEEK_DATA=d;
 if(!androidTv){
   try{
     const lr=await fetch(root+'data/links.json?v=20260924-exactlinks4',{cache:'no-store'});
     const ld=lr.ok?await lr.json():{links:{}};
     const nk=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
     window.SELECTION_TV_VERIFIED_LINKS=Object.fromEntries(Object.entries(ld.links||{}).map(([k,v])=>[nk(k),v]));
   }catch(e){window.SELECTION_TV_VERIFIED_LINKS={}}
 }
 document.title=d.title||('Sélection TV — '+week);
 if(d.bodyClass)document.body.className=d.bodyClass;
 await addCss(root+'assets/css/'+(d.theme==='magazine'?'magazine.css?v=20260924-imagecanon3':'archive.css?v=20260924-imagecanon3'));
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
 if(androidTv){
   // TV gets its metadata directly from works.json/links.json. Skip the browser
   // magazine enhancers, image hydrator, analytics and layout engine: on Fire TV
   // those scripts only mutated a hidden DOM and decoded images we never display.
   await addScript(root+'assets/js/android-tv-mode.js?v=20260926-tv18');
   return;
 }
 await addScript(root+'assets/js/analytics.js?v=20260925-analytics1');
 await addScript(root+'assets/js/jellyfin-bridge.js?v=20260926-jellyfin16');
 await addScript(root+'assets/js/'+(d.theme==='magazine'?'magazine-week.js?v=20260924-exactlinks4':'archive-week.js?v=20260924-exactlinks4'));
 await addScript(root+'assets/js/image-resolver.js?v=20260924-exactlinks4');
 if(window.SelectionTVImagesReady)await window.SelectionTVImagesReady;
 if(d.theme==='magazine'){
   const hydrateCandidates=()=>{
     for(const pool of Object.values(d.personalization?.pools||{})){
       for(const c of pool.candidates||[]){
         const w=window.SelectionTVImageFor?.(c.title);
         if(w?.image&&!c.image)c.image=w.image;
         if(w?.image_fallbacks?.length&&!c.image_fallbacks)c.image_fallbacks=[...w.image_fallbacks];
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
   await addScript(root+'assets/js/seen-filter.js?v=20260924-exactlinks4');
 }
 await addScript(root+'assets/js/page-layout.js?v=20260926-jellyfin-scroll3');
}).catch(err=>{document.body.innerHTML='<div style="padding:3rem;font-family:Arial;color:white;background:#171c23;min-height:100vh"><h1>Impossible de charger ce numéro</h1><p>'+esc(err.message)+'</p><p><a style="color:white" href="../../">Retour à l’accueil</a></p></div>'});
})();