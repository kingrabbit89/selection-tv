import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkProgressStructures} from './editorial-progress.mjs';
export const MAX_GITHUB_API_OUTPUT_BYTES = 32 * 1024 * 1024;
const sha256=content=>createHash('sha256').update(content,'utf8').digest('hex');

// Snapshot and validate the actual strings sent to the Git tree endpoint.
// The fingerprints are compact transport evidence, not editorial certification.
// Optional expected fingerprints bind a handoff to its original full contents.
export function preflightCommitFiles(files){
  assert(Array.isArray(files),'commit files must be an array');
  const seen=new Set(),fingerprints=[];
  const tree=files.map(file=>{
    const {path,content,content_sha256,content_bytes}=file;
    assert(typeof path==='string'&&path.trim(),'commit file path missing');
    assert(!seen.has(path),'duplicate commit file: '+path);seen.add(path);
    assert(typeof content==='string','commit file content missing: '+path);
    if(path.endsWith('.json')){
      let value;
      try{value=JSON.parse(content);}catch(error){throw new SyntaxError('Invalid JSON commit payload '+path+': '+error.message);}
      if(/^data\/research\/\d{4}-S\d{2}\.json$/.test(path)){
        assert(value&&typeof value==='object'&&!Array.isArray(value),'research checkpoint must be an object: '+path);
        checkProgressStructures(value);
      }
    }
    const proof={path,bytes:Buffer.byteLength(content,'utf8'),sha256:sha256(content)};
    if(content_sha256!==undefined)assert.equal(proof.sha256,content_sha256,'content fingerprint mismatch: '+path);
    if(content_bytes!==undefined)assert.equal(proof.bytes,content_bytes,'content byte count mismatch: '+path);
    fingerprints.push(proof);
    return {path,mode:'100644',type:'blob',content};
  });
  // Reparse the serialized payload too, rather than trusting a separately
  // inspected object or rereading a mutable content getter before the POST.
  const serialized=JSON.stringify({tree}),payload=JSON.parse(serialized);
  for(const [i,file] of payload.tree.entries()){
    assert.equal(sha256(file.content),fingerprints[i].sha256,'serialized content changed: '+file.path);
    assert.equal(Buffer.byteLength(file.content,'utf8'),fingerprints[i].bytes,'serialized byte count changed: '+file.path);
    if(file.path.endsWith('.json'))JSON.parse(file.content);
  }
  return {tree:payload.tree,fingerprints};
}
export function github(repo=process.env.GITHUB_REPOSITORY){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||''))throw Error('GITHUB_REPOSITORY missing/invalid');
  return (endpoint,method='GET',body)=>{
    const args=['api',`repos/${repo}/${endpoint}`,'--method',method];
    if(body!==undefined)args.push('--input','-');
    const out=execFileSync('gh',args,{encoding:'utf8',maxBuffer:MAX_GITHUB_API_OUTPUT_BYTES,input:body===undefined?undefined:JSON.stringify(body),stdio:['pipe','pipe','pipe']});
    return out.trim()?JSON.parse(out):null;
  };
}
export function readContent(api,ref,p){
  try{let f=api(`contents/${p}?ref=${encodeURIComponent(ref)}`);if(f.encoding!=='base64'&&f.sha)f=api(`git/blobs/${f.sha}`);if(f.encoding!=='base64')throw Error('Unreadable content: '+p);return Buffer.from(f.content,'base64').toString('utf8');}
  catch(e){if(String(e.stderr).includes('HTTP 404'))return null;throw e;}
}
export function commitFiles(api,base,files,message){
  // Finish validation of every file before even a tree/blob POST can occur.
  const prepared=preflightCommitFiles(files);
  const commit=api(`git/commits/${base}`);
  const payload=JSON.parse(JSON.stringify({base_tree:commit.tree.sha,tree:prepared.tree}));
  const tree=api('git/trees','POST',payload);
  return api('git/commits','POST',{message,tree:tree.sha,parents:[base]}).sha;
}
export function branchSha(api,branch){
  try{return api(`git/ref/heads/${branch}`).object.sha;}
  catch(e){if(String(e.stderr).includes('HTTP 404'))return null;throw e;}
}
export function openPR(api,repo,branch,title,body){
  const prs=api(`pulls?state=open&base=main&head=${encodeURIComponent(repo.split('/')[0]+':'+branch)}`);
  if(prs.length>1)throw Error('Ambiguous PRs');
  return prs[0]||api('pulls','POST',{base:'main',head:branch,title,body,draft:false});
}
