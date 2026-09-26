/**
 * Diff two captures — two T-Decks, one RF event.
 *
 * Two devices in the field produce two captures of the same air. Comparing
 * them by hand is how a coverage claim or a witness claim gets checked, and
 * it is also the debugging tool for decoder regressions between firmware
 * versions. This module is the matching arithmetic behind that view, pure
 * over plain data so it runs under node:test (captureDiff.test.ts), the same
 * way trafficView.ts and captureSlots.ts do.
 *
 * ── What a match is ─────────────────────────────────────────────────────
 *
 * Two frames match when their captured payloads are IDENTICAL — same length,
 * same bytes — and they sit at the same moment on a common clock. Payload
 * identity is found through a 64-bit FNV-1a hash of the bytes and then
 * CONFIRMED byte for byte, so a hash collision can never fabricate a pair.
 *
 * The clock is the hard half. .lscap timestamps are each device's own
 * boot-relative monotonic microseconds (docs/lilyshark-capture-format.md) —
 * two radios that heard the same transmission report two unrelated numbers.
 * So the offset between the two clocks is ESTIMATED from at least two distinct
 * shared payloads whose time differences agree. Frames then pair up one-to-one
 * within a tolerance around it.
 *
 * Everything the estimate rests on is reported — how many anchors it used
 * and how tightly they agreed. With fewer than two agreeing anchors,
 * `offsetSource` is "none" and no frames are paired. TX, unknown-direction,
 * and generated records cannot establish a clock offset or corroborate RX.
 *
 * Nothing here interprets a payload, and nothing decides which capture is
 * "right": a matched pair reports each side's own RSSI and SNR (null where
 * that radio did not report the field, never a zero) and their difference,
 * and unmatched frames are listed per side. What that means about coverage
 * is the operator's call, not this module's.
 */

import { RF_FIELD, type FrameDirection } from "./lscap";

/** The slice of an LscapFrame the diff reads. */
export interface DiffFrame {
	sequence: bigint | number;
	/** The capture's own boot-relative monotonic microseconds. */
	timestampUs: bigint;
	bytes: Uint8Array;
	presentFields: number;
	rssiDbm: number;
	snrDb: number;
	/** Only a recorded receive can corroborate another receiver's capture. */
	direction: FrameDirection;
	/** Generated frames are never evidence that a radio heard a transmission. */
	synthetic?: boolean;
}

/** One side's radio measurements for a matched frame; null = not reported. */
export interface SideMeasurement {
	rssiDbm: number | null;
	snrDb: number | null;
}

/** One transmission heard by both captures. */
export interface DiffPair {
	aIndex: number;
	bIndex: number;
	payloadHash: string;
	payloadLength: number;
	/** B's clock minus A's clock for this pair, microseconds. */
	deltaUs: number;
	/** How far this pair sits from the estimated offset, microseconds. */
	residualUs: number;
	a: SideMeasurement;
	b: SideMeasurement;
	/** B minus A, where BOTH sides reported the field; null otherwise. */
	rssiDeltaDb: number | null;
	snrDeltaDb: number | null;
}

/** Where the clock offset came from. */
export type OffsetSource = "given" | "estimated" | "none";

export interface CaptureDiff {
	/** B's clock minus A's clock, microseconds. */
	offsetUs: number;
	offsetSource: OffsetSource;
	toleranceUs: number;
	/** Anchor pairs the winning cluster held — 0 when nothing was estimated. */
	anchors: number;
	/** Spread of that cluster, microseconds: how tightly the anchors agreed. */
	spreadUs: number;
	matched: DiffPair[];
	/** Indices into each side's frame list, ascending. */
	unmatchedA: number[];
	unmatchedB: number[];
	countA: number;
	countB: number;
	/** Generated frames remain visible as unmatched, but cannot corroborate reception. */
	syntheticA: number;
	syntheticB: number;
	/** TX, unknown-direction, and generated records cannot support a receiver match. */
	ineligibleA: number;
	ineligibleB: number;
	/** Unmatched recorded RX frames, excluding the ineligible records above. */
	unmatchedRxA: number;
	unmatchedRxB: number;
}

export interface DiffOptions {
	/**
	 * How far apart two frames may sit on the aligned clock and still be the
	 * same transmission. Default 1 s: generous next to the milliseconds of
	 * propagation and receive-path delay between two nearby radios, tight
	 * enough that a mesh's repeats of one payload seconds apart stay distinct.
	 */
	toleranceUs?: number;
	/** Skip estimation and align on this offset (B minus A), microseconds. */
	offsetUs?: number;
}

export const DEFAULT_DIFF_TOLERANCE_US = 1_000_000;

/* ── payload identity ────────────────────────────────────────────────── */

/**
 * A 64-bit-wide payload key, as 16 hex characters: two 32-bit FNV-1a passes
 * over the bytes, the second one position-shifted so transpositions separate,
 * with the length folded in. It is a bucket key and nothing more — not a
 * commitment, not a cryptographic digest — because payload identity is
 * CONFIRMED byte for byte before any pair is made. A collision therefore
 * costs one comparison and can never fabricate a match.
 */
export function payloadHashHex(bytes: Uint8Array): string {
	let h1 = 0x811c9dc5 >>> 0;
	let h2 = 0x01000193 >>> 0;
	for (let i = 0; i < bytes.length; i++) {
		h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
		h2 = Math.imul(h2 ^ ((bytes[i] + i) & 0xff), 0x85ebca6b) >>> 0;
	}
	h1 = Math.imul(h1 ^ bytes.length, 0x01000193) >>> 0;
	return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function measurement(frame: DiffFrame): SideMeasurement {
	return {
		rssiDbm: (frame.presentFields & RF_FIELD.rssi) !== 0 ? frame.rssiDbm : null,
		snrDb: (frame.presentFields & RF_FIELD.snr) !== 0 ? frame.snrDb : null,
	};
}

export function isReceivedEvidence(frame: DiffFrame): boolean {
	return !frame.synthetic && frame.direction === "rx";
}

/** Payload hash → frame indices, in ascending time order. */
function bucketByPayload(frames: readonly DiffFrame[]): Map<string, number[]> {
	const order = frames
		.map((_, i) => i)
		.sort((x, y) => Number(frames[x].timestampUs - frames[y].timestampUs));
	const buckets = new Map<string, number[]>();
	for (const i of order) {
		if (!isReceivedEvidence(frames[i])) continue;
		const key = payloadHashHex(frames[i].bytes);
		const list = buckets.get(key);
		if (list) list.push(i);
		else buckets.set(key, [i]);
	}
	return buckets;
}

/* ── clock offset ────────────────────────────────────────────────────── */

export interface OffsetEstimate {
	offsetUs: number;
	/** Deltas in the winning cluster. 0 when nothing could be estimated. */
	anchors: number;
	/** Largest minus smallest delta in that cluster, microseconds. */
	spreadUs: number;
}

function median(sorted: readonly number[]): number {
	const n = sorted.length;
	if (n === 0) return 0;
	const mid = n >> 1;
	return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Estimate B's clock minus A's clock from the payloads both captures hold.
 *
 * Anchors are payloads that appear exactly once on each side. One shared
 * payload alone cannot establish that the captures overlap: a later beacon
 * can reuse identical bytes. Require at least two distinct payloads whose
 * time differences agree. Repeated payloads cannot establish an offset.
 *
 * The readings are clustered with a window of `toleranceUs`: the largest
 * cluster wins and its median is the offset, so a handful of coincidental
 * payload matches cannot drag the estimate off a real agreement.
 */
export function estimateTimeOffsetUs(
	a: readonly DiffFrame[],
	b: readonly DiffFrame[],
	toleranceUs: number = DEFAULT_DIFF_TOLERANCE_US,
): OffsetEstimate {
	const bucketsA = bucketByPayload(a);
	const bucketsB = bucketByPayload(b);
	const unique: number[] = [];
	for (const [key, listA] of bucketsA) {
		const listB = bucketsB.get(key);
		if (!listB) continue;
		if (listA.length === 1 && listB.length === 1) {
			if (!bytesEqual(a[listA[0]].bytes, b[listB[0]].bytes)) continue;
			unique.push(Number(b[listB[0]].timestampUs - a[listA[0]].timestampUs));
			continue;
		}
	}

	const deltas = unique;
	if (deltas.length < 2) return { offsetUs: 0, anchors: 0, spreadUs: 0 };

	deltas.sort((x, y) => x - y);
	// Widest run of deltas that all agree to within the tolerance.
	let bestStart = 0;
	let bestEnd = 0; // exclusive
	let start = 0;
	for (let end = 0; end < deltas.length; end++) {
		while (deltas[end] - deltas[start] > toleranceUs) start++;
		if (end + 1 - start > bestEnd - bestStart) {
			bestStart = start;
			bestEnd = end + 1;
		}
	}
	const cluster = deltas.slice(bestStart, bestEnd);
	if (cluster.length < 2) return { offsetUs: 0, anchors: 0, spreadUs: 0 };
	return {
		offsetUs: median(cluster),
		anchors: cluster.length,
		spreadUs: cluster[cluster.length - 1] - cluster[0],
	};
}

/* ── the diff ────────────────────────────────────────────────────────── */

/**
 * Match two captures frame by frame. Within each identical-payload bucket the
 * two sides are walked in time order on the ALIGNED clock and paired
 * one-to-one: a frame is never used twice, and a frame whose partner sits
 * outside the tolerance is reported unmatched rather than forced onto the
 * nearest thing available.
 */
export function diffCaptures(
	a: readonly DiffFrame[],
	b: readonly DiffFrame[],
	options: DiffOptions = {},
): CaptureDiff {
	const toleranceUs = options.toleranceUs ?? DEFAULT_DIFF_TOLERANCE_US;
	const estimate =
		options.offsetUs === undefined
			? estimateTimeOffsetUs(a, b, toleranceUs)
			: { offsetUs: options.offsetUs, anchors: 0, spreadUs: 0 };
	const offsetSource: OffsetSource =
		options.offsetUs !== undefined
			? "given"
			: estimate.anchors > 0
				? "estimated"
				: "none";

	const bucketsA = bucketByPayload(a);
	const bucketsB = bucketByPayload(b);
	const matched: DiffPair[] = [];
	const takenA = new Set<number>();
	const takenB = new Set<number>();

	for (const [key, listA] of offsetSource === "none" ? [] : bucketsA) {
		const listB = bucketsB.get(key);
		if (!listB) continue;
		let i = 0;
		let j = 0;
		while (i < listA.length && j < listB.length) {
			const frameA = a[listA[i]];
			const frameB = b[listB[j]];
			// A shared hash bucket is not proof of a shared payload.
			if (!bytesEqual(frameA.bytes, frameB.bytes)) {
				// Advance whichever is earlier on the aligned clock, so both
				// lists keep moving without pairing different bytes.
				if (
					Number(frameB.timestampUs) - estimate.offsetUs <
					Number(frameA.timestampUs)
				)
					j++;
				else i++;
				continue;
			}
			const deltaUs = Number(frameB.timestampUs - frameA.timestampUs);
			const residualUs = deltaUs - estimate.offsetUs;
			if (Math.abs(residualUs) <= toleranceUs) {
				const sideA = measurement(frameA);
				const sideB = measurement(frameB);
				matched.push({
					aIndex: listA[i],
					bIndex: listB[j],
					payloadHash: key,
					payloadLength: frameA.bytes.length,
					deltaUs,
					residualUs,
					a: sideA,
					b: sideB,
					rssiDeltaDb:
						sideA.rssiDbm !== null && sideB.rssiDbm !== null
							? sideB.rssiDbm - sideA.rssiDbm
							: null,
					snrDeltaDb:
						sideA.snrDb !== null && sideB.snrDb !== null
							? sideB.snrDb - sideA.snrDb
							: null,
				});
				takenA.add(listA[i]);
				takenB.add(listB[j]);
				i++;
				j++;
				continue;
			}
			// Too far apart: the earlier one has no partner in this bucket.
			if (residualUs < 0) j++;
			else i++;
		}
	}

	matched.sort((x, y) => x.aIndex - y.aIndex);
	const unmatchedA: number[] = [];
	for (let i = 0; i < a.length; i++) if (!takenA.has(i)) unmatchedA.push(i);
	const unmatchedB: number[] = [];
	for (let i = 0; i < b.length; i++) if (!takenB.has(i)) unmatchedB.push(i);
	const unmatchedRxA = unmatchedA.filter((i) => isReceivedEvidence(a[i])).length;
	const unmatchedRxB = unmatchedB.filter((i) => isReceivedEvidence(b[i])).length;

	return {
		offsetUs: estimate.offsetUs,
		offsetSource,
		toleranceUs,
		anchors: estimate.anchors,
		spreadUs: estimate.spreadUs,
		matched,
		unmatchedA,
		unmatchedB,
		countA: a.length,
		countB: b.length,
		syntheticA: a.filter((frame) => frame.synthetic).length,
		syntheticB: b.filter((frame) => frame.synthetic).length,
		ineligibleA: unmatchedA.length - unmatchedRxA,
		ineligibleB: unmatchedB.length - unmatchedRxB,
		unmatchedRxA,
		unmatchedRxB,
	};
}

/* ── the merged view ─────────────────────────────────────────────────── */

/** One line of the side-by-side view. */
export interface DiffRow {
	kind: "both" | "a-only" | "b-only";
	/** Index into A's frames, or null on a B-only row. */
	aIndex: number | null;
	bIndex: number | null;
	/** Seconds on the common clock, measured from A's first frame. */
	timeS: number;
	pair: DiffPair | null;
}

/**
 * When aligned, the two captures interleave on one clock. Otherwise each
 * file's rows keep their own relative clock, with all A rows before B rows.
 */
export function diffRows(
	a: readonly DiffFrame[],
	b: readonly DiffFrame[],
	diff: CaptureDiff,
): DiffRow[] {
	if (diff.offsetSource === "none") {
		const aStart = a[0]?.timestampUs ?? 0n;
		const bStart = b[0]?.timestampUs ?? 0n;
		return [
			...diff.unmatchedA.map((i): DiffRow => ({
				kind: "a-only", aIndex: i, bIndex: null,
				timeS: Number(a[i].timestampUs - aStart) / 1e6, pair: null,
			})),
			...diff.unmatchedB.map((i): DiffRow => ({
				kind: "b-only", aIndex: null, bIndex: i,
				timeS: Number(b[i].timestampUs - bStart) / 1e6, pair: null,
			})),
		];
	}
	// The common clock's zero: A's first frame, or — with no A frames at all —
	// B's first frame carried back across the offset.
	const zeroUs =
		a.length > 0
			? Number(a[0].timestampUs)
			: b.length > 0
				? Number(b[0].timestampUs) - diff.offsetUs
				: 0;
	const timeOfA = (i: number) => (Number(a[i].timestampUs) - zeroUs) / 1e6;
	const timeOfB = (i: number) =>
		(Number(b[i].timestampUs) - diff.offsetUs - zeroUs) / 1e6;

	const rows: DiffRow[] = [];
	for (const pair of diff.matched) {
		rows.push({
			kind: "both",
			aIndex: pair.aIndex,
			bIndex: pair.bIndex,
			timeS: timeOfA(pair.aIndex),
			pair,
		});
	}
	for (const i of diff.unmatchedA)
		rows.push({
			kind: "a-only",
			aIndex: i,
			bIndex: null,
			timeS: timeOfA(i),
			pair: null,
		});
	for (const i of diff.unmatchedB)
		rows.push({
			kind: "b-only",
			aIndex: null,
			bIndex: i,
			timeS: timeOfB(i),
			pair: null,
		});
	rows.sort((x, y) => x.timeS - y.timeS);
	return rows;
}

/* ── the witness reading ─────────────────────────────────────────────── */

/**
 * What two captures of one RF event say about each other. Every figure is
 * counted over the frames that actually matched, and a measurement average
 * only counts pairs where BOTH radios reported the field — a missing reading
 * is never a zero.
 */
export interface WitnessSummary {
	bothHeard: number;
	onlyA: number;
	onlyB: number;
	/** Mean of (B − A) across pairs where both sides reported it. */
	meanRssiDeltaDb: number | null;
	meanSnrDeltaDb: number | null;
	/** How many pairs each mean was taken over. */
	rssiPairs: number;
	snrPairs: number;
}

export function witnessSummary(diff: CaptureDiff): WitnessSummary {
	let rssiSum = 0;
	let rssiPairs = 0;
	let snrSum = 0;
	let snrPairs = 0;
	for (const pair of diff.matched) {
		if (pair.rssiDeltaDb !== null) {
			rssiSum += pair.rssiDeltaDb;
			rssiPairs++;
		}
		if (pair.snrDeltaDb !== null) {
			snrSum += pair.snrDeltaDb;
			snrPairs++;
		}
	}
	return {
		bothHeard: diff.matched.length,
		onlyA: diff.unmatchedRxA,
		onlyB: diff.unmatchedRxB,
		meanRssiDeltaDb: rssiPairs > 0 ? rssiSum / rssiPairs : null,
		meanSnrDeltaDb: snrPairs > 0 ? snrSum / snrPairs : null,
		rssiPairs,
		snrPairs,
	};
}

/** Seconds, signed, the way a clock offset reads in the UI. */
export function offsetLabel(offsetUs: number): string {
	const s = offsetUs / 1e6;
	return `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(3)} s`;
}

/**
 * The line above the diff table: what was matched, on what clock, and how
 * much the alignment rests on. An unestimated offset says so — comparing two
 * devices on their raw boot clocks is a guess, and it is labelled as one.
 */
export function diffSummaryNote(diff: CaptureDiff): string {
	const parts = [
		diff.offsetSource === "none"
			? `${diff.unmatchedRxA} RX frame(s) in A · ${diff.unmatchedRxB} in B; unpaired because clocks are not aligned`
			: `${diff.matched.length} shared RX match(es) · ${diff.unmatchedRxA} RX only in A · ${diff.unmatchedRxB} RX only in B`,
	];
	if (diff.offsetSource === "none") {
		parts.push(
			"clock not aligned — need at least two distinct shared payloads with agreeing times; no frames paired",
		);
	} else if (diff.offsetSource === "given") {
		parts.push(`clock offset ${offsetLabel(diff.offsetUs)} (set by hand)`);
	} else {
		parts.push(
			`clock offset ${offsetLabel(diff.offsetUs)} estimated from ${diff.anchors} anchor(s) agreeing to within ${(diff.spreadUs / 1000).toFixed(1)} ms`,
		);
	}
	if (diff.offsetSource !== "none")
		parts.push(`matched within ±${(diff.toleranceUs / 1000).toFixed(0)} ms`);
	if (diff.syntheticA + diff.syntheticB > 0)
		parts.push(`${diff.syntheticA + diff.syntheticB} generated frame(s) excluded from matching`);
	const other = diff.ineligibleA + diff.ineligibleB - diff.syntheticA - diff.syntheticB;
	if (other > 0) parts.push(`${other} TX or unknown-direction record(s) excluded from matching`);
	return parts.join(" · ");
}
