(function(){
  var CHILD_ORIGIN='https://kingrabbit89.github.io';
  var frame=document.getElementById('selectionTvFrame');
  var status=document.getElementById('selectionTvBridgeStatus');
  var privateTimer=null;
  var privateBusy=false;
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
    var key=norm(title)+'|'+String(year||'');
    if(localSearchCache.has(key))return localSearchCache.get(key);

    var promise=(async function(){
      try{
        var r=await a.getItems(a.getCurrentUserId(),{
          Recursive:true,
          IncludeItemTypes:'Movie',
          SearchTerm:title,
          Fields:'ProviderIds,OriginalTitle,Genres,Overview,People',
          EnableTotalRecordCount:false,
          Limit:20
        });
        var items=pget(r,'Items','items')||[];
        var nt=norm(title);
        var scored=items.map(function(x){
          var names=[x.Name,x.name,x.OriginalTitle,x.originalTitle].filter(Boolean).map(norm);
          var y=Number(x.ProductionYear||x.productionYear)||0;
          var score=0;
          if(names.indexOf(nt)!==-1)score+=100;
          else if(names.some(function(n){return n.includes(nt)||nt.includes(n);}))score+=40;
          if(year&&y===Number(year))score+=30;
          return {item:x,score:score};
        }).sort(function(a1,b1){return b1.score-a1.score;});
        return scored.length&&scored[0].score>=70?scored[0].item:null;
      }catch(e){
        return null;
      }
    })();

    localSearchCache.set(key,promise);
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
    if(!title)return null;
    try{
      var body={
        SearchInfo:{
          Name:title,
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
      if(!results.length)return null;
      var nt=norm(title);
      var scored=results.map(function(r){
        var score=0;
        var rn=norm(r.Name||r.name);
        var ry=Number(r.ProductionYear||r.productionYear)||0;
        if(rn===nt)score+=80;
        else if(rn.includes(nt)||nt.includes(rn))score+=35;
        if(year&&ry===Number(year))score+=30;
        return {r:r,score:score};
      }).sort(function(a1,b1){return b1.score-a1.score;});
      return scored[0].score>=35?scored[0].r:null;
    }catch(e){
      return null;
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
    var local=await localSearch(a,guess,year);

    if(local){
      var ids=providerIds(local);
      return {
        topicTitle:topicTitle,
        topicUrl:topicUrl,
        activityAt:activityAt,
        author:author,
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
    }

    var remote=await remoteSearch(a,guess,year);
    if(remote){
      var rids=providerIds(remote);
      return {
        topicTitle:topicTitle,
        topicUrl:topicUrl,
        activityAt:activityAt,
        author:author,
        title:remote.Name||remote.name||guess,
        titleGuess:guess,
        year:remote.ProductionYear||remote.productionYear||year,
        director:'',
        genre:'',
        overview:remote.Overview||remote.overview||'',
        image:remote.ImageUrl||remote.imageUrl||'',
        links:providerLink(rids),
        quality:qualityFromTopic(topicTitle),
        jellyfinItemId:'',
        workId:'',
        source:'remote'
      };
    }

    return {
      topicTitle:topicTitle,
      topicUrl:topicUrl,
      activityAt:activityAt,
      author:author,
      title:guess,
      titleGuess:guess,
      year:year,
      director:'',
      genre:'',
      overview:'',
      image:'',
      links:{},
      quality:qualityFromTopic(topicTitle),
      jellyfinItemId:'',
      workId:'',
      source:'unresolved'
    };
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
    if(frame.contentWindow)frame.contentWindow.postMessage(payload,CHILD_ORIGIN);
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
      var items=await mapLimited(sourceItems,3,enrichOne);
      sendPrivate({
        type:'selection-tv:jellyfin-private-uploads',
        version:1,
        generatedAt:feed.GeneratedAt||feed.generatedAt||new Date().toISOString(),
        windowHours:feed.WindowHours||feed.windowHours||24,
        items:items
      });
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

  frame.addEventListener('load',function(){
    setTimeout(loadPrivateUploads,2400);
    schedule();
  });

  setTimeout(loadPrivateUploads,3200);
  schedule();
})();