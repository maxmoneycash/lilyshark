import assert from 'node:assert/strict';
import test from 'node:test';

import type { HeardFrame } from './deviceLink';
import { hexDump } from './hexdump';
import {
  appendSnifferFrame,
  clearSnifferSession,
  getSnifferSession,
  recordSnifferFrame,
  setSnifferPaused,
  SNIFFER_FRAME_LIMIT,
} from './snifferSession';

const frame = (over: Partial<HeardFrame> = {}): HeardFrame => ({
  src: 0x1234abcd,
  dst: 0xffffffff,
  proto: 'Meshtastic',
  port: 3,
  rssiX10: -912,
  snrX10: 41,
  kind: 'POSITION',
  sim: false,
  atMs: 1_700_000_000_000,
  ...over,
});

test('appendSnifferFrame keeps a bounded ring, newest last', () => {
  let frames: HeardFrame[] = [];
  for (let i = 0; i < SNIFFER_FRAME_LIMIT + 30; i++) {
    frames = appendSnifferFrame(frames, frame({ atMs: i }));
  }
  assert.equal(frames.length, SNIFFER_FRAME_LIMIT);
  assert.equal(frames[0].atMs, 30);
  assert.equal(frames[frames.length - 1].atMs, SNIFFER_FRAME_LIMIT + 29);
});

test('pause freezes the list but never the counters', () => {
  clearSnifferSession();
  recordSnifferFrame(frame({ atMs: 1 }));
  recordSnifferFrame(frame({ atMs: 2 }));
  setSnifferPaused(true);
  recordSnifferFrame(frame({ atMs: 3 }));
  let s = getSnifferSession();
  assert.equal(s.frames.length, 2);
  assert.equal(s.totalHeard, 3);
  assert.equal(s.missedWhilePaused, 1);
  // Resuming clears the missed counter: those frames are gone from the list
  // for good, and the count only explains the gap while paused.
  setSnifferPaused(false);
  recordSnifferFrame(frame({ atMs: 4 }));
  s = getSnifferSession();
  assert.equal(s.frames.length, 3);
  assert.equal(s.frames[s.frames.length - 1].atMs, 4);
  assert.equal(s.totalHeard, 4);
  assert.equal(s.missedWhilePaused, 0);
  clearSnifferSession();
  s = getSnifferSession();
  assert.equal(s.frames.length, 0);
  assert.equal(s.totalHeard, 0);
  assert.equal(s.paused, false);
});

test('hexDump renders sixteen bytes per fixed-width row', () => {
  const bytes = new Uint8Array(20);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i;
  bytes[0] = 0x41; // 'A'
  const lines = hexDump(bytes);
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    '0000  41 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |A...............|',
  );
  assert.equal(
    lines[1],
    '0010  10 11 12 13                                       |....|',
  );
  // Every row is the same width up to the ascii column, monospace-aligned.
  assert.equal(lines[0].indexOf('|'), lines[1].indexOf('|'));
  assert.deepEqual(hexDump(new Uint8Array(0)), []);
});
