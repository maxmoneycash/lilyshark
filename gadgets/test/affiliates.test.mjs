import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAffiliates, affiliateLink, isAffiliateActive } from '../src/affiliates.mjs';
import { detailPage } from '../src/templates.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const device={slug:'x',name:'X',maker:'M',category:'radio',status:'listed',description:'d',tags:[],specs:{},source:'https://www.elecrow.com/thinknode-m1.html?a=1',usage:{tasks:['radio'],format:'board',goodFor:'g',capabilities:[]}};

test('shipped affiliate config validates and every program is inactive until an ID is added',async()=>{
  const programs=validateAffiliates(JSON.parse(await fs.readFile(path.join(root,'data/affiliates.json'),'utf8')));
  assert.ok(programs.length>=5);
  for(const program of programs)assert.equal(isAffiliateActive(program),false,program.id);
  assert.equal(affiliateLink('https://www.elecrow.com/thinknode-m1.html',programs),null);
});

test('redirect programs wrap the merchant URL and param programs append one query parameter',()=>{
  const programs=validateAffiliates([
    {id:'a',merchant:'A',hosts:['www.elecrow.com'],mode:'redirect',template:'https://www.awin1.com/cread.php?awinmid=1&awinaffid={id}&ued={url}',affiliateId:'42',applyUrl:'https://example.com/'},
    {id:'b',merchant:'B',hosts:['lilygo.cc'],mode:'param',param:'bg_ref',affiliateId:'abc',applyUrl:'https://example.com/'}
  ]);
  assert.equal(affiliateLink(device.source,programs).href,'https://www.awin1.com/cread.php?awinmid=1&awinaffid=42&ued=https%3A%2F%2Fwww.elecrow.com%2Fthinknode-m1.html%3Fa%3D1');
  assert.equal(affiliateLink('https://lilygo.cc/products/t-deck?variant=2',programs).href,'https://lilygo.cc/products/t-deck?variant=2&bg_ref=abc');
  assert.equal(affiliateLink('https://other.example/',programs),null);
  assert.equal(affiliateLink('http://www.elecrow.com/',programs),null);
});

test('invalid programs are rejected',()=>{
  const base={id:'a',merchant:'A',hosts:['h.example'],mode:'param',param:'r',affiliateId:'',applyUrl:'https://example.com/'};
  for(const bad of [{...base,mode:'other'},{...base,applyUrl:'http://example.com/'},{...base,affiliateId:'bad id'},{...base,mode:'redirect',template:'https://x.example/?u={url}'},{...base,hosts:[]}])assert.throws(()=>validateAffiliates([bad]));
  assert.throws(()=>validateAffiliates([base,{...base,id:'b'}]),/duplicate host/);
});

test('device pages show a disclosed sponsored link only when a program is active',()=>{
  const active=[{id:'a',merchant:'Elecrow',hosts:['www.elecrow.com'],mode:'param',param:'ref',affiliateId:'gs',applyUrl:'https://example.com/'}];
  const plain=detailPage(device,[device],{},[],[],[]);
  assert.ok(plain.includes('Maker’s website') && !plain.includes('rel="sponsored') && !plain.includes('device-affiliate-note'));
  const paid=detailPage(device,[device],{},[],[],active);
  assert.ok(paid.includes('Buy from Elecrow') && paid.includes('rel="sponsored noopener noreferrer"') && paid.includes('ref=gs') && paid.includes('pays us a small commission'));
  assert.ok(!paid.includes('Maker’s website'));
  const concept=detailPage({...device,owned:true},[device],{},[],[],active);
  assert.ok(!concept.includes('rel="sponsored'));
});

test('a device sold through a paying reseller still shows the maker’s own shop',()=>{
  const lab=[{id:'lab401',merchant:'Lab401',hosts:['lab401.com'],mode:'param',param:'ref',affiliateId:'gs',applyUrl:'https://example.com/'}];
  const resold={...device,source:'https://shop.hak5.org/products/key-croc',buy:'https://lab401.com/products/hak5-key-croc'};
  const html=detailPage(resold,[resold],{},[],[],lab);
  assert.ok(html.includes('Buy from Lab401') && html.includes('ref=gs'),'reseller link is tagged');
  assert.ok(html.includes('https://shop.hak5.org/products/key-croc') && html.includes('Maker’s website'),'maker shop stays reachable');
  // When the paid link IS the maker's own shop there is nothing to add.
  const direct=detailPage({...device,source:'https://lab401.com/products/x',buy:undefined},[device],{},[],[],lab);
  assert.equal(direct.match(/Maker’s website/g),null);
});
