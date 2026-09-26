(()=>{
  if(new URLSearchParams(location.search).get('tv')!=='1')return;

  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const SELECTOR='article.week-card,article.feature,article.list-card,article.platform:not(.jellyfin-private-upload),article.release-card,article.expire-card,article.radar-card,article.torrent-card,table.schedule tbody tr';
  const CACHE_KEY='selectionTv_androidtv_matches_v2';
  const POSITIVE_TTL=30*24*60*60*1000;
  const NEGATIVE_TTL=6*60*60*1000;
  const QUICK_CONCURRENCY=4;

  document.documentElement.classList.add('android-tv-mode');
  document.body.classList.add('android-tv-mode');

  const style=document.createElement('style');
  style.textContent=`
    html.android-tv-mode,body.android-tv-mode{
      margin:0!important;background:#0d1117!important;color:#f4f0e8!important;
      font-family:Arial,Helvetica,sans-serif!important;scroll-behavior:smooth
    }
    body.android-tv-mode .book,body.android-tv-mode>.toolbar{display:none!important}
    .stv-tv-shell{min-height:100vh;background:#0d1117;padding-bottom:52px}
    .stv-tv-hero{
      position:sticky;top:0;z-index:20;
      min-height:250px;padding:24px 52px 22px;
      background:linear-gradient(180deg,rgba(13,17,23,.99),rgba(17,23,32,.98));
      border-bottom:1px solid #343c48;
      box-shadow:0 8px 22px rgba(0,0,0,.32)
    }
    .stv-tv-hero-top{display:flex;align-items:center;gap:12px;min-height:28px;margin-bottom:12px}
    .stv-tv-status{font:14px/1.3 Arial,sans-serif;color:#9fa8b4}
    .stv-tv-status strong{color:#e9eef5}
    .stv-tv-hero-title{
      margin:0 0 8px;font:600 clamp(30px,3vw,46px)/1.03 Georgia,serif;color:#fff
    }
    .stv-tv-meta{font:15px/1.4 Arial,sans-serif;color:#c2c7cd;margin-bottom:8px}
    .stv-tv-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 10px}
    .stv-tv-badge{
      display:inline-flex;align-items:center;min-height:27px;padding:4px 8px;
      border:1px solid #657080;background:#202733;color:#f1eee8;
      font:700 13px/1 Arial,sans-serif
    }
    .stv-tv-badge.jellyfin-found{border-color:#618c71;background:#20392a;color:#e9f7ed}
    .stv-tv-badge.jellyfin-missing{border-color:#5b6067;background:#20252b;color:#aeb4ba}
    .stv-tv-badge.jellyfin-checking{border-color:#806f4e;background:#3a3121;color:#f0dfb5}
    .stv-tv-description{
      max-width:1250px;max-height:118px;overflow:hidden;
      font:17px/1.42 Georgia,serif;color:#ddd7cd
    }
    .stv-tv-hint{margin-top:10px;font:13px/1.3 Arial,sans-serif;color:#8e98a4}
    .stv-tv-row{padding:24px 52px 8px}
    .stv-tv-row-title{
      margin:0 0 12px;font:700 20px/1.2 Arial,sans-serif;color:#fff;letter-spacing:.01em
    }
    .stv-tv-strip{
      display:flex;gap:18px;overflow-x:hidden;overflow-y:visible;
      padding:8px 8px 18px;scroll-behavior:smooth
    }
    .stv-tv-tile{
      position:relative;flex:0 0 174px;width:174px;min-height:302px;
      padding:0;border:0;border-radius:5px;background:#171d26;color:#fff;
      text-align:left;outline:none;overflow:visible;
      transition:transform .13s ease,box-shadow .13s ease,background .13s ease
    }
    .stv-tv-poster-wrap{
      position:relative;width:100%;aspect-ratio:2/3;background:#252c35;
      border-radius:5px;overflow:hidden
    }
    .stv-tv-poster{width:100%;height:100%;object-fit:cover;display:block}
    .stv-tv-placeholder{
      width:100%;height:100%;display:flex;align-items:flex-end;
      padding:14px;box-sizing:border-box;
      font:700 18px/1.15 Georgia,serif;background:#252c35;color:#e8e3da
    }
    .stv-tv-state{
      position:absolute;left:7px;bottom:7px;z-index:3;
      padding:5px 7px;border-radius:3px;
      font:700 11px/1 Arial,sans-serif;
      background:rgba(25,31,38,.94);border:1px solid #66707c;color:#dde3e8
    }
    .stv-tv-state.found{background:rgba(31,67,45,.95);border-color:#77a187;color:#f1fff5}
    .stv-tv-state.missing{background:rgba(37,42,48,.95);border-color:#5c6268;color:#aeb4ba}
    .stv-tv-state.checking{background:rgba(63,52,31,.96);border-color:#8a744c;color:#f4dfb3}
    .stv-tv-tile-title{
      padding:9px 3px 0;font:700 15px/1.18 Arial,sans-serif;color:#f2eee7;
      display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden
    }
    .stv-tv-tile.is-focused{
      transform:scale(1.075);z-index:10;
      box-shadow:0 0 0 5px #fff,0 0 0 9px #54718c,0 14px 30px rgba(0,0,0,.45);
      background:#253443
    }
    .stv-tv-tile.is-focused .stv-tv-tile-title{color:#fff}
    @media(max-width:1300px){
      .stv-tv-hero{padding-left:38px;padding-right:38px}
      .stv-tv-row{padding-left:38px;padding-right:38px}
      .stv-tv-tile{flex-basis:158px;width:158px;min-height:278px}
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
  let libraryReady=false,libraryCount=0,quickInflight=0;
  const quickQueue=[];
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
      const t=clean(x.textContent);
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
    if(model.state==='checking')return 'Vérification…';
    return 'À vérifier';
  };
  const updateTile=model=>{
    if(!model.tile)return;
    const state=model.tile.querySelector('.stv-tv-state');
    state.className='stv-tv-state '+(model.state==='found'?'found':model.state==='missing'?'missing':model.state==='checking'?'checking':'');
    state.textContent=stateLabel(model);
    if(current===model)renderHero(model);
  };
  const renderHero=model=>{
    if(!model)return;
    document.querySelector('.stv-tv-hero-title').textContent=model.title;
    document.querySelector('.stv-tv-meta').textContent=model.meta.join(' · ');
    const badges=document.querySelector('.stv-tv-badges');badges.textContent='';
    model.ratings.forEach(t=>{
      const b=document.createElement('span');b.className='stv-tv-badge';b.textContent=t;badges.append(b);
    });
    const jf=document.createElement('span');
    jf.className='stv-tv-badge '+(model.state==='found'?'jellyfin-found':model.state==='missing'?'jellyfin-missing':'jellyfin-checking');
    jf.textContent=stateLabel(model);badges.append(jf);
    document.querySelector('.stv-tv-description').textContent=model.description||'';
    document.querySelector('.stv-tv-hint').textContent=model.state==='found'
      ? 'OK : ouvrir directement la fiche Jellyfin'
      : model.state==='missing'
        ? 'Œuvre non trouvée lors de la dernière recherche Jellyfin'
        : 'OK : lancer une recherche Jellyfin ciblée';
  };
  const renderStatus=()=>{
    const found=models.filter(x=>x.state==='found').length;
    const unresolved=models.filter(x=>x.state==='unknown'||x.state==='checking').length;
    const el=document.querySelector('.stv-tv-status');
    if(!el)return;
    el.innerHTML=libraryReady
      ? '<strong>Jellyfin</strong> · '+found+' dans la bibliothèque'+(unresolved?' · '+unresolved+' à vérifier':'')+(libraryCount?' · '+libraryCount+' éléments indexés':'')
      : '<strong>Jellyfin</strong> · préparation de la bibliothèque…';
  };

  const manualOpen=model=>{
    if(model.state==='found'&&model.itemId){
      try{window.SelectionTvAndroid?.openItem?.(String(model.itemId));return}catch{}
    }
    model.state='checking';updateTile(model);renderStatus();
    location.href=commandUrl(model);
  };

  const focusModel=model=>{
    if(!model||model===current)return;
    current?.tile?.classList.remove('is-focused');
    current=model;
    model.tile.classList.add('is-focused');
    try{model.tile.focus({preventScroll:true})}catch{model.tile.focus()}
    model.tile.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
    const row=model.row.section;
    const hero=document.querySelector('.stv-tv-hero');
    const r=row.getBoundingClientRect(),h=hero.getBoundingClientRect().height;
    if(r.top<h+8||r.bottom>window.innerHeight-10){
      const delta=r.top-(h+14);
      try{window.scrollBy({top:delta,left:0,behavior:'smooth'})}catch{window.scrollBy(0,delta)}
    }
    renderHero(model);
  };

  const move=(dir)=>{
    if(!current){focusModel(models[0]);return true}
    const row=current.row,idx=row.models.indexOf(current),ri=rows.indexOf(row);
    if(dir==='left'&&idx>0){focusModel(row.models[idx-1]);return true}
    if(dir==='right'&&idx<row.models.length-1){focusModel(row.models[idx+1]);return true}
    if(dir==='up'&&ri>0){
      const target=rows[ri-1];
      focusModel(target.models[Math.min(idx,target.models.length-1)]);return true;
    }
    if(dir==='down'&&ri<rows.length-1){
      const target=rows[ri+1];
      focusModel(target.models[Math.min(idx,target.models.length-1)]);return true;
    }
    return true;
  };
  window.SelectionTvTvRemote=command=>{
    if(command==='activate'||command==='center'||command==='enter'){
      if(current)manualOpen(current);else if(models[0])focusModel(models[0]);
      return true;
    }
    if(['left','right','up','down'].includes(command))return move(command);
    if(command==='first'){focusModel(models[0]);return true}
    return false;
  };
  document.addEventListener('keydown',e=>{
    const map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Enter:'activate',' ':'activate'};
    const c=map[e.key];if(!c)return;
    if(window.SelectionTvTvRemote(c)){e.preventDefault();e.stopPropagation()}
  },true);

  const makeTile=model=>{
    const b=document.createElement('button');b.type='button';b.className='stv-tv-tile';b.tabIndex=-1;
    const wrap=document.createElement('div');wrap.className='stv-tv-poster-wrap';
    if(model.image){
      const img=document.createElement('img');img.className='stv-tv-poster';img.src=model.image;img.alt='';img.loading='lazy';
      img.onerror=()=>{img.remove();const p=document.createElement('div');p.className='stv-tv-placeholder';p.textContent=model.title;wrap.prepend(p)};
      wrap.append(img);
    }else{
      const p=document.createElement('div');p.className='stv-tv-placeholder';p.textContent=model.title;wrap.append(p);
    }
    const st=document.createElement('span');st.className='stv-tv-state';st.textContent=stateLabel(model);wrap.append(st);
    const title=document.createElement('div');title.className='stv-tv-tile-title';title.textContent=model.title;
    b.append(wrap,title);
    b.onclick=()=>{focusModel(model);manualOpen(model)};
    b.onfocus=()=>focusModel(model);
    model.tile=b;updateTile(model);
    return b;
  };

  const buildShell=()=>{
    const shell=document.createElement('main');shell.className='stv-tv-shell';
    const hero=document.createElement('section');hero.className='stv-tv-hero';
    hero.innerHTML='<div class="stv-tv-hero-top"><div class="stv-tv-status"></div></div>'+
      '<h1 class="stv-tv-hero-title"></h1><div class="stv-tv-meta"></div>'+
      '<div class="stv-tv-badges"></div><div class="stv-tv-description"></div><div class="stv-tv-hint"></div>';
    shell.append(hero);

    rows.forEach(row=>{
      const section=document.createElement('section');section.className='stv-tv-row';row.section=section;
      const h=document.createElement('h2');h.className='stv-tv-row-title';h.textContent=row.title;section.append(h);
      const strip=document.createElement('div');strip.className='stv-tv-strip';row.strip=strip;
      row.models.forEach(m=>{m.row=row;strip.append(makeTile(m))});
      section.append(strip);shell.append(section);
    });

    document.body.append(shell);
    renderStatus();
    if(models[0])setTimeout(()=>focusModel(models[0]),100);
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
      catch{quickInflight--;model.state='unknown';updateTile(model)}
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
    if(result.error){
      model.state='unknown';
    }else if(result.found){
      model.state='found';model.itemId=result.itemId||'';model.jellyfinName=result.name||'';
      rememberFound(model,model.itemId,model.jellyfinName);
    }else{
      // A quick miss only means "not proven by provider/title index".
      // Keep it manually searchable instead of declaring it absent.
      model.state=result.quick?'unknown':'missing';
      if(!result.quick)rememberMissing(model);
    }
    if(Number.isFinite(Number(result.libraryCount)))libraryCount=Number(result.libraryCount);
    updateTile(model);renderStatus();pumpQuick();
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
        model={
          key,title,year,imdbId:ids.imdbId,tmdbId:ids.tmdbId,
          image:imageOf(source),meta:metaTexts(source),ratings:ratingsOf(source),
          description:descOf(source),state:'unknown',itemId:'',source
        };
        loadCachedState(model);
        byKey.set(key,model);models.push(model);
      }
      const page=source.closest('.page')||document.body;
      if(!grouped.has(page))grouped.set(page,[]);
      if(!grouped.get(page).includes(model))grouped.get(page).push(model);
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