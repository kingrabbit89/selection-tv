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

test('private handshake resumes a late legacy parent with bounded backoff and stops on a response',()=>{
  const bridge=read('assets/js/jellyfin-bridge.js');
  const messages=[],timers=[],statuses=[];
  const ctx=vm.createContext({PARENT:{postMessage:payload=>messages.push(payload)},TARGET_ORIGIN:'https://jellyfin.local',
    renderStatus:(state,message)=>statuses.push({state,message}),
    setTimeout:(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer},clearTimeout:timer=>{timer.cancelled=true},window:{}});
  const handshake=bridge.slice(bridge.indexOf('  let renderVersion=0;'),bridge.indexOf('  const retryControl='));
  vm.runInContext(handshake+'\nwindow.handshake={startPrivateHandshake,stopPrivateHandshake};',ctx);
  ctx.window.handshake.startPrivateHandshake();
  assert.equal(messages.length,1);
  timers.find(timer=>timer.delay===8000).fn();
  assert.equal(messages.length,2,'the old installed parent gets another chance after its startup windows');
  assert.match(statuses.at(-1).message,/toujours en attente/);
  assert.doesNotMatch(statuses.at(-1).message,/n.a pas.*transmis/);
  ctx.window.handshake.stopPrivateHandshake();
  timers.forEach(timer=>timer.fn());
  assert.equal(messages.length,2,'even an already queued callback is invalidated after a trusted payload');
  assert(timers.every(timer=>timer.cancelled));
});

test('manual private retry invalidates the old handshake and starts an independent response wait',()=>{
  const bridge=read('assets/js/jellyfin-bridge.js'),messages=[],timers=[];
  const ctx=vm.createContext({PARENT:{postMessage:payload=>messages.push(payload)},TARGET_ORIGIN:'https://jellyfin.local',renderStatus(){},
    setTimeout:(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer},clearTimeout(){},window:{}});
  const handshake=bridge.slice(bridge.indexOf('  let renderVersion=0;'),bridge.indexOf('  const retryControl='));
  vm.runInContext(handshake+'\nwindow.handshake={startPrivateHandshake,stopPrivateHandshake};',ctx);
  ctx.window.handshake.startPrivateHandshake();const oldTimers=timers.slice();
  ctx.window.handshake.stopPrivateHandshake();ctx.window.handshake.startPrivateHandshake(true);
  assert.deepEqual(messages.map(message=>message.type),['selection-tv:jellyfin-private-ready','selection-tv:jellyfin-private-retry','selection-tv:jellyfin-private-ready']);
  oldTimers.forEach(timer=>timer.fn());assert.equal(messages.length,3);
  timers.findLast(timer=>timer.delay===8000).fn();assert.equal(messages.length,4);
});

test('latest progressive snapshot retains every changed card while optional catalogue loading supersedes updates',async()=>{
  const bridge=read('assets/js/jellyfin-bridge.js');
  let settleCatalog;const catalogPromise=new Promise(resolve=>settleCatalog=resolve);
  const rendered=[],cards=[];
  const makeCard=(item,index)=>({index,director:item.director,querySelector:()=>null,
    replaceWith(replacement){cards[index]=replacement;rendered.push(index)}});
  cards.push(makeCard({director:'Old director 0'},0),makeCard({director:'Old director 1'},1));
  const document={
    querySelectorAll:selector=>selector.includes('data-private-index')?cards:[],
    querySelector:selector=>cards[Number(selector.match(/data-private-index="(\d+)"/)?.[1])],
    dispatchEvent(){}
  };
  const ctx=vm.createContext({catalogPromise,formatterReady:Promise.resolve(),document,makeCard,
    hydrateFromCatalog:item=>item,clearTimeout(){},setTimeout:()=>0,
    CustomEvent:class{},window:{},stopPrivateHandshake(){}});
  const dependencies=bridge.slice(bridge.indexOf('  let privateDataSettled='),bridge.indexOf('  const ratingBox='));
  const renderer=bridge.slice(bridge.indexOf('  const patchPrivate='),bridge.indexOf("  window.addEventListener('message'",bridge.indexOf('  const renderPrivate=')));
  vm.runInContext(dependencies+'\nlet renderVersion=0,privatePayloadReceived=false,waitingTimer;\n'+renderer+'\nwindow.render=renderPrivate;',ctx);
  const first=[{title:'Fixture 0',director:'New director 0',activityAt:new Date().toISOString()},
    {title:'Fixture 1',director:'Old director 1',activityAt:new Date().toISOString()}];
  const latest=[first[0],{...first[1],director:'New director 1'}];
  const old=ctx.window.render({phase:'progress',changedIndex:0,items:first});
  const fresh=ctx.window.render({phase:'progress',changedIndex:1,items:latest});
  settleCatalog({links:new Map(),works:new Map()});await Promise.all([old,fresh]);
  assert.deepEqual(cards.map(card=>card.director),['New director 0','New director 1']);
  assert.deepEqual(rendered,[0,1],'the latest complete snapshot repairs both superseded indexes');
  rendered.length=0;
  await ctx.window.render({phase:'progress',changedIndex:1,items:[latest[0],{...latest[1],director:'Newest director 1'}]});
  assert.deepEqual(rendered,[1],'after dependencies settle, a normal update keeps its incremental render');
});
