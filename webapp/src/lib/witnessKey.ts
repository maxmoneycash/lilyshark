/**
 * Witness keys in the browser — the Field Receipts anti-spoof primitive.
 *
 * A witness key identifies one over-the-air transmission: two receivers that
 * heard the same bytes on the same channel in the same minute derive the same
 * 32-byte key, while their radio metadata (RSSI, SNR, frequency error) stays
 * receiver-local and is never hashed. The derivation is frozen in
 * docs/protocol/field-receipts.md ("Witness key derivation (normative)") and
 * pinned by WITNESS-VECTOR-1; scripts/field_receipts.py is the reference and
 * this file mirrors it rule for rule, including the order eligibility is
 * checked in, so the two never disagree about which frames yield a key.
 *
 * Nothing here talks to a chain or a server. Keys are computed from an opened
 * capture with WebCrypto, and `corroborate()` finds the frames two captures
 * share — useful as plain dedup and cross-device correlation even if nobody
 * ever scores a point, which is the spec's own argument for shipping it first.
 */

import type { LscapCapture, LscapFrame } from "./lscap";
import { RF_FIELD } from "./lscap";

/** Frequencies are rounded to this step before hashing (absorbs crystal offset). */
export const FREQ_STEP_HZ = 25_000;
/** Receive times are bucketed to this many seconds (absorbs clock skew). */
export const BUCKET_SECONDS = 60;

/**
 * WITNESS-VECTOR-1, byte for byte as published in the spec. Every
 * implementation in the repository recomputes this and must match.
 */
export const WITNESS_VECTOR_1 = {
	name: "WITNESS-VECTOR-1",
	payload: Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i),
	freqHz: 906_862_500, // exactly half-way; exercises round-half-up
	unixSeconds: 1_893_456_000, // 2030-01-01T00:00:00Z
	roundedFreqHz: 906_875_000,
	timeBucket: 31_557_600,
	preimageHex:
		"a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf78d00d36e087e101",
	keyHex: "94ed6915ddbbfb1b5c2557f5ecb61cfe3783f40be380323af53beb8c3b610125",
} as const;

/** Round to the nearest 25 kHz step, half-up, in integer arithmetic. */
export function roundFrequencyHz(freqHz: number): number {
	const f = Math.floor(freqHz);
	return Math.floor((f + FREQ_STEP_HZ / 2) / FREQ_STEP_HZ) * FREQ_STEP_HZ;
}

/** The 60-second bucket a receive time falls in. */
export function timeBucket(unixSeconds: number): number {
	return Math.floor(unixSeconds / BUCKET_SECONDS);
}

function u32le(value: number): Uint8Array {
	if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
		throw new RangeError(`u32le: ${value} is not an unsigned 32-bit integer`);
	}
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value, true);
	return out;
}

/**
 * The exact bytes hashed: payload || u32le(rounded_freq_hz) || u32le(bucket).
 * The payload is followed by exactly 8 bytes — no length prefix, no padding.
 */
export function witnessPreimage(
	payload: Uint8Array,
	freqHz: number,
	unixSeconds: number,
): Uint8Array {
	const out = new Uint8Array(payload.length + 8);
	out.set(payload, 0);
	out.set(u32le(roundFrequencyHz(freqHz)), payload.length);
	out.set(u32le(timeBucket(unixSeconds)), payload.length + 4);
	return out;
}

/** The raw 32-byte SHA-256 of the preimage. */
export async function witnessKey(
	payload: Uint8Array,
	freqHz: number,
	unixSeconds: number,
): Promise<Uint8Array> {
	const preimage = witnessPreimage(payload, freqHz, unixSeconds);
	const digest = await crypto.subtle.digest("SHA-256", preimage as BufferSource);
	return new Uint8Array(digest);
}

export function toHex(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return s;
}

/**
 * Why a frame yields no key. The names match the reference implementation
 * and the spec's numbered eligibility rules, so diagnostics line up across
 * the Python and TypeScript tools.
 */
export type Ineligibility =
	| "synthetic"
	| "self_transmitted"
	| "crc_not_valid"
	| "empty_payload"
	| "truncated"
	| "required_fields_absent"
	| "no_wall_clock";

/**
 * The spec's reason a frame yields no witness key, or null when eligible.
 * Order matters and mirrors the reference: synthetic frames are refused
 * before anything else is looked at, and a frame this deck transmitted is
 * refused next — a witness key asserts somebody heard a transmission they
 * did not make, so a key over our own beacon attests to nothing.
 */
export function frameIneligibility(
	frame: Pick<
		LscapFrame,
		| "synthetic"
		| "direction"
		| "crc"
		| "capturedLength"
		| "originalLength"
		| "presentFields"
	>,
	hasWallClock: boolean,
): Ineligibility | null {
	if (frame.synthetic) return "synthetic";
	if (frame.direction === "tx") return "self_transmitted";
	if (frame.crc !== "valid") return "crc_not_valid";
	if (frame.capturedLength < 1) return "empty_payload";
	if (frame.capturedLength !== frame.originalLength) return "truncated";
	const required = RF_FIELD.timestamp | RF_FIELD.frequency;
	if ((frame.presentFields & required) !== required)
		return "required_fields_absent";
	if (!hasWallClock) return "no_wall_clock";
	return null;
}

/** One frame's witness key, with the inputs that produced it for display. */
export interface FrameWitness {
	/** Index of the frame in the capture's frame list. */
	index: number;
	sequence: bigint;
	keyHex: string;
	roundedFreqHz: number;
	unixSeconds: number;
	timeBucket: number;
}

export interface CaptureWitnessKeys {
	keys: FrameWitness[];
	/** Frames that yielded no key, counted by reason. Synthetic is not here. */
	skipped: Partial<Record<Exclude<Ineligibility, "synthetic">, number>>;
	/**
	 * Synthetic frames are refused, not skipped: a simulated frame can never
	 * corroborate anything, and tooling must say so rather than go quiet.
	 */
	refusedSynthetic: number;
}

/**
 * Derive a key for every eligible frame in an opened capture.
 *
 * A version 1 `.lscap` record carries only a boot-relative tick count, so a
 * wall-clock anchor must come from outside the file: `epochUnixSeconds` is
 * the unix time of tick 0, and `unix_seconds = epoch + ticks / ticks_per_second`
 * (integer floor), using the file header's tick rate. With no epoch every
 * frame is ineligible as `no_wall_clock` — never a placeholder key.
 */
export async function captureWitnessKeys(
	capture: LscapCapture,
	epochUnixSeconds?: number,
): Promise<CaptureWitnessKeys> {
	const hasWallClock = epochUnixSeconds !== undefined;
	const tps = BigInt(Math.max(1, capture.header.ticksPerSecond || 1));
	const result: CaptureWitnessKeys = {
		keys: [],
		skipped: {},
		refusedSynthetic: 0,
	};
	for (let i = 0; i < capture.frames.length; i++) {
		const frame = capture.frames[i];
		const why = frameIneligibility(frame, hasWallClock);
		if (why === "synthetic") {
			result.refusedSynthetic++;
			continue;
		}
		if (why) {
			result.skipped[why] = (result.skipped[why] ?? 0) + 1;
			continue;
		}
		const unixSeconds =
			(epochUnixSeconds as number) + Number(frame.timestampUs / tps);
		const payload = frame.bytes.subarray(0, frame.capturedLength);
		const key = await witnessKey(payload, frame.centerFrequencyHz, unixSeconds);
		result.keys.push({
			index: i,
			sequence: frame.sequence,
			keyHex: toHex(key),
			roundedFreqHz: roundFrequencyHz(frame.centerFrequencyHz),
			unixSeconds,
			timeBucket: timeBucket(unixSeconds),
		});
	}
	return result;
}

/** A witness key seen in two or more distinct captures. */
export interface Corroboration {
	keyHex: string;
	/** Which captures (by index into the input) heard it, and which frame. */
	heardBy: Array<{ capture: number; frame: FrameWitness }>;
}

/**
 * Find transmissions that independent captures agree on: the same key in
 * two or more different captures. Several frames with one key inside a
 * single capture (a replay, or a deck that logged the same frame twice) do
 * not corroborate each other — only distinct captures count, which is the
 * whole point of the primitive.
 */
export function corroborate(
	captures: readonly CaptureWitnessKeys[],
): Corroboration[] {
	const byKey = new Map<
		string,
		Array<{ capture: number; frame: FrameWitness }>
	>();
	captures.forEach((c, captureIndex) => {
		for (const frame of c.keys) {
			const list = byKey.get(frame.keyHex) ?? [];
			list.push({ capture: captureIndex, frame });
			byKey.set(frame.keyHex, list);
		}
	});
	const out: Corroboration[] = [];
	for (const [keyHex, heardBy] of byKey) {
		const distinct = new Set(heardBy.map((h) => h.capture));
		if (distinct.size >= 2) out.push({ keyHex, heardBy });
	}
	out.sort((a, b) => (a.keyHex < b.keyHex ? -1 : a.keyHex > b.keyHex ? 1 : 0));
	return out;
}
