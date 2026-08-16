import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  decodeShelbyPointer,
  findShelbyPointer,
  LSCAP_METADATA_FLAG,
  parseLscap,
  SHELBY_FLAG,
  SHELBY_POINTER_SIZE,
} from './lscap';

// Byte-exact output of the firmware C++ encoder for the field values below,
// pinned in docs/shelby-pointer-format.md as the format's test vector. The
// Python tooling in scripts/shelby_pointer.py is checked against the same
// bytes, so all three implementations provably agree on the wire format.
const GOLDEN_POINTER = Uint8Array.from(
  Buffer.from(
    '53484c420105a0a1a2a3a4a5a6a7a8a9aaabacadaeaf' +
      'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf0104070a0d10' +
      '1316191c1f2225282b2e3134373a3d404346494c4f52' +
      '55585b5e0000100080d8db7000000100',
    'hex',
  ),
);
const GOLDEN_COMMITMENT = `0x${Array.from({ length: 32 }, (_, i) => (0xa0 + i).toString(16)).join('')}`;
const GOLDEN_OWNER = `0x${Array.from({ length: 32 }, (_, i) => ((i * 3 + 1) & 0xff).toString(16).padStart(2, '0')).join('')}`;

test('decodes the firmware golden vector field for field', () => {
  const pointer = decodeShelbyPointer(GOLDEN_POINTER);
  assert.ok(pointer);
  assert.equal(pointer.version, 1);
  assert.equal(pointer.flags, 0x05);
  assert.equal(pointer.encrypted, true);
  assert.equal(pointer.capture, true);
  assert.equal(pointer.chunked, false);
  assert.equal(pointer.commitment, GOLDEN_COMMITMENT);
  assert.equal(pointer.owner, GOLDEN_OWNER);
  assert.equal(pointer.sizeBytes, 1 << 20);
  assert.equal(pointer.expiresAtUnix, 1893456000);
  assert.equal(pointer.chunkIndex, 0);
  assert.equal(pointer.chunkCount, 1);
});

test('rejects the same bytes the firmware rejects', () => {
  assert.equal(decodeShelbyPointer(GOLDEN_POINTER.subarray(0, 40)), null);
  assert.equal(decodeShelbyPointer(new Uint8Array(SHELBY_POINTER_SIZE)), null);

  const badVersion = Uint8Array.from(GOLDEN_POINTER);
  badVersion[4] = 99;
  assert.equal(decodeShelbyPointer(badVersion), null);

  const zeroCount = Uint8Array.from(GOLDEN_POINTER);
  zeroCount[80] = zeroCount[81] = 0;
  assert.equal(decodeShelbyPointer(zeroCount), null);

  // chunk_count > 1 without the chunked flag: one part of a split blob must
  // never pass for a whole one.
  const noFlag = Uint8Array.from(GOLDEN_POINTER);
  noFlag[80] = 4;
  assert.equal(decodeShelbyPointer(noFlag), null);

  // The reverse inconsistency: chunked flag on a single-chunk pointer.
  const strayFlag = Uint8Array.from(GOLDEN_POINTER);
  strayFlag[5] |= SHELBY_FLAG.chunked;
  assert.equal(decodeShelbyPointer(strayFlag), null);
});

test('accepts a consistent chunked pointer', () => {
  const chunked = Uint8Array.from(GOLDEN_POINTER);
  chunked[5] |= SHELBY_FLAG.chunked;
  chunked[78] = 3; // chunk index 3
  chunked[80] = 7; // of 7
  const pointer = decodeShelbyPointer(chunked);
  assert.ok(pointer);
  assert.equal(pointer.chunked, true);
  assert.equal(pointer.chunkIndex, 3);
  assert.equal(pointer.chunkCount, 7);
});

test('finds the pointer behind an enclosing protocol header', () => {
  const header = Uint8Array.from({ length: 16 }, (_, i) => i);
  const frame = new Uint8Array(header.length + SHELBY_POINTER_SIZE + 5);
  frame.set(header, 0);
  frame.set(GOLDEN_POINTER, header.length);

  const found = findShelbyPointer(frame);
  assert.ok(found);
  assert.equal(found.offset, 16);
  assert.equal(found.pointer.sizeBytes, 1 << 20);

  assert.equal(findShelbyPointer(new Uint8Array(96)), null);
});

// The same path the Traffic tab walks: parse the committed demo capture and
// scan every payload. The pointer must surface on frame 9, behind the 16-byte
// protocol header the generator puts there.
test('finds the pointer in samples/sample-mesh-traffic.lscap', async () => {
  const sampleUrl = new URL('../../../samples/sample-mesh-traffic.lscap', import.meta.url);
  const buffer = await readFile(sampleUrl);
  const capture = parseLscap(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  assert.equal(capture.header.minorVersion, 1);
  assert.ok(capture.frames.every((frame) => frame.synthetic));
  assert.ok(
    capture.frames.every(
      (frame) => (frame.metadataFlags & LSCAP_METADATA_FLAG.synthetic) !== 0,
    ),
  );

  const hits = capture.frames
    .map((frame, index) => ({ index, found: findShelbyPointer(frame.bytes) }))
    .filter((hit) => hit.found !== null);

  assert.equal(hits.length, 1);
  assert.equal(hits[0].index, 9);
  assert.equal(hits[0].found?.offset, 16);
  assert.equal(hits[0].found?.pointer.capture, true);
});

test('keeps the synthetic bit unassigned in a version 1.0 capture', async () => {
  const sampleUrl = new URL('../../../samples/sample-mesh-traffic.lscap', import.meta.url);
  const sample = await readFile(sampleUrl);
  const legacy = Uint8Array.from(sample);
  legacy[6] = 0;
  legacy[7] = 0;

  const capture = parseLscap(
    legacy.buffer.slice(legacy.byteOffset, legacy.byteOffset + legacy.byteLength),
  );
  assert.equal(capture.header.minorVersion, 0);
  assert.ok(capture.frames.every((frame) => !frame.synthetic));
  assert.ok(
    capture.frames.every(
      (frame) => (frame.metadataFlags & LSCAP_METADATA_FLAG.synthetic) !== 0,
    ),
  );
});
