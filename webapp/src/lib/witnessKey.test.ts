import assert from "node:assert/strict";
import test from "node:test";
import type { LscapCapture, LscapFrame } from "./lscap";
import { RF_FIELD } from "./lscap";
import {
	captureWitnessKeys,
	corroborate,
	frameIneligibility,
	roundFrequencyHz,
	timeBucket,
	toHex,
	WITNESS_VECTOR_1,
	witnessKey,
	witnessPreimage,
} from "./witnessKey";

// ---- WITNESS-VECTOR-1: the frozen derivation, byte for byte -------------

test("WITNESS-VECTOR-1: rounding and bucketing land on the published values", () => {
	assert.equal(
		roundFrequencyHz(WITNESS_VECTOR_1.freqHz),
		WITNESS_VECTOR_1.roundedFreqHz,
	);
	assert.equal(
		timeBucket(WITNESS_VECTOR_1.unixSeconds),
		WITNESS_VECTOR_1.timeBucket,
	);
});

test("WITNESS-VECTOR-1: the preimage is payload || u32le(freq') || u32le(bucket), 40 bytes", () => {
	const pre = witnessPreimage(
		WITNESS_VECTOR_1.payload,
		WITNESS_VECTOR_1.freqHz,
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.equal(pre.length, 40);
	assert.equal(toHex(pre), WITNESS_VECTOR_1.preimageHex);
});

test("WITNESS-VECTOR-1: the key matches the reference implementation", async () => {
	const key = await witnessKey(
		WITNESS_VECTOR_1.payload,
		WITNESS_VECTOR_1.freqHz,
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.equal(key.length, 32);
	assert.equal(toHex(key), WITNESS_VECTOR_1.keyHex);
});

// ---- rounding edges ------------------------------------------------------

test("frequency rounding is half-up to 25 kHz, integer arithmetic", () => {
	assert.equal(roundFrequencyHz(906_862_500), 906_875_000); // exactly half-way rounds up
	assert.equal(roundFrequencyHz(906_862_499), 906_850_000); // one Hz below rounds down
	assert.equal(roundFrequencyHz(906_875_000), 906_875_000); // on a step stays
	assert.equal(roundFrequencyHz(0), 0);
});

test("time bucket is floor(unix / 60), and adjacent minutes differ", () => {
	assert.equal(timeBucket(0), 0);
	assert.equal(timeBucket(59), 0);
	assert.equal(timeBucket(60), 1);
	assert.notEqual(timeBucket(1_893_456_059), timeBucket(1_893_456_060));
});

// ---- eligibility, in the reference's order ------------------------------

function frame(over: Partial<LscapFrame> = {}): LscapFrame {
	return {
		sequence: 1n,
		timestampUs: 0n,
		capturedLength: 32,
		originalLength: 32,
		truncated: false,
		presentFields: RF_FIELD.timestamp | RF_FIELD.frequency | RF_FIELD.rssi,
		centerFrequencyHz: WITNESS_VECTOR_1.freqHz,
		bandwidthHz: 125_000,
		bitRateBps: 0,
		frequencyDeviationHz: 0,
		airtimeUs: 0,
		frequencyErrorHz: 0,
		rssiDbm: -90,
		snrDb: 5,
		preambleSymbols: 8,
		syncWord: 0x2b,
		profileId: 0,
		radioStatus: 0,
		txPowerDbm: 0,
		spreadingFactor: 7,
		codingRateDenominator: 5,
		channelIndex: 0,
		radioIndex: 0,
		modulation: "lora",
		direction: "rx",
		crc: "valid",
		metadataFlags: 0,
		synthetic: false,
		bytes: Uint8Array.from(WITNESS_VECTOR_1.payload),
		...over,
	};
}

test("an ordinary received frame with a wall clock is eligible", () => {
	assert.equal(frameIneligibility(frame(), true), null);
});

test("eligibility reasons fire in the reference's order", () => {
	// synthetic is refused before anything else is examined
	assert.equal(
		frameIneligibility(frame({ synthetic: true, crc: "invalid" }), true),
		"synthetic",
	);
	// our own transmission can witness nothing
	assert.equal(
		frameIneligibility(frame({ direction: "tx", crc: "invalid" }), true),
		"self_transmitted",
	);
	// a payload that cannot be checked cannot corroborate anything
	for (const crc of ["unknown", "absent", "invalid"] as const) {
		assert.equal(
			frameIneligibility(frame({ crc }), true),
			"crc_not_valid",
			crc,
		);
	}
	assert.equal(
		frameIneligibility(frame({ capturedLength: 0, originalLength: 0 }), true),
		"empty_payload",
	);
	assert.equal(
		frameIneligibility(frame({ capturedLength: 16, originalLength: 32 }), true),
		"truncated",
	);
	assert.equal(
		frameIneligibility(frame({ presentFields: RF_FIELD.timestamp }), true),
		"required_fields_absent",
	);
	assert.equal(
		frameIneligibility(frame({ presentFields: RF_FIELD.frequency }), true),
		"required_fields_absent",
	);
	// no wall-clock anchor: ineligible, never a placeholder key
	assert.equal(frameIneligibility(frame(), false), "no_wall_clock");
});

// ---- whole captures -------------------------------------------------------

function capture(
	frames: LscapFrame[],
	ticksPerSecond = 1_000_000,
): LscapCapture {
	return {
		header: {
			majorVersion: 1,
			minorVersion: 0,
			fileHeaderSize: 32,
			recordHeaderSize: 80,
			fileFlags: 0,
			ticksPerSecond,
		},
		frames,
		trailingBytes: 0,
	};
}

test("without an epoch every frame is skipped as no_wall_clock and nothing is keyed", async () => {
	const out = await captureWitnessKeys(
		capture([frame(), frame({ sequence: 2n })]),
	);
	assert.equal(out.keys.length, 0);
	assert.equal(out.skipped.no_wall_clock, 2);
	assert.equal(out.refusedSynthetic, 0);
});

test("with an epoch, unix time is epoch + floor(ticks / tick rate) and the vector key comes out", async () => {
	// tick 0 at the vector's unix time, and this frame at tick 0: the key must be the vector's.
	const out = await captureWitnessKeys(
		capture([frame()]),
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.equal(out.keys.length, 1);
	assert.equal(out.keys[0].keyHex, WITNESS_VECTOR_1.keyHex);
	assert.equal(out.keys[0].unixSeconds, WITNESS_VECTOR_1.unixSeconds);
	assert.equal(out.keys[0].roundedFreqHz, WITNESS_VECTOR_1.roundedFreqHz);
	assert.equal(out.keys[0].timeBucket, WITNESS_VECTOR_1.timeBucket);

	// 90 s of ticks at 1 MHz lands one bucket later: a different key.
	const later = await captureWitnessKeys(
		capture([frame({ timestampUs: 90_000_000n })]),
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.equal(later.keys[0].unixSeconds, WITNESS_VECTOR_1.unixSeconds + 90);
	assert.notEqual(later.keys[0].keyHex, WITNESS_VECTOR_1.keyHex);
});

test("only the captured bytes are hashed, never trailing buffer", async () => {
	// Same first 32 bytes, extra junk after capturedLength: identical key.
	const padded = new Uint8Array(40);
	padded.set(WITNESS_VECTOR_1.payload);
	padded.fill(0xff, 32);
	const out = await captureWitnessKeys(
		capture([frame({ bytes: padded })]),
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.equal(out.keys[0].keyHex, WITNESS_VECTOR_1.keyHex);
});

test("synthetic frames are refused and counted, never keyed and never silently skipped", async () => {
	const out = await captureWitnessKeys(
		capture([
			frame(),
			frame({ sequence: 2n, synthetic: true }),
			frame({ sequence: 3n, synthetic: true }),
		]),
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.equal(out.keys.length, 1);
	assert.equal(out.refusedSynthetic, 2);
	assert.ok(!("synthetic" in out.skipped), "synthetic is refused, never a skip reason");
});

// ---- corroboration across captures ---------------------------------------

test("the same transmission in two captures corroborates; one capture alone never does", async () => {
	const epoch = WITNESS_VECTOR_1.unixSeconds;
	// Deck A heard it at tick 0, RSSI -90; deck B heard it 20 s later on its own clock, RSSI -70.
	const a = await captureWitnessKeys(capture([frame({ rssiDbm: -90 })]), epoch);
	const b = await captureWitnessKeys(
		capture([frame({ timestampUs: 20_000_000n, rssiDbm: -70, snrDb: 9 })]),
		epoch,
	);
	const pairs = corroborate([a, b]);
	assert.equal(pairs.length, 1);
	assert.equal(pairs[0].keyHex, WITNESS_VECTOR_1.keyHex);
	assert.deepEqual(pairs[0].heardBy.map((h) => h.capture).sort(), [0, 1]);

	// The same key twice inside ONE capture is a replay or a double log, not a witness.
	const replay = await captureWitnessKeys(
		capture([frame(), frame({ sequence: 2n, timestampUs: 5_000_000n })]),
		epoch,
	);
	assert.equal(corroborate([replay]).length, 0);
	assert.equal(
		corroborate([replay, b]).length,
		1,
		"but a second capture still corroborates it",
	);
});

test("a different channel or a different minute is a different transmission", async () => {
	const epoch = WITNESS_VECTOR_1.unixSeconds;
	const a = await captureWitnessKeys(capture([frame()]), epoch);
	const otherChannel = await captureWitnessKeys(
		capture([frame({ centerFrequencyHz: WITNESS_VECTOR_1.freqHz + 200_000 })]),
		epoch,
	);
	const nextMinute = await captureWitnessKeys(
		capture([frame({ timestampUs: 60_000_000n })]),
		epoch,
	);
	assert.equal(corroborate([a, otherChannel]).length, 0);
	assert.equal(corroborate([a, nextMinute]).length, 0);
});
