"""One-shot, hash-bound transport. Does not update any remote ref or publish."""
import base64, copy, datetime as dt, hashlib, json, lzma, os, pathlib, subprocess, urllib.request
BASE='dc90984a8fad7e3c746ab1617b9f400cbce0afb0'
OWNER='9cc03728-3c04-4cf7-8f90-b130b4f43364'
WEEK='2026-S43'
DIGEST='b7b22ce7f0ac47f6a47e72058f2cd9650031c01d177df5cae45dc82d00b9404c'
PREFIX='https://api.github.com/repos/kingrabbit89/selection-tv/'
SOURCE=pathlib.Path(__file__).resolve().parent
ROOT=pathlib.Path(os.environ['CANDIDATE']).resolve()
OUT=pathlib.Path(os.environ['OUT']).resolve();OUT.mkdir(parents=True,exist_ok=True)
PATHS={'data/coverage/2026-S43.json','data/links.json','data/research/2026-S43.json','data/weeks/2026-S43.json','data/works.json'}
def api(path,data=None):
    headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+os.environ['GH_TOKEN'],'X-GitHub-Api-Version':'2022-11-28'}
    req=urllib.request.Request(PREFIX+path,headers=headers,data=None if data is None else json.dumps(data).encode())
    with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)
def guard():
    assert api('git/ref/heads/auto/2026-S43')['object']['sha']==BASE,'Candidate changed; reconcile, do not overwrite'
    ref=api('git/ref/heads/locks/editorial-2026-S43')['object']['sha']
    lease=json.loads(api('git/commits/'+ref)['message'])
    assert lease['kind']=='selection-tv-editorial-lease' and lease['week']==WEEK and lease['owner']==OWNER and not lease.get('released'), 'Lease ownership lost'
    assert dt.datetime.fromisoformat(lease['expires_at'].replace('Z','+00:00'))>dt.datetime.now(dt.timezone.utc), 'Lease expired'
    return ref

def run(args):return subprocess.check_output(args,cwd=ROOT,text=True)
def digest(b):return hashlib.sha256(b).hexdigest()
def apply(value,operations):
    assert isinstance(operations,list) and len(operations)<1000
    for op in operations:
        path=op['path'];assert isinstance(path,list) and 0<len(path)<30 and all(type(k) in (str,int) for k in path)
        target=value
        for key in path[:-1]:target=target[key]
        kind=op['op']
        if kind=='set':target[path[-1]]=copy.deepcopy(op['value'])
        elif kind=='remove':del target[path[-1]]
        elif kind=='append':
            target=target[path[-1]];assert isinstance(target,list);target.append(copy.deepcopy(op['value']))
        elif kind=='reorder':
            target=target[path[-1]];assert isinstance(target,dict) and set(target)==set(op['keys']) and len(op['keys'])==len(target)
            ordered={key:target[key] for key in op['keys']};target.clear();target.update(ordered)
        else:raise ValueError('Unknown operation')
    return value

assert run(['git','rev-parse','HEAD']).strip()==BASE
assert not run(['git','status','--porcelain'])
lease=guard()
encoded=''.join((SOURCE/('patch-%02d.txt'%i)).read_text().strip() for i in range(6));assert len(encoded)==27180
compressed=base64.b64decode(encoded,validate=True)
decoder=lzma.LZMADecompressor();raw=decoder.decompress(compressed,max_length=2_000_001)
assert decoder.eof and not decoder.unused_data and len(raw)<=2_000_000 and digest(raw)==DIGEST
payload=json.loads(raw)
assert payload['schema_version']==1 and payload['week']==WEEK and payload['base_sha']==BASE and payload['lease_owner']==OWNER
assert {x['path'] for x in payload['updates']}==PATHS and len(payload['updates'])==len(PATHS)
files=[]
for update in payload['updates']:
    path=update['path'];original=(ROOT/path).read_bytes();assert digest(original)==update['base_sha256'],path+' base hash mismatch'
    result=apply(json.loads(original),update['ops'])
    content=json.dumps(result,ensure_ascii=False,indent=2)+'\n';assert digest(content.encode())==update['sha256'],path+' result hash mismatch'
    files.append({'path':path,'base_sha256':update['base_sha256'],'content':content})
research=json.loads(next(f['content'] for f in files if f['path']=='data/research/2026-S43.json'))
assert research['stage']!='ready' and research['remaining']
bundle={'schema_version':1,'week':WEEK,'base_sha':BASE,'stage':'enrichment','remaining':research['remaining'],'files':files}
bundle_path=OUT/'2026-S43.json';bundle_path.write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n')
for mode in ['check','apply']:
    log=run(['node','scripts/editorial-handoff.mjs',mode,str(bundle_path)]);(OUT/('handoff-'+mode+'.txt')).write_text(log)
checks=[]
for script in ['validate-links.mjs','validate-freshness.mjs']:
    log=run(['node','scripts/'+script]);(OUT/(script+'.txt')).write_text(log);checks.append({'script':script,'status':'passed'})
changed=set(run(['git','diff','--name-only']).splitlines());assert changed==PATHS
assert json.loads((ROOT/'data/manifest.json').read_text())['latest']=='2026-S42'
assert json.loads((ROOT/'data/weeks/2026-S43.json').read_text())['publication_status']=='draft'
lease=guard()
base_tree=api('git/commits/'+BASE)['tree']['sha'];entries=[];hashes={}
for item in files:
    body=(ROOT/item['path']).read_bytes();expected=next(x['sha256'] for x in payload['updates'] if x['path']==item['path']);assert digest(body)==expected
    blob=api('git/blobs',{'content':body.decode(),'encoding':'utf-8'})['sha']
    assert blob==hashlib.sha1(('blob '+str(len(body))+'\0').encode()+body).hexdigest()
    entries.append({'path':item['path'],'mode':'100644','type':'blob','sha':blob});hashes[item['path']]=expected
newtree=api('git/trees',{'base_tree':base_tree,'tree':entries})['sha']
run(['git','add','--',*sorted(PATHS)]);assert run(['git','write-tree']).strip()==newtree
stamp=dt.datetime.now(dt.timezone.utc).replace(microsecond=0);name='Selection TV editorial transport';email='noreply@users.noreply.github.com'
message='editorial(S43): integrate thirteen reviewed daily reserves from Chat, keep draft\n\nExact five-file batch verified by original and resulting SHA-256; seven daily pools now contain ten complete candidates. Other sections and editorial review remain unfinished. No publication or reference change performed by this job.'
author={'name':name,'email':email,'date':stamp.isoformat().replace('+00:00','Z')}
commit=api('git/commits',{'message':message,'tree':newtree,'parents':[BASE],'author':author,'committer':author})['sha']
# Recreate the returned, unsigned object locally and verify rather than assuming its bytes.
header='tree '+newtree+'\nparent '+BASE+'\nauthor '+name+' <'+email+'> '+str(int(stamp.timestamp()))+' +0000\ncommitter '+name+' <'+email+'> '+str(int(stamp.timestamp()))+' +0000\n\n'
match=None
for suffix in ['\n','']:
    body=(header+message+suffix).encode()
    if hashlib.sha1(('commit '+str(len(body))+'\0').encode()+body).hexdigest()==commit:match=body;break
assert match is not None,'Remote commit format differs: do not move candidate'
local=subprocess.check_output(['git','hash-object','-t','commit','-w','--stdin'],input=match,cwd=ROOT).decode().strip();assert local==commit
run(['git','update-ref','refs/heads/chat-reviewed-batch',commit]);run(['git','bundle','create',str(OUT/'candidate.bundle'),'refs/heads/chat-reviewed-batch'])
report={'week':WEEK,'base_sha':BASE,'commit_sha':commit,'tree_sha':newtree,'lease_ref_checked':lease,'files':hashes,'checks':checks,'remote_refs_updated':False,'publication_status':'draft','complete_issue':False}
(OUT/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
