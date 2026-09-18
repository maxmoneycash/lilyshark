import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFilters, filterDevices, sortDevices, filterURL, readSaved, compareIDs, resolveComparison, escapeHTML, selection } from '../src/catalog.mjs';
import { detailPage, compareTable } from '../src/templates.mjs';
const devices = JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url)));

test('search combines terms across device fields and intersects independent facets',()=>{
  const found=filterDevices(devices,readFilters('?q=pager+LoRa&category=radio&status=soldout'));
  assert.deepEqual(found.map(d=>d.slug),['the-hacker-pager']);
  assert.deepEqual(filterDevices(devices,readFilters('?q=pager&category=rfid')),[]);
  const tdecks=filterDevices(devices,readFilters('?q=%20%20LILYGO%20%20T-DECK%20'));
  assert.ok(tdecks.some(d=>d.slug==='lilygo-t-deck-plus') && tdecks.every(d=>/t-deck/i.test(d.name)));
  assert.deepEqual(filterDevices(devices,readFilters('?q=CC1111&status=listed')).map(d=>d.slug),['yard-stick-one']);
});
test('untrusted URL facets and view fall back to valid defaults',()=>{
  assert.deepEqual(readFilters('?category=constructor&status=toString&task=constructor&format=toString&capability=constructor&sort=oops&checked=yes&view=oops'),{q:'',category:'all',status:'all',task:'all',format:'all',capability:'all',sort:'useful',checked:false,view:'carousel'});
  assert.equal(readFilters('?q='+ 'a'.repeat(500)).q.length,200);
});
test('radio filters combine hardware, form factor and evidence without implying optional capabilities',()=>{
  const found=filterDevices(devices,readFilters('?q=ESP32-C5&capability=wifi5&format=addon&status=listed&checked=1'));
  for (const id of ['scout-lite','apex-5']) assert.ok(found.some(d=>d.slug===id),`ESP32-C5 addon filter missing ${id}`);
  assert.ok(found.every(d=>d.usage.format==='addon' && d.usage.capabilities.includes('wifi5')));
  assert.ok(filterDevices(devices,readFilters('?q=ESP32-C5&status=soldout')).some(d=>d.slug==='rabbit-labs-c5'));
  const mesh=filterDevices(devices,readFilters('?capability=meshtastic'));
  assert.ok(mesh.some(d=>d.slug==='sensecap-t1000-e'));
  assert.ok(!mesh.some(d=>d.slug==='chatter-2-0'));
  const gnss=filterDevices(devices,readFilters('?capability=gnss'));
  assert.ok(!gnss.some(d=>d.slug==='biscuit-ultra'));
  const hf=filterDevices(devices,readFilters('?capability=hf'));
  assert.ok(!hf.some(d=>d.slug==='meowkit'));
  for (const id of ['rak-wisblock-meshtastic-starter-kit','heltec-mesh-node-t114']) assert.ok(!gnss.some(d=>d.slug===id),`${id} has optional GNSS`);
  // Membership checks are stated as include/exclude so the catalog can grow without breaking them.
  const sdr=filterDevices(devices,readFilters('?capability=sdr&checked=1'));
  for (const id of ['hackrf-one','hackrf-pro','rtl-sdr-blog-v4','airspy-r2']) assert.ok(sdr.some(d=>d.slug===id),`sdr missing ${id}`);
  assert.ok(sdr.every(d=>d.usage.capabilities.includes('sdr')));
  const boards=filterDevices(devices,readFilters('?category=boards&checked=1'));
  for (const id of ['raspberry-pi-pico-2-w','seeed-xiao-esp32s3','arduino-uno-r4-wifi','esp32-s3-devkitc-1','dfrobot-huskylens-2']) assert.ok(boards.some(d=>d.slug===id),`boards missing ${id}`);
  assert.ok(boards.every(d=>d.category==='boards' && d.verified));
  const bareBoards=filterDevices(devices,readFilters('?category=boards&format=board&checked=1'));
  assert.ok(bareBoards.length>=4);
  assert.ok(bareBoards.every(d=>d.usage.format==='board'));
  assert.ok(!bareBoards.some(d=>d.slug==='dfrobot-huskylens-2')); // Display-equipped controller; not a bare board.
});
test('shareable filters round-trip search characters and all facets; sorting preserves input',()=>{
  const filters=readFilters('?q=RFID+%26+NFC&task=rfid&category=rfid&format=computer&capability=hf&status=listed&checked=1&sort=name&view=grid');
  assert.deepEqual(readFilters(filterURL(filters).split('?')[1]),filters);
  const before=devices.map(d=>d.slug),sorted=sortDevices(devices);
  assert.equal(sorted[0].status,'listed');assert.equal(sorted.at(-1).slug,'lilyshark');
  assert.deepEqual(devices.map(d=>d.slug),before);
});
test('comparison differences identify matching rows only when there is another device',()=>{
  const first=devices[0],other={...first,slug:'other',name:'Different device',specs:{...first.specs,power:'Different power'}};
  assert.match(compareTable([first,other]),/<tr data-same="true"><th scope="row">Processor/);
  assert.match(compareTable([first,other]),/<tr data-same="false"><th scope="row">Power/);
  assert.doesNotMatch(compareTable([first]),/data-same="true"/);
});
test('saved data tolerates blocked storage, malformed JSON and stale IDs',()=>{
  assert.deepEqual(readSaved({getItem(){throw new Error('denied')}},devices),[]);
  assert.deepEqual(readSaved({getItem(){return '{broken'}},devices),[]);
  assert.deepEqual(readSaved({getItem(){return '{"slug":"flipper-zero"}'}},devices),[]);
  assert.deepEqual(readSaved({getItem(){return '["flipper-zero","missing","flipper-zero",5]'}},devices),['flipper-zero']);
});
test('comparison URL preserves order, deduplicates, discards unknown IDs and caps at three',()=>{
  assert.deepEqual(compareIDs('?devices=the-hacker-pager,flipper-zero,missing,the-hacker-pager,lilyshark,pocketmage',devices),['the-hacker-pager','flipper-zero','lilyshark']);
  assert.deepEqual(selection(null,devices),[]);
  assert.deepEqual(compareIDs('?devices=',devices),[]);
});
test('comparison history restores presets while explicit empty links clear the selection',()=>{
  const preset=['flipper-zero','chameleon-ultra','proxmark3-rdv4'];
  assert.deepEqual(resolveComparison('',devices,preset),preset);
  assert.deepEqual(resolveComparison('?devices=flipper-zero,chameleon-ultra',devices,preset),preset.slice(0,2));
  assert.deepEqual(resolveComparison('?devices=',devices,preset),[]);
  assert.deepEqual(resolveComparison('',devices,['missing',...preset,'lilyshark']),preset);
});
test('concepts, partial reviews, revision notes and firmware ownership remain explicit',()=>{
  const concept=detailPage(devices.find(d=>d.slug==='lilyshark'),devices);
  assert.match(concept,/not available to order/);
  assert.doesNotMatch(concept,/Buy now|Preorder|Add to cart/);
  const tdeck=detailPage(devices.find(d=>d.slug==='lilygo-t-deck-plus'),devices);
  assert.match(tdeck,/LILYGO makes the hardware/);
  assert.match(tdeck,/class="device-evidence" href="#sources"/);
  assert.match(tdeck,/Source checked/);
  assert.match(tdeck,/Maker listing checked .*Detailed documentation reviewed .*Not hands-on tested/);
  const partial=devices.find(d=>d.slug==='cyperpro');
  assert.match(detailPage(partial,devices),/Final specifications remain unconfirmed/);
  assert.match(compareTable([partial]),/final specifications unconfirmed/);
  const revised=devices.find(d=>d.slug==='kode-dot');
  assert.ok(detailPage(revised,devices).includes(escapeHTML(revised.verificationNotes[0])));
  assert.ok(compareTable([revised]).includes(escapeHTML(revised.verificationNotes[0])));
  assert.match(compareTable([devices.find(d=>d.slug==='lilyshark')]),/Concept — specifications not set/);
});
test('rendered text is escaped and the public data drops unsupported archive verdicts',()=>{
  assert.equal(escapeHTML('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;');
  const hostile={...devices[0],verificationNotes:['<script>unsafe()</script>']};
  for(const html of [detailPage(hostile,devices),compareTable([hostile])]) {
    assert.match(html,/&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html,/<script>unsafe/);
  }
  for(const d of devices) { assert.equal(d.note,undefined); assert.equal(d.raised,undefined); }
  assert.doesNotMatch(JSON.stringify(devices),/widely panned|largest failure|only.*no confirmed defect|which is why it funded/);
});
