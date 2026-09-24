/* ---- helper Vu : chargé avant tout le reste ---- */
window.SelectionTVSeen=window.SelectionTVSeen||(()=>{
 const STORE='selectionTV_saved_v1';
 const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return {}}};
 const save=o=>{try{localStorage.setItem(STORE,JSON.stringify(o))}catch(e){}};
 const attach=(box,title,metaFactory)=>{
   if(!box||!title)return;
   const key=norm(title);
   let b=box.querySelector('button.seen-btn');
   if(!b){b=document.createElement('button');b.type='button';b.className='seen-btn';box.append(b)}
   const refresh=()=>{const item=load()[key],on=item?.status==='vu';b.textContent=on?'✓ Vu':'Vu';b.classList.toggle('seen-on',on);b.title=on?'Marqué comme vu — cliquer pour annuler':'Marquer comme déjà vu'};
   b.onclick=()=>{
     const all=load(),cur=all[key];
     if(cur?.status==='vu'){
       if(cur.previous_status){all[key]={...cur,status:cur.previous_status};delete all[key].previous_status}
       else delete all[key];
     }else{
       const meta=typeof metaFactory==='function'?(metaFactory()||{}):{};
       all[key]={...(cur||{}),...meta,title,previous_status:cur?.status||null,status:'vu',added:cur?.added||new Date().toISOString(),url:cur?.url||location.href,page:cur?.page||document.title};
     }
     save(all);refresh();
     document.dispatchEvent(new CustomEvent('selectiontv:seenchange',{detail:{title}}));
   };
   refresh();
 };
 return {attach,load,norm};
})();


function imgFail(img){ const v=img.closest('.visual'); if(v) v.classList.add('broken'); }


/* ---- migrated block ---- */


(()=>{
const STORE='selectionTV_saved_v1';
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return {}}};
const save=o=>{localStorage.setItem(STORE,JSON.stringify(o));updateCount()};
const updateCount=()=>{const el=document.getElementById('savedCount');if(el)el.textContent=Object.values(load()).filter(x=>(x.status||'a-recuperer')==='a-recuperer').length};
const makeA=(label,url,cls='')=>{const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener';if(cls)a.className=cls;return a};
const metaFrom=(el)=>{
 const title=(el.querySelector('h3')?.textContent||el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent||'').trim();
 const context=[el.querySelector('.slot')?.textContent,el.querySelector('.where')?.textContent,el.querySelector('.service')?.textContent,el.querySelector('.chan')?.textContent].filter(Boolean).join(' · ');
 const badge=el.querySelector('.badge')?.textContent?.trim()||'';
 const page=document.title;
 return {title,context,badge,page,url:location.href,added:new Date().toISOString(),status:'a-recuperer'};
};
const addActions=(el)=>{
 if(el.dataset.actionsAdded==='1') return;
 const m=metaFrom(el); if(!m.title) return;
 el.dataset.actionsAdded='1';
 const key=norm(m.title);
 const box=document.createElement('div');box.className='program-actions';
 const L=window.SELECTION_TV_VERIFIED_LINKS?.[key]||{};
 const exact=[['official','Page officielle','official'],['allocine','AlloCiné',''],['imdb','IMDb',''],['sc','SensCritique',''],['wiki','Wikipedia',''],['film_documentaire','Film-documentaire','']];
 exact.forEach(([k,label,cls])=>{if(L[k])box.append(makeA(label,L[k],cls))});
 const b=document.createElement('button');b.type='button';b.className='save';
 const refresh=()=>{const item=load()[key];b.textContent=item&&(item.status||'a-recuperer')==='a-recuperer'?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',!!item&&(item.status||'a-recuperer')==='a-recuperer')};
 b.onclick=()=>{const all=load(); if(all[key]&&(all[key].status||'a-recuperer')==='a-recuperer') delete all[key]; else all[key]=m; save(all);refresh()};refresh();box.append(b);window.SelectionTVSeen.attach(box,m.title,()=>m);
 const h=el.querySelector('h3'); const primary=L.allocine||L.sc||L.imdb||L.wiki||L.official||L.film_documentaire; if(h&&primary&&!h.querySelector('a')){const a=document.createElement('a');a.className='program-title-link';a.href=primary;a.target='_blank';a.rel='noopener';a.textContent=h.textContent;h.textContent='';h.append(a)}
 const target=el.querySelector('.reason')||el.querySelector('.interest')||el;
 target.append(box);
};
document.querySelectorAll('article.week-card,article.feature,article.list-card,article.platform').forEach(addActions);
document.querySelectorAll('table.schedule tbody tr').forEach(addActions);
updateCount();
window.addEventListener('storage',updateCount);
})();


/* ---- migrated block ---- */


(()=>{
const META={"Le Parrain, épilogue : la mort de Michael Corleone":["Francis Ford Coppola","2020 (remontage du film de 1990)","États-Unis"],"Paris, Texas":["Wim Wenders","1984","RFA / France"],"Tár":["Todd Field","2022","États-Unis"],"Sympathy for Mr. Vengeance":["Park Chan-wook","2002","Corée du Sud"],"A Scene at the Sea":["Takeshi Kitano","1991","Japon"],"Le Jardin des Finzi-Contini":["Vittorio De Sica","1970","Italie / RFA"],"Liberté, la statue qui voulait changer le monde":["Julien Johan","2026","France"],"« Gomorra », manifeste antimafia":["Benoît Felici","2026","France"],"Le Gouffre aux chimères":["Billy Wilder","1951","États-Unis"],"Portier de nuit":["Liliana Cavani","1974","Italie / France"],"Lost in Translation":["Sofia Coppola","2003","États-Unis / Japon"],"Doux oiseau de jeunesse":["Richard Brooks","1962","États-Unis"],"Certains l’aiment chaud":["Billy Wilder","1959","États-Unis"],"Jean Monnet, l’aventurier de l’Europe":["Christian Huleu","2024","France"],"L’empire LVMH":["Jennifer Deschamps","2026","France"],"L’empire LVMH — épisode 1":["Jennifer Deschamps","2026","France"],"L’empire LVMH — épisode 2":["Jennifer Deschamps","2026","France"],"La Bête aveugle":["Yasuzô Masumura","1969","Japon"],"Donbass":["Sergueï Loznitsa","2018","Allemagne / Ukraine / France / Roumanie"],"Mon nom est Moore, Roger Moore":["Jack Cocker","2024","Royaume-Uni"],"L’Affaire Bojarski":["Jean-Paul Salomé","2026","France"],"Fragments d’un parcours amoureux":["Chloé Barreau","2023 (sortie France 2025)","Italie"],"Caprice":["Emmanuel Mouret","2015","France"],"La Venue de l’avenir":["Cédric Klapisch","2025","France"],"Le miroir se brisa":["Guy Hamilton","1980","Royaume-Uni / États-Unis"],"Là où chantent les écrevisses":["Olivia Newman","2022","États-Unis"],"Le prisonnier d’Alcatraz":["John Frankenheimer","1962","États-Unis"],"Le démon s’éveille la nuit":["Fritz Lang","1952","États-Unis"],"Million Dollar Baby":["Clint Eastwood","2004","États-Unis"],"L’expérience":["Oliver Hirschbiegel","2001","Allemagne"],"Les ailes du désir":["Wim Wenders","1987","RFA / France"],"L’Idiot":["Akira Kurosawa","1951","Japon"],"Cette femme-là":["Guillaume Nicloux","2003","France"],"Eddington":["Ari Aster","2025","États-Unis"],"L’homme des hautes plaines":["Clint Eastwood","1973","États-Unis"],"Fight Club":["David Fincher","1999","États-Unis / Allemagne"],"Woman and Child":["Saeed Roustaee","2025","Iran"],"Les vertiges de la liberté":["Clément Chauveau & Fabien Douillard","2025","France"],"Un été sur le bitume":["Simon Ostermann","2026","Allemagne"],"Napoléon III, le prix de l’audace":["Édouard Jacques","2026","France"],"Aucun signe de faiblesse":["Frédéric Geffroy & Rachid Khafague","2026","France / Arabie saoudite"],"My Way":["Thierry Teston & Lisa Azuelos","2024","France"],"L’amour qu’il nous reste":["Hlynur Pálmason","2025","Islande"],"Sophie Marceau, à voix haute":["Sophie Rosemont","2026","France"],"CIA, les guerres secrètes de l’après-11 Septembre":["Antoine Mariotti & Manuel Guillon","2026","France"],"À l’est d’Éden":["Laure de Clermont-Tonnerre & Garth Davis","2026","États-Unis"],"The Last First : le K2 en hiver":["Amir Bar-Lev","2026","États-Unis / Royaume-Uni"],"Apollo Has Fallen":["création : Howard Overman","2026","Royaume-Uni / France / États-Unis"],"Le Carnaval des animaux":["mise en scène : Gabriel Alloing","2026","France"],"Rendez-vous en terre inconnue":["émission créée par Frédéric Lopez","2026 (épisode)","France"]};
const clean=s=>(s||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const make=(title)=>{
 const d=META[title]; if(!d) return null;
 const el=document.createElement('div'); el.className='work-meta';
 const first=(d[0]||'').startsWith('création')||(d[0]||'').startsWith('mise en scène')||(d[0]||'').startsWith('émission')
   ? d[0].charAt(0).toUpperCase()+d[0].slice(1)
   : 'Réalisation : '+d[0];
 el.innerHTML='<b>'+first+'</b> · Sortie : '+d[1]+' · Pays : '+d[2];
 return el;
};
document.querySelectorAll('article.week-card,article.list-card,article.platform').forEach(card=>{
 const h3=card.querySelector('h3'); if(!h3||card.querySelector('.work-meta')) return;
 const el=make(clean(h3.textContent)); if(el) h3.insertAdjacentElement('afterend',el);
});
document.querySelectorAll('article.feature').forEach(card=>{
 const h3=card.querySelector('h3'); if(!h3) return;
 const title=clean(h3.textContent), d=META[title]; if(!d) return;
 const old=card.querySelector('.meta'); if(old) old.remove();
 const el=make(title); if(el){const slot=card.querySelector('.slot'); slot?slot.insertAdjacentElement('afterend',el):h3.insertAdjacentElement('afterend',el);}
});
document.querySelectorAll('table.schedule tbody tr').forEach(row=>{
 const cell=row.querySelector('.prog'); if(!cell||cell.querySelector('.work-meta')) return;
 const title=clean(cell.childNodes[0]?.textContent||cell.textContent), el=make(title); if(el) cell.append(el);
});
})();


/* ---- migrated block ---- */


(()=>{
const INFO={"Le Parrain, épilogue : la mort de Michael Corleone":{"duration":"2 h 38","genre":"Drame / crime"},"Paris, Texas":{"duration":"2 h 28","genre":"Drame"},"Tár":{"duration":"2 h 38","genre":"Drame"},"Sympathy for Mr. Vengeance":{"duration":"2 h","genre":"Thriller / drame"},"A Scene at the Sea":{"duration":"1 h 40","genre":"Comédie dramatique / romance"},"Le Jardin des Finzi-Contini":{"duration":"1 h 34","genre":"Drame historique"},"Liberté, la statue qui voulait changer le monde":{"duration":"1 h 29","genre":"Documentaire historique / culturel"},"« Gomorra », manifeste antimafia":{"duration":"52 min","genre":"Documentaire / société"},"Le Gouffre aux chimères":{"duration":"1 h 51","genre":"Drame"},"Portier de nuit":{"duration":"1 h 59","genre":"Drame"},"Lost in Translation":{"duration":"1 h 42","genre":"Comédie dramatique"},"Doux oiseau de jeunesse":{"duration":"2 h","genre":"Comédie dramatique"},"Certains l’aiment chaud":{"duration":"2 h 02","genre":"Comédie"},"Jean Monnet, l’aventurier de l’Europe":{"duration":"1 h 30","genre":"Documentaire biographique / histoire"},"L’empire LVMH":{"duration":"2 × env. 60 min","genre":"Documentaire économie / société"},"L’empire LVMH — épisode 1":{"duration":"env. 60 min","genre":"Documentaire économie / société"},"L’empire LVMH — épisode 2":{"duration":"env. 60 min","genre":"Documentaire économie / société"},"La Bête aveugle":{"duration":"1 h 24","genre":"Drame / épouvante-horreur"},"Donbass":{"duration":"2 h 01","genre":"Drame / guerre"},"Mon nom est Moore, Roger Moore":{"duration":"1 h 31","genre":"Documentaire biographique / cinéma"},"L’Affaire Bojarski":{"duration":"2 h 08","genre":"Drame"},"Fragments d’un parcours amoureux":{"duration":"1 h 35","genre":"Documentaire"},"Caprice":{"duration":"1 h 40","genre":"Comédie sentimentale"},"La Venue de l’avenir":{"duration":"2 h 06","genre":"Comédie dramatique"},"Le miroir se brisa":{"duration":"1 h 45","genre":"Policier / thriller"},"Là où chantent les écrevisses":{"duration":"2 h 05","genre":"Drame / thriller"},"Le prisonnier d’Alcatraz":{"duration":"2 h 27","genre":"Biopic / drame"},"Le démon s’éveille la nuit":{"duration":"1 h 45","genre":"Drame / film noir"},"Million Dollar Baby":{"duration":"2 h 12","genre":"Drame / sport"},"L’expérience":{"duration":"1 h 54","genre":"Thriller"},"Les ailes du désir":{"duration":"2 h 08","genre":"Drame / fantastique / romance"},"L’Idiot":{"duration":"2 h 46","genre":"Drame"},"Cette femme-là":{"duration":"1 h 40","genre":"Policier"},"Eddington":{"duration":"2 h 25","genre":"Comédie / thriller / western"},"L’homme des hautes plaines":{"duration":"1 h 45","genre":"Western"},"Fight Club":{"duration":"2 h 19","genre":"Drame / thriller"},"Woman and Child":{"duration":"2 h 11","genre":"Drame"},"Les vertiges de la liberté":{"duration":"1 h 13","genre":"Documentaire / société"},"Un été sur le bitume":{"duration":"1 h 32","genre":"Comédie dramatique"},"Napoléon III, le prix de l’audace":{"duration":"1 h 02 (épisode diffusé)","genre":"Documentaire historique"},"Aucun signe de faiblesse":{"duration":"1 h 29","genre":"Film documentaire"},"My Way":{"duration":"1 h 25","genre":"Documentaire musical"},"L’amour qu’il nous reste":{"duration":"1 h 50","genre":"Drame"},"Sophie Marceau, à voix haute":{"duration":"52 min","genre":"Documentaire cinéma"},"CIA, les guerres secrètes de l’après-11 Septembre":{"duration":"3 × 45 min","genre":"Série documentaire histoire / géopolitique"},"Le Carnaval des animaux":{"duration":"1 h 05","genre":"Spectacle musical"},"Rendez-vous en terre inconnue":{"duration":"1 h 45 (émission Tony Parker)","genre":"Documentaire / aventure"},"Horizons : Haïti, la rançon de l’indépendance":{"duration":"1 h 03","genre":"Documentaire historique"},"La soirée du court métrage":{"duration":"soirée spéciale","genre":"Courts métrages"},"À l’est d’Éden":{"duration":"7 × env. 60 min","genre":"Mini-série dramatique"},"Paul, la série":{"duration":"6 × 30 min","genre":"Comédie"},"The Last First : le K2 en hiver":{"duration":"1 h 38","genre":"Documentaire / alpinisme"},"Ted Lasso — S4 E9":{"duration":"42 min","genre":"Comédie / sport"},"Apollo Has Fallen":{"duration":"8 × 43–52 min","genre":"Série d’action"}};
const REPLAY={"CIA, les guerres secrètes de l’après-11 Septembre":"Chaîne : France 5 · Replay : france.tv","Liberté, la statue qui voulait changer le monde":"Chaîne : Arte · Replay : arte.tv","Sophie Marceau, à voix haute":"Chaîne : Arte · Replay : arte.tv","« Gomorra », manifeste antimafia":"Chaîne : Arte · Replay : arte.tv","Horizons : Haïti, la rançon de l’indépendance":"Chaîne : Guadeloupe La 1ère · Replay : france.tv","La soirée du court métrage":"Chaîne : Guadeloupe La 1ère · Replay : france.tv"};
const clean=s=>(s||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const channelFor=(el,title)=>{
 if(el.matches('tr')){const c=clean(el.querySelector('.chan')?.textContent);return c?'Chaîne : '+c:'';}
 if(el.classList.contains('feature')){const s=clean(el.querySelector('.slot')?.textContent);const p=s.split('·').slice(1).join('·').trim();return p?'Chaîne : '+p:'';}
 if(el.classList.contains('week-card')){const s=clean(el.querySelector('.where')?.textContent);const p=s.split('·').slice(1).join('·').trim();return p?'Chaîne : '+p:'';}
 if(el.classList.contains('list-card')) return REPLAY[title]||clean(el.querySelector('.where')?.textContent);
 if(el.classList.contains('platform')){const p=clean(el.querySelector('.service')?.textContent);return p?'Plateforme : '+p:'';}
 return '';
};
const titleOf=el=>{
 if(el.matches('tr')) return clean(el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent);
 return clean(el.querySelector('h3')?.textContent);
};
const apply=el=>{
 const title=titleOf(el), d=INFO[title]; if(!title) return;
 const meta=el.querySelector('.work-meta'); if(!meta) return;
 const bits=[];
 if(d?.duration) bits.push('Durée : '+d.duration);
 if(d?.genre) bits.push('Genre : '+d.genre);
 const channel=channelFor(el,title); if(channel) bits.push(channel);
 let extra=meta.querySelector('.meta-extra');
 if(!extra){extra=document.createElement('span');extra.className='meta-extra';meta.append(extra);}
 extra.textContent=(bits.length?' · '+bits.join(' · '):'');
};
document.querySelectorAll('article.week-card,article.list-card,article.platform,article.feature,table.schedule tbody tr').forEach(apply);
})();


/* ---- migrated block ---- */


(()=>{
const RATINGS=window.SelectionTVRatings={"Le Parrain, épilogue : la mort de Michael Corleone":{"imdb":"7,5","sc":"7,6"},"Lost in Translation":{"imdb":"7,7","sc":"7,2"},"Paris, Texas":{"imdb":"8,1","sc":"8,0"},"Tár":{"imdb":"7,4","sc":"6,7"},"Sympathy for Mr. Vengeance":{"imdb":"7,5","sc":"7,3"},"A Scene at the Sea":{"imdb":"7,5","sc":"7,5"},"Le Jardin des Finzi-Contini":{"imdb":"7,2","sc":"7,1"},"Le Gouffre aux chimères":{"imdb":"8,0","sc":"8,0"},"Portier de nuit":{"imdb":"6,6","sc":"6,4"},"Doux oiseau de jeunesse":{"imdb":"7,1","sc":"6,8"},"Certains l’aiment chaud":{"imdb":"8,2","sc":"7,9"},"Caprice":{"imdb":"6,0","sc":"5,8"},"La Venue de l’avenir":{"imdb":"7,2","sc":"6,6"},"Le miroir se brisa":{"imdb":"6,2","sc":"5,8"},"Là où chantent les écrevisses":{"imdb":"7,2","sc":"6,4"},"Le prisonnier d’Alcatraz":{"imdb":"7,8","sc":"7,6"},"Le démon s’éveille la nuit":{"imdb":"7,0","sc":"6,5"},"Million Dollar Baby":{"imdb":"8,1","sc":"7,6"},"L’expérience":{"imdb":"7,7","sc":"7,1"},"Les ailes du désir":{"imdb":"7,9","sc":"7,5"},"L’Idiot":{"imdb":"7,1","sc":"6,9"},"Cette femme-là":{"imdb":"6,1","sc":"6,2"},"Eddington":{"imdb":"6,6","sc":"6,2"},"L’homme des hautes plaines":{"imdb":"7,4","sc":"7,3"},"Donbass":{"imdb":"6,6","sc":"6,2"},"Fight Club":{"imdb":"8,8","sc":"8,1"},"Woman and Child":{"imdb":"5,9","sc":"6,8"},"L’Affaire Bojarski":{"imdb":"7,0","sc":"6,5"},"L’amour qu’il nous reste":{"imdb":"6,8","sc":"6,6"},"Fragments d’un parcours amoureux":{"imdb":"7,1","sc":"6,7"},"La Bête aveugle":{"imdb":"7,0","sc":"7,3"},"Jeux dangereux":{"imdb":"8,1","sc":"8,2"},"Before Sunrise":{"imdb":"8,1","sc":"7,3"},"Tigre et dragon":{"imdb":"7,8","sc":"6,9"},"Volver":{"imdb":"7,6","sc":"7,1"},"American History X":{"imdb":"8,5","sc":"7,7"},"La Fureur de vivre":{"imdb":"7,6","sc":"7,3"},"Le Cercle des poètes disparus":{"imdb":"8,1","sc":"7,5"},"Fisher King : Le Roi pêcheur":{"imdb":"7,5","sc":"7,2"},"Miami Vice - Deux flics à Miami":{"imdb":"6,1","sc":"5,9"},"Arsenic et vieille dentelle":{"imdb":"7,9"}};
const q=s=>encodeURIComponent((s||'').trim());
const clean=s=>(s||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const titleOf=el=>{
 if(el.matches('tr')) return clean(el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent);
 return clean(el.querySelector('h3')?.textContent);
};
const add=el=>{
 const title=titleOf(el), r=RATINGS[title]; if(!r||el.querySelector('.ratings')) return;
 const box=document.createElement('div'); box.className='ratings';
 const L=window.SELECTION_TV_VERIFIED_LINKS?.[norm(title)]||{}; if(r.imdb){const a=L.imdb?document.createElement('a'):document.createElement('span');a.className='rating-pill imdb';if(L.imdb){a.target='_blank';a.rel='noopener';a.href=L.imdb}a.textContent='IMDb '+r.imdb+'/10';box.append(a);}
 if(r.sc){const a=L.sc?document.createElement('a'):document.createElement('span');a.className='rating-pill sc';if(L.sc){a.target='_blank';a.rel='noopener';a.href=L.sc}a.textContent='SensCritique '+r.sc+'/10';box.append(a);}
 const d=document.createElement('span');d.className='rating-date';d.textContent='relevé 24/09/2026';box.append(d);
 const meta=el.querySelector('.work-meta');
 if(meta) meta.insertAdjacentElement('afterend',box);
 else if(el.matches('tr')) el.querySelector('.prog')?.append(box);
 else el.querySelector('h3')?.insertAdjacentElement('afterend',box);
};
document.querySelectorAll('article.week-card,article.list-card,article.platform,article.feature,table.schedule tbody tr').forEach(add);
})();


/* ---- migrated block ---- */


(()=>{
const DIRECT=window.SelectionTVDirectLinks={"Lost in Translation":{"imdb":"https://www.imdb.com/title/tt0335266/","sc":"https://www.senscritique.com/film/-/472876","wiki":"https://fr.wikipedia.org/wiki/Lost_in_Translation","allocine":"https://www.allocine.fr/film/fichefilm_gen_cfilm=47395.html"},"Paris, Texas":{"imdb":"https://www.imdb.com/title/tt0087884/","sc":"https://www.senscritique.com/film/paris_texas/414147","wiki":"https://fr.wikipedia.org/wiki/Paris,_Texas","allocine":"https://www.allocine.fr/film/fichefilm_gen_cfilm=263.html"},"Tár":{"imdb":"https://www.imdb.com/title/tt14444726/","sc":"https://www.senscritique.com/film/tar/45408140"},"Sympathy for Mr. Vengeance":{"imdb":"https://www.imdb.com/title/tt0310775/","sc":"https://www.senscritique.com/film/sympathy_for_mister_vengeance/433650"},"A Scene at the Sea":{"imdb":"https://www.imdb.com/title/tt0103704/","sc":"https://www.senscritique.com/film/a_scene_at_the_sea/423974"},"Le Jardin des Finzi-Contini":{"imdb":"https://www.imdb.com/title/tt0065777/","sc":"https://www.senscritique.com/film/le_jardin_des_finzi_contini/484792"},"Le Gouffre aux chimères":{"imdb":"https://www.imdb.com/title/tt0043338/","sc":"https://www.senscritique.com/film/le_gouffre_aux_chimeres/366885"},"Portier de nuit":{"imdb":"https://www.imdb.com/title/tt0071910/","sc":"https://www.senscritique.com/film/portier_de_nuit/438107"},"Doux oiseau de jeunesse":{"imdb":"https://www.imdb.com/title/tt0056541/","sc":"https://www.senscritique.com/film/doux_oiseau_de_jeunesse/418145"},"Certains l’aiment chaud":{"imdb":"https://www.imdb.com/title/tt0053291/","sc":"https://www.senscritique.com/film/certains_l_aiment_chaud/460624"},"Le démon s’éveille la nuit":{"imdb":"https://www.imdb.com/title/tt0044502/","sc":"https://www.senscritique.com/film/le_demon_s_eveille_la_nuit/489937"},"Million Dollar Baby":{"imdb":"https://www.imdb.com/title/tt0405159/","sc":"https://www.senscritique.com/film/Million_Dollar_Baby/403401"},"Les ailes du désir":{"imdb":"https://www.imdb.com/title/tt0093191/"},"L’Idiot":{"imdb":"https://www.imdb.com/title/tt0043614/"},"L’homme des hautes plaines":{"imdb":"https://www.imdb.com/title/tt0068699/"},"La Bête aveugle":{"imdb":"https://www.imdb.com/title/tt0140384/"},"Donbass":{"imdb":"https://www.imdb.com/title/tt8282042/"},"Fragments d’un parcours amoureux":{"imdb":"https://www.imdb.com/title/tt28635725/"},"Fight Club":{"imdb":"https://www.imdb.com/title/tt0137523/","sc":"https://www.senscritique.com/film/fight_club/363185"},"Before Sunrise":{"imdb":"https://www.imdb.com/title/tt0112471/","sc":"https://www.senscritique.com/film/before_sunrise/470061"},"Volver":{"imdb":"https://www.imdb.com/title/tt0441909/","sc":"https://www.senscritique.com/film/volver/431177"},"Tigre et dragon":{"imdb":"https://www.imdb.com/title/tt0190332/","sc":"https://www.senscritique.com/film/tigre_et_dragon/424149"},"American History X":{"imdb":"https://www.imdb.com/title/tt0120586/","sc":"https://www.senscritique.com/film/american_history_x/392288"},"La Fureur de vivre":{"imdb":"https://www.imdb.com/title/tt0048545/","sc":"https://www.senscritique.com/film/la_fureur_de_vivre/373062"},"Le Cercle des poètes disparus":{"imdb":"https://www.imdb.com/title/tt0097165/","sc":"https://www.senscritique.com/film/le_cercle_des_poetes_disparus/363161"},"Fisher King : Le Roi pêcheur":{"imdb":"https://www.imdb.com/title/tt0101889/"},"Miami Vice - Deux flics à Miami":{"imdb":"https://www.imdb.com/title/tt0430357/"},"Arsenic et vieille dentelle":{"imdb":"https://www.imdb.com/title/tt0036613/","sc":"https://www.senscritique.com/film/arsenic_et_vieilles_dentelles/496973"},"Jeux dangereux":{"imdb":"https://www.imdb.com/title/tt0035446/","sc":"https://www.senscritique.com/film/jeux_dangereux/465400"},"Caprice":{"imdb":"https://www.imdb.com/title/tt3612984/"},"Eddington":{"imdb":"https://www.imdb.com/title/tt31176520/"},"Là où chantent les écrevisses":{"imdb":"https://www.imdb.com/title/tt9411972/"},"« Gomorra », manifeste antimafia":{"official":"https://www.arte.tv/fr/videos/123976-000-A/gomorra-manifeste-antimafia/"}};
const clean=s=>(s||'').replace(/\s+/g,' ').trim();
const titleOf=el=>{
 if(el.matches('tr')) return clean(el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent);
 return clean(el.querySelector('h3')?.textContent);
};
const pref=d=>d&&(d.allocine||d.sc||d.imdb||d.wiki||d.official);
document.querySelectorAll('article.week-card,article.list-card,article.platform,article.feature,article.radar-card,table.schedule tbody tr').forEach(el=>{
 const title=titleOf(el), d=DIRECT[title]||{};
 const titleLink=el.querySelector('.program-title-link');
 if(titleLink){
   const u=pref(d);
   if(u){titleLink.href=u}else{const t=document.createTextNode(titleLink.textContent);titleLink.replaceWith(t)}
 }
 el.querySelectorAll('.program-actions a').forEach(a=>{
   const label=clean(a.textContent).toLowerCase();
   let u=null;
   const V=window.SELECTION_TV_VERIFIED_LINKS?.[norm(title)]||{}; if(label==='imdb') u=V.imdb||d.imdb;
   else if(label==='senscritique') u=V.sc||d.sc;
   else if(label==='wikipedia') u=V.wiki||d.wiki;
   else if(label==='allociné') u=V.allocine||d.allocine;
   else if(label==='fiche') u=V.allocine||V.sc||V.imdb||V.wiki||V.official||pref(d);
   else if(label.startsWith('voir sur')) u=d.official;
   if(u) a.href=u; else a.remove();
 });
 el.querySelectorAll('.ratings a').forEach(a=>{
   const label=clean(a.textContent).toLowerCase();
   const V=window.SELECTION_TV_VERIFIED_LINKS?.[norm(title)]||{}; const u=label.startsWith('imdb')?(V.imdb||d.imdb):label.startsWith('senscritique')?(V.sc||d.sc):null;
   if(u)a.href=u;else{const s=document.createElement('span');s.className=a.className;s.textContent=a.textContent;a.replaceWith(s)}
 });
});
document.querySelectorAll('.page:not(#couverture):not(#sommaire)').forEach(p=>{
 if(!p.querySelector('.back-toc')){
   const a=document.createElement('a');a.className='back-toc';a.href='#sommaire';a.textContent='↑ Sommaire';p.append(a);
 }
});
})();


/* ---- migrated block ---- */


(()=>{
const STORE='selectionTV_saved_v1';
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return {}}};
const save=o=>{localStorage.setItem(STORE,JSON.stringify(o));const c=document.getElementById('savedCount');if(c)c.textContent=Object.values(o).filter(x=>(x.status||'a-recuperer')==='a-recuperer').length};
document.querySelectorAll('article.radar-card,article.torrent-card').forEach(card=>{
 if(card.dataset.saveAdded==='1') return;
 card.dataset.saveAdded='1';
 const title=(card.querySelector('h3')?.textContent||'').trim();
 if(!title) return;
 const key=norm(title);
 const isTorrent=card.classList.contains('torrent-card');
 const signal=(isTorrent?card.querySelector('.torrent-signal'):card.querySelector('.added'))?.textContent?.trim()||(isTorrent?'Radar popularité torrent':'Radar 1080p');
 let box=card.querySelector('.program-actions');
 if(!box){box=document.createElement('div');box.className='program-actions';card.append(box);}
 let b=box.querySelector('button.save');
 if(!b){b=document.createElement('button');b.type='button';b.className='save';box.append(b);}
 const refresh=()=>{const item=load()[key];const active=!!item&&(item.status||'a-recuperer')==='a-recuperer';b.textContent=active?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',active)};
 b.onclick=()=>{
   const all=load();
   if(all[key]&&(all[key].status||'a-recuperer')==='a-recuperer') delete all[key];
   else all[key]={title,context:(isTorrent?'Radar popularité torrent':'Radar 1080p')+' · '+signal,badge:isTorrent?'RADAR TORRENT':'RADAR 1080P',page:document.title,url:location.href,added:new Date().toISOString(),status:'a-recuperer'};
   save(all);refresh();
 };
 refresh();
 window.SelectionTVSeen.attach(box,title,()=>({title,context:(isTorrent?'Radar popularité torrent':'Radar 1080p')+' · '+signal,badge:isTorrent?'RADAR TORRENT':'RADAR 1080P'}));
});
})();


/* ---- migrated block ---- */


(()=>{
const DATA={
"CIA, les guerres secrètes de l’après-11 Septembre":{
 img:"https://commons.wikimedia.org/wiki/Special:FilePath/Seal_of_the_Central_Intelligence_Agency.jpg",
 links:[["France Télévisions","https://www.francetvpro.fr/contenu-de-presse/77744639"]]
},
"Liberté, la statue qui voulait changer le monde":{
 img:"https://cdn.mediatheque.epmoo.fr/link/3c9igq/kns1cy980bb59i8.jpg",
 links:[["Voir sur ARTE","https://www.youtube.com/watch?v=yQ3JqnPsrh4"],["Musée d’Orsay","https://www.musee-orsay.fr/fr/programme/agenda/evenements/documentaire-liberte-la-statue-qui-voulait-changer-le-monde"]]
},
"Sophie Marceau, à voix haute":{
 img:"https://media.senscritique.com/media/000024062662/0/sophie_marceau_a_voix_haute.jpg",
 links:[["Voir sur ARTE","https://www.arte.tv/fr/videos/128041-000-A/sophie-marceau-a-voix-haute/"],["SensCritique","https://www.senscritique.com/film/sophie_marceau_a_voix_haute/139350990"]],
 ratingText:["IMDb 5,5/10"]
},
"« Gomorra », manifeste antimafia":{
 img:"https://i1.wp.com/erwanbizeul.com/wp-content/uploads/2026/02/6000-1.png?fit=1024%2C614&ssl=1",
 links:[["Voir sur ARTE","https://www.arte.tv/fr/videos/123976-000-A/gomorra-manifeste-antimafia/"]]
},
"Horizons : Haïti, la rançon de l’indépendance":{
 img:"https://commons.wikimedia.org/wiki/Special:FilePath/Citadelle_Laferri%C3%A8re.jpg",
 links:[["France Télévisions","https://www.francetvpro.fr/contenu-de-presse/78546963"]]
},
"La soirée du court métrage":{
 img:"https://commons.wikimedia.org/wiki/Special:FilePath/Clapperboard.svg",
 links:[["France Télévisions","https://www.francetvpro.fr/contenu-de-presse/78473078"]]
},
"Cinéma + documentaires de la semaine":{
 img:"https://cdn.mediatheque.epmoo.fr/link/3c9igq/kns1cy980bb59i8.jpg",
 links:[["Liberté sur ARTE","https://www.youtube.com/watch?v=yQ3JqnPsrh4"],["Gomorra sur ARTE","https://www.arte.tv/fr/videos/123976-000-A/gomorra-manifeste-antimafia/"]]
},
"À l’est d’Éden":{
 img:"https://img.youtube.com/vi/fdBr5KyUilU/maxresdefault.jpg",
 links:[["Voir sur Netflix","https://www.netflix.com/title/81611854"],["SensCritique","https://www.senscritique.com/serie/east_of_eden/100082580"]]
},
"Paul, la série":{
 img:"https://img.youtube.com/vi/5TThfFaagNY/maxresdefault.jpg",
 links:[["AlloCiné","https://www.allocine.fr/series/ficheserie_gen_cserie=1000001829.html"],["Bande-annonce Prime Video","https://www.youtube.com/watch?v=5TThfFaagNY"]]
},
"The Last First : le K2 en hiver":{
 img:"https://www.apple.com/tv-pr/shows-and-films/t/the-last-first-winter-k2/images/show-home-graphic-header/key-art-01/16x9/Apple_TV_The_Last_First_Winter_K2_key_art_graphic_header_16_9_show_home.jpg.large_2x.jpg",
 links:[["Voir sur Apple TV","https://tv.apple.com/us/movie/the-last-first-winter-k2/umc.cmc.3qvemsb6f04actuyzdporeelt"],["IMDb","https://www.imdb.com/title/tt39150288/"]],
 ratings:[["IMDb","8,2","https://www.imdb.com/title/tt39150288/ratings/"]]
},
"Ted Lasso — S4 E9":{
 img:"https://www.apple.com/tv-pr/shows-and-films/t/ted-lasso/images/season-04/show-home-graphic-header/key-art-02/4x1/Apple_TV_Ted_Lasso_key_art_graphic_header_4_1_show_home.jpg.large_2x.jpg",
 links:[["Voir sur Apple TV","https://tv.apple.com/fr/show/ted-lasso/umc.cmc.vtoh0mn0xn7t3c643xqonfzy?l=fr"],["IMDb","https://www.imdb.com/title/tt10986410/"],["SensCritique","https://www.senscritique.com/serie/ted_lasso/40564961"]],
 ratings:[["IMDb","8,7","https://www.imdb.com/title/tt10986410/ratings/"],["SensCritique","7,6","https://www.senscritique.com/serie/ted_lasso/40564961"]]
},
"Apollo Has Fallen":{
 img:"https://image.tmdb.org/t/p/w500/kSwGrjbLVNzDtEnjITa08jwEIxR.jpg",
 links:[["Voir sur CANAL+","https://www.canalplus.com/series/has-fallen/h/26153428_50001"],["IMDb","https://www.imdb.com/fr/title/tt36350690/"],["AlloCiné","https://www.allocine.fr/series/ficheserie_gen_cserie=1000000714.html"]]
}
};
const clean=s=>(s||"").replace(/\s+/g," ").trim();
const titleOf=el=>clean(el.querySelector("h3")?.textContent);
const addDirectLinks=(el,d)=>{
 let box=el.querySelector(".program-actions");
 if(!box){box=document.createElement("div");box.className="program-actions";el.append(box)}
 // Remove leftover search-result buttons, keep save button.
 box.querySelectorAll("a").forEach(a=>a.remove());
 (d.links||[]).forEach(([label,url])=>{
   const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener";a.textContent=label;
   if(/^Voir sur/.test(label))a.className="official";
   box.insertBefore(a,box.querySelector("button.save"));
 });
};
const addRatings=(el,d)=>{
 let box=el.querySelector(".ratings");
 if(!box){box=document.createElement("div");box.className="ratings";
   const meta=el.querySelector(".work-meta"); if(meta)meta.insertAdjacentElement("afterend",box); else el.querySelector("h3")?.insertAdjacentElement("afterend",box);
 }else box.innerHTML="";
 (d.ratings||[]).forEach(([name,val,url])=>{
   const a=document.createElement("a");a.className="rating-pill "+(name==="IMDb"?"imdb":"sc");a.href=url;a.target="_blank";a.rel="noopener";a.textContent=name+" "+val+"/10";box.append(a);
 });
 (d.ratingText||[]).forEach(txt=>{const s=document.createElement("span");s.className="rating-pill imdb";s.textContent=txt;box.append(s)});
 if((d.ratings||[]).length||(d.ratingText||[]).length){const s=document.createElement("span");s.className="rating-date";s.textContent="relevé 24/09/2026";box.append(s)}
};
document.querySelectorAll(".replay-page article.list-card").forEach(el=>{
 const d=DATA[titleOf(el)];if(!d)return;
 if(!el.querySelector(".section-thumb")){const img=document.createElement("img");img.className="section-thumb";img.src=d.img;img.alt="Visuel de "+titleOf(el);img.loading="lazy";el.querySelector(".num")?.insertAdjacentElement("afterend",img)}
 addDirectLinks(el,d);addRatings(el,d);
});
document.querySelectorAll(".page:not(.subscription-page) article.platform").forEach(el=>{
 const d=DATA[titleOf(el)];if(!d)return;
 if(!el.classList.contains("has-visual")){
   const kids=[...el.children];const copy=document.createElement("div");copy.className="platform-copy";kids.forEach(k=>copy.append(k));
   const img=document.createElement("img");img.className="platform-thumb";img.src=d.img;img.alt="Visuel de "+titleOf({querySelector:()=>copy.querySelector("h3")});img.loading="lazy";
   el.append(img,copy);el.classList.add("has-visual");
 }
 addDirectLinks(el,d);addRatings(el,d);
});

// Conservative automatic fit pass for every fixed page.
const overlapsFooter=p=>{
 const footer=p.querySelector(".footer");if(!footer)return false;
 const fr=footer.getBoundingClientRect();
 let max=-Infinity;
 [...p.children].forEach(ch=>{
   if(ch===footer||ch.classList.contains("topbar")||ch.classList.contains("page-atmosphere")||ch.classList.contains("back-toc"))return;
   max=Math.max(max,ch.getBoundingClientRect().bottom);
 });
 return max>fr.top-4;
};
const fit=()=>{
 document.querySelectorAll(".page").forEach(p=>{
   p.classList.remove("fit-tight","fit-tighter","fit-ultra");
   if(overlapsFooter(p)) p.classList.add("fit-tight");
   if(overlapsFooter(p)) p.classList.add("fit-tighter");
   if(overlapsFooter(p)) p.classList.add("fit-ultra");
 });
};
const runFit=()=>requestAnimationFrame(()=>requestAnimationFrame(fit));
runFit();
window.addEventListener("load",()=>{setTimeout(fit,120);setTimeout(fit,600);setTimeout(fit,1600)});
document.fonts?.ready?.then(()=>setTimeout(fit,50));
document.querySelectorAll("img").forEach(img=>img.addEventListener("load",()=>setTimeout(fit,20),{once:true}));
})();


/* ---- migrated block ---- */


(()=>{
const STORE='selectionTV_saved_v1';
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return{}}};
const save=o=>localStorage.setItem(STORE,JSON.stringify(o));
document.querySelectorAll('[data-title] button.save').forEach(b=>{
 const el=b.closest('[data-title]'),title=el?.dataset.title;if(!title)return;const key=norm(title);
 const refresh=()=>{const a=load(),on=!!a[key]&&a[key].status!=='recupere'&&a[key].status!=='vu';b.textContent=on?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',on)};
 if(!b.dataset.bound){b.dataset.bound='1';b.onclick=()=>{const a=load();if(a[key]&&a[key].status==='a-recuperer')delete a[key];else a[key]={title,context:(el.closest('.physical')?'Blu-ray / UHD':el.closest('.streaming')?'Streaming':el.closest('.expiring')?'À voir avant disparition':'Sélection TV')+' · S40',badge:el.closest('.physical')?'BLU-RAY':el.closest('.streaming')?'STREAMING':el.closest('.expiring')?'EXPIRATION':'',page:document.title,url:location.href,added:new Date().toISOString(),status:'a-recuperer'};save(a);refresh()};}
 refresh();
 window.SelectionTVSeen.attach(b.closest('.program-actions')||el,title,()=>({title,context:(el.closest('.physical')?'Blu-ray / UHD':el.closest('.streaming')?'Streaming':el.closest('.expiring')?'À voir avant disparition':'Sélection TV')+' · S40',badge:el.closest('.physical')?'BLU-RAY':el.closest('.streaming')?'STREAMING':el.closest('.expiring')?'EXPIRATION':''}));
});
const input=document.getElementById('issueSearch'),results=document.getElementById('searchResults');
if(input&&results){
 const seen=new Set(),items=[];
 document.querySelectorAll('h3,.prog').forEach(el=>{
   const title=(el.childNodes[0]?.textContent||el.textContent||'').trim(); if(!title||seen.has(title))return;seen.add(title);
   const page=el.closest('.page');items.push({title,el,page,label:page?.querySelector('.topbar')?.childNodes[0]?.textContent?.trim()||''});
 });
 const render=()=>{
  const q=norm(input.value);results.innerHTML='';if(q.length<2){results.classList.remove('show');return}
  items.filter(x=>norm(x.title+' '+x.el.closest('article,tr')?.textContent).includes(q)).slice(0,12).forEach(x=>{
    const a=document.createElement('a');a.href='#'+(x.page?.id||'');a.innerHTML=x.title+'<small>'+x.label+'</small>';
    a.onclick=()=>{setTimeout(()=>{x.el.closest('article,tr')?.classList.add('search-hit');setTimeout(()=>x.el.closest('article,tr')?.classList.remove('search-hit'),2200)},120);results.classList.remove('show')};results.append(a)
  });results.classList.toggle('show',!!results.children.length)
 };
 input.addEventListener('input',render);document.addEventListener('click',e=>{if(!e.target.closest('.issue-search'))results.classList.remove('show')});
}
const compact=document.getElementById('compactToggle');if(compact)compact.onclick=()=>{document.body.classList.toggle('compact-mode');compact.textContent=document.body.classList.contains('compact-mode')?'Mode magazine':'Mode compact'};
})();


/* ---- data-driven exact links + metadata ---- */
(()=>{
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const titleOf=el=>{
 if(el.matches('tr')) return (el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent||'').trim();
 return (el.querySelector('h3')?.textContent||'').trim();
};
const labelFor=k=>({official:'Page officielle',allocine:'AlloCiné',imdb:'IMDb',sc:'SensCritique',wiki:'Wikipedia'}[k]||k);
Promise.all([
 fetch('../../data/links.json?v=20260924-platformpages2').then(r=>r.ok?r.json():{links:{}}),
 fetch('../../data/works.json?v=20260924-platformpages2').then(r=>r.ok?r.json():{works:[]})
]).then(([ld,wd])=>{
 const links=new Map(Object.entries(ld.links||{}).map(([k,v])=>[norm(k),v]));
 const works=new Map((wd.works||[]).map(x=>[norm(x.title),x]));
 document.querySelectorAll('article.week-card,article.list-card,article.platform,article.feature,article.radar-card,article.torrent-card,article.release-card,article.expire-card,table.schedule tbody tr').forEach(el=>{
   const title=titleOf(el); if(!title)return; const key=norm(title), L=links.get(key)||{}, W=works.get(key);
   let box=el.querySelector('.program-actions');
   if(!box){box=document.createElement('div');box.className='program-actions';const target=el.querySelector('.reason')||el.querySelector('.interest')||el;target.append(box)}
   const existing=new Set([...box.querySelectorAll('a')].map(a=>a.href));
   const order=['official','allocine','imdb','sc','wiki'];
   order.forEach(k=>{
     const u=L[k];
     if(!u||existing.has(u))return;
     if(k==='sc'&&[...box.querySelectorAll('a')].some(a=>a.textContent.trim()==='SensCritique'))return;
     const a=document.createElement('a');a.href=u;a.target='_blank';a.rel='noopener';a.textContent=labelFor(k);if(k==='official')a.className='official';
     const save=box.querySelector('button.save');save?box.insertBefore(a,save):box.append(a);existing.add(u);
   });
   if(W && !el.querySelector('.work-meta')){
     const bits=[W.director,W.year,W.country,W.genre].filter(Boolean);
     if(bits.length){
       const meta=document.createElement('div');meta.className='work-meta';meta.textContent=bits.join(' · ');
       if(el.matches('tr')){
         el.querySelector('.prog')?.append(meta);
       }else{
         const anchor=el.querySelector('.ratings')||el.querySelector('.meta')||el.querySelector('.where')||el.querySelector('.slot')||el.querySelector('h3');
         if(anchor)anchor.insertAdjacentElement('afterend',meta);
       }
     }
   }
   if(W?.ratings){
     let ratings=el.querySelector('.ratings');
     if(!ratings){
       ratings=document.createElement('div');ratings.className='ratings';
       if(el.matches('tr')) el.querySelector('.prog')?.append(ratings);
       else {const wm=el.querySelector('.work-meta')||el.querySelector('.meta')||el.querySelector('h3');wm?.insertAdjacentElement('afterend',ratings)}
     }
     if(W.ratings.imdb && L.imdb && ![...ratings.children].some(x=>x.textContent.startsWith('IMDb'))){const a=document.createElement('a');a.className='rating-pill imdb';a.href=L.imdb;a.target='_blank';a.rel='noopener';a.textContent='IMDb '+W.ratings.imdb+'/10';ratings.append(a)}
     if(W.ratings.senscritique && ![...ratings.children].some(x=>x.textContent.startsWith('SensCritique'))){const a=L.sc?document.createElement('a'):document.createElement('span');a.className='rating-pill sc';if(L.sc){a.href=L.sc;a.target='_blank';a.rel='noopener'}a.textContent='SensCritique '+W.ratings.senscritique+'/10';ratings.append(a)}
   }
 });
 const repairScheduleRows=()=>{
   document.querySelectorAll('table.schedule tbody tr').forEach(row=>{
     const prog=row.querySelector('.prog'); if(!prog)return;
     [...row.children].filter(ch=>!ch.matches('td,th')).forEach(ch=>prog.append(ch));
   });
 };
 repairScheduleRows();
}).catch(()=>{});
})();


/* ---- couche personnelle : films déjà vus ----
   Centralisée dans seen-filter.js pour éviter deux moteurs concurrents. */
