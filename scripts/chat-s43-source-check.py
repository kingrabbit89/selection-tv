"""Read-only second S43 evidence batch. No auth, cookies or access-control bypass."""
import concurrent.futures, datetime, hashlib, html, json, pathlib, re, urllib.parse, urllib.request
OUT=pathlib.Path('/tmp/chat-s43-evidence'); OUT.mkdir(parents=True,exist_ok=True)
URLS=[
'https://www.arte.tv/fr/videos/083910-000-A/thorin-le-dernier-neandertalien/',
'https://www.arte.tv/fr/videos/128690-000-A/shutter-island/',
'https://www.arte.tv/fr/videos/121277-000-A/israel-comment-sauver-la-democratie/',
'https://www.arte.tv/fr/videos/110207-000-A/potiche/',
'https://www.cinematheque.fr/film/32707.html',
'https://shellacfilms.com/film/pile-ou-face/',
'https://le-pacte.com/france/film/un-jour-avec-mon-pere',
'https://www.bacfilms.com/films/allah-n-est-pas-oblige/',
'https://www.senscritique.com/film/les_malheurs_de_sophie/13394677',
'https://www.senscritique.com/film/furcy_ne_libre/76518949',
'https://www.senscritique.com/film/pile_ou_face/110010295',
'https://www.senscritique.com/film/un_jour_avec_mon_pere/110061876',
'https://www.senscritique.com/film/allah_n_est_pas_oblige/111685727',
'https://www.senscritique.com/film/le_mecano_de_la_generale/365810',
'https://www.canalplus.com/fr/cinema/love-on-trial/h/31616648_50002',
'https://www.canalplus.com/fr/cinema/l-interet-d-adam/h/30267479_50001',
'https://www.canalplus.com/fr/cinema/exit-8/h/30486943_50001',
'https://www.canalplus.com/cinema/cadet-d-eau-douce/h/30347560_50002',
'https://www.canalplus.com/cinema/la-proie-nue/h/1550542_50002',
'https://www.canalplus.com/cinema/becoming-hitchcock-the-legacy-of-blackmail/h/27531750_50002',
'https://www.canalplus.com/cinema/une-jeunesse-indienne/h/31652206_50002',
'https://www.canalplus.com/cinema/left-handed-girl/h/30363126_50002',
'https://laboutique.carlottafilms.com/cdn/shop/files/3DVIVREUHDDEFAVECSTICKER_1200x1200.png?v=1789481039',
'https://laboutique.carlottafilms.com/cdn/shop/files/3DNADJAUHDDEF_1200x1200.png?v=1790343728',
'https://laboutique.carlottafilms.com/cdn/shop/files/3DSAILORSUITANDMACHINEGUNUHD_BDDEF_1200x1200.png?v=1787926893',
'https://laboutique.carlottafilms.com/cdn/shop/files/3DSANGREDELTOROBDSINGLEDEF_1200x1200.png?v=1787841878',
'https://awakeningfilm.com/en/about',
'https://www.senscritique.com/film/Sainte_Sophie_devoilee/43130780/videos',
'https://www.senscritique.com/film/vivre/462135',
'https://www.senscritique.com/film/nadja/458165',
'https://www.senscritique.com/film/sailor_suit_and_machine_gun/8289911'
]
def read(url):
 if urllib.parse.urlparse(url).scheme!='https': raise ValueError('HTTPS only')
 req=urllib.request.Request(url,headers={'User-Agent':'SelectionTV-PublicEvidenceCheck/1.0','Accept':'text/html,application/json,image/*;q=0.8'})
 with urllib.request.urlopen(req,timeout=25) as response:
  data=response.read(12*1024*1024+1)
  if len(data)>12*1024*1024:raise ValueError('Byte limit exceeded')
  return data,response.geturl(),response.status,response.headers.get('Content-Type','')
def raster(data):return data.startswith(b'\xff\xd8\xff') or data.startswith(b'\x89PNG\r\n\x1a\n') or data.startswith(b'RIFF')
def one(pair):
 i,url=pair;row={'url':url,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  data,final,status,mime=read(url);row.update(status=status,final_url=final,content_type=mime,sha256=hashlib.sha256(data).hexdigest())
  if raster(data):
   name=f'{i:02d}.image';(OUT/name).write_bytes(data);row['file']=name;row['downloaded_image']={'url':final,'file':name,'sha256':row['sha256'],'content_type':mime};return row
  name=f'{i:02d}.html';(OUT/name).write_bytes(data);row['file']=name;text=data.decode('utf8','replace');images=[]
  for tag in re.findall(r'<meta\b[^>]+>',text,re.I):
   attrs=dict((k.lower(),html.unescape(v)) for k,q,v in re.findall(r'([\w:-]+)\s*=\s*([\"\x27])(.*?)\2',tag,re.S))
   if attrs.get('property',attrs.get('name','')).lower() in ('og:image','twitter:image','twitter:image:src') and attrs.get('content'):
    image=urllib.parse.urljoin(final,attrs['content'])
    if image not in images:images.append(image)
  row['image_candidates']=images
  if images:
   try:
    image,image_url,image_status,image_mime=read(images[0])
    if not raster(image):raise ValueError('No recognized raster magic')
    filename=f'{i:02d}.image';(OUT/filename).write_bytes(image);row['downloaded_image']={'url':image_url,'status':image_status,'content_type':image_mime,'file':filename,'sha256':hashlib.sha256(image).hexdigest()}
   except Exception as error:row['image_error']=str(error)
 except Exception as error:row['error']=str(error)
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(one,enumerate(URLS)))
(OUT/'report.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
for row in rows:print(row['url'],row.get('status',row.get('error')),'image:',bool(row.get('downloaded_image')))
