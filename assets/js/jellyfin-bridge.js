(()=>{
  if(window.parent===window)return;

  const PARENT=window.parent;
  const script=document.currentScript;
  const ROOT=new URL('../../',script?.src||location.href);
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const SELECTOR='article.week-card,article.feature,article.list-card,article.platform,article.release-card,article.expire-card,article.radar-card,article.torrent-card,table.schedule tbody tr';
  const observed=new WeakSet();
  const keyToNodes=new Map();
  const pendingVisible=new Map();
  let metadata={works:new Map(),links:new Map()};
  let observer=null,sendTimer=null,parentReady=false;

  const titleOf=el=>{
    if(el.matches('tr'))return clean(el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent);
    return clean(el.dataset.title||el.querySelector('h3')?.textContent||'');
  };
  const yearOf=(el,title)=>{
    const w=metadata.works.get(norm(title));
    if(w?.year)return String(w.year);
    const text=el.querySelector('.work-meta,.meta2,.torrent-meta,.slot,.where,.service,.rel-date')?.textContent||el.textContent||'';
    return text.match(/\b(19|20)\d{2}\b/)?.[0]||'';
  };
  const imdbOf=title=>{
    const u=metadata.links.get(norm(title))?.imdb||'';
    return u.match(/\/title\/(tt\d+)/i)?.[1]||'';
  };
  const infoFor=el=>{
    const title=titleOf(el);if(!title)return null;
    const work=metadata.works.get(norm(title));
    const workId=el.dataset.workId||work?.id||'';
    const year=yearOf(el,title);
    const imdbId=imdbOf(title);
    const key=workId||imdbId||('title:'+norm(title)+'|'+year);
    return {key,title,year,imdbId,workId};
  };
  const remember=(info,el)=>{
    let set=keyToNodes.get(info.key);if(!set){set=new Set();keyToNodes.set(info.key,set)}
    set.add(el);
  };
  const ensureStyle=()=>{
    if(document.getElementById('selectionTvJellyfinStyle'))return;
    const s=document.createElement('style');s.id='selectionTvJellyfinStyle';s.textContent=`
      .jellyfin-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px}
      .jellyfin-pill{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border:1px solid #4f6f7e;background:#edf5f6;color:#173441;font:700 10px/1.2 Arial,sans-serif;letter-spacing:.02em}
      .jellyfin-pill.played{border-color:#47705b;background:#edf5ef;color:#214b35}
      .jellyfin-pill.quality{border-color:#8a7a54;background:#f6f1e5;color:#5c4b27}
      .jellyfin-open{appearance:none;border:1px solid #39546a;background:#172f43;color:#fff;padding:4px 8px;font:700 10px/1.2 Arial,sans-serif;cursor:pointer}
      .jellyfin-open:hover{background:#24475f}
    `;document.head.append(s);
  };
  const render=(item)=>{
    const nodes=keyToNodes.get(item.key);if(!nodes)return;
    for(const el of nodes){
      let box=el.querySelector('.jellyfin-actions');
      if(!item.found){box?.remove();continue}
      if(!box){box=document.createElement('div');box.className='jellyfin-actions';const actions=el.querySelector('.program-actions');(actions||el).append(box)}
      box.textContent='';
      const present=document.createElement('span');present.className='jellyfin-pill';present.textContent='Dans Jellyfin';box.append(present);
      if(item.played){const seen=document.createElement('span');seen.className='jellyfin-pill played';seen.textContent='✓ Vu dans Jellyfin';box.append(seen)}
      if(item.quality){const q=document.createElement('span');q.className='jellyfin-pill quality';q.textContent=item.quality;box.append(q)}
      const open=document.createElement('button');open.type='button';open.className='jellyfin-open';open.textContent='Ouvrir dans Jellyfin';
      open.onclick=()=>PARENT.postMessage({type:'selection-tv:jellyfin-open',itemId:item.itemId},'*');
      box.append(open);
    }
  };
  const request=items=>{
    if(!parentReady||!items.length)return false;
    PARENT.postMessage({type:'selection-tv:jellyfin-query',version:1,items},'*');
    return true;
  };
  const observeElement=el=>{
    if(observed.has(el))return;observed.add(el);
    const info=infoFor(el);if(!info)return;remember(info,el);
    if(observer)observer.observe(el);else request([info]);
  };
  const scan=root=>{
    if(root?.matches?.(SELECTOR))observeElement(root);
    root?.querySelectorAll?.(SELECTOR).forEach(observeElement);
  };
  const initObserver=()=>{
    if('IntersectionObserver'in window){
      observer=new IntersectionObserver(entries=>{
        const batch=[];
        for(const e of entries){
          if(!e.isIntersecting)continue;
          const info=infoFor(e.target);if(!info)continue;
          remember(info,e.target);
          if(!parentReady){pendingVisible.set(info.key,info);continue}
          observer.unobserve(e.target);batch.push(info);
        }
        request(batch);
      },{rootMargin:'1200px 0px'});
    }
    scan(document);
    new MutationObserver(records=>{
      clearTimeout(sendTimer);
      sendTimer=setTimeout(()=>{for(const r of records)for(const n of r.addedNodes)if(n instanceof Element)scan(n)},80);
    }).observe(document.body,{childList:true,subtree:true});
  };

  Promise.all([
    fetch(new URL('data/works.json',ROOT),{cache:'no-store'}).then(r=>r.ok?r.json():{works:[]}).catch(()=>({works:[]})),
    fetch(new URL('data/links.json',ROOT),{cache:'no-store'}).then(r=>r.ok?r.json():{links:{}}).catch(()=>({links:{}}))
  ]).then(([wd,ld])=>{
    metadata.works=new Map((wd.works||[]).filter(w=>w?.title).map(w=>[norm(w.title),w]));
    metadata.links=new Map(Object.entries(ld.links||{}).map(([k,v])=>[norm(k),v]));
    ensureStyle();initObserver();
    if(parentReady)scan(document);
  });

  window.addEventListener('message',e=>{
    if(e.source!==PARENT||!e.data)return;
    if(e.data.type==='selection-tv:jellyfin-ready'){
      parentReady=true;
      if(pendingVisible.size){request([...pendingVisible.values()]);pendingVisible.clear()}
      scan(document);
    }
    if(e.data.type==='selection-tv:jellyfin-result'&&Array.isArray(e.data.items))e.data.items.forEach(render);
  });
})();

/* ---- Jellyfin-only private forum uploads ---- */
(()=>{
  if(window.parent===window)return;
  const PARENT=window.parent;
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtDate=value=>{
    if(!value)return '';
    const d=new Date(value);if(Number.isNaN(d.getTime()))return '';
    try{return new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)}
    catch{return ''}
  };
  const safeUrl=u=>{
    if(u==null)return '';
    const raw=String(u).trim();
    if(!raw||/^(?:undefined|null)$/i.test(raw))return '';
    try{const x=new URL(raw,location.href);return /^https?:$/.test(x.protocol)?x.href:''}catch{return ''}
  };
  const makeLink=(label,url,cls='')=>{
    const u=safeUrl(url);if(!u)return null;
    const a=document.createElement('a');a.href=u;a.target='_blank';a.rel='noopener';a.textContent=label;if(cls)a.className=cls;return a;
  };
  const catalogPromise=Promise.all([
    fetch(new URL('../../data/links.json?v=20260925-private',document.currentScript?.src||location.href),{cache:'no-store'}).then(r=>r.ok?r.json():{links:{}}),
    fetch(new URL('../../data/works.json?v=20260925-private',document.currentScript?.src||location.href),{cache:'no-store'}).then(r=>r.ok?r.json():{works:[]})
  ]).then(([ld,wd])=>({
    links:new Map(Object.entries(ld.links||{}).map(([k,v])=>[norm(k),v])),
    works:new Map((wd.works||[]).map(w=>[norm(w.title),w]))
  })).catch(()=>({links:new Map(),works:new Map()}));

  const ratingBox=(ratings,links)=>{
    const r=ratings||{};
    if(!r.imdb&&!r.senscritique&&!r.sc&&!r.jellyfin)return null;
    const box=document.createElement('div');box.className='ratings';
    if(r.imdb){
      const a=links?.imdb?makeLink('IMDb '+r.imdb+'/10',links.imdb,'rating-pill imdb'):null;
      if(a)box.append(a);else{const s=document.createElement('span');s.className='rating-pill imdb';s.textContent='IMDb '+r.imdb+'/10';box.append(s)}
    }
    const sc=r.senscritique||r.sc;
    if(sc){
      const a=links?.sc?makeLink('SensCritique '+sc+'/10',links.sc,'rating-pill sc'):null;
      if(a)box.append(a);else{const s=document.createElement('span');s.className='rating-pill sc';s.textContent='SensCritique '+sc+'/10';box.append(s)}
    }
    if(!r.imdb&&!sc&&r.jellyfin){
      const s=document.createElement('span');s.className='rating-pill imdb';s.textContent='Jellyfin '+String(r.jellyfin).replace('.',',')+'/10';box.append(s);
    }
    if(box.children.length){
      const d=document.createElement('span');d.className='rating-date';d.textContent='relevé automatiquement';box.append(d);
      return box;
    }
    return null;
  };

  const hydrateFromCatalog=(item,catalog)=>{
    const key=norm(item.title||item.titleGuess||item.topicTitle);
    const W=catalog.works.get(key)||null;
    const L=catalog.links.get(key)||{};
    const out={...item,links:{...L,...(item.links||{})}};
    if(W){
      if(!out.image&&W.image)out.image=W.image;
      if(!out.director&&W.director)out.director=W.director;
      if(!out.year&&W.year)out.year=W.year;
      if(!out.genre&&W.genre)out.genre=W.genre;
      out.workId=out.workId||W.id||'';
      out.ratings={
        ...(W.ratings||{}),
        ...(out.ratings||{})
      };
    }
    return out;
  };
  const ensureStyle=()=>{
    if(document.getElementById('selectionTvPrivateUploadsStyle'))return;
    const s=document.createElement('style');s.id='selectionTvPrivateUploadsStyle';s.textContent=`
      .jellyfin-private-uploads-page{--section:#76563e}
      .jellyfin-private-upload .private-topic-title{font:6.4pt/1.35 var(--sans);color:var(--muted);margin-top:1.5mm;overflow-wrap:anywhere}
      .jellyfin-private-upload .private-topic-title b{color:var(--section);text-transform:uppercase;letter-spacing:.05em}
      .jellyfin-private-upload .private-source{font:700 6.5pt var(--sans);color:var(--section);letter-spacing:.04em;text-transform:uppercase;margin-bottom:1mm}
      .jellyfin-private-upload .private-overview{margin-top:1.5mm}
      .jellyfin-private-upload .private-unresolved{display:flex;width:29mm;height:43mm;align-items:flex-end;padding:2.5mm;background:#172f43;color:white;font:700 8pt/1.15 var(--serif)}
      .jellyfin-private-note{margin-top:3mm;padding:2.5mm 3.5mm;border-left:.65mm solid var(--section);background:var(--section-soft);font:7.5pt/1.4 var(--serif)}
      @media screen and (max-width:680px){.jellyfin-private-upload .private-topic-title{font-size:9pt}.jellyfin-private-upload .private-source{font-size:9pt}}
    `;document.head.append(s);
  };
  const saveControl=(box,item)=>{
    const STORE='selectionTV_saved_v1';
    const key=norm(item.title);
    const load=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch{return {}}};
    const save=o=>{try{localStorage.setItem(STORE,JSON.stringify(o))}catch{}};
    const b=document.createElement('button');b.type='button';b.className='save';
    const refresh=()=>{const x=load()[key],on=!!x&&(x.status||'a-recuperer')==='a-recuperer';b.textContent=on?'✓ À récupérer':'＋ À récupérer';b.classList.toggle('saved',on)};
    b.onclick=()=>{
      const all=load();
      if(all[key]&&(all[key].status||'a-recuperer')==='a-recuperer')delete all[key];
      else all[key]={title:item.title,context:'Vos Uploads · dernières 24 h',badge:'UPLOAD FORUM',page:document.title,url:item.topicUrl||location.href,added:new Date().toISOString(),status:'a-recuperer'};
      save(all);refresh();
    };
    refresh();box.append(b);
    window.SelectionTVSeen?.attach(box,item.title,()=>({title:item.title,context:'Vos Uploads · dernières 24 h',badge:'UPLOAD FORUM',url:item.topicUrl||location.href}));
  };
  const makeCard=(item,index)=>{
    const article=document.createElement('article');
    article.className='platform has-poster jellyfin-private-upload';
    article.dataset.title=item.title||item.titleGuess||item.topicTitle||'';
    article.dataset.privateJellyfin='1';
    if(Number.isInteger(index))article.dataset.privateIndex=String(index);
    if(item.workId)article.dataset.workId=item.workId;

    const imgUrl=safeUrl(item.image);
    if(imgUrl){
      const img=document.createElement('img');img.className='platform-poster';img.src=imgUrl;img.alt='Affiche de '+article.dataset.title;img.loading='lazy';
      img.onerror=()=>{img.remove();if(!article.querySelector('.private-unresolved')){const fb=document.createElement('div');fb.className='private-unresolved';fb.textContent=article.dataset.title||'Film à identifier';article.prepend(fb)}};
      article.append(img);
    }else{
      const fb=document.createElement('div');fb.className='private-unresolved';fb.textContent=article.dataset.title||'Film à identifier';article.append(fb);
    }

    const copy=document.createElement('div');copy.className='platform-copy';
    const source=document.createElement('div');source.className='private-source';
    source.textContent='Upload forum'+(item.activityAt?' · '+fmtDate(item.activityAt):'');
    copy.append(source);

    const h3=document.createElement('h3');h3.textContent=article.dataset.title;copy.append(h3);

    const bits=[];
    if(item.director)bits.push('Réalisation : '+item.director);
    if(item.year)bits.push(String(item.year));
    if(item.genre)bits.push(item.genre);
    if(item.quality)bits.push(item.quality);
    if(bits.length){const meta=document.createElement('div');meta.className='work-meta';meta.textContent=bits.join(' · ');copy.append(meta)}

    const rbox=ratingBox(item.ratings,item.links||{});
    if(rbox)copy.append(rbox);

    if(item.overview){const p=document.createElement('p');p.className='private-overview';p.textContent=item.overview;copy.append(p)}

    const original=document.createElement('div');original.className='private-topic-title';
    original.innerHTML='<b>Sujet</b> · '+esc(item.topicTitle||'');
    copy.append(original);

    const actions=document.createElement('div');actions.className='program-actions';
    const V=window.SELECTION_TV_VERIFIED_LINKS?.[norm(article.dataset.title)]||{};
    const links={...(item.links||{})};
    if(!links.imdb&&V.imdb)links.imdb=V.imdb;
    if(!links.sc&&V.sc)links.sc=V.sc;
    if(!links.allocine&&V.allocine)links.allocine=V.allocine;
    [
      ['topic','Voir le topic',item.topicUrl,'official'],
      ['allocine','AlloCiné',links.allocine,''],
      ['imdb','IMDb',links.imdb,''],
      ['sc','SensCritique',links.sc,''],
      ['tmdb','TMDb',links.tmdb,'']
    ].forEach(([,label,url,cls])=>{const a=makeLink(label,url,cls);if(a)actions.append(a)});

    if(item.jellyfinItemId){
      const j=document.createElement('div');j.className='jellyfin-actions';
      const badge=document.createElement('span');badge.className='jellyfin-pill';badge.textContent='Dans Jellyfin';j.append(badge);
      const open=document.createElement('button');open.type='button';open.className='jellyfin-open';open.textContent='Ouvrir dans Jellyfin';
      open.onclick=()=>PARENT.postMessage({type:'selection-tv:jellyfin-open',itemId:item.jellyfinItemId},'*');
      j.append(open);actions.append(j);
    }

    saveControl(actions,item);
    copy.append(actions);
    article.append(copy);
    return article;
  };
  const removeOld=()=>{
    document.querySelectorAll('.jellyfin-private-uploads-page').forEach(x=>x.remove());
    document.querySelectorAll('.toc-link[data-jellyfin-private="1"]').forEach(x=>x.remove());
  };
  const addToc=()=>{
    const group=document.querySelector('#sommaire .toc-group');
    if(!group||group.querySelector('[data-jellyfin-private="1"]'))return;
    const a=document.createElement('a');a.className='toc-link';a.href='#jellyfin-uploads-1';a.dataset.jellyfinPrivate='1';
    a.innerHTML='<span class="toc-label">Vos Uploads<span class="toc-sub">24 dernières heures · privé Jellyfin</span></span><span class="toc-page">Jellyfin</span>';
    const method=[...group.querySelectorAll('.toc-link')].find(x=>x.getAttribute('href')==='#methode');
    method?group.insertBefore(a,method):group.append(a);
  };
  const patchPrivate=(items)=>{
    const cards=[...document.querySelectorAll('.jellyfin-private-upload[data-private-index]')];
    if(cards.length!==items.length)return false;
    items.forEach((item,index)=>{
      const current=document.querySelector('.jellyfin-private-upload[data-private-index="'+index+'"]');
      if(current)current.replaceWith(makeCard(item,index));
    });
    return true;
  };

  const renderPrivate=async payload=>{
    const raw=(payload.items||[]).filter(x=>x&&(x.title||x.titleGuess||x.topicTitle));
    if(!raw.length)return;
    const catalog=await catalogPromise;
    const items=raw.map(x=>hydrateFromCatalog(x,catalog));

    if(payload.phase!=='provisional' && patchPrivate(items)){
      document.dispatchEvent(new CustomEvent('selectiontv:privateuploadsrendered',{detail:{count:items.length,phase:payload.phase||''}}));
      return;
    }

    removeOld();
    ensureStyle();addToc();
    const book=document.querySelector('.book');if(!book)return;
    const firstDaily=book.querySelector('[id$="-selection"]');
    const perPage=4;
    for(let start=0,pageNo=1;start<items.length;start+=perPage,pageNo++){
      const page=document.createElement('section');
      page.className='page jellyfin-private-uploads-page';
      page.id='jellyfin-uploads-'+pageNo;
      const top=document.createElement('div');top.className='topbar';top.innerHTML='Vos Uploads<span class="issue">Rubrique privée Jellyfin</span>';page.append(top);
      const kicker=document.createElement('div');kicker.className='kicker';kicker.textContent='Disponibilités récentes';page.append(kicker);
      const h=document.createElement('div');h.className='h1';h.textContent=pageNo===1?'Les uploads des dernières 24 heures':'Vos Uploads — suite';page.append(h);
      const deck=document.createElement('div');deck.className='deck';deck.textContent='Les sujets récents du forum sont identifiés comme œuvres et enrichis par les métadonnées disponibles dans Jellyfin.';page.append(deck);
      const rule=document.createElement('div');rule.className='rule';page.append(rule);
      const grid=document.createElement('div');grid.className='platform-grid';items.slice(start,start+perPage).forEach((x,offset)=>grid.append(makeCard(x,start+offset)));page.append(grid);
      if(pageNo===1){
        const note=document.createElement('div');note.className='jellyfin-private-note';
        note.textContent='Cette rubrique n’existe que dans l’intégration Jellyfin. Les données du forum ne sont pas inscrites dans les fichiers publics de Sélection TV.';
        page.append(note);
      }
      const back=document.createElement('a');back.className='back-toc';back.href='#sommaire';back.textContent='↑ Sommaire';page.append(back);
      const footer=document.createElement('div');footer.className='footer';
      footer.innerHTML='<span>Flux privé · actualisation Jellyfin</span><span>J</span>';page.append(footer);
      firstDaily?book.insertBefore(page,firstDaily):book.append(page);
    }
    document.dispatchEvent(new CustomEvent('selectiontv:privateuploadsrendered',{detail:{count:items.length}}));
  };
  window.addEventListener('message',e=>{
    if(e.source!==PARENT||!e.data)return;
    if(e.data.type==='selection-tv:jellyfin-private-uploads')renderPrivate(e.data);
  });

  // Explicit handshake: Plugin Pages may finish its own script before or
  // after this iframe bridge. Tell the parent exactly when private payloads
  // can safely be delivered.
  try{
    PARENT.postMessage({type:'selection-tv:jellyfin-private-ready',version:1},'*');
    setTimeout(()=>PARENT.postMessage({type:'selection-tv:jellyfin-private-ready',version:1},'*'),500);
    setTimeout(()=>PARENT.postMessage({type:'selection-tv:jellyfin-private-ready',version:1},'*'),1800);
  }catch{}
})();
