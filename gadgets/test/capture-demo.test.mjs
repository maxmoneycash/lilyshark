import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCapture, captureFrames, frameState, frameExplanation, hexRows } from '../src/capture-demo.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('../public/samples/lilyshark-synthetic.json',import.meta.url)));

test('browser sample is the unchanged synthetic capture parsed by the project tool',()=>{
  const source=new URL('../../samples/field-capture-0846.lscap',import.meta.url);
  const packaged=new URL('../public/samples/lilyshark-synthetic.lscap',import.meta.url);
  assert.deepEqual(fs.readFileSync(packaged),fs.readFileSync(source));
  const parsed=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('../../scripts/lscap.py',import.meta.url)),'dump',fileURLToPath(packaged),'--pretty'],{encoding:'utf8'}));
  assert.deepEqual(fixture,parsed);
  assert.equal(validateCapture(fixture).length,24);
});

test('capture challenges isolate the real failure records without inventing bytes',()=>{
  const records=validateCapture(fixture);
  const crc=captureFrames(records,'crc');
  const truncated=captureFrames(records,'truncated');
  assert.deepEqual(crc.map(f=>f.sequence),[14]);
  assert.deepEqual(truncated.map(f=>f.sequence),[20]);
  assert.equal(truncated[0].original_length-truncated[0].captured_length,7);
  assert.equal(frameState(crc[0]),'CRC failed');
  assert.equal(frameState(truncated[0]),'Truncated');
  assert.match(frameExplanation(truncated[0]),/missing 7 bytes/);
  for(const frame of records) {
    const shown=hexRows(frame.payload_hex).split('\n').map(line=>line.slice(6).replaceAll(' ','')).join('');
    assert.equal(shown,frame.payload_hex);
    assert.equal(shown.length/2,frame.captured_length);
  }
});

test('invalid sample data cannot be presented as a validated synthetic capture',()=>{
  for(const change of [
    v=>{v.records[0].synthetic=false;},
    v=>{v.records[0].payload_hex='not bytes';},
    v=>{v.records[0].captured_length+=1;},
    v=>{v.records[0].original_length=0;},
    v=>{v.records[0].center_frequency_hz=undefined;},
    v=>{v.records[0].direction_name='unknown';},
    v=>{v.records[0]=null;},
    v=>{v.records[1].sequence=v.records[0].sequence;},
    v=>{v.file_header.major_version=2;},
    v=>{v.records=[];}
  ]) {
    const copy=structuredClone(fixture);change(copy);
    assert.throws(()=>validateCapture(copy));
  }
  assert.equal(frameState({...fixture.records[0],crc_state:0}),'CRC unknown');
  assert.equal(frameState({...fixture.records[0],crc_state:1}),'CRC not present');
});
