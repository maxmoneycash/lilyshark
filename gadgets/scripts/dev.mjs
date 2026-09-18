import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.GADGETS_PORT || 54644);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const server = http.createServer(async (req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{Allow:'GET, HEAD'}).end(); return; }
  try {
    const url = new URL(req.url,'http://localhost');
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0') || decoded.includes('\\')) { res.writeHead(400).end('Bad request'); return; }
    let file = path.resolve(root, `.${decoded}`);
    if (file !== path.resolve(root) && !file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
    let status = 200;
    try {
      const info = await fs.stat(file);
      if (info.isDirectory()) {
        if (!url.pathname.endsWith('/')) { res.writeHead(308,{Location:url.pathname+'/'+url.search}).end(); return; }
        file = path.join(file,'index.html');
      }
      await fs.access(file);
    } catch { file = path.join(root,'404.html'); status=404; }
    const data = await fs.readFile(file);
    res.writeHead(status,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Length':data.length});
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(400).end('Bad request'); }
});
server.listen(port,'127.0.0.1',()=>console.log(`gadgets.sh preview: http://127.0.0.1:${port}`));
