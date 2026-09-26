import assert from 'node:assert/strict';
import test from 'node:test';
import { RF_FIELD, type LscapFrame } from './lscap';
import { summarizeCaptureWindow } from './captureSurvey';

const profileFields = RF_FIELD.frequency | RF_FIELD.bandwidth
  | RF_FIELD.spreadingFactor | RF_FIELD.codingRate;

function frame(timestampUs: number, overrides: Partial<LscapFrame> = {}): LscapFrame {
  return {
    timestampUs: BigInt(timestampUs),
    presentFields: RF_FIELD.timestamp | RF_FIELD.rssi | RF_FIELD.snr | profileFields,
    direction: 'rx',
    synthetic: false,
    crc: 'valid',
    rssiDbm: -90,
    snrDb: 0,
    centerFrequencyHz: 906_875_000,
    bandwidthHz: 250_000,
    spreadingFactor: 11,
    codingRateDenominator: 5,
    ...overrides,
  } as LscapFrame;
}

test('a separate visit summarizes observed RX without elevating TX or generated frames', () => {
  const summary = summarizeCaptureWindow([
    frame(1_000_000),
    frame(2_000_000, { rssiDbm: -80, snrDb: 4, crc: 'invalid' }),
    frame(3_000_000, { direction: 'tx', rssiDbm: 50 }),
    frame(4_000_000, { synthetic: true, rssiDbm: 50 }),
    frame(5_000_000, { direction: 'unknown', rssiDbm: 50 }),
  ]);
  assert.equal(summary.received, 2);
  assert.equal(summary.transmitted, 1);
  assert.equal(summary.unknownDirection, 1);
  assert.equal(summary.synthetic, 1);
  assert.equal(summary.invalidCrc, 1);
  assert.equal(summary.recordedSpanS, 4);
  assert.equal(summary.medianRssiDbm, -85);
  assert.equal(summary.rssiSamples, 2);
  assert.equal(summary.medianSnrDb, 2);
  assert.equal(summary.snrSamples, 2);
  assert.deepEqual(summary.profiles, ['906.875 MHz · BW 250 kHz · SF11 · CR 4/5']);
});

test('RF profile labels preserve one-Hz setting differences', () => {
  const summary = summarizeCaptureWindow([
    frame(1_000_000),
    frame(2_000_000, { centerFrequencyHz: 906_875_400, bandwidthHz: 250_125 }),
  ]);
  assert.deepEqual(summary.profiles, [
    '906.875 MHz · BW 250 kHz · SF11 · CR 4/5',
    '906.8754 MHz · BW 250.125 kHz · SF11 · CR 4/5',
  ]);
});

test('missing measurements and incomplete settings stay unknown', () => {
  const summary = summarizeCaptureWindow([
    frame(1_000_000, { presentFields: RF_FIELD.timestamp }),
    frame(2_000_000, { presentFields: RF_FIELD.timestamp | RF_FIELD.rssi,
      rssiDbm: -70, snrDb: 0 }),
  ]);
  assert.equal(summary.medianRssiDbm, -70);
  assert.equal(summary.rssiSamples, 1);
  assert.equal(summary.medianSnrDb, null);
  assert.equal(summary.snrSamples, 0);
  assert.deepEqual(summary.profiles, []);
  assert.equal(summary.incompleteProfileFrames, 2);
});

test('empty and one-frame windows do not invent a duration', () => {
  assert.equal(summarizeCaptureWindow([]).recordedSpanS, null);
  assert.equal(summarizeCaptureWindow([frame(5_000_000)]).recordedSpanS, null);
});
