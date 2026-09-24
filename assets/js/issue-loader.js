(()=>{
const week=document.body.dataset.week;
if(!week){document.body.innerHTML='<p style="padding:2rem">Numéro introuvable.</p>';return}
const root='../../';
const jsonUrl=root+'data/weeks/'+week+'.json';
const addCss=href=>new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.onload=resolve;l.onerror=reject;document.head.append(l)});
const addScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.append(s)});
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch(jsonUrl,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(async d=>{
 window.SELECTION_TV_WEEK_DATA=d;
 document.title=d.title||('Sélection TV — '+week);
 if(d.bodyClass)document.body.className=d.bodyClass;
 await addCss(root+'assets/css/'+(d.theme==='magazine'?'magazine.css?v=20260924-gridlayout1':'archive.css?v=20260924-gridlayout1'));
 const rich=d.theme==='magazine';
 const toolbar=rich
 ? '<div class="toolbar"><b>SÉLECTION TV · '+esc(d.short||week)+'</b><span>Films · documentaires · replay · plateformes · radar 1080p</span><a class="navlink" href="../../">Accueil</a><a class="navlink" href="../../recherche.html">Recherche</a><a class="navlink" href="../../catalogue.html">Catalogue</a><a class="navlink" href="../../calendrier.html">Calendrier</a><a class="navlink" href="../../a-recuperer.html">À récupérer <span class="saved-count" id="savedCount">0</span></a><div class="issue-search"><input id="issueSearch" type="search" placeholder="Rechercher un film, réalisateur…"><div class="search-results" id="searchResults"></div></div><button class="seen-toggle" id="seenToggle" type="button">Afficher les vus</button><button class="compact-toggle" id="compactToggle" type="button">Mode compact</button><button onclick="window.print()">Imprimer / enregistrer en PDF</button></div>'
 : '<div class="toolbar"><b>SÉLECTION TV · '+esc(d.short||week)+'</b><span>'+esc(d.range||'')+'</span><span class="spacer"></span><a href="../../">Accueil</a><a href="../../recherche.html">Recherche</a><a href="../../catalogue.html">Catalogue</a><a href="../../calendrier.html">Calendrier</a><a href="../../a-recuperer.html">À récupérer</a><a href="#sommaire">Sommaire</a></div>';
 const book='<div class="book">'+(d.pages||[]).map(p=>'<section class="'+esc(p.className||'page')+'" id="'+esc(p.id)+'">'+p.html+'</section>').join('')+'</div>';
 document.body.innerHTML=toolbar+book;
 await addScript(root+'assets/js/'+(d.theme==='magazine'?'magazine-week.js?v=20260924-gridlayout1':'archive-week.js?v=20260924-gridlayout1')); if(d.theme==='magazine') await addScript(root+'assets/js/seen-filter.js?v=20260924-gridlayout1');
}).catch(err=>{document.body.innerHTML='<div style="padding:3rem;font-family:Arial;color:white;background:#171c23;min-height:100vh"><h1>Impossible de charger ce numéro</h1><p>'+esc(err.message)+'</p><p><a style="color:white" href="../../">Retour à l’accueil</a></p></div>'});
})();