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
    body.android-tv-mode .interest,body.android-tv-mode .deck{font-size:18px!important;line-height:1.46!important;color:#ddd7cd!important}
    body.android-tv-mode .work-meta,body.android-tv-mode .meta2,body.android-tv-mode .torrent-meta,
    body.android-tv-mode .slot,body.android-tv-mode .where,body.android-tv-mode .service{font-size:14px!important;line-height:1.4!important;color:#aaa59c!important}
    body.android-tv-mode .week-grid,body.android-tv-mode .week-grid-five,
    body.android-tv-mode .radar-grid,body.android-tv-mode .torrent-grid,
    body.android-tv-mode .feature-columns,body.android-tv-mode .hero-grid,
    body.android-tv-mode .list-2,body.android-tv-mode .platform-grid,
    body.android-tv-mode .release-grid{
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
      gap:36px 44px!important;
      align-items:start!important
    }
    body.android-tv-mode .week-card,body.android-tv-mode .feature,body.android-tv-mode .list-card,
    body.android-tv-mode .platform,body.android-tv-mode .release-card,body.android-tv-mode .radar-card,
    body.android-tv-mode .torrent-card{
      border-color:#47505d!important;
      padding:18px!important;
      min-width:0!important;
      height:auto!important;
      max-height:none!important;
      overflow:visible!important
    }
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
    body.android-tv-mode button.stv-tv-open:focus,
    body.android-tv-mode button.stv-tv-open.stv-tv-focused{
      outline:5px solid #fff;outline-offset:5px;background:#3a5870;
      transform:scale(1.04)
    }
    body.android-tv-mode button.stv-tv-open[data-state="found"]{border-color:#7fa48d;background:#284636}
    body.android-tv-mode button.stv-tv-open[data-state="missing"]{border-color:#8d7f69;background:#40372c}
    body.android-tv-mode{scroll-padding-top:28px;scroll-padding-bottom:40px}
    body.android-tv-mode .stv-tv-focusable{
      position:relative;outline:none!important;border-radius:5px;
      scroll-margin-top:28px;scroll-margin-bottom:40px;
      transition:transform .12s ease,box-shadow .12s ease,background .12s ease
    }
    body.android-tv-mode .stv-tv-focusable.stv-tv-card-focused,
    body.android-tv-mode .stv-tv-focusable:focus{
      box-shadow:inset 0 0 0 5px #fff,0 0 0 3px #3a5870!important;
      background:#17212c!important;z-index:3
    }
    body.android-tv-mode .stv-tv-focusable.stv-tv-card-focused button.stv-tv-open,
    body.android-tv-mode .stv-tv-focusable:focus button.stv-tv-open{
      background:#3a5870;border-color:#fff
    }
    body.android-tv-mode a{color:inherit!important;text-decoration:none!important}
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
  const results=new Map();
  const pending=new Set();
  const requests=new Map();
  const status=document.createElement('div');
  status.id='stv-tv-status';status.setAttribute('role','status');
  status.style.cssText='padding:16px 54px;background:#20303a;color:#fff;font:16px/1.5 Arial,sans-serif';
  const statusText=document.createElement('span');status.append(statusText);
  const retry=document.createElement('button');retry.type='button';retry.textContent='Réessayer';retry.className='stv-tv-open';retry.style.marginLeft='16px';retry.hidden=true;status.append(retry);
  document.body.prepend(status);
  let completed=0,found=0,failed=0,libraryCount=null,lastError='',timeout;
  const hasBridge=()=>typeof window.SelectionTvAndroid?.lookup==='function';
  const updateStatus=()=>{
    if(!hasBridge()){
      statusText.textContent='Connexion native Jellyfin indisponible dans cet écran.';retry.hidden=false;return;
    }
    const count=libraryCount===null?'':` · ${libraryCount} films et séries accessibles`;
    statusText.textContent=failed
      ? `Jellyfin : ${failed} recherche(s) en erreur${lastError?' ('+lastError+')':''}. Vérifiez la connexion au serveur.`
      : pending.size
        ? `Recherche dans Jellyfin… ${completed}/${sent.size}${count}`
        : `Jellyfin : ${found} œuvre(s) reconnue(s)${count}`;
    retry.hidden=pending.size>0||(!failed&&found>0);
  };
  const armTimeout=()=>{
    clearTimeout(timeout);
    timeout=setTimeout(()=>{
      if(pending.size){statusText.textContent='Jellyfin ne répond pas encore. Vous pouvez relancer la recherche.';retry.hidden=false}
    },45000);
  };
  updateStatus();
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
  const commandUrl=req=>{
    const q=new URLSearchParams();
    q.set('key',req.key);q.set('title',req.title);
    if(req.year)q.set('year',req.year);
    if(req.imdbId)q.set('imdbId',req.imdbId);
    if(req.tmdbId)q.set('tmdbId',req.tmdbId);
    return 'selectiontv://open?'+q.toString();
  };
  const ensureAction=(el,req)=>{
    let box=el.querySelector('.stv-tv-jellyfin');
    if(!box){
      box=document.createElement('div');box.className='stv-tv-jellyfin';
      const anchor=el.querySelector('.ratings')||el.querySelector('.work-meta,.meta2,.torrent-meta,.slot,.where,.service')||el.querySelector('h3');
      if(anchor)anchor.insertAdjacentElement('afterend',box);
      else (el.matches('tr')?(el.querySelector('.prog')||el.cells[0]):el).append(box);
    }
    let open=box.querySelector('button.stv-tv-open');
    if(!open){
      open=document.createElement('button');open.type='button';open.className='stv-tv-open';open.tabIndex=0;
      open.setAttribute('aria-label','Chercher cette œuvre dans Jellyfin');
      open.textContent='Chercher dans Jellyfin';
      box.append(open);
    }
    el.classList.add('stv-tv-focusable');
    el.tabIndex=0;
    el.setAttribute('role','button');
    el.setAttribute('aria-label',titleOf(el)+' — ouvrir dans Jellyfin');
    open.dataset.key=req.key;
    open.onclick=()=>{
      open.textContent='Recherche…';open.dataset.state='searching';
      const token=String(Date.now());open.dataset.lookupToken=token;
      setTimeout(()=>{
        if(open.dataset.lookupToken===token&&open.dataset.state==='searching'){
          open.textContent='Réessayer dans Jellyfin';
          open.dataset.state='';
        }
      },20000);
      location.href=commandUrl(req);
    };
    return {box,open};
  };
  const render=result=>{
    const nodes=keyNodes.get(result.key);if(!nodes)return;
    const req=requests.get(result.key);
    for(const el of nodes){
      const action=req?ensureAction(el,req):null;
      if(!action)continue;
      action.box.querySelector('.stv-tv-present')?.remove();
      if(result.found){
        const pill=document.createElement('span');pill.className='stv-tv-present';pill.textContent='Dans Jellyfin';
        action.box.insertBefore(pill,action.open);
        action.open.textContent='Ouvrir dans Jellyfin';action.open.dataset.state='found';
      }else{
        action.open.textContent='Chercher dans Jellyfin';action.open.dataset.state='';
      }
    }
  };

  window.SelectionTvAndroidResult=result=>{
    if(typeof result==='string'){try{result=JSON.parse(result)}catch{return}}
    if(!result?.key||!requests.has(result.key))return;
    if(pending.delete(result.key)){
      completed++;
      if(result.error){failed++;lastError=String(result.errorType||'')}
      else if(result.found)found++;
    }
    if(Number.isFinite(result.libraryCount))libraryCount=result.libraryCount;
    if(!result.error){results.set(result.key,result);render(result)}
    if(!pending.size)clearTimeout(timeout);
    updateStatus();
  };

  const queryElement=el=>{
    const title=titleOf(el);if(!title)return;
    const year=yearOf(el,title),ids=idsOf(title);
    const key=ids.imdbId?('imdb:'+ids.imdbId):ids.tmdbId?('tmdb:'+ids.tmdbId):('title:'+norm(title)+'|'+year);
    addNode(key,el);
    let req=requests.get(key);
    if(!req){
      req={requestId:++seq,key,title,year,imdbId:ids.imdbId,tmdbId:ids.tmdbId};
      requests.set(key,req);
    }
    ensureAction(el,req);
    if(results.has(key)){render(results.get(key));return}
    if(sent.has(key)||!hasBridge())return;
    sent.add(key);
    pending.add(key);updateStatus();armTimeout();
    try{window.SelectionTvAndroid.lookup(JSON.stringify(req))}
    catch{window.SelectionTvAndroidResult({key,error:true})}
  };

  window.SelectionTvAndroidOpenResult=result=>{
    if(typeof result==='string'){try{result=JSON.parse(result)}catch{return}}
    if(!result?.key)return;
    const nodes=keyNodes.get(result.key);if(!nodes)return;
    for(const el of nodes){
      const open=[...el.querySelectorAll('button.stv-tv-open')].find(x=>x.dataset.key===result.key)||el.querySelector('button.stv-tv-open');
      if(!open)continue;
      open.dataset.lookupToken='';
      if(result.error){
        open.textContent=result.errorType==='Timeout'?'Recherche trop longue — réessayer':'Réessayer dans Jellyfin';open.dataset.state='';
      }else if(result.found){
        open.textContent='Ouvrir dans Jellyfin';open.dataset.state='found';
      }else{
        open.textContent='Non trouvé dans Jellyfin';open.dataset.state='missing';
      }
    }
  };

  const focusableCards=()=>[...document.querySelectorAll('.stv-tv-focusable')].filter(el=>{
    const r=el.getBoundingClientRect();
    const cs=getComputedStyle(el);
    return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';
  });
  const revealCard=el=>{
    const r=el.getBoundingClientRect();
    const safeTop=28;
    const safeBottom=Math.max(safeTop+120,window.innerHeight-40);
    const available=safeBottom-safeTop;
    let delta=0;

    if(r.height<=available){
      if(r.top<safeTop)delta=r.top-safeTop;
      else if(r.bottom>safeBottom)delta=r.bottom-safeBottom;
    }else if(r.top<safeTop||r.top>safeTop+80){
      // Oversized card: anchor its beginning instead of centering it and cutting both ends.
      delta=r.top-safeTop;
    }

    if(Math.abs(delta)>1){
      try{window.scrollBy({top:delta,left:0,behavior:'smooth'})}
      catch{window.scrollBy(0,delta)}
    }
  };
  const focusCard=el=>{
    if(!el)return false;
    document.querySelectorAll('.stv-tv-card-focused').forEach(x=>x.classList.remove('stv-tv-card-focused'));
    document.querySelectorAll('.stv-tv-focused').forEach(x=>x.classList.remove('stv-tv-focused'));
    el.classList.add('stv-tv-card-focused');
    try{el.focus({preventScroll:true})}catch{try{el.focus()}catch{}}
    revealCard(el);
    return true;
  };
  const scrollInsideCurrentCard=(current,direction)=>{
    const r=current.getBoundingClientRect();
    const safeTop=28;
    const safeBottom=Math.max(safeTop+160,window.innerHeight-40);
    const step=Math.max(140,Math.floor((safeBottom-safeTop)*0.62));

    if(direction==='down'&&r.bottom>safeBottom+16){
      const amount=Math.min(step,r.bottom-safeBottom);
      try{window.scrollBy({top:amount,left:0,behavior:'smooth'})}
      catch{window.scrollBy(0,amount)}
      return true;
    }

    if(direction==='up'&&r.top<safeTop-16){
      const amount=Math.min(step,safeTop-r.top);
      try{window.scrollBy({top:-amount,left:0,behavior:'smooth'})}
      catch{window.scrollBy(0,-amount)}
      return true;
    }

    return false;
  };
  const moveFocus=direction=>{
    const controls=focusableCards();
    if(!controls.length)return false;
    let current=document.activeElement;
    if(!controls.includes(current)){
      current=controls.find(el=>el.getBoundingClientRect().top>=0)||controls[0];
      return focusCard(current);
    }

    if((direction==='down'||direction==='up')&&scrollInsideCurrentCard(current,direction))return true;

    const cr=current.getBoundingClientRect();
    const cx=cr.left+cr.width/2,cy=cr.top+cr.height/2;
    let best=null,bestScore=Infinity;
    for(const el of controls){
      if(el===current)continue;
      const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      const dx=x-cx,dy=y-cy;
      let primary,secondary,ok=false;
      if(direction==='right'){ok=dx>8;primary=dx;secondary=Math.abs(dy)}
      else if(direction==='left'){ok=dx<-8;primary=-dx;secondary=Math.abs(dy)}
      else if(direction==='down'){ok=dy>8;primary=dy;secondary=Math.abs(dx)}
      else if(direction==='up'){ok=dy<-8;primary=-dy;secondary=Math.abs(dx)}
      if(!ok)continue;
      const score=primary+(secondary*4.5);
      if(score<bestScore){bestScore=score;best=el}
    }

    if(!best){
      const i=controls.indexOf(current);
      if(direction==='down'||direction==='right')best=controls[Math.min(controls.length-1,i+1)];
      else best=controls[Math.max(0,i-1)];
    }
    return focusCard(best);
  };
  const activateFocused=()=>{
    const controls=focusableCards();
    const current=controls.includes(document.activeElement)?document.activeElement:controls[0];
    if(!current)return false;
    focusCard(current);
    const open=current.querySelector('button.stv-tv-open');
    if(!open)return false;
    open.click();
    return true;
  };
  window.SelectionTvTvRemote=command=>{
    if(command==='activate'||command==='center'||command==='enter')return activateFocused();
    if(['up','down','left','right'].includes(command))return moveFocus(command);
    if(command==='first')return focusCard(focusableCards()[0]);
    return false;
  };
  document.addEventListener('click',event=>{
    const card=event.target?.closest?.('.stv-tv-focusable');
    if(!card||event.target?.closest?.('button.stv-tv-open'))return;
    const open=card.querySelector('button.stv-tv-open');
    if(open)open.click();
  },true);

  document.addEventListener('keydown',event=>{
    const map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'activate',' ':'activate'};
    const command=map[event.key];
    if(!command)return;
    if(window.SelectionTvTvRemote(command)){
      event.preventDefault();
      event.stopPropagation();
    }
  },true);

  retry.onclick=()=>{
    sent.clear();pending.clear();results.clear();requests.clear();completed=0;found=0;failed=0;
    document.querySelectorAll(SELECTOR).forEach(queryElement);updateStatus();
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