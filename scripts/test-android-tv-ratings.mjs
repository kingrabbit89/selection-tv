import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the production formatter, grid hydration and pool model builder in
// their actual closure. Native search/navigation stays outside this harness.
const source=fs.readFileSync(new URL('../assets/js/android-tv-mode.js',import.meta.url),'utf8');
const prefix=source.slice(0,source.indexOf('  const posterCandidatesOf='));
const pool=source.slice(source.indexOf('    const poolModel='),source.indexOf('    // The desktop reserve engine'));
function runtime(catalogue=[],published={}){
  const window={SelectionTVRatings:published};
  vm.runInNewContext(prefix+`
    const idsFor=()=>({imdbId:'',tmdbId:''});
    const cacheKeyFor=(title,year)=>norm(title)+'|'+year;
    const loadCachedState=()=>{};
    ${pool}
    window.harness={ratingLabels,ratingsOf,poolModel,setWorks(data){
      works=new Map(data.map(w=>[norm(w.title),w]));
    }};
  })();`,{
    window,URLSearchParams,location:{search:'?tv=1'},
    fetch:()=>new Promise(()=>{}),
    document:{documentElement:{classList:{add(){}}},body:{classList:{add(){}}},
      createElement:()=>({}),head:{append(){}}}
  });
  window.harness.setWorks(catalogue);
  return window.harness;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const grid=(texts=[])=>({querySelectorAll:()=>texts.map(textContent=>({textContent}))});

test('Shutter Island grid hydrates saved alternate publishers when IMDb and SC are unavailable',()=>{
  const actual={title:'Shutter Island',ratings:{rottentomatoes:'69 % (262 critiques)',allocine_presse:'3,8/5 (31 titres)'}};
  assert.deepEqual(plain(runtime([actual]).ratingsOf(grid(),actual.title)),[
    'Rotten Tomatoes 69 % (262 critiques)','AlloCiné presse 3,8/5 (31 titres)'
  ]);
});

test('known legacy bare numbers receive /10 while explicit scales and review counts stay intact',()=>{
  const {ratingLabels}=runtime();
  assert.deepEqual(plain(ratingLabels({imdb:'7,2',senscritique:6.8})),['IMDb 7,2/10','SensCritique 6.8/10']);
  assert.deepEqual(plain(ratingLabels({imdb:'7,2/10',sc:'6,8/10 (210 avis)',metascore:'63/100',audience:'81 %'})),[
    'IMDb 7,2/10','SensCritique 6,8/10 (210 avis)','Metascore 63/100','Audience 81 %'
  ]);
});

test('each recorded S42 publisher keeps its attribution and source scale',()=>{
  const {ratingLabels}=runtime();
  assert.deepEqual(plain(ratingLabels({rotten_tomatoes:'72 %',allocine_press:'4,1/5',
    allocine_spectateurs:'3,5/5',metacritic:'64/100',cinemascore:'A-',filmrezensionen:'7/10',
    another_publisher:'★★★'})),[
    'Rotten Tomatoes 72 %','AlloCiné presse 4,1/5','AlloCiné spectateurs 3,5/5',
    'Metacritic 64/100','CinemaScore A-','Filmrezensionen 7/10','another_publisher ★★★'
  ]);
});

test('equivalent provider aliases do not create duplicate badges',()=>{
  assert.deepEqual(plain(runtime().ratingLabels({sc:'7,1',senscritique:'7,1/10',
    rottentomatoes:'69 %',rotten_tomatoes:'69 %',allocine_presse:'3,8/5',allocine_press:'3,8/5'})),[
    'SensCritique 7,1/10','Rotten Tomatoes 69 %','AlloCiné presse 3,8/5'
  ]);
});

test('zero is a recorded rating and missing or nonscalar values are not invented ratings',()=>{
  assert.deepEqual(plain(runtime().ratingLabels({imdb:0,sc:' ',metacritic:null,audience:false,
    rottentomatoes:{score:'69 %'}})),['IMDb 0/10']);
  assert.deepEqual(plain(runtime().ratingLabels()),[]);
});

test('DOM, runtime and catalogue hydration deduplicate identical explicit badges',()=>{
  const r=runtime([{title:'La Maison des femmes',ratings:{imdb:'7,2/10'}}],
    {'La Maison des femmes':{imdb:'7,2'}});
  assert.deepEqual(plain(r.ratingsOf(grid(['IMDb 7,2/10 relevé 2026-10-10']),'La Maison des femmes')),['IMDb 7,2/10']);
});

test('primary and reserve models use the same alternate ratings without changing state or pool identity',()=>{
  const r=runtime([{title:'Shutter Island',year:2010,ratings:{rottentomatoes:'69 % (262 critiques)',
    allocine_presse:'3,8/5 (31 titres)'}}]);
  for(const isReserve of [false,true]){
    const model=r.poolModel({title:'Shutter Island',rank:4,summary:'Résumé enregistré',why:'Motif enregistré'},'jeudi',isReserve);
    assert.deepEqual(plain(model.ratings),['Rotten Tomatoes 69 % (262 critiques)','AlloCiné presse 3,8/5 (31 titres)']);
    assert.equal(model.isReserve,isReserve);
    assert.equal(model.poolId,'jeudi');assert.equal(model.rank,4);
    assert.equal(model.state,'unknown');assert.equal(model.played,null);
  }
});
