import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateDeviceDetails} from '../src/device-details.mjs';
import {detailPage, catalogPage} from '../src/templates.mjs';

const devices=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url)));
const profiles=JSON.parse(fs.readFileSync(new URL('../data/device-details.json',import.meta.url)));

test('every catalog entry has a dated reference profile and each factual source appears in its resources',()=>{
  validateDeviceDetails(devices,profiles);
  assert.equal(profiles.cyperpro.coverage,'unconfirmed');
  assert.equal(profiles.lilyshark.coverage,'concept');
  for(const device of devices){
    const profile=profiles[device.slug], html=detailPage(device,devices,profile);
    assert.equal([...html.matchAll(/data-spec-row/g)].length,profile.sections.flatMap(group=>group.rows).length,device.slug);
    assert.match(html,/id="spec-search"/);
    assert.match(html,/id="resources"/);
  }
});

test('missing profiles, untraceable facts and executable resource URLs fail before publishing',()=>{
  const missing=structuredClone(profiles); delete missing['flipper-zero'];
  assert.throws(()=>validateDeviceDetails(devices,missing),/missing dated detail review/);
  const orphan=structuredClone(profiles); orphan['flipper-zero'].sections[0].rows[0].source='https://unreviewed.example/';
  assert.throws(()=>validateDeviceDetails(devices,orphan),/unlisted source/);
  const unsafe=structuredClone(profiles); unsafe['flipper-zero'].resources[0].url='javascript:alert(1)';
  assert.throws(()=>validateDeviceDetails(devices,unsafe),/invalid or duplicate resource/);
});

test('specification and resource text is escaped and device pages preserve working action destinations',()=>{
  const profile=structuredClone(profiles['flipper-zero']);
  profile.sections[0].rows[0].value='<img src=x onerror=alert(1)>';
  profile.resources[0].label='<script>unsafe()</script>';
  const html=detailPage(devices[0],devices,profile);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<img src=x|<script>unsafe/);
  assert.match(html,/href="\/compare\/\?devices=flipper-zero"/);
  assert.match(html,/data-share-device="flipper-zero"/);
  assert.doesNotMatch(catalogPage(devices),/data-carousel-prev|data-carousel-next/);
});
