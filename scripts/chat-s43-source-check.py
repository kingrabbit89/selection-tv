"""Temporary read-only publisher checks for the user-requested S43 production.
No cookies, authentication, private URLs, retries or access-control workarounds.
"""
import concurrent.futures, datetime, hashlib, html, json, pathlib, re, urllib.error, urllib.parse, urllib.request
OUT = pathlib.Path('/tmp/chat-s43-evidence'); OUT.mkdir(parents=True, exist_ok=True)
URLS = [
'https://torrentfreak.com/top-10-most-torrented-pirated-movies/',
'https://torrentfreak.com/most-pirated-movies-of-2026-weekly-archive/',
'https://www.criterion.com/films/31102-welcome-ii-the-terrordome',
'https://www.criterion.com/films/27993-the-shout',
'https://www.criterion.com/films/28912-christiane-f',
'https://www.criterion.com/films/528-the-silence-of-the-lambs',
'https://www.criterion.com/films/34234-days-and-nights-in-the-forest',
'https://www.arrowfilms.com/p/4k/the-long-good-friday-4k-uhd/18022598/',
'https://www.arrowfilms.com/p/the-last-boy-scout-limited-edition-4k-uhd/17977994/',
'https://www.arrowfilms.com/p/4k/creepshow-2-4k-uhd/18022597/',
'https://www.arrowfilms.com/p/the-monster-squad-limited-edition-4k-uhd/17977982/',
'https://www.arrowfilms.com/p/cujo-limited-edition-4k-uhd/17977990/',
'https://www.arrowfilms.com/p/futureworld-limited-edition-4k-uhd/17977987/',
'https://laboutique.carlottafilms.com/products/vivre-de-akira-kurosawa',
'https://laboutique.carlottafilms.com/products/nadja-de-michael-almereyda',
'https://laboutique.carlottafilms.com/products/sailor-suit-and-machine-gun-de-shinji-somai',
'https://laboutique.carlottafilms.com/products/sangre-del-toro-de-yves-montmayeur',
'https://www.arte.tv/fr/videos/127462-000-A/le-grand-jeu-de-jessica-chastain/',
'https://www.arte.tv/fr/videos/047933-000-A/monuments-eternels/',
'https://www.arte.tv/fr/videos/130396-000-A/ma-vie-maga/',
'https://www.arte.tv/fr/videos/124239-080-A/arte-reportage/',
'https://www.arte.tv/fr/videos/130381-000-A/interstellar/',
'https://www.arte.tv/fr/videos/026377-000-A/cadavres-exquis/',
'https://www.francetvpro.fr/contenu-de-presse/78925088',
'https://www.francetvpro.fr/contenu-de-presse/78909360',
'https://www.gaumont.com/en/node/203',
'https://www.netflix.com/fr/title/81757047',
'https://www.canalplus.com/cinema/marty-supreme/h/31399311_40099/streaming/'
]
def read_url(url, max_bytes):
    if urllib.parse.urlparse(url).scheme != 'https': raise ValueError('HTTPS only')
    request = urllib.request.Request(url, headers={'User-Agent': 'SelectionTV-PublicEvidenceCheck/1.0', 'Accept': 'text/html,application/json,image/*;q=0.8'})
    with urllib.request.urlopen(request, timeout=25) as response:
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes: raise ValueError('Response exceeds byte limit')
        return data, response.geturl(), response.status, response.headers.get('Content-Type', '')
def one(pair):
    i, url = pair
    row = {'url': url, 'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        data, final, status, mime = read_url(url, 6*1024*1024)
        row.update(status=status, final_url=final, content_type=mime, sha256=hashlib.sha256(data).hexdigest())
        name = f'{i:02d}.html'; (OUT / name).write_bytes(data); row['file'] = name
        text = data.decode('utf-8', 'replace')
        images = []
        for tag in re.findall(r'<meta\b[^>]+>', text, re.I):
            attrs = dict((k.lower(), html.unescape(v)) for k, q, v in re.findall(r'([\w:-]+)\s*=\s*([\"\x27])(.*?)\2', tag, re.S))
            if attrs.get('property', attrs.get('name', '')).lower() in ('og:image', 'twitter:image', 'twitter:image:src') and attrs.get('content'):
                image = urllib.parse.urljoin(final, attrs['content'])
                if image not in images: images.append(image)
        row['image_candidates'] = images
        if images:
            try:
                image, image_url, image_status, image_mime = read_url(images[0], 12*1024*1024)
                magic = image.startswith(b'\xff\xd8\xff') or image.startswith(b'\x89PNG\r\n\x1a\n') or image.startswith(b'RIFF')
                if not magic: raise ValueError('Image response has no recognized raster magic')
                filename=f'{i:02d}.image'; (OUT / filename).write_bytes(image)
                row['downloaded_image']={'url':image_url,'status':image_status,'content_type':image_mime,'file':filename,'sha256':hashlib.sha256(image).hexdigest()}
            except Exception as error: row['image_error']=str(error)
    except Exception as error: row['error'] = str(error)
    return row
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    rows=list(pool.map(one, enumerate(URLS)))
(OUT/'report.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
for row in rows: print(row['url'], row.get('status',row.get('error')), 'image:',bool(row.get('downloaded_image')))
