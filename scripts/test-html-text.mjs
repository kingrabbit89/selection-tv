import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {decodeHtmlEntities,htmlText} from './html-text.mjs';
import {renderFeature,renderGridRow,renderSectionCard,sectionKinds} from './editorial-draft-cards.mjs';

const normalize=value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const title = `L'Œuvre "à voir" & ses suites`;
const candidate = {title,work_id:'oeuvre-2024',quality:'DOC',image:'poster.png',time:'23:20',channel:'Arte',meta:'2024 · Pascal Cuissot · France · 54 min',
  summary:'Une enquête qui suit le travail des chercheurs sur des vestiges et leurs analyses.',
  why:'La mise en scène du travail scientifique rend accessible une recherche complexe.'};

test('escaped apostrophe, quotes and ampersand in card/grid titles retain canonical identity', () => {
  const feature=renderFeature(candidate), grid=renderGridRow(candidate,'Une proposition scientifique documentée.');
  assert.match(feature,/L&#39;Œuvre &quot;à voir&quot; &amp; ses suites/,'renderer remains safely escaped');
  const cardTitle=htmlText(feature.match(/<h3>([\s\S]*?)<\/h3>/)[1]);
  const gridTitle=htmlText(grid.match(/<td class="prog">([^<]+)<\/td>/)[1]);
  assert.equal(cardTitle,title);assert.equal(gridTitle,title);
  const catalogue=new Map([[normalize(title),candidate.work_id]]);
  assert.equal(catalogue.get(normalize(cardTitle)),candidate.work_id);
  assert.equal(catalogue.get(normalize(gridTitle)),candidate.work_id);
});

test('decode exactly once after removing actual markup, preserving escaped literal angle brackets', () => {
  assert.equal(htmlText('<em>Un titre</em> &lt;script&gt; &amp;lt; &nbsp; suite'),'Un titre <script> &lt; suite');
  assert.equal(decodeHtmlEntities('&#39; &#x27; &#X1F3AC; &apos; &quot; &amp;'),`' ' 🎬 ' " &`);
  assert.equal(decodeHtmlEntities('&Eacute;t&eacute; &unknown; &#0; &#xD800; &#x110000;'),'Été &unknown; � � �');
});

test('real editorial and image validators resolve escaped titles; freshness detects a repeat against legacy raw text', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-html-text-'));
  const write=(name,value) => {const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
  const run=script => spawnSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{cwd:dir,encoding:'utf8',env:{...process.env,SELECTION_TV_VALIDATE_WEEK:'2026-S40',SELECTION_TV_CANDIDATE:'1'}});
  try {
    write('data/manifest.json',{latest:'2026-S40',weeks:[{week:'2026-S40',status:'draft'},{week:'2026-S39',status:'published'}]});
    write('data/editorial-config.json',{quality_gates:{remote_image_health_from_week:'2026-S40'}});
    write('data/personalization-config.json',{freshness:{enabled_from_week:'2026-S40',previous_issue_public_repeat_max:0,history_lookback_issues:4}});
    write('data/works.json',{works:[{id:candidate.work_id,title,image:'poster.png',ratings:{imdb:'7,2'}}]});
    write('data/links.json',{links:{[title]:{imdb:'https://www.imdb.com/title/tt33888759/'}}});
    write('data/weeks/2026-S40.json',{week:'2026-S40',pages:[{id:'samedi-selection',html:renderFeature(candidate)},
      {id:'samedi-grille',html:`<table>${renderGridRow(candidate,'Un programme de recherche scientifique.')}</table>`}]});
    write('data/weeks/2026-S39.json',{week:'2026-S39',pages:[{id:'samedi-selection',html:`<article class="feature"><h3>${title}</h3></article>`}]});
    fs.writeFileSync(path.join(dir,'poster.png'),Buffer.from([137,80,78,71,13,10,26,10]));
    const editorial=run('./validate-editorial.mjs');
    assert.equal(editorial.status,0,editorial.stdout+'\n'+editorial.stderr);
    assert.match(editorial.stdout,/retained daily titles: 1 without central exact link: 0/);
    assert(!editorial.stderr.includes('ratings or explicit unavailable reason missing'));
    const images=run('./validate-image-sources.mjs');
    assert.equal(images.status,0,images.stdout+'\n'+images.stderr);
    assert.match(images.stdout,/Remote image health: 1 visual works/);
    const freshness=run('./validate-freshness.mjs');
    assert.equal(freshness.status,1,'a repeated title must fail the unchanged freshness policy');
    assert.match(freshness.stderr,/public core repeats 1 title\(s\) from previous public issue/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('real reserve validator matches escaped section titles and still rejects missing titles or reserves', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-reserve-html-text-'));
  const write=(name,value) => {const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
  const run=() => spawnSync(process.execPath,[fileURLToPath(new URL('./validate-reserves.mjs',import.meta.url))],{
    cwd:dir,encoding:'utf8',env:{...process.env,SELECTION_TV_VALIDATE_WEEK:'2026-S42',SELECTION_TV_CANDIDATE:'1'}});
  const titles=[title,`L'Été 🎬 "R&D" & suite`,...Array.from({length:8},(_,i) => 'Réserve '+(i+1))];
  const candidates=titles.map((text,i) => ({...candidate,title:text,work_id:'reserve-'+i,rank:i+1,date:'2026-10-10',
    release_label:'14 octobre 2026 · Blu-ray',release_url:'https://editor.example.test/edition/'+i,editor:'Éditeur'}));
  const works=candidates.map((c,i) => ({id:c.work_id,title:c.title,director:'Réalisatrice',year:2024,country:'France',
    genre:'Documentaire',duration:'54 min',image:c.image,image_source_url:'https://official.example.test/poster/'+i,
    image_checked:'2026-10-09',ratings:{imdb:'7,2'}}));
  const sectionCard=(kind,c,index) => {
    const rendered=renderSectionCard(kind,c,index);
    // Keep the real renderer's structure and exercise equivalent numeric entities too.
    return index===1 ? rendered.replace(/<h3>[\s\S]*?<\/h3>/,
      '<h3>L&#x27;&#201;t&#233; &#x1F3AC; &quot;R&amp;D&quot; &amp; suite</h3>') : rendered;
  };
  const dailyIds=['samedi','dimanche','lundi','mardi','mercredi','jeudi','vendredi'].map(day => day+'-selection');
  const pools=Object.fromEntries(dailyIds.map(id => [id,{target:3,desired_reserve:7,candidates}]));
  pools['rendezvous-1']={target:2,card_type:'week-card',candidates:candidates.slice(0,7)};
  pools['sorties-physiques']={target:2,card_type:'release-card',candidates:candidates.slice(0,4)};
  const week={week:'2026-S42',pages:[
    {id:'rendezvous-1',html:candidates.slice(0,2).map((c,i) => sectionCard(sectionKinds.rendezvous,c,i)).join('')},
    {id:'sorties-physiques',html:candidates.slice(0,2).map((c,i) => sectionCard(sectionKinds.physical_release,c,i)).join('')}],
    personalization:{pools}};
  try {
    write('data/manifest.json',{latest:'2026-S42'});
    write('data/personalization-config.json',{
      reserve_readiness:{enabled_from_week:'2026-S42'},
      section_reserve_pools:{enabled_from_week:'2026-S42',sections:{
        weekly_rendezvous:{page_id_prefix:'rendezvous-',card_type:'week-card',minimum_reserve_per_page:5},
        physical_releases:{page_id_prefix:'sorties-physiques',card_type:'release-card',minimum_reserve_per_page:2}}}});
    write('data/works.json',{works});
    write('data/links.json',{links:Object.fromEntries(candidates.map((c,i) => [c.title,{imdb:'https://www.imdb.com/title/tt'+(1000000+i)+'/'}]))});
    write('data/weeks/2026-S42.json',week);
    const valid=run();
    assert.equal(valid.status,0,valid.stdout+'\n'+valid.stderr);
    assert(!valid.stderr.includes('recommandation initiale absente du pool'));
    for(const id of ['rendezvous-1','sorties-physiques']){
      const missing=structuredClone(week);
      missing.pages.find(page => page.id===id).html=missing.pages.find(page => page.id===id).html
        .replace(/<h3>[\s\S]*?<\/h3>/,'<h3>Une recommandation réellement absente</h3>');
      write('data/weeks/2026-S42.json',missing);
      const absent=run();
      assert.equal(absent.status,1,'a genuinely absent section title must fail');
      assert(absent.stderr.includes(id+': recommandation initiale absente du pool: Une recommandation réellement absente'),absent.stderr);
      const shallow=structuredClone(week);
      shallow.personalization.pools[id].candidates=shallow.personalization.pools[id].candidates.slice(0,2);
      write('data/weeks/2026-S42.json',shallow);
      const shortage=run();
      assert.equal(shortage.status,1,'an insufficient section reserve must fail');
      assert(shortage.stderr.includes(id+': 2 candidats pour target 2; au moins '+(id==='rendezvous-1'?5:2)+' réserves attendues'),shortage.stderr);
      assert(!shortage.stderr.includes('recommandation initiale absente du pool'),shortage.stderr);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
