(()=>{
const STORE='selectionTV_saved_v1';
const SEEN='selectionTV_seen_v2';
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const loadStore=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}')}catch(e){return {}}};
const saveStore=o=>{try{localStorage.setItem(STORE,JSON.stringify(o))}catch(e){}};
const loadSeen=()=>{try{return JSON.parse(localStorage.getItem(SEEN)||'{}')}catch(e){return {}}};
const saveSeen=o=>{try{localStorage.setItem(SEEN,JSON.stringify(o))}catch(e){}};
const keys=(title,workId)=>[workId,'title:'+norm(title)].filter(Boolean);
function isSeen(title,workId){
 const seen=loadSeen();
 if(keys(title,workId).some(k=>!!seen[k]))return true;
 return loadStore()[norm(title)]?.status==='vu';
}
function setSeen(title,workId,value){
 const seen=loadSeen(),saved=loadStore(),key=norm(title),cur=saved[key],on=value==null?!isSeen(title,workId):!!value;
 if(on){
   const k=workId||('title:'+key);
   seen[k]={title,work_id:workId||null,seen_at:new Date().toISOString()};
   saved[key]={...(cur||{}),title,work_id:workId||cur?.work_id||null,previous_status:cur?.status&&cur.status!=='vu'?cur.status:(cur?.previous_status||null),status:'vu',seen_at:new Date().toISOString(),added:cur?.added||new Date().toISOString()};
 }else{
   for(const k of keys(title,workId))delete seen[k];
   if(cur?.status==='vu'){
     if(cur.previous_status){saved[key]={...cur,status:cur.previous_status};delete saved[key].previous_status}
     else delete saved[key];
   }
 }
 saveSeen(seen);saveStore(saved);
 document.dispatchEvent(new CustomEvent('selectiontv:seenchange',{detail:{title,workId:workId||null,seen:on}}));
 return on;
}
function toggle(title,workId){return setSeen(title,workId,null)}
function countSeen(works=[]){return works.reduce((n,w)=>n+(isSeen(w.title,w.id)?1:0),0)}
window.SelectionTVSeenRegistry={norm,isSeen,setSeen,toggle,countSeen};
})();