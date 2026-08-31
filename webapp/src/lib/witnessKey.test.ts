// Self-check: node --import tsx --test src/lib/witnessKey.test.ts
//
// The witness-key derivation is frozen (docs/protocol/field-receipts.md,
// "Witness key derivation (normative)") and pinned by WITNESS-VECTOR-1;
// this file holds the webapp implementation to the published bytes, the
// rounding/bucket edges, and the spec's eligibility rules — including the
// promise that synthetic frames are refused in the library, not the UI.
import assert from "node:assert";
import test from "node:test";
import { type CrcStatus, type LscapFrame, RF_FIELD } from "./lscap.ts";
import {
	computeWitnessKey,
	frameWitnessKey,
	roundWitnessFrequencyHz,
	WITNESS_VECTOR_1,
	witnessEligibility,
	witnessPreimage,
	witnessTimeBucket,
} from "./witnessKey.ts";

function hexOf(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesOfHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
	}
	return out;
}

const VECTOR_PAYLOAD = bytesOfHex(WITNESS_VECTOR_1.payloadHex);

/** An eligible frame; override fields to make it fail one rule at a time. */
function makeFrame(overrides: Partial<LscapFrame> = {}): LscapFrame {
	const bytes = VECTOR_PAYLOAD.slice();
	return {
		sequence: 7n,
		timestampUs: 90_000_000n,
		capturedLength: bytes.length,
		originalLength: bytes.length,
		truncated: false,
		presentFields: RF_FIELD.timestamp | RF_FIELD.frequency,
		centerFrequencyHz: WITNESS_VECTOR_1.freqHz,
		bandwidthHz: 250_000,
		bitRateBps: 0,
		frequencyDeviationHz: 0,
		airtimeUs: 0,
		frequencyErrorHz: 0,
		rssiDbm: -80,
		snrDb: 8,
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
		bytes,
		...overrides,
	};
}

test("WITNESS-VECTOR-1: preimage and key are byte-exact", async () => {
	assert.strictEqual(
		roundWitnessFrequencyHz(WITNESS_VECTOR_1.freqHz),
		WITNESS_VECTOR_1.roundedFreqHz,
	);
	assert.strictEqual(
		witnessTimeBucket(WITNESS_VECTOR_1.unixSeconds),
		WITNESS_VECTOR_1.timeBucket,
	);

	const preimage = witnessPreimage(
		VECTOR_PAYLOAD,
		WITNESS_VECTOR_1.freqHz,
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.strictEqual(preimage.length, 40);
	assert.strictEqual(hexOf(preimage), WITNESS_VECTOR_1.preimageHex);
	// The published u32le encodings, spelled out: 906875000 and 31557600.
	assert.strictEqual(hexOf(preimage.subarray(32, 36)), "78d00d36");
	assert.strictEqual(hexOf(preimage.subarray(36, 40)), "e087e101");

	const key = await computeWitnessKey(
		VECTOR_PAYLOAD,
		WITNESS_VECTOR_1.freqHz,
		WITNESS_VECTOR_1.unixSeconds,
	);
	assert.strictEqual(key.length, 32);
	assert.strictEqual(hexOf(key), WITNESS_VECTOR_1.keyHex);
});

test("frequency rounding: half-up at the 12,500 Hz boundary", () => {
	const step = 906_850_000; // an exact 25 kHz step
	assert.strictEqual(roundWitnessFrequencyHz(step), step);
	assert.strictEqual(roundWitnessFrequencyHz(step + 12_499), step);
	assert.strictEqual(roundWitnessFrequencyHz(step + 12_500), step + 25_000);
	assert.strictEqual(roundWitnessFrequencyHz(step + 12_501), step + 25_000);
	assert.strictEqual(roundWitnessFrequencyHz(0), 0);
	assert.strictEqual(roundWitnessFrequencyHz(12_499), 0);
	assert.strictEqual(roundWitnessFrequencyHz(12_500), 25_000);
});

test("time bucket: floor division by 60", () => {
	assert.strictEqual(witnessTimeBucket(0), 0);
	assert.strictEqual(witnessTimeBucket(59), 0);
	assert.strictEqual(witnessTimeBucket(60), 1);
	assert.strictEqual(witnessTimeBucket(119), 1);
	assert.strictEqual(witnessTimeBucket(120), 2);
	assert.strictEqual(
		witnessTimeBucket(WITNESS_VECTOR_1.unixSeconds),
		WITNESS_VECTOR_1.timeBucket,
	);
});

test("u32le encoding edges: zero, max, and refusal to wrap", () => {
	// All-zero inputs encode as eight zero bytes after the payload.
	assert.strictEqual(
		hexOf(witnessPreimage(new Uint8Array(0), 0, 0)),
		"0".repeat(16),
	);

	// The largest 25 kHz step that fits in u32: 4,294,950,000 = 0xFFFFBC70.
	const maxStep = 4_294_950_000;
	assert.strictEqual(roundWitnessFrequencyHz(maxStep), maxStep);
	const atMax = witnessPreimage(
		new Uint8Array(0),
		maxStep,
		0xffff_ffff * 60 + 59,
	);
	assert.strictEqual(hexOf(atMax.subarray(0, 4)), "70bcffff");
	// The largest bucket that fits: unix 0xFFFFFFFF*60+59 → bucket 0xFFFFFFFF.
	assert.strictEqual(hexOf(atMax.subarray(4, 8)), "ffffffff");

	// One step beyond either u32 throws instead of silently wrapping.
	assert.throws(
		() => witnessPreimage(new Uint8Array(0), maxStep + 12_500, 0),
		RangeError,
	);
	assert.throws(
		() => witnessPreimage(new Uint8Array(0), 0, (0xffff_ffff + 1) * 60),
		RangeError,
	);

	// Non-integer and negative inputs are rejected loudly too.
	assert.throws(() => roundWitnessFrequencyHz(-1), RangeError);
	assert.throws(() => roundWitnessFrequencyHz(1.5), RangeError);
	assert.throws(() => witnessTimeBucket(-60), RangeError);
});

test("an eligible frame with an anchor is eligible", () => {
	assert.strictEqual(witnessEligibility(makeFrame(), true), "eligible");
});

test("eligibility: CRC must be valid — unknown/absent/invalid all fail", () => {
	for (const crc of ["unknown", "absent", "invalid"] as CrcStatus[]) {
		assert.strictEqual(
			witnessEligibility(makeFrame({ crc }), true),
			"crc_not_valid",
		);
	}
});

test("eligibility: empty payloads and truncated frames yield no key", () => {
	const empty = makeFrame({
		capturedLength: 0,
		originalLength: 0,
		bytes: new Uint8Array(0),
	});
	assert.strictEqual(witnessEligibility(empty, true), "empty_payload");

	const truncated = makeFrame({ originalLength: 64, truncated: true });
	assert.strictEqual(witnessEligibility(truncated, true), "truncated");
});

test("eligibility: timestamp and frequency present-bits are both required", () => {
	for (const presentFields of [0, RF_FIELD.timestamp, RF_FIELD.frequency]) {
		assert.strictEqual(
			witnessEligibility(makeFrame({ presentFields }), true),
			"required_fields_absent",
		);
	}
	// Extra bits set alongside the required two are fine.
	const all = makeFrame({
		presentFields: RF_FIELD.timestamp | RF_FIELD.frequency | RF_FIELD.rssi,
	});
	assert.strictEqual(witnessEligibility(all, true), "eligible");
});

test("eligibility: no wall-clock anchor means no key (v1 ticks are boot-relative)", () => {
	assert.strictEqual(witnessEligibility(makeFrame(), false), "no_wall_clock");
	assert.strictEqual(witnessEligibility(makeFrame()), "no_wall_clock");
});

test("synthetic frames are refused first, before any other rule", () => {
	assert.strictEqual(
		witnessEligibility(makeFrame({ synthetic: true }), true),
		"synthetic",
	);
	// Even a frame that also fails CRC reads as synthetic — refusal, not skip.
	const both = makeFrame({ synthetic: true, crc: "invalid" });
	assert.strictEqual(witnessEligibility(both, true), "synthetic");
});

test("frameWitnessKey: eligible frame derives epoch + ticks/rate", async () => {
	// timestampUs = 90,000,000 ticks at 1e6 ticks/s → 90 s after the anchor.
	const epoch = WITNESS_VECTOR_1.unixSeconds - 90;
	const result = await frameWitnessKey(makeFrame(), epoch);
	assert.ok(result.key, "eligible frame must yield a key");
	assert.strictEqual(result.reason, null);
	assert.strictEqual(result.unixSeconds, WITNESS_VECTOR_1.unixSeconds);
	assert.strictEqual(hexOf(result.key), WITNESS_VECTOR_1.keyHex);
});

test("frameWitnessKey: honours a non-microsecond tick rate", async () => {
	// 90,000 ticks at 1000 ticks/s is the same 90 s offset.
	const frame = makeFrame({ timestampUs: 90_000n });
	const result = await frameWitnessKey(
		frame,
		WITNESS_VECTOR_1.unixSeconds - 90,
		1000,
	);
	assert.ok(result.key);
	assert.strictEqual(hexOf(result.key), WITNESS_VECTOR_1.keyHex);
});

test("frameWitnessKey: no anchor → null key with no_wall_clock", async () => {
	for (const epoch of [null, undefined]) {
		const result = await frameWitnessKey(makeFrame(), epoch);
		assert.strictEqual(result.key, null);
		assert.strictEqual(result.reason, "no_wall_clock");
	}
});

test("frameWitnessKey: synthetic frames are blocked in the library", async () => {
	// The anchor is present and every other rule passes — the refusal is the
	// library's own, not a UI courtesy.
	const result = await frameWitnessKey(
		makeFrame({ synthetic: true }),
		1_893_456_000,
	);
	assert.strictEqual(result.key, null);
	assert.strictEqual(result.reason, "synthetic");
});

test("frameWitnessKey: ineligible frames report the reference's reason tokens", async () => {
	const epoch = 1_893_456_000;
	const cases: [LscapFrame, string][] = [
		[makeFrame({ crc: "unknown" }), "crc_not_valid"],
		[
			makeFrame({
				capturedLength: 0,
				originalLength: 0,
				bytes: new Uint8Array(0),
			}),
			"empty_payload",
		],
		[makeFrame({ originalLength: 64, truncated: true }), "truncated"],
		[
			makeFrame({ presentFields: RF_FIELD.timestamp }),
			"required_fields_absent",
		],
	];
	for (const [frame, reason] of cases) {
		const result = await frameWitnessKey(frame, epoch);
		assert.strictEqual(result.key, null);
		assert.strictEqual(result.reason, reason);
	}
});
