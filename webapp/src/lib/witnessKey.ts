/**
 * Field Receipts witness keys — the webapp implementation.
 *
 * The derivation is frozen in docs/protocol/field-receipts.md ("Witness key
 * derivation (normative)") and pinned by WITNESS-VECTOR-1:
 *
 *   witness_key     = SHA-256(payload || u32le(rounded_freq_hz) || u32le(time_bucket))
 *   rounded_freq_hz = ((freq_hz + 12500) // 25000) * 25000   (round half-up)
 *   time_bucket     = unix_seconds // 60
 *
 * scripts/field_receipts.py is the reference implementation and
 * src/shelby/witness_key.cpp the firmware twin; eligibility order and reason
 * tokens here match both. Version 1 .lscap records carry only boot-relative
 * ticks, so deriving a key needs a wall-clock anchor (the unix time of tick 0)
 * supplied by the caller — a frame without one is ineligible. Synthetic frames
 * are refused by this library, never merely skipped: they can never yield a
 * key, whatever the UI does.
 */

import { type LscapFrame, RF_FIELD } from "./lscap.ts";

export const WITNESS_FREQ_STEP_HZ = 25_000;
export const WITNESS_BUCKET_SECONDS = 60;
/** A witness key is a raw SHA-256 digest. */
export const WITNESS_KEY_SIZE = 32;

/**
 * Reasons a frame yields no witness key, in the order they are checked.
 * Tokens are identical to the Python reference (scripts/field_receipts.py)
 * and the C++ labels (witnessEligibilityLabel), so diagnostics line up
 * across all three implementations.
 */
export type WitnessIneligibleReason =
	| "synthetic"
	| "crc_not_valid"
	| "empty_payload"
	| "truncated"
	| "required_fields_absent"
	| "no_wall_clock";

export type WitnessEligibility = "eligible" | WitnessIneligibleReason;

/**
 * WITNESS-VECTOR-1, as published in docs/protocol/field-receipts.md.
 * Every implementation in the repository is tested byte-exact against it.
 */
export const WITNESS_VECTOR_1 = {
	name: "WITNESS-VECTOR-1",
	/** Bytes A0–BF in order (32 bytes). */
	payloadHex:
		"a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf",
	/** Exactly half-way between 25 kHz steps; exercises round-half-up. */
	freqHz: 906_862_500,
	roundedFreqHz: 906_875_000,
	/** 2030-01-01T00:00:00Z. */
	unixSeconds: 1_893_456_000,
	timeBucket: 31_557_600,
	/** The exact 40 bytes hashed: payload || u32le(freq') || u32le(bucket). */
	preimageHex:
		"a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf78d00d36e087e101",
	keyHex: "94ed6915ddbbfb1b5c2557f5ecb61cfe3783f40be380323af53beb8c3b610125",
} as const;

const U32_MAX = 0xffff_ffff;

function requireNonNegativeInteger(value: number, what: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(
			`${what} must be a non-negative integer, got ${value}`,
		);
	}
}

/**
 * Round to the nearest 25 kHz step, half-up. JS numbers hold every integer
 * up to 2^53 exactly, so `freqHz + 12500` cannot overflow for any u32 input
 * (the C++ twin needs a 64-bit intermediate for the same guarantee).
 */
export function roundWitnessFrequencyHz(freqHz: number): number {
	requireNonNegativeInteger(freqHz, "freq_hz");
	return (
		Math.floor((freqHz + WITNESS_FREQ_STEP_HZ / 2) / WITNESS_FREQ_STEP_HZ) *
		WITNESS_FREQ_STEP_HZ
	);
}

export function witnessTimeBucket(unixSeconds: number): number {
	requireNonNegativeInteger(unixSeconds, "unix_seconds");
	return Math.floor(unixSeconds / WITNESS_BUCKET_SECONDS);
}

/**
 * The exact byte string hashed: payload || u32le(freq') || u32le(bucket).
 * Throws RangeError rather than truncating if either u32 field would not
 * fit — a wrapped encoding would be a valid-looking key nothing can match.
 */
export function witnessPreimage(
	payload: Uint8Array,
	freqHz: number,
	unixSeconds: number,
): Uint8Array<ArrayBuffer> {
	const rounded = roundWitnessFrequencyHz(freqHz);
	const bucket = witnessTimeBucket(unixSeconds);
	if (rounded > U32_MAX) {
		throw new RangeError(`rounded_freq_hz ${rounded} does not fit in u32`);
	}
	if (bucket > U32_MAX) {
		throw new RangeError(`time_bucket ${bucket} does not fit in u32`);
	}
	const preimage = new Uint8Array(payload.length + 8);
	preimage.set(payload, 0);
	const tail = new DataView(preimage.buffer, payload.length, 8);
	tail.setUint32(0, rounded, true);
	tail.setUint32(4, bucket, true);
	return preimage;
}

/** Derive the 32-byte witness key via WebCrypto (crypto.subtle). */
export async function computeWitnessKey(
	payload: Uint8Array,
	freqHz: number,
	unixSeconds: number,
): Promise<Uint8Array> {
	const preimage = witnessPreimage(payload, freqHz, unixSeconds);
	const digest = await crypto.subtle.digest("SHA-256", preimage);
	return new Uint8Array(digest);
}

/**
 * Apply the spec's eligibility rules to a parsed .lscap frame. Synthetic is
 * checked first, matching the reference implementation: simulated frames are
 * refused, not merely skipped, so callers can report them loudly. Version 1
 * records never carry wall time themselves, so `hasWallClock` says whether
 * the caller holds an anchor for this capture; it defaults to false because
 * no anchor means no key.
 */
export function witnessEligibility(
	frame: LscapFrame,
	hasWallClock = false,
): WitnessEligibility {
	if (frame.synthetic) {
		return "synthetic";
	}
	if (frame.crc !== "valid") {
		return "crc_not_valid";
	}
	if (frame.capturedLength < 1) {
		return "empty_payload";
	}
	if (frame.capturedLength !== frame.originalLength) {
		return "truncated";
	}
	const required = RF_FIELD.timestamp | RF_FIELD.frequency;
	if ((frame.presentFields & required) !== required) {
		return "required_fields_absent";
	}
	if (!hasWallClock) {
		return "no_wall_clock";
	}
	return "eligible";
}

export type FrameWitnessKeyResult =
	| { key: Uint8Array; reason: null; unixSeconds: number }
	| { key: null; reason: WitnessIneligibleReason };

/**
 * Eligibility plus derivation for one frame. `epochUnixSeconds` is the
 * wall-clock anchor (unix seconds at capture tick 0); pass null/undefined
 * when none is known and the frame comes back ineligible with
 * "no_wall_clock". `ticksPerSecond` is the capture file header's tick rate
 * (the firmware writes 1,000,000 — microsecond ticks). An ineligible frame —
 * synthetic ones included, which this library refuses outright — yields
 * `{ key: null, reason }`, never a placeholder key.
 */
export async function frameWitnessKey(
	frame: LscapFrame,
	epochUnixSeconds: number | null | undefined,
	ticksPerSecond = 1_000_000,
): Promise<FrameWitnessKeyResult> {
	if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 1) {
		throw new RangeError(
			`ticks_per_second must be a positive integer, got ${ticksPerSecond}`,
		);
	}
	const eligibility = witnessEligibility(frame, epochUnixSeconds != null);
	if (eligibility !== "eligible" || epochUnixSeconds == null) {
		// The second clause never decides on its own — a missing anchor already
		// reads as no_wall_clock — it only teaches the type system that an
		// eligible frame has an anchor.
		return {
			key: null,
			reason: eligibility === "eligible" ? "no_wall_clock" : eligibility,
		};
	}
	requireNonNegativeInteger(epochUnixSeconds, "epoch_unix_seconds");
	const unixSeconds =
		epochUnixSeconds + Number(frame.timestampUs / BigInt(ticksPerSecond));
	const key = await computeWitnessKey(
		frame.bytes,
		frame.centerFrequencyHz,
		unixSeconds,
	);
	return { key, reason: null, unixSeconds };
}
