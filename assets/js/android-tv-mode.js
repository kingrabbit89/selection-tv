(()=>{
  if(new URLSearchParams(location.search).get('tv')!=='1')return;

  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const SELECTOR='article.week-card,article.feature,article.list-card,article.platform:not(.jellyfin-private-upload),article.release-card,article.expire-card,article.radar-card,article.torrent-card,table.schedule tbody tr';
  const CACHE_KEY='selectionTv_androidtv_matches_v2';
  const POSITIVE_TTL=30*24*60*60*1000;
  const NEGATIVE_TTL=24*60*60*1000;
  const QUICK_CONCURRENCY=4;
  const DEEP_CONCURRENCY=2;

  document.documentElement.classList.add('android-tv-mode');
  document.body.classList.add('android-tv-mode');

  const style=document.createElement('style');
  style.textContent=`
    html.android-tv-mode,body.android-tv-mode{
      margin:0!important;background:#0d1117!important;color:#f4f0e8!important;
      font-family:Arial,Helvetica,sans-serif!important;scroll-behavior:auto!important
    }
    body.android-tv-mode .book,body.android-tv-mode>.toolbar{display:none!important}
    .stv-tv-shell{min-height:100vh;background:#0d1117;padding:8px 0 56px}
    .stv-tv-statusbar{
      position:sticky;top:0;z-index:18;
      min-height:32px;padding:8px 42px;
      background:rgba(13,17,23,.94);border-bottom:1px solid #2c333d;
      font:13px/1.25 Arial,sans-serif;color:#9fa8b4
    }
    .stv-tv-statusbar strong{color:#e9eef5}
    .stv-tv-row{padding:20px 42px 10px}
    .stv-tv-row-title{
      margin:0 0 12px;font:700 19px/1.2 Arial,sans-serif;color:#fff;letter-spacing:.01em
    }
    .stv-tv-grid{
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(138px,158px));
      gap:18px 16px;
      align-items:start;
      overflow:visible
    }
    .stv-tv-tile{
      position:relative;width:100%;min-width:0;
      padding:0;border:0;border-radius:5px;background:#171d26;color:#fff;
      text-align:left;outline:none;overflow:visible;
      transition:transform .1s linear,box-shadow .1s linear,background .1s linear
    }
    .stv-tv-poster-wrap{
      position:relative;width:100%;aspect-ratio:2/3;background:#252c35;
      border-radius:5px;overflow:hidden
    }
    .stv-tv-poster{width:100%;height:100%;object-fit:cover;display:block}
    .stv-tv-placeholder{
      width:100%;height:100%;display:flex;align-items:flex-end;
      padding:12px;box-sizing:border-box;
      font:700 16px/1.15 Georgia,serif;background:#252c35;color:#e8e3da
    }
    .stv-tv-state{
      position:absolute;left:6px;bottom:6px;z-index:3;
      padding:4px 6px;border-radius:3px;
      font:700 10px/1 Arial,sans-serif;
      background:rgba(25,31,38,.94);border:1px solid #66707c;color:#dde3e8
    }
    .stv-tv-state.found{background:rgba(31,67,45,.96);border-color:#77a187;color:#f1fff5}
    .stv-tv-state.missing{background:rgba(37,42,48,.96);border-color:#5c6268;color:#aeb4ba}
    .stv-tv-state.checking{background:rgba(63,52,31,.96);border-color:#8a744c;color:#f4dfb3}
    .stv-tv-tile-title{
      padding:8px 2px 0;font:700 13px/1.18 Arial,sans-serif;color:#e9e5de;
      display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden
    }
    .stv-tv-tile.is-focused{
      transform:scale(1.055);z-index:25;
      box-shadow:0 0 0 4px #fff,0 0 0 7px #587896,0 10px 24px rgba(0,0,0,.46);
      background:#253443
    }
    .stv-tv-tile.is-focused .stv-tv-tile-title{color:#fff}
    .stv-tv-info{
      position:fixed;z-index:24;width:360px;max-height:238px;
      box-sizing:border-box;padding:16px 17px;
      border:1px solid rgba(180,194,208,.55);border-radius:7px;
      background:rgba(15,19,24,.82);
      box-shadow:0 12px 32px rgba(0,0,0,.46);
      color:#f5f1ea;pointer-events:none;
      opacity:0;visibility:hidden;
      transition:opacity .08s linear;
      overflow:hidden
    }
    .stv-tv-info.visible{opacity:1;visibility:visible}
    .stv-tv-info-title{margin:0 0 6px;font:700 22px/1.05 Georgia,serif;color:#fff}
    .stv-tv-info-meta{
      margin:0 0 7px;font:12px/1.35 Arial,sans-serif;color:#c3c9cf;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis
    }
    .stv-tv-info-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
    .stv-tv-info-badge{
      display:inline-flex;align-items:center;padding:4px 6px;
      border:1px solid #687381;background:rgba(34,41,51,.88);
      color:#f0ede7;font:700 11px/1 Arial,sans-serif
    }
    .stv-tv-info-badge.found{border-color:#6b987b;background:rgba(31,67,45,.9);color:#effff4}
    .stv-tv-info-badge.missing{border-color:#5f646b;background:rgba(36,40,46,.9);color:#afb5bb}
    .stv-tv-info-badge.checking{border-color:#8b754f;background:rgba(61,50,30,.9);color:#f0dcae}
    .stv-tv-info-desc{
      font:13px/1.35 Georgia,serif;color:#ddd7cd;
      display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden
    }
    .stv-tv-info-hint{margin-top:8px;font:11px/1.25 Arial,sans-serif;color:#9ca5af}
    @media(max-width:1300px){
      .stv-tv-statusbar{padding-left:28px;padding-right:28px}
      .stv-tv-row{padding-left:28px;padding-right:28px}
      .stv-tv-grid{grid-template-columns:repeat(auto-fill,minmax(126px,148px));gap:16px 14px}
      .stv-tv-info{width:330px;max-height:224px}
    }
  `;
  document.head.append(style);

  const worksPromise=fetch('../../data/works.json',{cache:'no-store'}).then(r=>r.ok?r.json():{works:[]}).catch(()=>({works:[]}));
  const linksPromise=fetch('../../data/links.json',{cache:'no-store'}).then(r=>r.ok?r.json():{links:{}}).catch(()=>({links:{}}));

  const readCache=()=>{
    try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{}}catch{return {}}
  };
  const writeCache=cache=>{try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache))}catch{}};
  const cache=readCache();

  let models=[],rows=[],current=null,works=new Map(),links=new Map();
  let libraryReady=false,libraryCount=0,quickInflight=0,deepInflight=0;
  const quickQueue=[];
  const deepQueue=[];
  const deepActive=new Set();
  const byKey=new Map();

  const titleOf=el=>{
    if(el.matches('tr'))return clean(el.querySelector('.prog')?.childNodes?.[0]?.textContent||el.querySelector('.prog')?.textContent);
    return clean(el.dataset.title||el.querySelector('h3')?.textContent||'');
  };
  const metaTexts=el=>{
    const out=[];
    el.querySelectorAll('.work-meta,.meta2,.torrent-meta,.slot,.where,.service,.rel-date').forEach(x=>{
      const t=clean(x.textContent);if(t&&!out.includes(t))out.push(t);
    });
    return out;
  };
  const descOf=el=>{
    const out=[];
    el.querySelectorAll('p,.reason,.why2,.interest').forEach(x=>{
      const clone=x.cloneNode(true);
      clone.querySelectorAll?.('a,button,.program-actions,.ratings,.jellyfin-actions,.seen-btn,.save').forEach(n=>n.remove());
      const t=clean(clone.textContent);
      if(t&&t.length>20&&!out.includes(t))out.push(t);
    });
    return out.join(' ');
  };
  const ratingsOf=el=>{
    const out=[];
    el.querySelectorAll('.rating-pill').forEach(x=>{
      const t=clean(x.textContent).replace(/relevé.*$/i,'').trim();
      if(t&&!out.includes(t))out.push(t);
    });
    return out;
  };
  const imageOf=el=>{
    const img=el.querySelector('img');
    return img?.currentSrc||img?.getAttribute('src')||'';
  };
  const groupTitle=page=>{
    const h=page?.querySelector('.h1,.grid-title,h2');
    if(h&&clean(h.textContent))return clean(h.textContent);
    const top=page?.querySelector('.topbar');
    if(top){
      const clone=top.cloneNode(true);
      clone.querySelectorAll('.issue').forEach(x=>x.remove());
      const t=clean(clone.textContent);if(t)return t;
    }
    return 'Sélection';
  };
  const yearFor=(el,title)=>{
    const w=works.get(norm(title));
    if(w?.year)return String(w.year);
    const text=metaTexts(el).join(' ');
    return text.match(/\b(19|20)\d{2}\b/)?.[0]||'';
  };
  const idsFor=title=>{
    const l=links.get(norm(title))||{};
    return {
      imdbId:String(l.imdb||'').match(/\/title\/(tt\d+)/i)?.[1]||'',
      tmdbId:String(l.tmdb||'').match(/\/movie\/(\d+)/i)?.[1]||''
    };
  };
  const cacheKeyFor=(title,year,ids)=>{
    if(ids.imdbId)return 'imdb:'+ids.imdbId.toLowerCase();
    if(ids.tmdbId)return 'tmdb:'+ids.tmdbId;
    return 'title:'+norm(title)+'|'+year;
  };

  const loadCachedState=model=>{
    const entry=cache[model.key];
    if(!entry)return;
    const age=Date.now()-(Number(entry.savedAt)||0);
    if(entry.found&&entry.itemId&&age<POSITIVE_TTL){
      model.state='found';model.itemId=entry.itemId;model.jellyfinName=entry.name||'';
    }else if(entry.found===false&&entry.definitive&&age<NEGATIVE_TTL){
      model.state='missing';
    }else{
      delete cache[model.key];
    }
  };
  const rememberFound=(model,itemId,name)=>{
    cache[model.key]={found:true,itemId,name:name||'',savedAt:Date.now()};
    writeCache(cache);
  };
  const rememberMissing=model=>{
    cache[model.key]={found:false,definitive:true,savedAt:Date.now()};
    writeCache(cache);
  };

  const requestFor=model=>({
    key:model.key,title:model.title,year:model.year,
    imdbId:model.imdbId,tmdbId:model.tmdbId
  });
  const commandUrl=model=>{
    const q=new URLSearchParams(requestFor(model));
    [...q.entries()].forEach(([k,v])=>{if(!v)q.delete(k)});
    return 'selectiontv://open?'+q.toString();
  };

  const stateLabel=model=>{
    if(model.state==='found')return 'Dans Jellyfin';
    if(model.state==='missing')return 'Pas dans Jellyfin';
    if(model.state==='checking')return 'Analyse…';
    if(model.state==='queued')return 'À vérifier';
    return 'À vérifier';
  };
  const updateTile=model=>{
    if(!model.tile)return;
    const state=model.tile.querySelector('.stv-tv-state');
    state.className='stv-tv-state '+(model.state==='found'?'found':model.state==='missing'?'missing':model.state==='checking'?'checking':'');
    state.textContent=stateLabel(model);
    if(current===model)renderInfo(model);
  };
  const infoClass=model=>model.state==='found'?'found':model.state==='missing'?'missing':model.state==='checking'?'checking':'';
  const positionInfo=()=>{
    if(!current?.tile)return;
    const panel=document.querySelector('.stv-tv-info');if(!panel)return;
    const r=current.tile.getBoundingClientRect();
    const gap=14;
    const margin=12;
    const pw=panel.offsetWidth||360;
    const ph=panel.offsetHeight||220;
    let left=r.right+gap;
    if(left+pw>window.innerWidth-margin)left=r.left-pw-gap;
    left=Math.max(margin,Math.min(left,window.innerWidth-pw-margin));
    let top=r.top;
    top=Math.max(margin,Math.min(top,window.innerHeight-ph-margin));
    panel.style.left=Math.round(left)+'px';
    panel.style.top=Math.round(top)+'px';
  };
  const renderInfo=model=>{
    const panel=document.querySelector('.stv-tv-info');if(!panel||!model)return;
    panel.querySelector('.stv-tv-info-title').textContent=model.title;
    panel.querySelector('.stv-tv-info-meta').textContent=model.meta.join(' · ');
    const badges=panel.querySelector('.stv-tv-info-badges');badges.textContent='';
    model.ratings.forEach(t=>{
      const b=document.createElement('span');b.className='stv-tv-info-badge';b.textContent=t;badges.append(b);
    });
    const jf=document.createElement('span');jf.className='stv-tv-info-badge '+infoClass(model);
    jf.textContent=stateLabel(model);badges.append(jf);
    panel.querySelector('.stv-tv-info-desc').textContent=model.description||'';
    panel.querySelector('.stv-tv-info-hint').textContent=model.state==='found'
      ? 'OK : ouvrir la fiche Jellyfin'
      : model.state==='missing'
        ? 'OK : relancer une recherche Jellyfin'
        : 'OK : rechercher dans Jellyfin';
    panel.classList.add('visible');
    requestAnimationFrame(positionInfo);
  };

  const renderStatus=()=>{
    const found=models.filter(x=>x.state==='found').length;
    const missing=models.filter(x=>x.state==='missing').length;
    const unresolved=models.filter(x=>x.state==='unknown'||x.state==='queued'||x.state==='checking').length;
    const el=document.querySelector('.stv-tv-statusbar');
    if(!el)return;
    el.innerHTML=libraryReady
      ? '<strong>Jellyfin</strong> · '+found+' présents · '+missing+' absents'+(unresolved?' · '+unresolved+' en cours':'')+(libraryCount?' · '+libraryCount+' éléments indexés':'')
      : '<strong>Jellyfin</strong> · préparation de la bibliothèque…';
  };

  const manualOpen=model=>{
    if(model.state==='found'&&model.itemId){
      try{window.SelectionTvAndroid?.openItem?.(String(model.itemId));return}catch{}
    }
    model.state='checking';updateTile(model);renderStatus();
    location.href=commandUrl(model);
  };

  const revealTile=model=>{
    const r=model.tile.getBoundingClientRect();
    const safeTop=44;
    const safeBottom=window.innerHeight-28;
    let delta=0;
    if(r.top<safeTop)delta=r.top-safeTop;
    else if(r.bottom>safeBottom)delta=r.bottom-safeBottom;
    if(Math.abs(delta)>1)window.scrollBy(0,Math.round(delta));
  };
  const focusModel=model=>{
    if(!model)return;
    if(current!==model){
      current?.tile?.classList.remove('is-focused');
      current=model;
      model.tile.classList.add('is-focused');
    }
    try{model.tile.focus({preventScroll:true})}catch{try{model.tile.focus()}catch{}}
    revealTile(model);
    renderInfo(model);
    requestAnimationFrame(positionInfo);
  };

  const visibleTiles=()=>models.filter(m=>m.tile&&m.tile.offsetParent!==null);
  const spatialMove=dir=>{
    if(!current){focusModel(models[0]);return true}
    const cr=current.tile.getBoundingClientRect();
    const cx=cr.left+cr.width/2,cy=cr.top+cr.height/2;
    let best=null,bestScore=Infinity;
    for(const model of visibleTiles()){
      if(model===current)continue;
      const r=model.tile.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      const dx=x-cx,dy=y-cy;
      let primary=0,secondary=0,ok=false;
      if(dir==='left'){ok=dx<-8;primary=-dx;secondary=Math.abs(dy)}
      else if(dir==='right'){ok=dx>8;primary=dx;secondary=Math.abs(dy)}
      else if(dir==='up'){ok=dy<-8;primary=-dy;secondary=Math.abs(dx)}
      else if(dir==='down'){ok=dy>8;primary=dy;secondary=Math.abs(dx)}
      if(!ok)continue;
      const score=primary+secondary*(dir==='up'||dir==='down'?4.2:3.2);
      if(score<bestScore){bestScore=score;best=model}
    }
    if(best)focusModel(best);
    return true;
  };

  let navLockedUntil=0;
  window.SelectionTvTvRemote=command=>{
    const now=performance.now();
    if(['left','right','up','down'].includes(command)){
      if(now<navLockedUntil)return true;
      navLockedUntil=now+110;
      return spatialMove(command);
    }
    if(command==='activate'||command==='center'||command==='enter'){
      if(current)manualOpen(current);else if(models[0])focusModel(models[0]);
      return true;
    }
    if(command==='first'){focusModel(models[0]);return true}
    return false;
  };
  document.addEventListener('keydown',e=>{
    const map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Enter:'activate',' ':'activate'};
    const c=map[e.key];if(!c)return;
    if(window.SelectionTvTvRemote(c)){e.preventDefault();e.stopPropagation()}
  },true);
  window.addEventListener('scroll',()=>{if(current)requestAnimationFrame(positionInfo)},{passive:true});
  window.addEventListener('resize',()=>{if(current)requestAnimationFrame(positionInfo)});

  const makeTile=model=>{
    const b=document.createElement('button');b.type='button';b.className='stv-tv-tile';b.tabIndex=-1;
    const wrap=document.createElement('div');wrap.className='stv-tv-poster-wrap';
    if(model.image){
      const img=document.createElement('img');img.className='stv-tv-poster';img.src=model.image;img.alt='';img.loading='lazy';
      img.onerror=()=>{
        if(model.imageFallback&&img.src!==model.imageFallback){
          img.src=model.imageFallback;
          return;
        }
        img.remove();
        const p=document.createElement('div');p.className='stv-tv-placeholder';p.textContent=model.title;wrap.prepend(p);
      };
      wrap.append(img);
    }else{
      const p=document.createElement('div');p.className='stv-tv-placeholder';p.textContent=model.title;wrap.append(p);
    }
    const st=document.createElement('span');st.className='stv-tv-state';st.textContent=stateLabel(model);wrap.append(st);
    const title=document.createElement('div');title.className='stv-tv-tile-title';title.textContent=model.title;
    b.append(wrap,title);
    b.onclick=()=>{focusModel(model);manualOpen(model)};
    b.onfocus=()=>{if(current!==model)focusModel(model)};
    model.tile=b;updateTile(model);
    return b;
  };

  const buildShell=()=>{
    const shell=document.createElement('main');shell.className='stv-tv-shell';

    const status=document.createElement('div');status.className='stv-tv-statusbar';
    shell.append(status);

    rows.forEach(row=>{
      const section=document.createElement('section');section.className='stv-tv-row';row.section=section;
      const h=document.createElement('h2');h.className='stv-tv-row-title';h.textContent=row.title;section.append(h);
      const grid=document.createElement('div');grid.className='stv-tv-grid';row.grid=grid;
      row.models.forEach(m=>{m.row=row;grid.append(makeTile(m))});
      section.append(grid);shell.append(section);
    });

    const panel=document.createElement('aside');panel.className='stv-tv-info';
    panel.innerHTML='<h3 class="stv-tv-info-title"></h3>'+
      '<div class="stv-tv-info-meta"></div><div class="stv-tv-info-badges"></div>'+
      '<div class="stv-tv-info-desc"></div><div class="stv-tv-info-hint"></div>';
    shell.append(panel);

    document.body.append(shell);
    renderStatus();
    if(models[0])setTimeout(()=>focusModel(models[0]),80);
  };

  const queueQuick=model=>{
    if(model.state==='found'||model.state==='missing'||model._queued)return;
    model._queued=true;quickQueue.push(model);pumpQuick();
  };
  const pumpQuick=()=>{
    if(!libraryReady)return;
    while(quickInflight<QUICK_CONCURRENCY&&quickQueue.length){
      const model=quickQueue.shift();if(!model)continue;
      quickInflight++;model.state='checking';updateTile(model);renderStatus();
      try{window.SelectionTvAndroid?.lookupQuick?.(JSON.stringify(requestFor(model)))}
      catch{quickInflight--;model.state='unknown';updateTile(model);queueDeep(model)}
    }
    if(quickInflight===0&&quickQueue.length===0)pumpDeep();
  };

  const queueDeep=model=>{
    if(!model||model.state==='found'||model.state==='missing'||model._deepQueued||deepActive.has(model.key))return;
    model._deepQueued=true;
    model.state='queued';
    updateTile(model);renderStatus();
    deepQueue.push(model);
    pumpDeep();
  };
  const pumpDeep=()=>{
    if(!libraryReady||quickInflight>0||quickQueue.length>0)return;
    while(deepInflight<DEEP_CONCURRENCY&&deepQueue.length){
      const model=deepQueue.shift();if(!model)continue;
      if(model.state==='found'||model.state==='missing')continue;
      deepInflight++;deepActive.add(model.key);
      model.state='checking';updateTile(model);renderStatus();
      try{window.SelectionTvAndroid?.lookup?.(JSON.stringify(requestFor(model)))}
      catch{
        deepActive.delete(model.key);deepInflight=Math.max(0,deepInflight-1);
        model.state='unknown';updateTile(model);renderStatus();
      }
    }
  };

  window.SelectionTvAndroidLibraryReady=count=>{
    libraryReady=true;libraryCount=Number(count)||0;renderStatus();
    models.forEach(queueQuick);pumpQuick();
  };
  window.SelectionTvAndroidResult=result=>{
    if(typeof result==='string'){try{result=JSON.parse(result)}catch{return}}
    const model=byKey.get(result?.key);if(!model)return;

    if(result.quick)quickInflight=Math.max(0,quickInflight-1);
    if(deepActive.delete(model.key))deepInflight=Math.max(0,deepInflight-1);

    if(result.error){
      model.state='unknown';
    }else if(result.found){
      model.state='found';model.itemId=result.itemId||'';model.jellyfinName=result.name||'';
      rememberFound(model,model.itemId,model.jellyfinName);
    }else if(result.quick){
      model.state='queued';
      queueDeep(model);
    }else{
      model.state='missing';
      rememberMissing(model);
    }

    if(Number.isFinite(Number(result.libraryCount)))libraryCount=Number(result.libraryCount);
    updateTile(model);renderStatus();pumpQuick();pumpDeep();
  };
  window.SelectionTvAndroidOpenResult=result=>{
    if(typeof result==='string'){try{result=JSON.parse(result)}catch{return}}
    const model=byKey.get(result?.key);if(!model)return;
    if(result.error){model.state='unknown'}
    else if(result.found){
      model.state='found';model.itemId=result.itemId||'';rememberFound(model,model.itemId,'');
    }else{
      model.state='missing';rememberMissing(model);
    }
    updateTile(model);renderStatus();
  };

  Promise.all([worksPromise,linksPromise]).then(([wd,ld])=>{
    works=new Map((wd.works||[]).filter(w=>w?.title).map(w=>[norm(w.title),w]));
    links=new Map(Object.entries(ld.links||{}).map(([k,v])=>[norm(k),v]));

    const originals=[...document.querySelectorAll(SELECTOR)];
    const grouped=new Map();
    originals.forEach(source=>{
      const title=titleOf(source);if(!title)return;
      const year=yearFor(source,title),ids=idsFor(title);
      const key=cacheKeyFor(title,year,ids);
      let model=byKey.get(key);
      if(!model){
        const work=works.get(norm(title))||{};
        const sourceImage=imageOf(source);
        model={
          key,title,year,imdbId:ids.imdbId,tmdbId:ids.tmdbId,
          image:sourceImage||work.image||'',
          imageFallback:sourceImage&&work.image&&sourceImage!==work.image?work.image:'',
          meta:metaTexts(source),ratings:ratingsOf(source),
          description:descOf(source),state:'unknown',itemId:'',source
        };
        loadCachedState(model);
        byKey.set(key,model);models.push(model);
      }
      const page=source.closest('.page')||document.body;
      if(!model._grouped){
        model._grouped=true;
        if(!grouped.has(page))grouped.set(page,[]);
        grouped.get(page).push(model);
      }
    });

    rows=[...grouped.entries()].map(([page,list])=>({title:groupTitle(page),models:list})).filter(r=>r.models.length);
    buildShell();

    const readyPoll=setInterval(()=>{
      try{
        if(window.SelectionTvAndroid?.isLibraryReady?.()===true){
          clearInterval(readyPoll);
          window.SelectionTvAndroidLibraryReady(libraryCount||0);
        }
      }catch{}
    },500);
  });
})();