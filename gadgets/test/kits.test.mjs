import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKit,readKit,kitFromURL,kitURL,toggleKit,DEFAULT_KIT_NAME,safeURL,remixKit,updateKitPart,partDetails,kitMarkdown,KIT_QUERY_MAX_LENGTH,KIT_FRAGMENT_MAX_BYTES} from '../src/kits.mjs';
const catalog=Array.from({length:8},(_,i)=>({slug:`device-${i}`}));

test('kit links preserve names and selection order while discarding unknown and repeated devices',()=>{
  const kit=normalizeKit({name:'Radio & robots / 夏',devices:['device-2','missing','device-2','device-0']},catalog);
  assert.deepEqual(kitFromURL(kitURL(kit).split('?')[1],catalog),kit);
  assert.deepEqual(kit.devices,['device-2','device-0']);
  assert.equal(kitFromURL('',catalog),null);
  assert.deepEqual(kitFromURL('?devices=',catalog),normalizeKit(null,catalog));
});
test('kits tolerate unavailable storage, malformed values and oversized links',()=>{
  for(const storage of [{getItem(){throw Error('blocked');}},{getItem(){return '{bad';}},{getItem(){return '7';}}])assert.deepEqual(readKit(storage,catalog),normalizeKit(null,catalog));
  const kit=normalizeKit({name:'x'.repeat(100),devices:catalog.map(d=>d.slug)},catalog);
  assert.equal(kit.name.length,64);assert.equal(kit.devices.length,6);
});
test('kit edits are immutable, cap at six, and removal makes space for a different device',()=>{
  const kit=normalizeKit({devices:catalog.slice(0,6).map(d=>d.slug)},catalog);
  assert.equal(toggleKit(kit,'device-6',catalog).reason,'full');
  const removed=toggleKit(kit,'device-0',catalog);
  assert.equal(removed.reason,'removed');assert.equal(kit.devices.length,6);
  const added=toggleKit(removed.kit,'device-6',catalog);
  assert.equal(added.reason,'added');assert.equal(added.kit.devices.at(-1),'device-6');
  assert.equal(toggleKit(kit,'invented',catalog).reason,'unknown');
});

 test('setup stories, custom parts and creator links survive sharing without changing the draft',()=>{
  const draft=normalizeKit({name:'<A & B>',author:'@builder',story:'A custom radio rig — 夏',parts:'Printed case & a custom PCB',project:'https://example.com/build?a=1&b=2',photo:'https://example.com/photo.jpg',devices:[]},catalog);
  const before=structuredClone(draft),shared=kitFromURL(kitURL(draft).split('?')[1],catalog);
  assert.deepEqual(shared,draft);shared.story='Remixed';assert.deepEqual(draft,before);
  assert.equal(normalizeKit({story:'x'.repeat(900),parts:'y'.repeat(800)},catalog).story.length,500);
  assert.equal(normalizeKit({parts:'y'.repeat(800)},catalog).parts.length,240);
 });
 test('project and photo URLs reject executable schemes, credentials and overlong values',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','https://user:password@example.com/','//example.com/a','https://example.com/'+ 'x'.repeat(450)]) assert.equal(safeURL(url),'');
  assert.equal(safeURL('https://example.com/'+'夏'.repeat(100)),'');
  assert.equal(safeURL('http://example.com/project'),'http://example.com/project');
  assert.equal(safeURL('http://example.com/photo.jpg',true),'');
  assert.equal(safeURL('https://example.com/photo.jpg',true),'https://example.com/photo.jpg');
 });

test('a remix keeps source credit while creating an independent editable setup',()=>{
 const source=normalizeKit({name:'Bench radio',author:'@maker',story:'Tested on my bench',devices:['device-0']},catalog);
 const remixed=remixKit(source,catalog);assert.equal(remixed.author,'');assert.equal(remixed.from,'Bench radio by @maker');assert.equal(remixed.name,'Bench radio — remix');
 remixed.devices.push('device-1');assert.deepEqual(source.devices,['device-0']);assert.equal(source.name,'Bench radio');
 assert.deepEqual(kitFromURL(kitURL(remixed).split('?')[1],catalog),remixed);
});

test('part quantities, planning states and notes survive a shared URL while old links still work',()=>{
 const old=kitFromURL('?name=Bench&devices=device-1,device-0',catalog);
 assert.deepEqual(old.items,{});
 const edited=updateKitPart(old,'device-1',{quantity:2,state:'have',note:'One at each end — 868 MHz',link:'',affiliate:false},catalog);
 assert.deepEqual(partDetails(edited.items['device-1']),{quantity:2,state:'have',note:'One at each end — 868 MHz',link:'',affiliate:false});
 assert.deepEqual(kitFromURL(kitURL(edited).split('?')[1],catalog),edited);
 assert.deepEqual(old.items,{});
 assert.deepEqual(updateKitPart(old,'missing',{state:'have'},catalog),old);
 assert.deepEqual(toggleKit(edited,'device-1',catalog).kit.items,{});
 assert.equal(partDetails(remixKit(edited,catalog).items['device-1']).state,'considering');
 assert.equal(partDetails(remixKit(edited,catalog).items['device-1']).quantity,2);
});

test('malformed part data cannot introduce devices, unknown states or excessive quantities',()=>{
 for(const items of ['{bad','null','7','[]','"text"'])assert.deepEqual(kitFromURL(`?devices=device-1&items=${encodeURIComponent(items)}`,catalog).items,{});
 const kit=normalizeKit({devices:['device-1'],items:{'device-0':{state:'have'},'device-1':{quantity:999,state:'constructor',note:'x'.repeat(400)}}},catalog);
 assert.deepEqual(Object.keys(kit.items),['device-1']);
 assert.equal(kit.items['device-1'].quantity,99);
 assert.equal(kit.items['device-1'].state,'considering');
 assert.equal(kit.items['device-1'].note.length,160);
 assert.equal(partDetails({quantity:2.5}).quantity,1);
});

test('a portable parts list includes requirements and source links without activating creator markup',()=>{
 const hardware=[{slug:'radio',name:'A & B radio',source:'https://example.com/radio(v2)',usage:{needs:'A tuned antenna',tradeoff:'Check the regional variant'}}];
 const kit=normalizeKit({name:'<script>bad</script>',story:'[click](javascript:alert(1))',devices:['radio'],items:{radio:{quantity:2,state:'need',note:'One at each end'}}},hardware);
 const exported=kitMarkdown(kit,hardware);
 assert.match(exported,/2 × A & B radio/);
 assert.match(exported,/Status: Need it/);
 assert.match(exported,/Requirements: A tuned antenna/);
 assert.match(exported,/https:\/\/example.com\/radio%28v2%29/);
 assert.ok(!exported.includes('<script>'));
 assert.ok(!exported.includes('[click]('));
 assert.match(exported,/does not establish compatibility/);
});

test('untrusted nested quantities and state values cannot crash a shared setup',()=>{
 for(const invalid of [{toString:1},{valueOf:1},[],{},null,true]){
  const items={'device-1':{quantity:invalid,state:invalid}};
  const kit=kitFromURL(`?devices=device-1&items=${encodeURIComponent(JSON.stringify(items))}`,catalog);
  assert.equal(partDetails(kit.items['device-1']).quantity,1);
  assert.equal(partDetails(kit.items['device-1']).state,'considering');
 }
});
test('repeated remixes retain the first known credit and immediate parent without transferring ownership',()=>{
 const original=normalizeKit({name:'Original radio',author:'Alice',devices:['device-0']},catalog);
 const second={...remixKit(original,catalog),name:'A different antenna',author:'Bob'};
 const third=remixKit(second,catalog);
 assert.equal(third.from,'A different antenna by Bob');
 assert.equal(third.origin,'Original radio by Alice');
 assert.deepEqual(kitFromURL(kitURL(third).split('?')[1],catalog),third);
 assert.match(kitMarkdown(third,catalog),/Earlier version: Original radio by Alice/);
});
test('multiline build notes and accessory lists survive save, share and export',()=>{
 const kit=normalizeKit({story:'First line\r\nSecond line',parts:'Antenna\nUSB cable',devices:['device-0'],items:{'device-0':{note:'First unit\nSecond unit'}}},catalog);
 const shared=kitFromURL(kitURL(kit).split('?')[1],catalog);
 assert.equal(shared.story,'First line\nSecond line');
 assert.equal(shared.parts,'Antenna\nUSB cable');
 assert.equal(shared.items['device-0'].note,'First unit\nSecond unit');
 assert.match(kitMarkdown(shared,catalog),/Antenna\nUSB cable/);
});

test('creator buying links and affiliate disclosure survive share, remix and export without replacement',()=>{
 const kit=normalizeKit({devices:['device-0'],items:{'device-0':{link:'https://maker.example/product?ref=alice&size=small',affiliate:true}}},catalog);
 const shared=kitFromURL(kitURL(kit).split('?')[1],catalog);
 assert.equal(shared.items['device-0'].link,'https://maker.example/product?ref=alice&size=small');
 assert.equal(shared.items['device-0'].affiliate,true);
 assert.equal(remixKit(shared,catalog).items['device-0'].link,shared.items['device-0'].link);
 assert.match(kitMarkdown(shared,catalog),/Creator affiliate buying link/);
 for(const link of ['javascript:alert(1)','https://me:secret@example.com/','file:///tmp/test'])assert.equal(partDetails({link}).link,'');
 assert.equal(partDetails({affiliate:'true'}).affiliate,false);
});

const parseSharedKit=(link,devices=catalog)=>{
 const url=new URL(link,'https://gadgets.example');
 return kitFromURL(url.search,devices,url.hash);
};
const fragmentFor=value=>'#kit=v1.'+Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');

test('bounded setup fields retain complete Unicode code points at every field limit',()=>{
 const limits={name:64,author:40,from:120,origin:120,story:500,parts:240};
 for(const [key,limit] of Object.entries(limits)){
  const input={devices:['device-0'],[key]:'A'.repeat(limit-1)+'📻'};
  const kit=normalizeKit(input,catalog);
  assert.equal(kit[key],'A'.repeat(limit-1),key);
  assert.ok(kit[key].isWellFormed(),key);
  assert.deepEqual(parseSharedKit(kitURL(kit)),kit,key);
  assert.equal(normalizeKit({...input,[key]:'A'.repeat(limit-2)+'📻'},catalog)[key],'A'.repeat(limit-2)+'📻',key);
 }
 const kit=normalizeKit({name:'A'.repeat(55)+'📻',devices:['device-0'],items:{'device-0':{note:'A'.repeat(159)+'📻'}}},catalog);
 assert.equal(kit.items['device-0'].note,'A'.repeat(159));
 const remixed=remixKit(kit,catalog);
 assert.equal(remixed.name,'A'.repeat(55)+' — remix');
 assert.ok(remixed.name.isWellFormed());
 assert.deepEqual(parseSharedKit(kitURL(remixed)),remixed);
 const malformed=normalizeKit({name:'A\ud800B\udc00C',story:'\ud800',devices:['device-0']},catalog);
 assert.equal(malformed.name,'A�B�C');
 assert.deepEqual(parseSharedKit(kitURL(malformed)),malformed);
});

test('short links keep their legacy format and legacy query snapshots remain readable',()=>{
 const kit=normalizeKit({name:'Old & new',devices:['device-1','device-0']},catalog);
 assert.equal(kitURL(kit),'/setup/?name=Old+%26+new&devices=device-1%2Cdevice-0');
 assert.deepEqual(parseSharedKit(kitURL(kit)),kit);
 assert.deepEqual(kitFromURL('?devices=device-1&name=Bench',catalog,'#parts'),normalizeKit({name:'Bench',devices:['device-1']},catalog));
 const long=normalizeKit({name:'Legacy Unicode',story:'界'.repeat(500),devices:['device-0'],items:{'device-0':{note:'📻'.repeat(80),link:'https://maker.example/?ref=alice',affiliate:true}}},catalog);
 const legacy=new URLSearchParams({...long,devices:long.devices.join(','),items:JSON.stringify(long.items)});
 assert.ok(legacy.toString().length>KIT_QUERY_MAX_LENGTH);
 assert.deepEqual(kitFromURL('?'+legacy,catalog),long);
});

test('realistic six-device Unicode setups use a fragment and preserve creator links, credits and states',()=>{
 const devices=catalog.slice(0,6).map(d=>d.slug);
 const kit=normalizeKit({name:'週末の無線ベンチ — radio lab 📻',author:'@工作室_Émilie',from:'A radio bench by @previous',origin:'The first radio bench by @first',devices,
  story:'今週末は GPS ログと無線機の設定を比べます。\nCheck the exact hardware and firmware before starting. 🔧',parts:'予備バッテリー、USB-C ケーブル、ケース、アンテナ。\n2 × microSD cards.',project:'https://maker.example/my-radio-bench',
  items:Object.fromEntries(devices.map((id,i)=>[id,{quantity:i+1,state:['considering','have','need'][i%3],note:'ファームウェアの版、端子、周波数設定を先に確認。\nKeep the existing creator buying link. 🔧',link:`https://maker.example/${id}?ref=alice&utm_source=creator&utm_medium=social&utm_campaign=weekend-radio-bench`,affiliate:i%2===0}]))},catalog);
 const before=structuredClone(kit),url=new URL(kitURL(kit),'https://gadgets.example');
 assert.equal(url.pathname,'/setup/');assert.equal(url.search,'');assert.match(url.hash,/^#kit=v1\.[A-Za-z0-9_-]+$/);
 assert.deepEqual(parseSharedKit(url.href),kit);assert.deepEqual(kit,before);
 const legacy=new URLSearchParams({...kit,devices:kit.devices.join(','),items:JSON.stringify(kit.items)});
 assert.ok(url.href.length<new URL('/setup/?'+legacy,'https://gadgets.example').href.length);
 const payload=JSON.parse(Buffer.from(url.hash.slice('#kit=v1.'.length),'base64url').toString());
 assert.ok(!Object.hasOwn(payload.items['device-0'],'quantity'));
 assert.ok(!Object.hasOwn(payload.items['device-0'],'state'));
 assert.equal(payload.items['device-0'].link,kit.items['device-0'].link);
});

test('maximum normalized Unicode snapshots stay bounded and keep the server request target short',()=>{
 const devices=catalog.slice(0,6).map(d=>d.slug),urlPrefix='https://maker.example/?ref=';
 const buyingURL=urlPrefix+'&'.repeat(400-urlPrefix.length);
 const kit=normalizeKit({name:'界'.repeat(64),author:'界'.repeat(40),from:'前'.repeat(120),origin:'元'.repeat(120),story:'界'.repeat(500),parts:'界'.repeat(240),project:buyingURL,photo:buyingURL,devices,
  items:Object.fromEntries(devices.map(id=>[id,{quantity:99,state:'have',note:'界'.repeat(160),link:buyingURL,affiliate:true}]))},catalog);
 const url=new URL(kitURL(kit),'https://gadgets.example');
 assert.equal(url.pathname+url.search,'/setup/');
 assert.deepEqual(parseSharedKit(url.href),kit);
 assert.ok(Buffer.from(url.hash.slice('#kit=v1.'.length),'base64url').length<=KIT_FRAGMENT_MAX_BYTES);
 const customOnly=normalizeKit({...kit,devices:[],items:{}},catalog);
 assert.deepEqual(parseSharedKit(kitURL(customOnly)),customOnly);
});

test('fragment decoding rejects unknown, malformed and oversized payloads before use',()=>{
 const old='?devices=device-0&name=Old';
 const malformed=['#kit=','#kit=v2.abc','#kit=v1.','#kit=v1.a','#kit=v1.%20','#kit=v1.e30=','#kit=v1.e30&devices=device-0',
  fragmentFor('{bad'),fragmentFor('null'),fragmentFor('[]'),fragmentFor('7'),fragmentFor('{}'),fragmentFor({devices:'device-0'}),
  '#kit=v1.'+Buffer.from([0xc3,0x28]).toString('base64url'),
  '#kit=v1.'+'a'.repeat(Math.ceil(KIT_FRAGMENT_MAX_BYTES/3)*4+1),
  fragmentFor('{"devices":[]}'.padEnd(KIT_FRAGMENT_MAX_BYTES+1,' ')),
  '#kit=v1.eyJkZXZpY2VzIjpbXX1'];
 for(const hash of malformed)assert.equal(kitFromURL(old,catalog,hash),null,hash.slice(0,70));
 assert.deepEqual(kitFromURL('',catalog,fragmentFor('{"devices":[]}'.padEnd(KIT_FRAGMENT_MAX_BYTES,' '))),normalizeKit(null,catalog));
 const hostile={name:'x'.repeat(100),devices:['missing','device-0','device-0'],project:'javascript:alert(1)',items:{'device-0':{quantity:{toString:1},state:'constructor',note:'界'.repeat(300),link:'https://user:secret@maker.example/'}}};
 assert.deepEqual(kitFromURL('',catalog,fragmentFor(hostile)),normalizeKit(hostile,catalog));
 assert.deepEqual(kitFromURL(old,catalog,fragmentFor({name:'Fragment wins',devices:[]})),normalizeKit({name:'Fragment wins',devices:[]},catalog));
 assert.throws(()=>kitURL({name:'Too large',devices:['device-0'],story:'界'.repeat(KIT_FRAGMENT_MAX_BYTES)}),/too large/);
});
