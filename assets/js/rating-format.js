(()=>{
  const publishers={
    imdb:['IMDb','imdb'],senscritique:['SensCritique','sc'],sc:['SensCritique','sc'],
    rotten_tomatoes:['Rotten Tomatoes','rottentomatoes'],rottentomatoes:['Rotten Tomatoes','rottentomatoes'],
    allocine_presse:['AlloCiné presse','allocine-presse'],allocine_press:['AlloCiné presse','allocine-presse'],
    allocine_spectateurs:['AlloCiné spectateurs','allocine-spectateurs'],metacritic:['Metacritic','metacritic'],
    metascore:['Metascore','metascore'],audience:['Audience','audience'],cinemascore:['CinemaScore','cinemascore'],
    filmrezensionen:['Filmrezensionen','filmrezensionen']
  };
  const aliases={senscritique:['sc','senscritique'],sc:['sc','senscritique'],
    rotten_tomatoes:['rotten_tomatoes','rottentomatoes'],rottentomatoes:['rottentomatoes','rotten_tomatoes'],
    allocine_presse:['allocine_presse','allocine_press','allocine'],allocine_press:['allocine_press','allocine_presse','allocine'],
    allocine_spectateurs:['allocine_spectateurs','allocine'],metascore:['metascore','metacritic']};
  // Saved scores may already include their scale and review count. Add /10 only
  // to legacy bare IMDb/SensCritique numbers, never to another publisher.
  const entries=(ratings,links={})=>{
    const out=[],seen=new Set();
    for(const [key,value] of Object.entries(ratings||{})){
      if(typeof value!=='string'&&typeof value!=='number')continue;
      const score=String(value).replace(/\s+/g,' ').trim();if(!score)continue;
      const [publisher,className]=publishers[key]||[key,key.replace(/[^a-z0-9_-]/gi,'-')];
      const scale=['imdb','senscritique','sc'].includes(key)&&/^\d+(?:[.,]\d+)?$/.test(score)?'/10':'';
      const label=publisher+' '+score+scale;if(seen.has(label))continue;seen.add(label);
      const url=(aliases[key]||[key]).map(alias=>links[alias]).find(Boolean)||'';
      out.push({key,publisher,label,className,url});
    }
    return out;
  };
  const labels=ratings=>entries(ratings).map(entry=>entry.label);
  const appendTo=(box,ratings,links)=>{
    for(const entry of entries(ratings,links)){
      const pill=document.createElement(entry.url?'a':'span');
      pill.className='rating-pill '+entry.className;pill.textContent=entry.label;
      if(entry.url){pill.href=entry.url;pill.target='_blank';pill.rel='noopener'}
      box.append(pill);
    }
    return box;
  };
  window.SelectionTVRatingFormat={entries,labels,appendTo};
})();
