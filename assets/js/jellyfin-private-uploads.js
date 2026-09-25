(function(){
  var CHILD_ORIGIN='https://kingrabbit89.github.io';
  var frame=document.getElementById('selectionTvFrame');
  var status=document.getElementById('selectionTvBridgeStatus');
  var privateTimer=null;
  var privateBusy=false;
  var lastPrivatePayload=null;
  var localSearchCache=new Map();

  if(!frame)return;

  function api(){
    if(window.ApiClient)return window.ApiClient;
    if(window.ServerConnections&&typeof window.ServerConnections.currentApiClient==='function'){
      return window.ServerConnections.currentApiClient();
    }
    return null;
  }

  function norm(s){
    return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  }

  function arr(v){ return Array.isArray(v)?v:[]; }

  function titleCandidates(title){
    var raw=String(title||'').trim();
    var out=[];
    function add(v){
      v=String(v||'').replace(/\s+/g,' ').trim().replace(/^[\-–—:;,\s]+|[\-–—:;,\s]+$/g,'');
      if(v&&out.map(norm).indexOf(norm(v))===-1)out.push(v);
    }
    add(raw);
    var par=[...raw.matchAll(/\(([^()]{2,100})\)/g)].map(function(m){return m[1]});
    par.forEach(add);
    add(raw.replace(/\s*\([^()]+\)\s*/g,' ').replace(/\s+/g,' '));
    if(/\s+-\s+/.test(raw))add(raw.split(/\s+-\s+/)[0]);
    return out.slice(0,4);
  }

  function pget(o,a,b){
    if(!o)return undefined;
    return o[a]!==undefined?o[a]:o[b];
  }

  function providerIds(item){
    return pget(item,'ProviderIds','providerIds')||{};
  }

  function providerLink(ids){
    ids=ids||{};
    var out={};
    var imdb=ids.Imdb||ids.IMDb||ids.imdb;
    var tmdb=ids.Tmdb||ids.TMDb||ids.tmdb;
    if(imdb)out.imdb='https://www.imdb.com/title/'+encodeURIComponent(String(imdb))+'/';
    if(tmdb)out.tmdb='https://www.themoviedb.org/movie/'+encodeURIComponent(String(tmdb));
    return out;
  }

  function qualityFromTopic(title){
    var t=String(title||'');
    var q=[];
    if(/\b(?:2160p|4k|uhd)\b/i.test(t))q.push('4K / UHD');
    else if(/\b1080p\b/i.test(t))q.push('1080p');
    else if(/\b720p\b/i.test(t))q.push('720p');
    if(/\bremux\b/i.test(t))q.push('Remux');
    if(/\b(?:dolby[ .-]?vision|\bdv\b)\b/i.test(t))q.push('Dolby Vision');
    else if(/\bhdr10\+?\b|\bhdr\b/i.test(t))q.push('HDR');
    return q.join(' · ');
  }

  async function localSearch(a,title,year){
    var candidates=titleCandidates(title);
    var cacheKey=candidates.map(norm).join('|')+'|'+String(year||'');
    if(localSearchCache.has(cacheKey))return localSearchCache.get(cacheKey);

    var promise=(async function(){
      var all=[];
      for(var ci=0;ci<candidates.length;ci++){
        try{
          var r=await a.getItems(a.getCurrentUserId(),{
            Recursive:true,
            IncludeItemTypes:'Movie',
            SearchTerm:candidates[ci],
            Fields:'ProviderIds,OriginalTitle,Genres,Overview,People',
            EnableTotalRecordCount:false,
            Limit:20
          });
          all=all.concat(pget(r,'Items','items')||[]);
        }catch(e){}
      }
      var seen={};
      all=all.filter(function(x){
        var id=x.Id||x.id||JSON.stringify([x.Name,x.ProductionYear]);
        if(seen[id])return false;seen[id]=1;return true;
      });
      var norms=candidates.map(norm);
      var scored=all.map(function(x){
        var names=[x.Name,x.name,x.OriginalTitle,x.originalTitle].filter(Boolean).map(norm);
        var y=Number(x.ProductionYear||x.productionYear)||0;
        var score=0;
        norms.forEach(function(nt,idx){
          if(names.indexOf(nt)!==-1)score=Math.max(score,110-idx*8);
          else if(names.some(function(n){return n.includes(nt)||nt.includes(n);}))score=Math.max(score,55-idx*5);
        });
        if(year&&y===Number(year))score+=35;
        else if(year&&y&&Math.abs(y-Number(year))<=1)score+=8;
        return {item:x,score:score};
      }).sort(function(a1,b1){return b1.score-a1.score;});
      return scored.length&&scored[0].score>=80?scored[0].item:null;
    })();

    localSearchCache.set(cacheKey,promise);
    return promise;
  }

  function directorOf(item){
    var people=arr(item.People||item.people);
    return people.filter(function(p){
      return String(p.Type||p.type||'').toLowerCase()==='director';
    }).map(function(p){
      return p.Name||p.name;
    }).filter(Boolean).join(', ');
  }

  function localImage(a,item){
    var tags=item.ImageTags||item.imageTags||{};
    if(!(tags.Primary||tags.primary))return '';
    try{
      return a.getImageUrl(item.Id||item.id,{type:'Primary',maxWidth:500,quality:90});
    }catch(e){
      return '';
    }
  }

  async function remoteSearch(a,title,year){
    var candidates=titleCandidates(title);
    var best=null,bestScore=-1;
    for(var ci=0;ci<candidates.length;ci++){
      try{
        var body={
          SearchInfo:{
            Name:candidates[ci],
            Year:year||null,
            MetadataLanguage:'fr',
            MetadataCountryCode:'FR',
            ProviderIds:{}
          },
          IncludeDisabledProviders:true
        };
        var results=await a.ajax({
          type:'POST',
          url:a.getUrl('Items/RemoteSearch/Movie'),
          data:JSON.stringify(body),
          contentType:'application/json',
          dataType:'json'
        });
        results=arr(results);
        var nt=norm(candidates[ci]);
        results.forEach(function(r){
          var score=0;
          var rn=norm(r.Name||r.name);
          var ry=Number(r.ProductionYear||r.productionYear)||0;
          if(rn===nt)score+=95-ci*6;
          else if(rn.includes(nt)||nt.includes(rn))score+=45-ci*4;
          if(year&&ry===Number(year))score+=35;
          else if(year&&ry&&Math.abs(ry-Number(year))<=1)score+=8;
          if(score>bestScore){bestScore=score;best=r;}
        });
      }catch(e){}
      if(bestScore>=120)break;
    }
    return bestScore>=50?best:null;
  }

  async function localSearchByProvider(a,remote,year){
    if(!remote)return null;
    var ids=providerIds(remote);
    var imdb=String(ids.Imdb||ids.IMDb||ids.imdb||'').toLowerCase();
    var tmdb=String(ids.Tmdb||ids.TMDb||ids.tmdb||'');
    var names=[remote.Name,remote.name,remote.OriginalTitle,remote.originalTitle].filter(Boolean);
    var all=[];

    for(var i=0;i<Math.min(names.length,3);i++){
      try{
        var r=await a.getItems(a.getCurrentUserId(),{
          Recursive:true,
          IncludeItemTypes:'Movie',
          SearchTerm:names[i],
          Fields:'ProviderIds,OriginalTitle,Genres,Overview,People',
          EnableTotalRecordCount:false,
          Limit:30
        });
        all=all.concat(pget(r,'Items','items')||[]);
      }catch(e){}
    }

    var exact=all.find(function(x){
      var p=providerIds(x);
      var xi=String(p.Imdb||p.IMDb||p.imdb||'').toLowerCase();
      var xt=String(p.Tmdb||p.TMDb||p.tmdb||'');
      return (imdb&&xi===imdb)||(tmdb&&xt===tmdb);
    });
    if(exact)return exact;

    var targetNames=names.map(norm);
    return all.find(function(x){
      var y=Number(x.ProductionYear||x.productionYear)||0;
      var n=[x.Name,x.name,x.OriginalTitle,x.originalTitle].filter(Boolean).map(norm);
      return (!year||!y||Math.abs(Number(year)-y)<=1)
        && n.some(function(v){return targetNames.indexOf(v)!==-1;});
    })||null;
  }

  async function publicEnrichment(a,title,year,director,topicTitle,ids){
    try{
      return await a.ajax({
        type:'POST',
        url:a.getUrl('SelectionTv/Enrich'),
        data:JSON.stringify({
          title:title,
          year:year||null,
          director:director||null,
          topicTitle:topicTitle||null,
          imdbId:(ids&&((ids.Imdb||ids.IMDb||ids.imdb)))||null
        }),
        contentType:'application/json',
        dataType:'json'
      });
    }catch(e){
      return {};
    }
  }

  async function enrichOne(upload){
    var a=api();
    var topicTitle=upload.topicTitle||upload.TopicTitle||'';
    var topicUrl=upload.topicUrl||upload.TopicUrl||'';
    var guess=upload.titleGuess||upload.TitleGuess||topicTitle;
    var year=Number(upload.year||upload.Year)||null;
    var activityAt=upload.activityAt||upload.ActivityAt||null;
    var author=upload.author||upload.Author||null;
    var directorGuess=upload.directorGuess||upload.DirectorGuess||null;
    var local=await localSearch(a,guess,year);
    var base=null,ids={};

    if(local){
      ids=providerIds(local);
      base={
        topicTitle:topicTitle,topicUrl:topicUrl,activityAt:activityAt,author:author,
        title:local.Name||local.name||guess,
        titleGuess:guess,
        year:local.ProductionYear||local.productionYear||year,
        director:directorOf(local),
        genre:arr(local.Genres||local.genres).join(' / '),
        overview:local.Overview||local.overview||'',
        image:localImage(a,local),
        links:providerLink(ids),
        quality:qualityFromTopic(topicTitle),
        jellyfinItemId:local.Id||local.id,
        workId:'',
        source:'library'
      };

      // The Selection TV iframe is HTTPS. A poster served by a local HTTP
      // Jellyfin server is blocked as mixed content, so prefer a public HTTPS
      // poster from Jellyfin's remote metadata providers when available.
      if(!/^https:/i.test(base.image||'')){
        var posterRemote=await remoteSearch(a,guess,year);
        if(posterRemote){
          var posterUrl=posterRemote.ImageUrl||posterRemote.imageUrl||'';
          if(/^https:/i.test(posterUrl))base.image=posterUrl;
          var posterIds=providerIds(posterRemote);
          ids={...posterIds,...ids};
          base.links={...providerLink(posterIds),...(base.links||{})};
        }
      }
    }else{
      var remote=await remoteSearch(a,guess,year);
      if(remote){
        var secondLocal=await localSearchByProvider(a,remote,year);
        if(secondLocal){
          local=secondLocal;
          ids=providerIds(local);
          base={
            topicTitle:topicTitle,topicUrl:topicUrl,activityAt:activityAt,author:author,
            title:local.Name||local.name||remote.Name||remote.name||guess,
            titleGuess:guess,
            year:local.ProductionYear||local.productionYear||remote.ProductionYear||remote.productionYear||year,
            director:directorOf(local),
            genre:arr(local.Genres||local.genres).join(' / '),
            overview:local.Overview||local.overview||remote.Overview||remote.overview||'',
            image:localImage(a,local),
            links:{...providerLink(providerIds(remote)),...providerLink(ids)},
            quality:qualityFromTopic(topicTitle),
            jellyfinItemId:local.Id||local.id,
            workId:'',
            source:'library',
            ratings:{jellyfin:(local.CommunityRating||local.communityRating||'')}
          };
          var secondPoster=remote.ImageUrl||remote.imageUrl||'';
          if(/^https:/i.test(secondPoster))base.image=secondPoster;
        }else{
          ids=providerIds(remote);
          base={
            topicTitle:topicTitle,topicUrl:topicUrl,activityAt:activityAt,author:author,
            title:remote.Name||remote.name||guess,
            titleGuess:guess,
            year:remote.ProductionYear||remote.productionYear||year,
            director:'',
            genre:'',
            overview:remote.Overview||remote.overview||'',
            image:remote.ImageUrl||remote.imageUrl||'',
            links:providerLink(ids),
            quality:qualityFromTopic(topicTitle),
            jellyfinItemId:'',
            workId:'',
            source:'remote'
          };
        }
      }else{
        base={
          topicTitle:topicTitle,topicUrl:topicUrl,activityAt:activityAt,author:author,
          title:titleCandidates(guess)[0]||guess,titleGuess:guess,year:year,director:'',genre:'',overview:'',image:'',
          links:{},quality:qualityFromTopic(topicTitle),jellyfinItemId:'',workId:'',source:'unresolved'
        };
      }
    }

    var extra=await publicEnrichment(
      a,
      base.title||guess,
      base.year||year,
      base.director||directorGuess,
      topicTitle,
      ids
    );
    var exLinks=base.links||{};
    var strictImdb=extra.ImdbUrl||extra.imdbUrl;
    var strictSc=extra.SensCritiqueUrl||extra.sensCritiqueUrl;
    if(strictImdb)exLinks.imdb=strictImdb;
    if(strictSc)exLinks.sc=strictSc;
    base.links=exLinks;
    var strictImage=extra.ImageUrl||extra.imageUrl||'';
    if(/^https:/i.test(strictImage))base.image=strictImage;
    else if(/^http:/i.test(base.image||''))base.image='';
    if(base.source==='unresolved'&&(extra.MatchedTitle||extra.matchedTitle)){
      base.title=extra.MatchedTitle||extra.matchedTitle;
    }
    base.director=base.director||directorGuess||'';
    base.ratings={
      ...(base.ratings||{}),
      imdb:extra.ImdbRating||extra.imdbRating||'',
      senscritique:extra.SensCritiqueRating||extra.sensCritiqueRating||''
    };
    return base;
  }

  async function mapLimited(items,limit,fn){
    var out=new Array(items.length);
    var next=0;
    async function worker(){
      while(true){
        var i=next++;
        if(i>=items.length)return;
        out[i]=await fn(items[i],i);
      }
    }
    var workers=[];
    for(var n=0;n<Math.min(limit,items.length);n++)workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  function sendPrivate(payload){
    if(payload)lastPrivatePayload=payload;
    if(frame.contentWindow&&lastPrivatePayload){
      frame.contentWindow.postMessage(lastPrivatePayload,CHILD_ORIGIN);
    }
  }

  async function loadPrivateUploads(){
    if(privateBusy)return;
    var a=api();
    if(!a)return;
    privateBusy=true;
    try{
      var feed=await a.ajax({
        type:'GET',
        url:a.getUrl('SelectionTv/Uploads',{hours:24}),
        dataType:'json'
      });
      var sourceItems=arr(feed.Items||feed.items);

      // Show the private section immediately. Exact metadata enrichment can
      // take time for obscure films and must never hide the whole section.
      var provisional=sourceItems.map(function(upload){
        var topicTitle=upload.topicTitle||upload.TopicTitle||'';
        var guess=upload.titleGuess||upload.TitleGuess||topicTitle;
        return {
          topicTitle:topicTitle,
          topicUrl:upload.topicUrl||upload.TopicUrl||'',
          activityAt:upload.activityAt||upload.ActivityAt||null,
          author:upload.author||upload.Author||null,
          title:guess,
          titleGuess:guess,
          year:Number(upload.year||upload.Year)||null,
          director:upload.directorGuess||upload.DirectorGuess||'',
          genre:'',
          overview:'',
          image:'',
          links:{},
          ratings:{},
          quality:qualityFromTopic(topicTitle),
          jellyfinItemId:'',
          workId:'',
          source:'pending'
        };
      });

      sendPrivate({
        type:'selection-tv:jellyfin-private-uploads',
        version:2,
        phase:'provisional',
        generatedAt:feed.GeneratedAt||feed.generatedAt||new Date().toISOString(),
        windowHours:feed.WindowHours||feed.windowHours||24,
        items:provisional
      });

      if(status&&provisional.length){
        var initialBase=(status.textContent||'').replace(/ · uploads.*$/,'');
        status.textContent=initialBase+' · uploads '+provisional.length+' · enrichissement…';
      }

      var items=provisional.slice();
      var nextIndex=0;
      var completed=0;

      async function worker(){
        while(true){
          var i=nextIndex++;
          if(i>=sourceItems.length)return;
          try{
            items[i]=await enrichOne(sourceItems[i]);
          }catch(e){
            console.warn('Selection TV enrichment failed for item',i,e);
          }
          completed++;
          sendPrivate({
            type:'selection-tv:jellyfin-private-uploads',
            version:3,
            phase:completed===sourceItems.length?'enriched':'progress',
            completed:completed,
            total:sourceItems.length,
            generatedAt:feed.GeneratedAt||feed.generatedAt||new Date().toISOString(),
            windowHours:feed.WindowHours||feed.windowHours||24,
            items:items
          });
          if(status){
            var progressBase=(status.textContent||'').replace(/ · uploads.*$/,'');
            status.textContent=progressBase+' · uploads '+sourceItems.length+' · '+completed+'/'+sourceItems.length+' enrichis';
          }
        }
      }

      await Promise.all(Array.from({length:Math.min(4,sourceItems.length)},worker));

      if(status&&items.length){
        var base=(status.textContent||'').replace(/ · uploads.*$/,'');
        status.textContent=base+' · uploads '+items.length;
      }
    }catch(err){
      console.warn('Selection TV private uploads unavailable',err);
    }finally{
      privateBusy=false;
    }
  }

  function schedule(){
    clearInterval(privateTimer);
    privateTimer=setInterval(loadPrivateUploads,10*60*1000);
  }

  window.addEventListener('message',function(e){
    if(e.source!==frame.contentWindow||!e.data)return;
    if(e.data.type==='selection-tv:jellyfin-private-ready'){
      if(lastPrivatePayload)sendPrivate();
      else loadPrivateUploads();
    }
  });

  frame.addEventListener('load',function(){
    [250,900,2200].forEach(function(delay){
      setTimeout(function(){
        if(lastPrivatePayload)sendPrivate();
        else loadPrivateUploads();
      },delay);
    });
    schedule();
  });

  setTimeout(loadPrivateUploads,3200);
  schedule();
})();