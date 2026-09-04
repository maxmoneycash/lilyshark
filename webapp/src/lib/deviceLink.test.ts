import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendTelemetryHistory,
  isLilysharkBanner,
  nextSerialAction,
  parseLskLine,
  TELEMETRY_HISTORY_LIMIT,
  type DeviceTelemetry,
} from './deviceLink';

const T_LINE =
  'LSK T {"bat":"BAT 87%","gps":"GPS FIX 7","profile":"LongFast","frames":1284,' +
  '"rssi_x10":-921,"snr_x10":74,"sim":false}';

const T_LINE_WITH_FIX =
  'LSK T {"bat":"BAT 87%","gps":"GPS FIX 7","profile":"LongFast","frames":1284,' +
  '"rssi_x10":-921,"snr_x10":74,"sim":false,"lat":37.4419,"lon":-122.143}';

const sample = (over: Partial<DeviceTelemetry> = {}): DeviceTelemetry => ({
  bat: 'BAT 87%',
  gps: 'GPS FIX 7',
  profile: 'LongFast',
  frames: 1,
  rssiX10: -900,
  snrX10: 50,
  sim: false,
  atMs: 1_700_000_000_000,
  ...over,
});

test('parseLskLine reads a firmware telemetry line', () => {
  const parsed = parseLskLine(T_LINE);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'T');
  assert.ok(parsed.telemetry);
  assert.equal(parsed.telemetry.bat, 'BAT 87%');
  assert.equal(parsed.telemetry.gps, 'GPS FIX 7');
  assert.equal(parsed.telemetry.profile, 'LongFast');
  assert.equal(parsed.telemetry.frames, 1284);
  assert.equal(parsed.telemetry.rssiX10, -921);
  assert.equal(parsed.telemetry.snrX10, 74);
  assert.equal(parsed.telemetry.sim, false);
  assert.equal(parsed.telemetry.lat, undefined);
  assert.equal(parsed.telemetry.lon, undefined);
});

test('parseLskLine keeps lat/lon when the firmware sends a fix', () => {
  const parsed = parseLskLine(T_LINE_WITH_FIX);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'T');
  if (parsed.kind !== 'T') return;
  assert.equal(parsed.telemetry.lat, 37.4419);
  assert.equal(parsed.telemetry.lon, -122.143);
});

test('parseLskLine ignores a missing or invalid line', () => {
  assert.equal(parseLskLine('hello'), undefined);
  assert.equal(parseLskLine('LSK T not-json'), undefined);
  assert.equal(parseLskLine('LSK X {}'), undefined);
});

test('parseLskLine reads a TX confirmation', () => {
  const ok = parseLskLine('LSK OK {"proto":"meshtastic","kind":"text"}');
  assert.ok(ok);
  assert.equal(ok.kind, 'OK');
  if (ok.kind !== 'OK') return;
  assert.equal(ok.proto, 'meshtastic');
  assert.equal(ok.txKind, 'text');

  const err = parseLskLine('LSK ERR {"proto":"meshcore","reason":"identity-pending"}');
  assert.ok(err);
  assert.equal(err.kind, 'ERR');
  if (err.kind !== 'ERR') return;
  assert.equal(err.reason, 'identity-pending');
});

test('parseLskLine reads the handshake and a pointer', () => {
  const id = parseLskLine('LSK ID {"app":"lilyshark","fw":"0.1.0","board":"t-deck"}');
  assert.ok(id);
  assert.equal(id.kind, 'ID');
  assert.equal(id.firmware, '0.1.0');

  const pointer = parseLskLine(
    'LSK P {"size":1024,"expires":1893456000,"owner":"0xabc","commit":"0xdef"}',
  );
  assert.ok(pointer);
  assert.equal(pointer.kind, 'P');
  assert.equal(pointer.pointer?.sizeBytes, 1024);
  assert.equal(pointer.pointer?.owner, '0xabc');
  assert.equal(pointer.pointer?.commitment, '0xdef');
});

test('parseLskLine reads a heard-frame line with a position', () => {
  const parsed = parseLskLine(
    'LSK F {"src":863123500,"dst":4294967295,"proto":"Meshtastic","port":3,' +
      '"hops":1,"rssi_x10":-912,"snr_x10":41,"kind":"POSITION","sim":false,' +
      '"lat":37.4419,"lon":-122.143,"name":"Bay-Node","short":"BAY"}',
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, 'F');
  if (parsed.kind !== 'F') return;
  assert.equal(parsed.frame.src, 863123500);
  assert.equal(parsed.frame.proto, 'Meshtastic');
  assert.equal(parsed.frame.port, 3);
  assert.equal(parsed.frame.lat, 37.4419);
  assert.equal(parsed.frame.lon, -122.143);
  assert.equal(parsed.frame.name, 'Bay-Node');
  assert.equal(parsed.frame.short, 'BAY');
});

test('parseLskLine reads a spectrum sweep line', () => {
  const parsed = parseLskLine(
    'LSK S {"f0":902000000,"f1":928000000,"bins":4,"db":[-121,-118,-87,-119]}',
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, 'S');
  if (parsed.kind !== 'S') return;
  assert.equal(parsed.sweep.f0Hz, 902000000);
  assert.equal(parsed.sweep.f1Hz, 928000000);
  assert.deepEqual(parsed.sweep.db, [-121, -118, -87, -119]);
  // A clipped line whose JSON survives must not chart as a narrower band.
  assert.equal(
    parseLskLine('LSK S {"f0":902000000,"f1":928000000,"bins":4,"db":[-121,-118]}'),
    undefined,
  );
});

test('parseLskLine reads extra telemetry fields when present', () => {
  const parsed = parseLskLine(
    'LSK T {"bat":"BAT 87%","gps":"GPS FIX 7","profile":"LongFast","frames":12,' +
      '"rssi_x10":-900,"snr_x10":50,"sim":false,"mv":3980,"pct":87,"sat":7,' +
      '"freq_hz":906875000,"sf":11,"bw_hz":250000,"rx":44,"crc":2}',
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, 'T');
  if (parsed.kind !== 'T') return;
  assert.equal(parsed.telemetry.mv, 3980);
  assert.equal(parsed.telemetry.pct, 87);
  assert.equal(parsed.telemetry.sat, 7);
  assert.equal(parsed.telemetry.freqHz, 906875000);
  assert.equal(parsed.telemetry.sf, 11);
  assert.equal(parsed.telemetry.bwHz, 250000);
  assert.equal(parsed.telemetry.rx, 44);
  assert.equal(parsed.telemetry.crc, 2);
});

test('boot console lines count as Lilyshark, not as silence', () => {
  assert.equal(isLilysharkBanner('Lilyshark starting'), true);
  assert.equal(isLilysharkBanner('Lilyshark UI ready'), true);
  assert.equal(isLilysharkBanner('LSK ID {"app":"lilyshark","fw":"x"}'), true);
  assert.equal(isLilysharkBanner('FRAME 12'), false);
});

test('a USB drop during the first handshake is a retry, not a failure', () => {
  assert.equal(
    nextSerialAction({ event: 'stream-drop', deliberate: false, attempt: 0 }),
    'retry',
  );
  assert.equal(
    nextSerialAction({ event: 'timeout', deliberate: false, attempt: 1 }),
    'retry',
  );
  assert.equal(
    nextSerialAction({ event: 'stream-drop', deliberate: false, attempt: 2 }),
    'fail',
  );
  assert.equal(
    nextSerialAction({ event: 'stream-drop', deliberate: true, attempt: 0 }),
    'ignore',
  );
});

test('appendTelemetryHistory keeps a bounded ring of samples', () => {
  let history: DeviceTelemetry[] = [];
  for (let i = 0; i < TELEMETRY_HISTORY_LIMIT + 25; i++) {
    history = appendTelemetryHistory(history, sample({ frames: i, atMs: i }));
  }
  assert.equal(history.length, TELEMETRY_HISTORY_LIMIT);
  assert.equal(history[0].frames, 25);
  assert.equal(history[history.length - 1].frames, TELEMETRY_HISTORY_LIMIT + 24);
});

test("the telemetry line carries the frames the deck heard and did not report", () => {
	// Without these a deck hearing plenty and attributing none is
	// indistinguishable from a deck hearing nothing at all — and that second
	// reading is the one that makes an operator stop looking. The firmware
	// spells them drop_crc / drop_bad / drop_nosrc.
	const line =
		'LSK T {"bat":"BAT 87%","gps":"GPS ON  12 SAT","profile":"MESHTASTIC BAY MF",' +
		'"frames":3,"rssi_x10":-1010,"snr_x10":55,"sim":false,"rx":80,"crc":28,' +
		'"drop_crc":28,"drop_bad":0,"drop_nosrc":50}';
	const parsed = parseLskLine(line);
	assert.ok(parsed && parsed.kind === 'T' && parsed.telemetry, "the line parses");
	assert.equal(parsed.telemetry.rx, 80);
	assert.equal(parsed.telemetry.dropCrc, 28);
	assert.equal(parsed.telemetry.dropMalformed, 0);
	assert.equal(parsed.telemetry.dropNoSource, 50);
});

test("older firmware without the drop counters still parses", () => {
	// A deck flashed before these existed reports nothing about them, which
	// must read as "did not say" rather than as zero frames dropped.
	const line =
		'LSK T {"bat":"BAT 87%","gps":"GPS ON","profile":"P","frames":0,' +
		'"rssi_x10":0,"snr_x10":0,"sim":false,"rx":5,"crc":1}';
	const parsed = parseLskLine(line);
	assert.ok(parsed && parsed.kind === 'T' && parsed.telemetry);
	assert.equal(parsed.telemetry.dropCrc, undefined);
	assert.equal(parsed.telemetry.dropNoSource, undefined);
});
