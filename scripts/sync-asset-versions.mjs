import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const loader='assets/js/issue-loader.js';
const normalize=s=>s.replace(/\?v=[a-zA-Z0-9_-]+/g,'?v=ASSET_VERSION');
const hash=createHash('sha256');
for(const file of [...walk('assets/js'),...walk('assets/css')].sort()){
 hash.update(file+'\0');const content=fs.readFileSync(file);
 hash.update(file===loader?normalize(content.toString()):content);
}
const version=hash.digest('hex').slice(0,16);
const files=[loader,...walk('semaines').filter(p=>p.endsWith('/index.html'))];
let stale=false;
for(const file of files){
 const old=fs.readFileSync(file,'utf8');
 const next=file===loader?old.replace(/\?v=[a-zA-Z0-9_-]+/g,'?v='+version):old.replace(/issue-loader\.js\?v=[a-zA-Z0-9_-]+/g,'issue-loader.js?v='+version);
 if(old===next)continue;
 if(process.argv.includes('--check')){console.error('Stale asset version: '+file);stale=true}
 else fs.writeFileSync(file,next);
}
if(stale)throw Error('Run node scripts/sync-asset-versions.mjs before committing asset changes.');
console.log('✓ Shared asset version '+version);
