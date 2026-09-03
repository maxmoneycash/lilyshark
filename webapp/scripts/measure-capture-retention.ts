/**
 * How many bytes the analyzer retains per frame of an open capture.
 *
 *   node --expose-gc --import tsx scripts/measure-capture-retention.ts
 *
 * This is where the number in src/lib/captureSlots.ts comes from. That module
 * spends a memory budget across the open capture slots, and a budget divided
 * by a guessed per-frame cost is not a bound on anything — so the cost is
 * measured here, on the analyzer's own parser and the same derived index
 * arrays the TRAFFIC view keeps alive for as long as a capture is open.
 *
 * The capture's ArrayBuffer is allocated BEFORE the baseline is taken, so what
 * this reports is what the parse and the indexes cost on top of the file's own
 * bytes. Both halves are added up in captureSlots.ts.
 */
import { frameAddressing, reticulumDestinationHashHex } from '../src/lib/conversation.ts';
import type { RawFrameFields } from '../src/lib/deviceLink.ts';
import { protoOfProfile } from '../src/lib/frameFilter.ts';
import { findShelbyPointer, parseLscap } from '../src/lib/lscap.ts';
import { buildLscap } from '../src/lib/lscapWrite.ts';

declare const gc: (() => void) | undefined;

function record(i: number, payload: number): RawFrameFields {
  return {
    seq: i,
    timestampUs: BigInt(i) * 2_400_000n,
    rssiX10: -900 - (i % 300),
    snrX10: 60 - (i % 90),
    presentFields: 0xffff,
    centerFrequencyHz: 906_875_000,
    bandwidthHz: 250_000,
    bitRateBps: 0,
    frequencyDeviationHz: 0,
    airtimeUs: 84_600,
    frequencyErrorHz: -1200,
    preambleSymbols: 16,
    syncWord: 0x2b,
    profileId: 1,
    radioStatus: 0,
    txPowerDbm: 22,
    spreadingFactor: 11,
    codingRateDenominator: 5,
    channelIndex: 0,
    radioIndex: 0,
    modulation: 1,
    direction: 1,
    crc: 2,
    metadataFlags: 0,
    originalLength: payload,
    bytes: new Uint8Array(payload).fill(i & 0xff),
  };
}

/** Collect repeatedly: one pass leaves the young generation half-swept. */
function settle(): number {
  if (!gc) throw new Error('run with --expose-gc');
  for (let i = 0; i < 8; i++) gc();
  return process.memoryUsage().heapUsed;
}

function measure(n: number, payload: number): void {
  const records: RawFrameFields[] = [];
  for (let i = 0; i < n; i++) records.push(record(i, payload));
  const bytes = buildLscap(records).slice();
  records.length = 0;
  const buf = bytes.buffer as ArrayBuffer;

  const before = settle();

  // Everything the TRAFFIC view keeps alive while one capture is open.
  const capture = parseLscap(buf);
  const frames = capture.frames;
  const pointers = frames.map((f) => findShelbyPointer(f.bytes));
  const addressings = frames.map((f) => frameAddressing(f.bytes, f.profileId));
  const destHashes = frames.map((f) =>
    protoOfProfile(f.profileId) === 'rnode' ? reticulumDestinationHashHex(f.bytes) : null,
  );
  const shown = frames.map((_, i) => i);

  const after = settle();
  const retained = after - before;
  // Touch every structure after the second reading so none of them can be
  // collected before it is taken.
  const live =
    frames.length +
    pointers.length +
    addressings.length +
    destHashes.length +
    shown.length;
  if (live !== n * 5) throw new Error('an index array was lost');

  console.log(
    `frames=${String(n).padStart(7)}  payload=${String(payload).padStart(3)} B  ` +
      `retained=${(retained / 1024 / 1024).toFixed(1)} MiB  ` +
      `per frame=${(retained / n).toFixed(1)} B  ` +
      `file bytes per frame=${(bytes.length / n).toFixed(1)} B`,
  );
}

measure(50_000, 40);
measure(100_000, 40);
measure(200_000, 40);
measure(50_000, 255);
