(()=>{
  if(new URLSearchParams(location.search).get('tv')!=='1')return;

  document.documentElement.classList.add('android-tv-mode');
  document.body.classList.add('android-tv-mode');

  const style=document.createElement('style');
  style.id='selectionTvAndroidTvStyle';
  style.textContent=`
    html.android-tv-mode,body.android-tv-mode{background:#0d1117!important;color:#f3f0e8!important;scroll-behavior:smooth}
    body.android-tv-mode .toolbar,
    body.android-tv-mode #couverture,
    body.android-tv-mode #sommaire,
    body.android-tv-mode #methode,
    body.android-tv-mode .footer,
    body.android-tv-mode .back-toc,
    body.android-tv-mode .program-actions,
    body.android-tv-mode .seen-summary,
    body.android-tv-mode .rating-date,
    body.android-tv-mode .page-atmosphere{display:none!important}
    body.android-tv-mode .book{padding:0!important;max-width:none!important}
    body.android-tv-mode .page{
      width:100%!important;height:auto!important;min-height:0!important;
      margin:0!important;padding:38px 54px 46px!important;
      background:#111720!important;color:#f3f0e8!important;
      box-shadow:none!important;border:0!important;border-bottom:1px solid #303744!important;
      overflow:visible!important
    }
    body.android-tv-mode .topbar{position:static!important;height:auto!important;margin-bottom:24px!important;padding-bottom:14px!important;border-bottom:1px solid #303744!important}
    body.android-tv-mode .topbar *,body.android-tv-mode .issue{color:#c9c2b7!important}
    body.android-tv-mode h1,body.android-tv-mode h2,body.android-tv-mode h3,
    body.android-tv-mode .h1,body.android-tv-mode .grid-title{color:#fff!important}
    body.android-tv-mode h2,body.android-tv-mode .grid-title{font-size:30px!important}
    body.android-tv-mode h3{font-size:23px!important;line-height:1.15!important}
    body.android-tv-mode p,body.android-tv-mode .reason,body.android-tv-mode .why2,
    body.android-tv-mode .interest,body.android-tv-mode .deck{font-size:17px!important;line-height:1.45!important;color:#ddd7cd!important}
    body.android-tv-mode .work-meta,body.android-tv-mode .meta2,body.android-tv-mode .torrent-meta,
    body.android-tv-mode .slot,body.android-tv-mode .where,body.android-tv-mode .service{font-size:14px!important;line-height:1.4!important;color:#aaa59c!important}
    body.android-tv-mode .week-grid,body.android-tv-mode .week-grid-five,
    body.android-tv-mode .radar-grid,body.android-tv-mode .torrent-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:26px!important}
    body.android-tv-mode .feature-columns,body.android-tv-mode .hero-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:28px!important}
    body.android-tv-mode .list-2,body.android-tv-mode .platform-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:28px 36px!important}
    body.android-tv-mode .release-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:28px!important}
    body.android-tv-mode .week-card,body.android-tv-mode .feature,body.android-tv-mode .list-card,
    body.android-tv-mode .platform,body.android-tv-mode .release-card,body.android-tv-mode .radar-card,
    body.android-tv-mode .torrent-card{border-color:#47505d!important}
    body.android-tv-mode img{background:#171d26!important}
    body.android-tv-mode .rating-pill{
      display:inline-flex!important;align-items:center!important;
      padding:5px 9px!important;margin:5px 6px 2px 0!important;
      font:700 14px/1.1 Arial,sans-serif!important;
      color:#f5efe5!important;border:1px solid #6d7682!important;background:#202732!important;
      text-decoration:none!important;pointer-events:none!important
    }
    body.android-tv-mode .ratings{margin:8px 0!important}
    body.android-tv-mode .schedule{table-layout:auto!important}
    body.android-tv-mode .schedule th{font-size:12px!important;color:#aaa59c!important}
    body.android-tv-mode .schedule td{font-size:15px!important;line-height:1.4!important;padding:13px 10px 13px 0!important;border-color:#303744!important;color:#ddd7cd!important}
    body.android-tv-mode .schedule .prog{font-size:20px!important;color:#fff!important;min-width:280px!important}
    body.android-tv-mode .schedule .time{font-size:16px!important;color:#fff!important}
    body.android-tv-mode .schedule .chan{font-size:15px!important;color:#c9c2b7!important}
    body.android-tv-mode .stv-tv-jellyfin{
      display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px
    }
    body.android-tv-mode .stv-tv-present{
      display:inline-flex;align-items:center;padding:7px 10px;
      border:1px solid #6e8798;background:#20303a;color:#eaf5f7;
      font:700 14px/1.1 Arial,sans-serif
    }
    body.android-tv-mode button.stv-tv-open{
      appearance:none;border:2px solid #8197aa;background:#25394a;color:white;
      padding:9px 13px;font:700 15px/1.1 Arial,sans-serif;border-radius:3px
    }
    body.android-tv-mode button.stv-tv-open:focus{
      outline:4px solid #fff;outline-offset:4px;background:#3a5870
    }
    body.android-tv-mode a{color:inherit!important;text-decoration:none!important}
    @media(max-width:1400px){
      body.android-tv-mode .week-grid,body.android-tv-mode .week-grid-five,
      body.android-tv-mode .radar-grid,body.android-tv-mode .torrent-grid,
      body.android-tv-mode .release-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
    }
  `;
  document.head.append(style);

  // External/internal web links have no useful place in the TV client. Preserve
  // their visible label (especially IMDb / SensCritique ratings) but remove navigation.
  const neutralizeLinks=root=>{
    root.querySelectorAll?.('a').forEach(a=>{
      const span=document.createElement('span');
      span.className=a.className;
      span.innerHTML=a.innerHTML;
      for(const attr of ['data-title','data-work-id'])if(a.hasAttribute(attr))span.setAttribute(attr,a.getAttribute(attr));
      a.replaceWith(span);
    });
    root.querySelectorAll?.('.program-actions,.seen-btn,.save,.seen-toggle,.compact-toggle').forEach(el=>el.remove());
  };
  neutralizeLinks(document);

  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node instanceof Element)neutralizeLinks(node);
    }
  }).observe(document.body,{childList:true,subtree:true});

  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const SELECTOR='article.week-card,article.feature,article.list-card,article.platform:not(.jellyfin-private-upload),article.release-card,article.expire-card,article.radar-card,article.torrent-card,table.schedule tbody tr';
  const keyNodes=new Map();
  const sent=new Set();
  let works=new Map(),links=new Map(),seq=0;

  const titleOf=el=>{
    if(el.matches('tr'))return clean(el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent);
    return clean(el.dataset.title||el.querySelector('h3')?.textContent||'');
  };
  const yearOf=(el,title)=>{
    const w=works.get(norm(title));
    if(w?.year)return String(w.year);
    const txt=el.querySelector('.work-meta,.meta2,.torrent-meta,.slot,.where,.service,.rel-date')?.textContent||'';
    return txt.match(/\b(19|20)\d{2}\b/)?.[0]||'';
  };
  const idsOf=title=>{
    const l=links.get(norm(title))||{};
    return {
      imdbId:String(l.imdb||'').match(/\/title\/(tt\d+)/i)?.[1]||'',
      tmdbId:String(l.tmdb||'').match(/\/movie\/(\d+)/i)?.[1]||''
    };
  };
  const addNode=(key,el)=>{
    let nodes=keyNodes.get(key);if(!nodes){nodes=new Set();keyNodes.set(key,nodes)}
    nodes.add(el);
  };
  const render=result=>{
    const nodes=keyNodes.get(result.key);if(!nodes)return;
    for(const el of nodes){
      el.querySelector('.stv-tv-jellyfin')?.remove();
      if(!result.found)return;
      const box=document.createElement('div');box.className='stv-tv-jellyfin';
      const pill=document.createElement('span');pill.className='stv-tv-present';pill.textContent='Dans Jellyfin';box.append(pill);
      const open=document.createElement('button');open.type='button';open.className='stv-tv-open';open.textContent='Ouvrir dans Jellyfin';
      open.onclick=()=>window.SelectionTvAndroid?.openItem?.(String(result.itemId||''));
      box.append(open);
      const anchor=el.querySelector('.ratings')||el.querySelector('.work-meta,.meta2,.torrent-meta,.slot,.where,.service')||el.querySelector('h3');
      (anchor||el).insertAdjacentElement?.('afterend',box) || el.append(box);
    }
  };

  window.SelectionTvAndroidResult=result=>{
    if(typeof result==='string'){try{result=JSON.parse(result)}catch{return}}
    if(result?.key)render(result);
  };

  const queryElement=el=>{
    const title=titleOf(el);if(!title)return;
    const year=yearOf(el,title),ids=idsOf(title);
    const key=ids.imdbId||ids.tmdbId||('title:'+norm(title)+'|'+year);
    addNode(key,el);
    if(sent.has(key))return;
    sent.add(key);
    const req={requestId:++seq,key,title,year,imdbId:ids.imdbId,tmdbId:ids.tmdbId};
    try{window.SelectionTvAndroid?.lookup?.(JSON.stringify(req))}catch{}
  };

  Promise.all([
    fetch('../../data/works.json',{cache:'no-store'}).then(r=>r.ok?r.json():{works:[]}).catch(()=>({works:[]})),
    fetch('../../data/links.json',{cache:'no-store'}).then(r=>r.ok?r.json():{links:{}}).catch(()=>({links:{}}))
  ]).then(([wd,ld])=>{
    works=new Map((wd.works||[]).filter(w=>w?.title).map(w=>[norm(w.title),w]));
    links=new Map(Object.entries(ld.links||{}).map(([k,v])=>[norm(k),v]));
    document.querySelectorAll(SELECTOR).forEach(queryElement);
    new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches?.(SELECTOR))queryElement(node);
        node.querySelectorAll?.(SELECTOR).forEach(queryElement);
      }
    }).observe(document.body,{childList:true,subtree:true});
  });
})();