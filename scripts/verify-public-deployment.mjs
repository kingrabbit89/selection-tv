const target=process.argv[2]||process.env.SELECTION_TV_VALIDATE_WEEK;
if(!target)throw new Error('Usage: node scripts/verify-public-deployment.mjs YYYY-Sxx');
const base='https://kingrabbit89.github.io/selection-tv/';
const bust='?deployment_check='+Date.now();

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(path,kind){
  let lastError=null;
  for(let attempt=1;attempt<=5;attempt++){
    try{
      const r=await fetch(base+path+bust+'&attempt='+attempt,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      if(r.ok)return kind==='json'?r.json():r.text();
      const error=new Error(path+' HTTP '+r.status);
      if(r.status<500&&r.status!==429)throw error;
      lastError=error;
    }catch(error){
      lastError=error;
    }
    if(attempt<5)await sleep(1200*attempt);
  }
  throw lastError||new Error(path+' unavailable');
}
const getJson=path=>get(path,'json');
const getText=path=>get(path,'text');

const manifest=await getJson('data/manifest.json');
if(manifest.latest!==target)throw new Error('public manifest.latest='+manifest.latest+'; expected '+target);
const entry=(manifest.weeks||[]).find(x=>x.week===target);
if(!entry||entry.status!=='published')throw new Error('public manifest entry is not published');

const week=await getJson('data/weeks/'+target+'.json');
if(week.week!==target||week.publication_status!=='published')throw new Error('public week JSON is not promoted');

const shell=await getText('semaines/'+target+'/');
if(!shell.includes('data-week="'+target+'"')&&!shell.includes("data-week='"+target+"'")){
  throw new Error('public weekly shell does not identify '+target);
}

const latest=await getText('latest.html');
if(!latest.includes("fetch('data/manifest.json',{cache:'no-store'})"))throw new Error('public latest.html no longer resolves the manifest without cache');

console.log('✓ GitHub Pages serves promoted '+target+' consistently');
