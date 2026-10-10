import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('assets/js/jellyfin-private-uploads.js');
function host(feed){
  const sent=[],timers=[],listeners={},state={user:'user-1',calls:0,reloads:0};
  const child={postMessage:payload=>sent.push(JSON.parse(JSON.stringify(payload)))};
  const frame={contentWindow:child,style:{},getBoundingClientRect:()=>({width:100,height:100}),addEventListener(){}};
  const location={origin:'http://jellyfin.test',reload(){state.reloads++}};
  const window={location,addEventListener:(type,fn)=>listeners[type]=fn,ApiClient:{
    getCurrentUserId:()=>state.user,serverAddress:()=>location.origin,getUrl:path=>'/'+path,
    ajax:async()=>{state.calls++;return feed()},getItems:async()=>({Items:[]})
  }};
  const document={getElementById:id=>id==='selectionTvFrame'?frame:{textContent:'Jellyfin',className:''},
    body:{contains:()=>true},addEventListener(){},visibilityState:'visible'};
  vm.runInNewContext(source,{window,document,location,Map,URLSearchParams,
    sessionStorage:{getItem:()=>null,setItem(){}},getComputedStyle:()=>({display:'block',visibility:'visible'}),
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length},clearTimeout(){},setInterval:()=>1,clearInterval(){},
    console:{warn(){}}});
  const start=()=>timers.find(timer=>timer.delay===3200).fn();
  const retry=(origin='https://kingrabbit89.github.io')=>listeners.message({source:child,origin,data:{type:'selection-tv:jellyfin-private-retry'}});
  return {state,sent,timers,frame,start,retry};
}
test('standalone and Plugin Pages inline private bootstrap share the same implementation',()=>{
  const html=read('integrations/jellyfin/selection-tv.html');
  const start=html.indexOf('(function(){',html.indexOf('Jellyfin-only private uploads'));
  assert.equal(html.slice(start,html.lastIndexOf('</script>')).trim(),source.trim());
});
test('legacy parent without the new session helper still fetches and sends an empty valid feed',async()=>{
  const h=host(async()=>({Items:[],WindowHours:24}));await h.start();
  assert.equal(h.state.calls,1);
  assert.equal(h.sent[0].state,'loading');
  assert.deepEqual(h.sent.at(-1).items,[]);
  assert.equal(h.sent.at(-1).phase,'provisional');
});
test('real API rejection sends an error status and retry is limited to the trusted iframe origin',async()=>{
  const h=host(async()=>{throw new Error('service unavailable')});await h.start();
  assert.equal(h.sent.at(-1).state,'error');
  h.retry('https://unexpected.test');assert.equal(h.state.calls,1);
  h.retry();await Promise.resolve();await Promise.resolve();
  assert.equal(h.state.calls,2);
});
test('slow requests stay pending and repeated retry does not duplicate an unfinished request',async()=>{
  let finish;const h=host(()=>new Promise(resolve=>finish=resolve));const request=h.start();
  h.timers.find(timer=>timer.delay===15000).fn();
  assert.equal(h.sent.at(-1).state,'loading');assert.equal(h.sent.at(-1).pending,true);
  h.retry();assert.equal(h.state.calls,1);
  finish({Items:[],WindowHours:24});await request;
  assert.equal(h.sent.at(-1).phase,'provisional');
});
test('a legacy parent discards a private response after the account changes',async()=>{
  let finish;const h=host(()=>new Promise(resolve=>finish=resolve));const request=h.start();
  h.state.user='user-2';finish({Items:[{TopicTitle:'Private fixture',ActivityAt:new Date().toISOString()}]});await request;
  assert.equal(h.state.reloads,1);assert.equal(h.frame.style.visibility,'hidden');
  assert(!h.sent.some(payload=>payload.items?.length));
});
