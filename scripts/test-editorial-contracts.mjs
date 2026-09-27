import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionPageMatches,dailyReserveCandidates} from './editorial-contracts.mjs';
test('two five-card pages satisfy the ten-rendezvous family',()=>{
 const pages=[{id:'rendezvous-1',count:5},{id:'rendezvous-2',count:5},{id:'radar-1',count:5}];
 assert.equal(pages.filter(p=>sectionPageMatches(p.id,'rendezvous-1')).reduce((n,p)=>n+p.count,0),10);
 assert(sectionPageMatches('radar-2','radar-1'));
 assert(!sectionPageMatches('radar-torrent','radar-1'));
 assert(!sectionPageMatches('rendezvous-autre','rendezvous-1'));
});
test('freshness reserve ratio excludes event releases and daily primaries',()=>{
 const candidate=(title,rank)=>({title,rank});
 const issue={personalization:{pools:{'samedi-selection':{target:3,candidates:[candidate('primary',1),candidate('reserve',4)]},'sorties-physiques':{target:1,candidates:[candidate('new edition',2)]}}}};
 assert.deepEqual(dailyReserveCandidates(issue).map(c=>c.title),['reserve']);
});

const {probeRemoteImage}=await import('./image-health.mjs');
test('HTML masquerading as a jpg or image MIME is rejected',async()=>{
 const result=await probeRemoteImage('https://fixture.invalid/poster.jpg',{fetcher:async()=>new Response('<html>unavailable</html>',{headers:{'content-type':'image/jpeg'}})});
 assert.equal(result.ok,false);
});
test('transient source failure retries and accepts actual image bytes',async()=>{
 let calls=0;
 const result=await probeRemoteImage('https://fixture.invalid/poster',{delay:async()=>{},fetcher:async()=>++calls===1?new Response('busy',{status:503}):new Response(new Uint8Array([255,216,255,224]),{headers:{'content-type':'application/octet-stream'}})});
 assert.equal(calls,2);assert.equal(result.ok,true);
});
