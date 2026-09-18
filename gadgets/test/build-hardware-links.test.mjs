import test from 'node:test';
import assert from 'node:assert/strict';
import {readBuildHardware,buildHardwareSearch} from '../src/build-projects.mjs';
const devices=[{slug:'radio'},{slug:'board'},{slug:'sensor'}];

test('build links preserve exact selected models and quantities without dropping campaign parameters',()=>{
  const query=buildHardwareSearch('?utm_source=creator',{radio:2,board:1},devices);
  assert.deepEqual(readBuildHardware(query,devices),{radio:2,board:1});
  assert.equal(new URLSearchParams(query).get('utm_source'),'creator');
  assert.equal(buildHardwareSearch(query,{},devices),'?utm_source=creator');
  assert.deepEqual(readBuildHardware('?hardware=board',devices),{board:1});
});

test('stale and malformed build links cannot create ownership or invalid quantities',()=>{
  assert.deepEqual(readBuildHardware('?hardware=radio:0,board:100,sensor:1.5',devices),{});
  assert.deepEqual(readBuildHardware('?hardware=missing,radio:2:3,board:',devices),{});
  assert.deepEqual(readBuildHardware('?hardware=radio:2,sensor:99',devices),{radio:2,sensor:99});
  assert.deepEqual(readBuildHardware('x'.repeat(5001),devices),{});
  assert.deepEqual(readBuildHardware(null,devices),{});
  assert.equal(buildHardwareSearch('',{radio:{toString:1},unknown:1},devices),'');
});
