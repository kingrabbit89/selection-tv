(()=>{
  const script=document.currentScript;
  const configUrl=new URL('../../data/analytics.json',script?.src||location.href);
  const normPath=()=>location.pathname.replace(/\/index\.html$/,'/')||'/';
  const fire=(name,title='')=>{
    if(!window.goatcounter?.count)return;
    window.goatcounter.count({path:name,title:title||name,event:true});
  };
  window.SelectionTVAnalytics={event:fire};

  fetch(configUrl,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(cfg=>{
    if(!cfg?.enabled||cfg.provider!=='goatcounter'||!cfg.code)return;
    const code=String(cfg.code).trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
    if(!code)return;

    window.goatcounter={
      path:()=>normPath()
    };

    const s=document.createElement('script');
    s.async=true;
    s.src='https://gc.zgo.at/count.js';
    s.dataset.goatcounter=cfg.endpoint||('https://'+code+'.goatcounter.com/count');
    s.onload=()=>{
      document.addEventListener('click',e=>{
        const el=e.target.closest('button,a');
        if(!el)return;
        if(el.matches('.seen-btn,#seenToggle,#seenWorkButton')){
          fire('interaction-seen',document.title);
          return;
        }
        if(el.matches('.save,#saveButton,[data-save]')){
          fire('interaction-save',document.title);
        }
      },true);
    };
    document.head.appendChild(s);
  }).catch(()=>{});
})();