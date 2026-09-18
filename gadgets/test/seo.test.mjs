import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setSiteOrigin, detailPage, layout } from '../src/templates.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('pages carry the tags that make a link findable and shareable',async()=>{
  setSiteOrigin('https://example.test');
  const device={slug:'thing',name:'Thing',maker:'Maker',category:'radio',status:'listed',description:'A thing.',tags:['a','b'],specs:{},
    image:'/assets/thing.jpg',source:'https://maker.example/thing',usage:{tasks:['radio'],format:'board',goodFor:'g',capabilities:[]}};
  const html=detailPage(device,[device],{},[],[],[],{makers:[],listings:[]});
  assert.ok(html.includes('<link rel="canonical" href="https://example.test/devices/thing/">'),'canonical');
  assert.ok(html.includes('<meta property="og:url" content="https://example.test/devices/thing/">'),'og:url');
  assert.ok(html.includes('<meta property="og:image" content="https://example.test/assets/thing.jpg">'),'og:image uses the device photo');
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'),'twitter card');
  const ld=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld['@type'],'Product');
  assert.equal(ld.name,'Thing');
  assert.equal(ld.brand.name,'Maker');
  assert.deepEqual(ld.sameAs,['https://maker.example/thing']);
  // A page with no photo still gets a shareable default rather than an empty tag.
  const plain=layout({title:'T',description:'D',body:'',path:'/about/'});
  assert.ok(plain.includes('og:image" content="https://example.test/assets/og-default.png"'));
  assert.ok(plain.includes('<link rel="canonical" href="https://example.test/about/">'));
  setSiteOrigin('https://gadgets.sh');
});

test('an unlaunched preview stays out of search; GADGETS_PUBLIC=1 opts in with a sitemap',async(t)=>{
  // Build into a scratch directory so this never races the shared dist other tests read.
  const dist=await fs.mkdtemp(path.join(os.tmpdir(),'gadgets-seo-'));
  t.after(()=>fs.rm(dist,{recursive:true,force:true}));
  const build=env=>execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,GADGETS_DIST:dist,...env}});

  build({GADGETS_PUBLIC:''});
  assert.equal(await fs.readFile(path.join(dist,'robots.txt'),'utf8'),'User-agent: *\nDisallow: /\n');

  build({GADGETS_PUBLIC:'1',GADGETS_SITE_ORIGIN:'https://example.test'});
  const robots=await fs.readFile(path.join(dist,'robots.txt'),'utf8');
  assert.match(robots,/^User-agent: \*\nAllow: \/\n/);
  assert.match(robots,/Sitemap: https:\/\/example\.test\/sitemap\.xml/);
  const sitemap=await fs.readFile(path.join(dist,'sitemap.xml'),'utf8');
  assert.ok(sitemap.includes('<loc>https://example.test/devices/flipper-zero/</loc>'),'devices are listed');
  assert.ok(!sitemap.includes('/buy/thanks/'),'order confirmation stays out of the sitemap');
  assert.ok(sitemap.match(/<url>/g).length>100,'every page is listed');
});
