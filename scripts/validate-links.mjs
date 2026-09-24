import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

const root=new URL('../',import.meta.url);
const read=async p=>readFile(new URL(p,root),'utf8');
const errors=[];
const forbidden=[
  /senscritique\.com\/recherche/i,
  /imdb\.com\/find/i,
  /imdb\.com\/search\/title/i,
  /allocine\.fr\/rechercher/i,
  /wikipedia\.org\/w\/index\.php\?search/i,
  /google\.com\/search/i,
  /arte\.tv\/fr\/search/i,
  /france\.tv\/recherche/i,
  /primevideo\.com\/search/i,
  /tv\.apple\.com\/search/i,
  /canalplus\.com\/recherche/i,
  /mubi\.com\/.*search/i,
  /netflix\.com\/search/i
];

function scanValue(value,path){
  if(typeof value==='string'){
    const urls=value.match(/https?:\\/\\/[^"'<>\\s]+/g)||[];
    for(const url of urls)if(forbidden.some(r=>r.test(url)))errors.push(`${path}: search-result URL forbidden: ${url}`);
    return;
  }
  if(Array.isArray(value)){value.forEach((v,i)=>scanValue(v,`${path}[${i}]`));return}
  if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))scanValue(v,`${path}.${k}`);
}

const links=JSON.parse(await read('data/links.json'));
for(const [title,L] of Object.entries(links.links||{})){
  scanValue(L,`data/links.json:${title}`);
  if(L.imdb&&!/^https:\/\/www\.imdb\.com\/(?:fr\/)?title\/tt\d+\/?$/.test(L.imdb))
    errors.push(`data/links.json:${title}: IMDb must be an exact title page, got ${L.imdb}`);
  if(L.sc&&!/^https:\/\/www\.senscritique\.com\/(?:film|serie)\/[^?#]+\/\d+\/?$/.test(L.sc))
    errors.push(`data/links.json:${title}: SensCritique must be an exact work page, got ${L.sc}`);
}

for(const dir of ['data/weeks','data/radar-reserves']){
  let names=[];try{names=await readdir(new URL(dir+'/',root))}catch{}
  for(const name of names.filter(n=>n.endsWith('.json'))){
    const obj=JSON.parse(await read(dir+'/'+name));scanValue(obj,dir+'/'+name);
  }
}

const jsNames=await readdir(new URL('assets/js/',root));
for(const name of jsNames.filter(n=>n.endsWith('.js'))){
  const src=await read('assets/js/'+name);
  for(const r of forbidden)if(r.test(src))errors.push(`assets/js/${name}: contains generated search-page URL pattern ${r}`);
}

if(errors.length){
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('✓ Exact-link policy: no search-result URLs; IMDb/SensCritique links are canonical work pages.');
