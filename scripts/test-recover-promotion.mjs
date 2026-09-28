import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverPromotion} from './recover-promotion.mjs';
const week='2026-S42',repo='owner/repo';
function fixture({closed=false,changed=false,stale=false,moved=false}={}){
 const before={latest:'2026-S41',weeks:[{week:'2026-S41',from:'2026-10-03',status:'published'},{week,from:'2026-10-10',status:'draft'}]};
 const after=structuredClone(before);after.latest=week;after.weeks[1].status='published';
 const files=['data/manifest.json',`data/weeks/${week}.json`];let creates=0;
 const api=(p,method='GET',body)=>{
  if(p.startsWith('pulls?'))return closed?[{state:'closed'}]:[];
  if(p==='compare/base...head')return {status:stale?'diverged':'ahead',behind_by:stale?1:0,total_commits:1,files:files.map(filename=>({filename}))};
  if(p.startsWith('contents/')){const isHead=p.endsWith('ref=head');const obj=p.includes('manifest')?(isHead?after:before):{week,publication_status:isHead?'published':'draft',...(changed&&isHead?{pages:['unreviewed edit']}:{})};return {encoding:'base64',content:Buffer.from(JSON.stringify(obj)).toString('base64')};}
  if(p==='git/ref/heads/main')return {object:{sha:moved?'new-base':'base'}};
  if(p==='git/ref/heads/promote/'+week)return {object:{sha:'head'}};
  if(p==='pulls'&&method==='POST'){creates++;assert.equal(body.head,'promote/'+week);return {number:42,html_url:'fixture'};}
  throw Error(p);
 };return {api,created:()=>creates};
}
test('interruption after branch creation recovers only missing PR',()=>{const f=fixture();assert.equal(recoverPromotion(f.api,repo,week,'base','head').number,42);assert.equal(f.created(),1);});
for(const flag of ['closed','changed','stale','moved'])test('recovery refuses '+flag+' promotion',()=>{const f=fixture({[flag]:true});assert.throws(()=>recoverPromotion(f.api,repo,week,'base','head'));assert.equal(f.created(),0);});
test('existing open PR reused without mutation',()=>{const api=()=>[{state:'open',number:17}];assert.equal(recoverPromotion(api,repo,week,'base','head').number,17);});
