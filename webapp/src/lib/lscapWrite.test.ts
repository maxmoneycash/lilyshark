// Self-check: node --import tsx --test src/lib/lscapWrite.test.ts
//
// The writer and the reader describe the same 80-byte record from opposite
// sides. Nothing but a round trip proves they agree, so every field a frame
// carries is written, parsed back, and compared.
import assert from "node:assert";
import test from "node:test";
import type { RawFrameFields } from "./deviceLink.ts";
import { LSCAP_FILE_HEADER_SIZE, LSCAP_RECORD_HEADER_SIZE, parseLscap } from "./lscap.ts";
import { buildLscap, lscapByteLength } from "./lscapWrite.ts";

function frame(over: Partial<RawFrameFields> = {}): RawFrameFields {
	return {
		seq: 7,
		timestampUs: 123_456_789n,
		rssiX10: -915,
		snrX10: 62,
		presentFields: 0b1010_1010,
		centerFrequencyHz: 906_875_000,
		bandwidthHz: 250_000,
		bitRateBps: 1_200,
		frequencyDeviationHz: 5_000,
		airtimeUs: 84_600,
		frequencyErrorHz: -1_200,
		preambleSymbols: 16,
		syncWord: 0x2b,
		profileId: 1,
		radioStatus: -3,
		txPowerDbm: 22,
		spreadingFactor: 11,
		codingRateDenominator: 5,
		channelIndex: 2,
		radioIndex: 0,
		modulation: 1, // lora
		direction: 1, // rx
		crc: 2, // valid
		metadataFlags: 0,
		originalLength: 4,
		bytes: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
		...over,
	};
}

test("an empty capture is a bare, valid header", () => {
	const bytes = buildLscap([]);
	assert.equal(bytes.length, LSCAP_FILE_HEADER_SIZE);
	const cap = parseLscap(bytes.buffer as ArrayBuffer);
	assert.equal(cap.frames.length, 0);
	assert.equal(cap.trailingBytes, 0);
	assert.equal(cap.header.majorVersion, 1);
	assert.equal(cap.header.recordHeaderSize, LSCAP_RECORD_HEADER_SIZE);
	assert.equal(cap.header.ticksPerSecond, 1_000_000);
});

test("every written field survives a round trip", () => {
	const f = frame();
	const cap = parseLscap(buildLscap([f]).buffer as ArrayBuffer);
	assert.equal(cap.frames.length, 1);
	const g = cap.frames[0];

	assert.equal(g.sequence, BigInt(f.seq));
	assert.equal(g.timestampUs, f.timestampUs);
	assert.equal(g.presentFields, f.presentFields);
	assert.equal(g.centerFrequencyHz, f.centerFrequencyHz);
	assert.equal(g.bandwidthHz, f.bandwidthHz);
	assert.equal(g.bitRateBps, f.bitRateBps);
	assert.equal(g.frequencyDeviationHz, f.frequencyDeviationHz);
	assert.equal(g.airtimeUs, f.airtimeUs);
	assert.equal(g.frequencyErrorHz, f.frequencyErrorHz);
	// stored x10, handed back in real units
	assert.equal(g.rssiDbm, -91.5);
	assert.equal(g.snrDb, 6.2);
	assert.equal(g.preambleSymbols, f.preambleSymbols);
	assert.equal(g.syncWord, f.syncWord);
	assert.equal(g.profileId, f.profileId);
	assert.equal(g.radioStatus, -3, "radio_status is signed");
	assert.equal(g.txPowerDbm, f.txPowerDbm);
	assert.equal(g.spreadingFactor, f.spreadingFactor);
	assert.equal(g.codingRateDenominator, f.codingRateDenominator);
	assert.equal(g.channelIndex, f.channelIndex);
	assert.equal(g.radioIndex, f.radioIndex);
	assert.equal(g.modulation, "lora");
	assert.equal(g.direction, "rx");
	assert.equal(g.crc, "valid");
	assert.deepEqual([...g.bytes], [...f.bytes]);
	assert.equal(g.capturedLength, 4);
	assert.equal(g.truncated, false);
});

test("a truncated frame reports both lengths", () => {
	const cap = parseLscap(
		buildLscap([frame({ originalLength: 300 })]).buffer as ArrayBuffer,
	);
	assert.equal(cap.frames[0].capturedLength, 4);
	assert.equal(cap.frames[0].originalLength, 300);
	assert.equal(cap.frames[0].truncated, true);
});

test("the synthetic flag survives, so simulated traffic stays labelled", () => {
	const cap = parseLscap(
		buildLscap([frame({ metadataFlags: 0b100 })]).buffer as ArrayBuffer,
	);
	assert.equal(cap.frames[0].synthetic, true);
	const real = parseLscap(buildLscap([frame()]).buffer as ArrayBuffer);
	assert.equal(real.frames[0].synthetic, false);
});

test("many frames keep their order, lengths and payloads", () => {
	const frames = [0, 1, 2, 3, 4].map((i) =>
		frame({
			seq: i,
			timestampUs: BigInt(i * 1000),
			bytes: Uint8Array.from(Array.from({ length: i }, (_, k) => i * 16 + k)),
			originalLength: i,
		}),
	);
	const built = buildLscap(frames);
	assert.equal(built.length, lscapByteLength(frames));

	const cap = parseLscap(built.buffer as ArrayBuffer);
	assert.equal(cap.trailingBytes, 0, "no slack after the last record");
	assert.equal(cap.frames.length, 5);
	cap.frames.forEach((g, i) => {
		assert.equal(g.sequence, BigInt(i));
		assert.equal(g.capturedLength, i);
		assert.deepEqual([...g.bytes], [...frames[i].bytes]);
	});
});

test("a zero-length payload is a record, not a gap", () => {
	const cap = parseLscap(
		buildLscap([frame({ bytes: new Uint8Array(0), originalLength: 0 })])
			.buffer as ArrayBuffer,
	);
	assert.equal(cap.frames.length, 1);
	assert.equal(cap.frames[0].capturedLength, 0);
	assert.equal(cap.trailingBytes, 0);
});
