import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendSpectrumSweep,
  binCenterHz,
  dbRange,
  DEFAULT_DB_RANGE,
  fmtMHz,
  freqTicks,
  hexToRgb,
  MIN_DB_SPAN,
  parseSpectrumBody,
  peakBin,
  powerToUnit,
  SPECTRUM_HISTORY_LIMIT,
  type SpectrumSweep,
  updatePeakHold,
} from './spectrum';

const sweep = (over: Partial<SpectrumSweep> = {}): SpectrumSweep => ({
  f0Hz: 902_000_000,
  f1Hz: 928_000_000,
  db: [-120, -95, -110],
  atMs: 1_700_000_000_000,
  ...over,
});

test('parseSpectrumBody reads a firmware sweep body', () => {
  const parsed = parseSpectrumBody(
    { f0: 902_000_000, f1: 928_000_000, bins: 4, db: [-121, -118, -87, -119] },
    1234,
  );
  assert.ok(parsed);
  assert.equal(parsed.f0Hz, 902_000_000);
  assert.equal(parsed.f1Hz, 928_000_000);
  assert.deepEqual(parsed.db, [-121, -118, -87, -119]);
  assert.equal(parsed.atMs, 1234);
});

test('parseSpectrumBody rejects incomplete or corrupt sweeps', () => {
  // A serial line clipped mid-array still parses as JSON often enough; the
  // declared bin count is what catches it.
  assert.equal(
    parseSpectrumBody({ f0: 902e6, f1: 928e6, bins: 8, db: [-120, -119] }),
    undefined,
  );
  assert.equal(parseSpectrumBody({ f0: 902e6, f1: 928e6, bins: 0, db: [] }), undefined);
  assert.equal(
    parseSpectrumBody({ f0: 902e6, f1: 928e6, bins: 2, db: [-120, 'x'] }),
    undefined,
  );
  assert.equal(
    parseSpectrumBody({ f0: 902e6, f1: 928e6, bins: 2, db: [-120, Number.NaN] }),
    undefined,
  );
  // A band must run upward and sit at a real frequency.
  assert.equal(parseSpectrumBody({ f0: 928e6, f1: 902e6, bins: 1, db: [-120] }), undefined);
  assert.equal(parseSpectrumBody({ f0: 902e6, f1: 902e6, bins: 1, db: [-120] }), undefined);
  assert.equal(parseSpectrumBody({ f1: 928e6, bins: 1, db: [-120] }), undefined);
  assert.equal(parseSpectrumBody({ f0: 902e6, f1: 928e6, db: [-120] }), undefined);
});

test('appendSpectrumSweep keeps a bounded waterfall ring', () => {
  let ring: SpectrumSweep[] = [];
  for (let i = 0; i < SPECTRUM_HISTORY_LIMIT + 10; i++) {
    ring = appendSpectrumSweep(ring, sweep({ atMs: i }));
  }
  assert.equal(ring.length, SPECTRUM_HISTORY_LIMIT);
  assert.equal(ring[0].atMs, 10);
  assert.equal(ring[ring.length - 1].atMs, SPECTRUM_HISTORY_LIMIT + 9);
});

test('appendSpectrumSweep restarts the history on a retune', () => {
  let ring = appendSpectrumSweep([], sweep());
  ring = appendSpectrumSweep(ring, sweep({ atMs: 2 }));
  assert.equal(ring.length, 2);
  // A different span means the old rows sit at the wrong frequencies.
  ring = appendSpectrumSweep(ring, sweep({ f0Hz: 868_000_000, f1Hz: 870_000_000 }));
  assert.equal(ring.length, 1);
  // So does a different bin count at the same span.
  ring = appendSpectrumSweep(ring, sweep({ f0Hz: 868_000_000, f1Hz: 870_000_000, db: [-120] }));
  assert.equal(ring.length, 1);
});

test('updatePeakHold keeps the loudest value per bin', () => {
  const first = updatePeakHold(undefined, [-120, -90, -110]);
  assert.deepEqual(first, [-120, -90, -110]);
  const second = updatePeakHold(first, [-100, -119, -105]);
  assert.deepEqual(second, [-100, -90, -105]);
  // A retuned sweep has a different bin count: the trace restarts.
  assert.deepEqual(updatePeakHold(second, [-70, -71]), [-70, -71]);
  // The fold never mutates its input.
  assert.deepEqual(first, [-120, -90, -110]);
});

test('dbRange spans the data with a minimum spread', () => {
  assert.deepEqual(dbRange([]), DEFAULT_DB_RANGE);
  const r = dbRange([sweep({ db: [-121.4, -87.2, -119] })]);
  assert.equal(r.minDb, -122);
  assert.equal(r.maxDb, -87);
  // A flat noise floor must not stretch to full brightness.
  const flat = dbRange([sweep({ db: [-120, -119.5, -120.2] })]);
  assert.equal(flat.maxDb - flat.minDb, MIN_DB_SPAN);
  assert.equal(flat.minDb, -121);
});

test('powerToUnit clamps into 0..1', () => {
  assert.equal(powerToUnit(-130, -120, -80), 0);
  assert.equal(powerToUnit(-60, -120, -80), 1);
  assert.equal(powerToUnit(-100, -120, -80), 0.5);
  assert.equal(powerToUnit(-100, -90, -90), 0);
});

test('binCenterHz and peakBin locate the loudest frequency', () => {
  // Four bins over 902–928: centers at 905.25, 911.75, 918.25, 924.75.
  assert.equal(binCenterHz(902e6, 928e6, 4, 0), 905.25e6);
  assert.equal(binCenterHz(902e6, 928e6, 4, 3), 924.75e6);
  assert.equal(peakBin([-120, -87, -110]), 1);
  assert.equal(peakBin([]), -1);
});

test('freqTicks spans the band ends inclusively', () => {
  const ticks = freqTicks(902e6, 928e6, 5);
  assert.equal(ticks.length, 5);
  assert.equal(ticks[0].hz, 902e6);
  assert.equal(ticks[4].hz, 928e6);
  assert.equal(ticks[2].frac, 0.5);
  assert.equal(ticks[2].hz, 915e6);
});

test('fmtMHz and hexToRgb format for the axis and the canvas', () => {
  assert.equal(fmtMHz(906_875_000), '906.875 MHz');
  assert.deepEqual(hexToRgb('#39ff5a'), { r: 0x39, g: 0xff, b: 0x5a });
  // fg() can carry an alpha suffix; only the first six digits matter.
  assert.deepEqual(hexToRgb('#39ff5a88'), { r: 0x39, g: 0xff, b: 0x5a });
});
