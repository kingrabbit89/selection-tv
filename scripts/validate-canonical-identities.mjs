import fs from 'node:fs';
import assert from 'node:assert/strict';
const works=JSON.parse(fs.readFileSync('data/works.json')).works;
const ids=new Set(), legacy=new Set(), titles=new Set();
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
for(const w of works){
  assert(w.id&&!ids.has(w.id),'duplicate canonical ID: '+w.id);ids.add(w.id);
  const key=norm(w.title)+'|'+String(w.year||'')+'|'+String(w.media_type||'');
  assert(!titles.has(key),'ambiguous canonical title/year/type: '+w.title);titles.add(key);
  for(const id of w.legacy_ids||[]){assert(!legacy.has(id),'duplicate legacy ID: '+id);legacy.add(id)}
}
for(const id of legacy)assert(!ids.has(id),'legacy ID shadows canonical ID: '+id);
for(const dir of ['data/weeks','data/radar-reserves'])for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
  const walk=x=>{if(!x||typeof x!=='object')return;if(x.work_id)assert(!legacy.has(x.work_id),'unmigrated work_id in '+file+': '+x.work_id);Object.values(x).forEach(walk)};
  walk(JSON.parse(fs.readFileSync(dir+'/'+file)));
}
console.log('✓ Canonical IDs, legacy aliases and migrated references are coherent');
