import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {webpInfo, copyPosters, checkPosterAssets, posterPath, isPosterPath, posterDigest, parseCli} from './poster-copy.mjs';
import {applyResolutions} from './poster-resolver.mjs';

const JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,0,16,74,70,73,70,0,1]);
// Minimal RIFF/WEBP with a VP8X header: enough for signature and size checks.
function webp(width,height,seed=0){
  const b=Buffer.alloc(30+seed);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WEBP',8);b.write('VP8X',12);b.writeUInt32LE(10,16);
  b.writeUIntLE(width-1,24,3);b.writeUIntLE(height-1,27,3);
  return b;
}
function fakeWeb(routes){
  const calls=[];
  const fetcher=async(url,init={})=>{
    calls.push({url,headers:init.headers||{}});
    const route=routes[url];
    if(!route)return new Response('missing',{status:404});
    return new Response(route.body,{status:route.status??200,headers:route.headers||{'content-type':'image/jpeg'}});
  };
  return {fetcher,calls};
}
// Stands in for Pillow: output size depends on the input, like a real encoder.
const fakeConvert=async entries=>entries.map(entry=>{
  fs.writeFileSync(entry.out,webp(360,540,fs.readFileSync(entry.in).length%7));
  return {out:entry.out,ok:true,width:360,height:540};
});
const options={intervalMs:0,convert:fakeConvert};
const tempRoot=()=>fs.mkdtempSync(path.join(os.tmpdir(),'selection-poster-copy-'));

test('WebP headers are parsed; other formats are not WebP', () => {
  assert.deepEqual(webpInfo(webp(360,540)),{width:360,height:540});
  const lossy=Buffer.alloc(30);lossy.write('RIFF',0);lossy.write('WEBP',8);lossy.write('VP8 ',12);
  lossy[23]=0x9d;lossy[24]=0x01;lossy[25]=0x2a;lossy.writeUInt16LE(300,26);lossy.writeUInt16LE(450,28);
  assert.deepEqual(webpInfo(lossy),{width:300,height:450});
  const lossless=Buffer.alloc(30);lossless.write('RIFF',0);lossless.write('WEBP',8);lossless.write('VP8L',12);
  lossless[20]=0x2f;lossless.writeUInt32LE((200-1)|((300-1)<<14),21);
  assert.deepEqual(webpInfo(lossless),{width:200,height:300});
  assert.equal(webpInfo(JPEG),null);
  assert.equal(posterPath('la-firme'),'assets/posters/la-firme.webp');
  assert.throws(()=>posterPath('../x'),/unsafe work id/);
  assert(isPosterPath('assets/posters/la-firme.webp'));
  assert(!isPosterPath('assets/posters/../data/works.webp'));
});

test('copy keeps the healthy original as image_remote and first fallback, drops dead URLs, writes no Referer', async () => {
  const root=tempRoot();
  const dead='https://dead.example.test/p.jpg',ok='https://media.example.test/p.jpg',other='https://other.example.test/p.jpg';
  const work={id:'usual-suspects-1995',title:'Usual Suspects',image:dead,image_source_url:'https://www.imdb.com/title/tt0114814/',
    image_strategy:'hand-picked',image_fallbacks:[ok,other]};
  const {fetcher,calls}=fakeWeb({[dead]:{status:403,body:'no'},[ok]:{body:JPEG}});
  try {
    const [result]=await copyPosters({works:[work],targets:[work],fetcher,root,...options});
    assert.equal(result.status,'copied');
    const written=fs.readFileSync(path.join(root,result.file));
    assert.deepEqual(result.update,{image:'assets/posters/usual-suspects-1995.webp',image_remote:ok,image_fallbacks:[ok,other],
      image_sha256:posterDigest(written)});
    assert.deepEqual(webpInfo(written),{width:360,height:540});
    assert(calls.every(call=>!call.headers.Referer&&!call.headers.referer));
    assert.equal(calls.some(call=>call.url===other),false,'stops at the first healthy source');
    const {doc}=applyResolutions({works:[work]},[result],{today:'2026-10-16'});
    const local=doc.works[0];
    assert.equal(local.image_source_url,work.image_source_url,'provenance page is kept');
    assert.equal(local.image_strategy,'hand-picked','editorial notes are kept');

    // Re-running changes nothing and downloads nothing.
    const again=fakeWeb({});
    const [kept]=await copyPosters({works:[local],targets:[local],fetcher:again.fetcher,root,...options});
    assert.equal(kept.status,'kept');assert.equal(again.calls.length,0);
    // A refresh with the same source bytes rewrites nothing either.
    const refresh=fakeWeb({[ok]:{body:JPEG}});
    const [same]=await copyPosters({works:[local],targets:[local],fetcher:refresh.fetcher,root,refresh:true,...options});
    assert.equal(same.status,'copied');assert.equal(same.file_changed,false);
    assert.equal(same.update,undefined,'identical values leave works.json untouched');
    assert.equal(applyResolutions({updated:'2026-10-01',works:[local]},[same],{today:'2026-10-20'}).doc.updated,'2026-10-01');
    assert.equal(refresh.calls[0].url,ok,'a local poster refreshes from image_remote');

    // An older copy without fingerprint gets one, offline; a file changed behind
    // works.json is reported instead of silently re-fingerprinted.
    const {image_sha256,...legacy}=local;
    const [backfilled]=await copyPosters({works:[legacy],targets:[legacy],fetcher:again.fetcher,root,...options});
    assert.deepEqual(backfilled.update,{image_sha256});
    fs.writeFileSync(path.join(root,local.image),webp(360,540,3));
    const [tampered]=await copyPosters({works:[local],targets:[local],fetcher:again.fetcher,root,...options});
    assert.equal(tampered.status,'failed');assert.match(tampered.why,/differs from image_sha256/);
    assert.equal(again.calls.length,0);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('dry run writes no file; HTML, SVG, missing sources and unsafe ids are not copied', async () => {
  const root=tempRoot();
  const page='https://cdn.example.test/page.jpg',svg='https://cdn.example.test/logo.svg',good='https://cdn.example.test/good.jpg';
  const {fetcher}=fakeWeb({[page]:{body:'<html>blocked</html>'},[svg]:{body:'<svg xmlns="http://www.w3.org/2000/svg"></svg>',headers:{'content-type':'image/svg+xml'}},
    [good]:{body:JPEG}});
  const works=[{id:'html',title:'H',image:page},{id:'svg',title:'S',image:svg},{id:'none',title:'N'},
    {id:'Bad/Id',title:'B',image:good},{id:'dry',title:'D',image:good}];
  try {
    const results=await copyPosters({works,targets:works,fetcher,root,dryRun:true,...options});
    assert.deepEqual(results.map(r=>r.status),['failed','failed','skipped','skipped','copied']);
    assert.equal(results[0].attempts[0].why,'non-image response bytes');
    assert.equal(results[1].attempts[0].why,'SVG kept remote');
    assert.equal(results[3].why,'unsafe work id');
    assert.equal(fs.existsSync(path.join(root,'assets/posters/dry.webp')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('CI check: each local poster is a small WebP named after its work, with its remote original kept', () => {
  const root=tempRoot(),dir=path.join(root,'assets/posters');
  fs.mkdirSync(dir,{recursive:true});
  const good={id:'good',image:'assets/posters/good.webp',image_remote:'https://cdn.example.test/g.jpg',image_fallbacks:['https://cdn.example.test/g.jpg'],
    image_sha256:posterDigest(webp(360,540))};
  try {
    fs.writeFileSync(path.join(dir,'good.webp'),webp(360,540));
    let report=checkPosterAssets({works:[good,{id:'remote',image:'https://cdn.example.test/r.jpg'}],root});
    assert.deepEqual(report.errors,[]);assert.equal(report.posters,1);assert.equal(report.bytes,30);

    fs.writeFileSync(path.join(dir,'big.webp'),webp(800,1200));
    fs.writeFileSync(path.join(dir,'fake.webp'),JPEG);
    fs.writeFileSync(path.join(dir,'orphan.webp'),webp(10,10));
    report=checkPosterAssets({root,works:[good,
      {id:'big',image:'assets/posters/big.webp',image_remote:'https://x.test/b.jpg',image_fallbacks:['https://x.test/b.jpg']},
      {id:'fake',image:'assets/posters/fake.webp',image_remote:'https://x.test/f.jpg',image_fallbacks:['https://x.test/other.jpg']},
      {id:'renamed',image:'assets/posters/good.webp',image_remote:'https://x.test/g.jpg',image_fallbacks:['https://x.test/g.jpg']},
      {id:'missing',image:'assets/posters/missing.webp',image_fallbacks:[]}]});
    const text=report.errors.join('\n');
    assert.match(text,/big: .*800×1200, above 360×540/);
    assert.match(text,/fake: .* is not a WebP file/);
    assert.match(text,/fake: image_fallbacks must start with image_remote/);
    assert.match(text,/big: .*does not match image_sha256/);
    assert.match(text,/renamed: poster path must be assets\/posters\/renamed\.webp/);
    assert.match(text,/missing: missing assets\/posters\/missing\.webp/);
    assert.match(text,/assets\/posters\/orphan\.webp: not the image of any work/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('CLI accepts exactly one target selector', () => {
  assert.throws(()=>parseCli([]),/Usage/);
  assert.throws(()=>parseCli(['--check','--all']),/Usage/);
  assert.throws(()=>parseCli(['--all','--force']),/unknown flag/);
  assert.equal(parseCli(['--check']).check,true);
  assert.deepEqual(parseCli(['--week','2026-S43','--dry-run']).week,'2026-S43');
});
