import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { RawFrameFields } from './deviceLink';
import {
  decodeShelbyPointer,
  findShelbyPointer,
  LSCAP_METADATA_FLAG,
  type LscapFrame,
  parseLscap,
  RF_FIELD,
  SHELBY_FLAG,
  SHELBY_POINTER_SIZE,
  summarize,
} from './lscap';
import { buildLscap } from './lscapWrite';

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

function fixture(records: Uint8Array[] = [], fileSize = 24, recordSize = 80): ArrayBuffer {
  const data = new Uint8Array(fileSize + records.reduce((n, r) => n + r.length, 0));
  data.set(Buffer.from('LSCP'));
  const view = new DataView(data.buffer);
  view.setUint16(4, 1, true);
  view.setUint16(6, 1, true);
  view.setUint16(8, fileSize, true);
  view.setUint16(10, recordSize, true);
  view.setUint32(16, 1_000_000, true);
  let offset = fileSize;
  for (const record of records) { data.set(record, offset); offset += record.length; }
  return data.buffer;
}

function frameFixture(payload = 'abc', headerSize = 80): Uint8Array {
  const data = new Uint8Array(headerSize + payload.length);
  data.set(Buffer.from('LSFR'));
  const view = new DataView(data.buffer);
  view.setUint16(4, headerSize, true);
  view.setUint16(6, 1, true);
  view.setUint16(8, payload.length, true);
  view.setUint16(10, payload.length, true);
  data.set(Buffer.from(payload), headerSize);
  return data;
}

test('invalid file sizes produce readable errors instead of invalid offsets', () => {
  for (const [offset, value] of [[8, 0], [8, 23], [8, 65535], [10, 0], [10, 79]]) {
    const data = fixture();
    new DataView(data).setUint16(offset, value, true);
    assert.throws(() => parseLscap(data), /header/i);
  }
});

test('compatible extensions and payload record markers preserve frame boundaries', () => {
  const capture = parseLscap(fixture([frameFixture('LSFR', 84), frameFixture('odd', 84)], 28, 84));
  assert.equal(capture.frames.length, 2);
  assert.equal(capture.trailingBytes, 0);
  assert.equal(Buffer.from(capture.frames[1].bytes).toString(), 'odd');
});

test('corrupt layouts and lengths stop recovery before the bad record', () => {
  for (const [offset, value] of [[4, 79], [4, 84], [6, 2], [8, 256], [10, 1]]) {
    const bad = frameFixture();
    new DataView(bad.buffer).setUint16(offset, value, true);
    const capture = parseLscap(fixture([frameFixture(), bad, frameFixture()]));
    assert.equal(capture.frames.length, 1);
    assert.equal(capture.trailingBytes, bad.length + frameFixture().length);
    assert.match(capture.recoveryMessage!, /byte 107/);
  }
});

test('partial last record exposes the recovery reason and keeps preceding frames', () => {
  const tail = frameFixture().subarray(0, 82);
  const capture = parseLscap(fixture([frameFixture(), tail]));
  assert.equal(capture.frames.length, 1);
  assert.equal(capture.trailingBytes, tail.length);
  assert.match(capture.recoveryMessage!, /Incomplete payload/);
});

// A frame the analyzer would hold in memory. Only the fields summarize() reads
// are varied; the rest are plausible constants.
function statsFrame(i: number): LscapFrame {
  return {
    sequence: BigInt(i),
    timestampUs: BigInt(i) * 1_000n,
    capturedLength: 16 + (i % 7),
    originalLength: 16 + (i % 7),
    truncated: false,
    presentFields: RF_FIELD.rssi | RF_FIELD.snr | RF_FIELD.airtime,
    centerFrequencyHz: 906_875_000,
    bandwidthHz: 250_000,
    bitRateBps: 0,
    frequencyDeviationHz: 0,
    airtimeUs: 1_000 + (i % 13),
    frequencyErrorHz: 0,
    rssiDbm: (((i * 37) % 900) - 1_300) / 10,
    snrDb: (((i * 71) % 401) - 200) / 10,
    preambleSymbols: 8,
    syncWord: 0x2b,
    profileId: 0,
    radioStatus: 0,
    txPowerDbm: 17,
    spreadingFactor: 7,
    codingRateDenominator: 5,
    channelIndex: 0,
    radioIndex: 0,
    modulation: 'lora',
    direction: 'rx',
    crc: i % 5 === 0 ? 'invalid' : 'valid',
    metadataFlags: 0,
    synthetic: false,
    bytes: new Uint8Array(0),
  };
}

// CAPTURE_FRAME_LIMIT is 128,000, so a capture recorded to the app's own limit
// is larger than the ~110,000 arguments a spread call can carry. summarize()
// runs inside a render-time useMemo, so a throw here used to blank the whole
// Traffic screen and reopening the saved capture could not recover it.
test('summarizes a capture at the app frame limit without overflowing the stack', () => {
  const frames = Array.from({ length: 128_000 }, (_, i) => statsFrame(i));

  let bytes = 0;
  let crcValid = 0;
  let airtimeUs = 0;
  let bestSnrDb = Number.NEGATIVE_INFINITY;
  for (const frame of frames) {
    bytes += frame.capturedLength;
    if (frame.crc === 'valid') crcValid++;
    airtimeUs += frame.airtimeUs;
    if (frame.snrDb > bestSnrDb) bestSnrDb = frame.snrDb;
  }

  const stats = summarize(frames);
  assert.equal(stats.frames, 128_000);
  assert.equal(stats.bytes, bytes);
  assert.equal(stats.crcValid, crcValid);
  assert.equal(stats.crcInvalid, 128_000 - crcValid);
  assert.equal(stats.bestSnrDb, bestSnrDb);
  assert.equal(stats.airtimeMs, airtimeUs / 1000);
  assert.ok(Number.isFinite(stats.bestSnrDb!));
  assert.ok(Number.isFinite(stats.airtimeMs));
});

function rawStatsFrame(over: Partial<RawFrameFields>): RawFrameFields {
  return {
    seq: 0,
    timestampUs: 0n,
    rssiX10: 0,
    snrX10: 0,
    presentFields: 0,
    centerFrequencyHz: 906_875_000,
    bandwidthHz: 0,
    bitRateBps: 4_800,
    frequencyDeviationHz: 25_000,
    airtimeUs: 1_000,
    frequencyErrorHz: 0,
    preambleSymbols: 8,
    syncWord: 0x2b,
    profileId: 0,
    radioStatus: 0,
    txPowerDbm: 17,
    spreadingFactor: 0,
    codingRateDenominator: 0,
    channelIndex: 0,
    radioIndex: 0,
    modulation: 2, // fsk
    direction: 1, // rx
    crc: 2, // valid
    metadataFlags: 0,
    originalLength: 4,
    bytes: Uint8Array.from([1, 2, 3, 4]),
    ...over,
  };
}

// An FSK radio reports no SNR at all, and the parser stores an unreported
// field as 0. The frame table already prints those cells as an em dash; the
// summary strip has to agree rather than show 0.0 dB as if it were measured.
test('leaves a statistic no frame reported out of the summary', () => {
  const capture = parseLscap(
    buildLscap([
      rawStatsFrame({
        seq: 1,
        presentFields: RF_FIELD.rssi | RF_FIELD.airtime,
        rssiX10: -812,
        snrX10: 65, // stale field, not reported: must not reach the summary
      }),
      rawStatsFrame({
        seq: 2,
        timestampUs: 1_000_000n,
        presentFields: RF_FIELD.airtime,
        rssiX10: -300,
        snrX10: 120,
      }),
    ]).buffer as ArrayBuffer,
  );

  const stats = summarize(capture.frames);
  assert.equal(stats.frames, 2);
  assert.equal(stats.bestSnrDb, null);
  assert.equal(stats.medianRssiDbm, -81.2);
});
