import {execFileSync} from 'node:child_process';
export function github(repo=process.env.GITHUB_REPOSITORY){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||''))throw Error('GITHUB_REPOSITORY missing/invalid');
  return (endpoint,method='GET',body)=>{
    const args=['api',`repos/${repo}/${endpoint}`,'--method',method];
    if(body!==undefined)args.push('--input','-');
    const out=execFileSync('gh',args,{encoding:'utf8',input:body===undefined?undefined:JSON.stringify(body),stdio:['pipe','pipe','pipe']});
    return out.trim()?JSON.parse(out):null;
  };
}
export function readContent(api,ref,p){
  try{let f=api(`contents/${p}?ref=${encodeURIComponent(ref)}`);if(f.encoding!=='base64'&&f.sha)f=api(`git/blobs/${f.sha}`);if(f.encoding!=='base64')throw Error('Unreadable content: '+p);return Buffer.from(f.content,'base64').toString('utf8');}
  catch(e){if(String(e.stderr).includes('HTTP 404'))return null;throw e;}
}
export function commitFiles(api,base,files,message){
  const commit=api(`git/commits/${base}`);
  const tree=api('git/trees','POST',{base_tree:commit.tree.sha,tree:files.map(f=>({path:f.path,mode:'100644',type:'blob',content:f.content}))});
  return api('git/commits','POST',{message,tree:tree.sha,parents:[base]}).sha;
}
export function branchSha(api,branch){
  try{return api(`git/ref/heads/${branch}`).object.sha;}
  catch(e){if(String(e.stderr).includes('HTTP 404'))return null;throw e;}
}
export function openPR(api,repo,branch,title,body){
  const prs=api(`pulls?state=open&base=main&head=${encodeURIComponent(repo.split('/')[0]+':'+branch)}`);
  if(prs.length>1)throw Error('Ambiguous PRs');
  return prs[0]||api('pulls','POST',{base:'main',head:branch,title,body});
}
