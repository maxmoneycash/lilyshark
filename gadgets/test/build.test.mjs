import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { guides, comparisons } from '../src/guides.mjs';
import {collections} from '../src/discovery.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));

test('catalog expansion has primary-source evidence and intact credited local images',async()=>{
  const catalog=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
  const originalExpansion=JSON.parse(await fs.readFile(path.join(root,'data/expansion-2026-09-15.json'),'utf8'));
  const currentExpansion=JSON.parse(await fs.readFile(path.join(root,'data/expansion-2026-09-16.json'),'utf8'));
  const added=[...originalExpansion,...currentExpansion];
  const images=JSON.parse(await fs.readFile(path.join(root,'data/images.json'),'utf8'));
  assert.equal(originalExpansion.length,22);
  assert.ok(currentExpansion.length>0);
  assert.equal(new Set(added).size,added.length);
  assert.equal(catalog.filter(d=>!added.includes(d.slug)).length,45);
  for(const slug of added){
    const d=catalog.find(d=>d.slug===slug),image=images[slug];
    assert.ok(d.verified && d.checked && d.verificationNotes.length>=2,slug);
    assert.ok(d.source.startsWith('https://') && d.usage.needs && d.usage.tradeoff,slug);
    assert.ok(image.credit && image.sourcePage.startsWith('https://'),slug);
    const bytes=await fs.readFile(path.join(root,'public',image.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256,slug);
  }
});

test('build produces all device routes, valid local links and only curated public data',async()=>{
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root});
  const catalog=JSON.parse(await fs.readFile(path.join(root,'dist/catalog.json'),'utf8'));
  const sourceCatalog=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
  assert.deepEqual(catalog.map(d=>d.slug),sourceCatalog.map(d=>d.slug));
  assert.equal(new Set(catalog.map(d=>d.slug)).size,catalog.length);
  for(const d of catalog){
    const html=await fs.readFile(path.join(root,'dist/devices',d.slug,'index.html'),'utf8');
    assert.match(html,/<h1>/);
    if(!d.owned){
      assert.ok(d.reviewed && d.verificationNotes.length,`Missing review: ${d.slug}`);
      assert.ok(d.image && d.imageSourcePage && d.imageCaption && d.imageCredit,`Missing image credit: ${d.slug}`);
      assert.ok(d.imageWidth > 0 && d.imageHeight > 0);
      assert.equal(d.archivedPrice,undefined);
    }
    for(const [,href] of html.matchAll(/(?:href|src)="(\/[^"?#]*)/g)){
      await fs.access(path.join(root,'dist',href,href.endsWith('/')?'index.html':''));
    }
  }
  await assert.rejects(fs.access(path.join(root,'dist/data/archive.json')));
  const html=await fs.readFile(path.join(root,'dist/hardware/index.html'),'utf8');
  assert.equal([...html.matchAll(/<article class="device-card"/g)].length,catalog.length);
  for(const route of ['/','/hardware/','/builds/','/builds/lilyshark/','/builds/scout-lite/','/for-makers/','/firmware/lilyshark/','/about/','/saved/','/compare/','/setup/','/kit/','/collections/',...collections.map(c=>`/collections/${c.slug}/`),'/guides/',...guides.map(g=>`/guides/${g.slug}/`),...comparisons.map(c=>`/comparisons/${c.slug}/`)]){
    const html=await fs.readFile(path.join(root,'dist',route,'index.html'),'utf8');
    for(const [,href] of html.matchAll(/(?:href|src)="(\/[^"?#]*)/g))await fs.access(path.join(root,'dist',href,href.endsWith('/')?'index.html':''));
    if(route.startsWith('/comparisons/')){
      assert.match(html,/data-initial-compare=/);
    assert.match(html,/<table class="comparison"[^>]*>/);
      assert.match(html,/Revision & source notes/);
    }
  }
});

test('preview serves pages, redirects directory URLs, and never serves source files',async()=>{
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root});
  const server=spawn(process.execPath,['scripts/dev.mjs'],{cwd:root,env:{...process.env,GADGETS_PORT:'54645'},stdio:['ignore','pipe','pipe']});
  let startupError='';
  server.stderr.on('data',chunk=>{startupError+=chunk;});
  const startupTimeout=AbortSignal.timeout(10000);
  try {
    await Promise.race([
      once(server.stdout,'data',{signal:startupTimeout}),
      once(server,'exit',{signal:startupTimeout}).then(([code])=>{throw new Error(`Preview exited during startup (${code}): ${startupError}`);})
    ]);
    const base='http://127.0.0.1:54645';
    assert.equal((await fetch(base+'/')).status,200);
    const redirected=await fetch(base+'/devices/flipper-zero?q=x',{redirect:'manual'});
    assert.equal(redirected.status,308);
    assert.equal(redirected.headers.get('location'),'/devices/flipper-zero/?q=x');
    assert.equal((await fetch(base+'/devices/missing/')).status,404);
    assert.equal((await fetch(base+'/data/archive.json')).status,404);
    assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
    assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  } finally {if(server.exitCode===null && server.signalCode===null){const exited=once(server,'exit');server.kill();await exited;}}
});
