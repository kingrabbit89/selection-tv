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
    if(!items.length)return;
    PARENT.postMessage({type:'selection-tv:jellyfin-query',version:1,items},'*');
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
          observer.unobserve(e.target);
          const info=infoFor(e.target);if(info){remember(info,e.target);batch.push(info)}
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
    if(e.data.type==='selection-tv:jellyfin-ready'){parentReady=true;scan(document)}
    if(e.data.type==='selection-tv:jellyfin-result'&&Array.isArray(e.data.items))e.data.items.forEach(render);
  });
})();