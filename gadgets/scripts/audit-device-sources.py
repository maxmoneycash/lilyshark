"""Fetch official catalog references into a private research cache; never publish raw pages."""
import concurrent.futures, hashlib, json, pathlib, re, sys
from datetime import datetime, timezone
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

root = pathlib.Path(__file__).resolve().parents[1]
cache = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/gadgets-source-audit')
cache.mkdir(parents=True, exist_ok=True)
devices = json.loads((root/'data/catalog.json').read_text())
jobs = [(d['slug'], s) for d in devices for s in ([{'url':d['source'],'label':d['sourceLabel']}] if d.get('source') else [])+d.get('extraSources',[])]

def fetch(job):
    slug, source = job
    key = slug+'-'+hashlib.sha256(source['url'].encode()).hexdigest()[:8]
    row = dict(slug=slug, **source, retrieved=datetime.now(timezone.utc).isoformat(), cache=key)
    try:
        response = requests.get(source['url'], timeout=35, headers={'User-Agent':'Mozilla/5.0 (compatible; hardware-source-review/1.0)'})
        row.update(status=response.status_code, finalURL=response.url)
        if 'application/pdf' in response.headers.get('Content-Type','') or response.content.startswith(b'%PDF'):
            # Keep PDFs as PDFs. Binary decoded as HTML creates bogus “page text”.
            (cache/(key+'.pdf')).write_bytes(response.content)
            row.update(title=source['label'], characters=0, links=[], format='pdf', needsReview=True)
            (cache/(key+'.json')).write_text(json.dumps(row,indent=2))
            return row
        soup = BeautifulSoup(response.content, 'html.parser')
        row['title'] = soup.title.get_text(' ',strip=True) if soup.title else ''
        for tag in soup.select('script,style,noscript,svg,nav,header,footer'): tag.decompose()
        main = soup.select_one('main') or soup.select_one('article') or soup
        links = []
        for a in main.select('a[href]'):
            url = urljoin(response.url,a['href'])
            label = a.get_text(' ',strip=True)
            if url.startswith('https://') and re.search(r'doc|spec|manual|download|firmware|github|guide|schematic|datasheet|pinout|software|wiki|source|assembly',label+' '+url,re.I):
                links.append({'label':label[:150], 'url':url})
        text = main.get_text('\n',strip=True)
        row.update(characters=len(text), links=list({x['url']:x for x in links}.values()))
        (cache/(key+'.txt')).write_text(text)
        (cache/(key+'.json')).write_text(json.dumps(row,indent=2))
    except Exception as e:
        row['error'] = str(e)
    return row

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    rows=[]
    for row in pool.map(fetch,jobs):
        rows.append(row)
        print(row['slug'],row.get('status',row.get('error')),row.get('characters',0),flush=True)
(cache/'manifest.json').write_text(json.dumps(rows,indent=2))
print(f'{len(rows)} sources retrieved; inspect and curate facts before publishing.',flush=True)
