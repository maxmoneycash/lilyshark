// Self-check: node --import tsx --test src/lib/captureDiff.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_DIFF_TOLERANCE_US,
	type DiffFrame,
	diffCaptures,
	diffRows,
	diffSummaryNote,
	estimateTimeOffsetUs,
	offsetLabel,
	payloadHashHex,
	witnessSummary,
} from "./captureDiff";
import { RF_FIELD } from "./lscap";

/* ── fixtures ────────────────────────────────────────────────────────── */

const REPORTS_BOTH = RF_FIELD.rssi | RF_FIELD.snr;

function frame(
	sequence: number,
	timestampUs: number,
	payload: readonly number[],
	over: Partial<DiffFrame> = {},
): DiffFrame {
	return {
		sequence: BigInt(sequence),
		timestampUs: BigInt(timestampUs),
		bytes: Uint8Array.from(payload),
		presentFields: REPORTS_BOTH,
		rssiDbm: -90,
		snrDb: 5,
		...over,
	};
}

/** A small capture: four distinct payloads, one per second. */
function captureA(): DiffFrame[] {
	return [
		frame(1, 1_000_000, [0x10, 0x01], { rssiDbm: -80, snrDb: 8 }),
		frame(2, 2_000_000, [0x10, 0x02], { rssiDbm: -85, snrDb: 6 }),
		frame(3, 3_000_000, [0x10, 0x03], { rssiDbm: -90, snrDb: 4 }),
		frame(4, 4_000_000, [0x10, 0x04], { rssiDbm: -95, snrDb: 2 }),
	];
}

/** The same four transmissions on a second device's clock, offset by `shift`. */
function heardAgain(
	frames: readonly DiffFrame[],
	shiftUs: number,
	over: (index: number) => Partial<DiffFrame> = () => ({}),
): DiffFrame[] {
	return frames.map((f, i) => ({
		...f,
		sequence: BigInt(100 + i),
		timestampUs: f.timestampUs + BigInt(shiftUs),
		bytes: Uint8Array.from(f.bytes),
		...over(i),
	}));
}

/* ── payload identity ────────────────────────────────────────────────── */

test("the payload key is stable, and separates payloads that differ", () => {
	const bytes = Uint8Array.from([1, 2, 3, 4]);
	assert.equal(payloadHashHex(bytes), payloadHashHex(Uint8Array.from(bytes)));
	assert.equal(payloadHashHex(bytes).length, 16);
	assert.notEqual(
		payloadHashHex(bytes),
		payloadHashHex(Uint8Array.from([1, 2, 3])),
	);
	// A transposition and a zero-extension are different payloads.
	assert.notEqual(
		payloadHashHex(bytes),
		payloadHashHex(Uint8Array.from([2, 1, 3, 4])),
	);
	assert.notEqual(
		payloadHashHex(bytes),
		payloadHashHex(Uint8Array.from([1, 2, 3, 4, 0])),
	);
	assert.equal(payloadHashHex(new Uint8Array()).length, 16);
});

/* ── the three rubric cases ──────────────────────────────────────────── */

test("identical captures match fully, with nothing left over", () => {
	const a = captureA();
	const diff = diffCaptures(a, captureA());
	assert.equal(diff.matched.length, 4);
	assert.deepEqual(diff.unmatchedA, []);
	assert.deepEqual(diff.unmatchedB, []);
	assert.equal(diff.offsetUs, 0);
	assert.equal(diff.offsetSource, "estimated");
	assert.equal(diff.anchors, 4);
	assert.equal(diff.spreadUs, 0);
	// Every pair lines the same frame up with itself.
	for (const pair of diff.matched) {
		assert.equal(pair.aIndex, pair.bIndex);
		assert.equal(pair.deltaUs, 0);
		assert.equal(pair.residualUs, 0);
	}
});

test("a time-shifted capture still matches under offset estimation", () => {
	const a = captureA();
	// 12.5 s of clock difference — far beyond any matching tolerance, which
	// is the whole point: two devices' boot clocks are unrelated numbers.
	const b = heardAgain(a, 12_500_000);
	const diff = diffCaptures(a, b);
	assert.equal(diff.offsetSource, "estimated");
	assert.equal(diff.offsetUs, 12_500_000);
	assert.equal(diff.anchors, 4);
	assert.equal(diff.matched.length, 4);
	assert.deepEqual(diff.unmatchedA, []);
	assert.deepEqual(diff.unmatchedB, []);
	for (const pair of diff.matched) {
		assert.equal(pair.deltaUs, 12_500_000);
		assert.equal(pair.residualUs, 0);
	}
	// Without estimation the same captures share nothing on their raw clocks.
	const raw = diffCaptures(a, b, { offsetUs: 0 });
	assert.equal(raw.offsetSource, "given");
	assert.equal(raw.matched.length, 0);
	assert.equal(raw.unmatchedA.length, 4);
	assert.equal(raw.unmatchedB.length, 4);
});

test("a shift plus per-frame jitter still lines up, offset from the median", () => {
	const a = captureA();
	const jitter = [0, 40_000, -25_000, 15_000];
	const b = a.map((f, i) => ({
		...f,
		timestampUs: f.timestampUs + BigInt(7_000_000 + jitter[i]),
		bytes: Uint8Array.from(f.bytes),
	}));
	const diff = diffCaptures(a, b, { toleranceUs: 250_000 });
	assert.equal(diff.matched.length, 4);
	assert.equal(diff.anchors, 4);
	// The median of the four readings, and a spread that reports the jitter.
	assert.equal(diff.offsetUs, 7_000_000 + (0 + 15_000) / 2);
	assert.equal(diff.spreadUs, 65_000);
	assert.ok(diff.matched.every((p) => Math.abs(p.residualUs) <= 250_000));
});

test("unmatched frames are reported per side, on their own clocks", () => {
	const a = captureA();
	// B missed frame 3 and heard one thing A never did.
	const b = heardAgain([a[0], a[1], a[3]], 5_000_000);
	b.push(frame(200, 9_500_000, [0xaa, 0xbb]));
	const diff = diffCaptures(a, b);
	assert.equal(diff.matched.length, 3);
	assert.deepEqual(diff.unmatchedA, [2]);
	assert.deepEqual(diff.unmatchedB, [3]);
	assert.equal(diff.countA, 4);
	assert.equal(diff.countB, 4);

	const summary = witnessSummary(diff);
	assert.equal(summary.bothHeard, 3);
	assert.equal(summary.onlyA, 1);
	assert.equal(summary.onlyB, 1);
});

/* ── the witness use case ────────────────────────────────────────────── */

test("a matched pair carries each side's own RSSI and SNR", () => {
	const a = captureA();
	const b = heardAgain(a, 3_000_000, (i) => ({
		rssiDbm: -70 - i,
		snrDb: 11 - i,
	}));
	const diff = diffCaptures(a, b);
	const first = diff.matched[0];
	assert.deepEqual(first.a, { rssiDbm: -80, snrDb: 8 });
	assert.deepEqual(first.b, { rssiDbm: -70, snrDb: 11 });
	assert.equal(first.rssiDeltaDb, 10);
	assert.equal(first.snrDeltaDb, 3);

	const summary = witnessSummary(diff);
	assert.equal(summary.rssiPairs, 4);
	assert.equal(summary.snrPairs, 4);
	// B heard every frame stronger than A did — A's readings fall away
	// faster than B's, so the gap widens down the capture.
	assert.equal(summary.meanRssiDeltaDb, (10 + 14 + 18 + 22) / 4);
	assert.equal(summary.meanSnrDeltaDb, (3 + 4 + 5 + 6) / 4);
});

test("a field a radio did not report is null, never a zero", () => {
	const a = [frame(1, 1_000_000, [7, 7], { presentFields: 0 })];
	const b = [frame(9, 1_000_000, [7, 7])];
	const diff = diffCaptures(a, b);
	assert.equal(diff.matched.length, 1);
	assert.deepEqual(diff.matched[0].a, { rssiDbm: null, snrDb: null });
	assert.deepEqual(diff.matched[0].b, { rssiDbm: -90, snrDb: 5 });
	// A difference needs both sides to have reported.
	assert.equal(diff.matched[0].rssiDeltaDb, null);
	assert.equal(diff.matched[0].snrDeltaDb, null);
	const summary = witnessSummary(diff);
	assert.equal(summary.meanRssiDeltaDb, null);
	assert.equal(summary.rssiPairs, 0);
});

/* ── matching discipline ─────────────────────────────────────────────── */

test("frames outside the tolerance stay unmatched rather than being forced", () => {
	const a = [frame(1, 1_000_000, [1, 2, 3])];
	const b = [frame(2, 1_000_000 + 3_000_000, [1, 2, 3])];
	// Told the offset is zero, the pair is 3 s apart: too far to be one event.
	const diff = diffCaptures(a, b, { offsetUs: 0, toleranceUs: 500_000 });
	assert.equal(diff.matched.length, 0);
	assert.deepEqual(diff.unmatchedA, [0]);
	assert.deepEqual(diff.unmatchedB, [0]);
});

test("a repeated payload pairs one-to-one, never many-to-one", () => {
	const beacon = [0xbe, 0xac];
	const a = [
		frame(1, 1_000_000, beacon),
		frame(2, 2_000_000, beacon),
		frame(3, 3_000_000, beacon),
	];
	// The second device heard only two of the three beacons.
	const b = [frame(10, 1_010_000, beacon), frame(11, 3_010_000, beacon)];
	const diff = diffCaptures(a, b, { offsetUs: 0, toleranceUs: 100_000 });
	assert.equal(diff.matched.length, 2);
	assert.deepEqual(
		diff.matched.map((p) => [p.aIndex, p.bIndex]),
		[
			[0, 0],
			[2, 1],
		],
	);
	assert.deepEqual(diff.unmatchedA, [1]);
	assert.deepEqual(diff.unmatchedB, []);
});

test("payloads of equal length but different bytes never pair", () => {
	const a = [frame(1, 1_000_000, [1, 2, 3, 4])];
	const b = [frame(2, 1_000_000, [1, 2, 3, 5])];
	const diff = diffCaptures(a, b, { offsetUs: 0 });
	assert.equal(diff.matched.length, 0);
	assert.deepEqual(diff.unmatchedA, [0]);
	assert.deepEqual(diff.unmatchedB, [0]);
});

test("two captures with nothing in common say the clock is a guess", () => {
	const a = captureA();
	const b = [frame(9, 40_000_000, [0xff, 0xee])];
	const diff = diffCaptures(a, b);
	assert.equal(diff.offsetSource, "none");
	assert.equal(diff.offsetUs, 0);
	assert.equal(diff.anchors, 0);
	assert.equal(diff.matched.length, 0);
	assert.match(diffSummaryNote(diff), /no shared payload to align on/);
	assert.match(diffSummaryNote(diff), /assumption, not a measurement/);
});

test("an empty capture diffs without dividing by anything", () => {
	const diff = diffCaptures([], []);
	assert.deepEqual(
		{ matched: diff.matched, a: diff.unmatchedA, b: diff.unmatchedB },
		{ matched: [], a: [], b: [] },
	);
	assert.equal(diff.offsetSource, "none");
	assert.deepEqual(diffRows([], [], diff), []);

	const oneSided = diffCaptures(captureA(), []);
	assert.deepEqual(oneSided.unmatchedA, [0, 1, 2, 3]);
	assert.equal(oneSided.matched.length, 0);
});

test("estimation ignores a coincidence in favour of the agreeing cluster", () => {
	const a = [
		frame(1, 1_000_000, [1]),
		frame(2, 2_000_000, [2]),
		frame(3, 3_000_000, [3]),
		frame(4, 4_000_000, [9]),
	];
	const b = [
		frame(10, 6_000_000, [1]),
		frame(11, 7_000_000, [2]),
		frame(12, 8_000_000, [3]),
		// The same payload heard 40 s out — one reading against three.
		frame(13, 44_000_000, [9]),
	];
	const estimate = estimateTimeOffsetUs(a, b, 500_000);
	assert.equal(estimate.offsetUs, 5_000_000);
	assert.equal(estimate.anchors, 3);
	const diff = diffCaptures(a, b, { toleranceUs: 500_000 });
	assert.equal(diff.matched.length, 3);
	assert.deepEqual(diff.unmatchedA, [3]);
	assert.deepEqual(diff.unmatchedB, [3]);
});

test("the default tolerance is a documented second", () => {
	assert.equal(DEFAULT_DIFF_TOLERANCE_US, 1_000_000);
	assert.equal(diffCaptures([], []).toleranceUs, DEFAULT_DIFF_TOLERANCE_US);
});

/* ── the merged view ─────────────────────────────────────────────────── */

test("rows interleave both sides on one clock, marked per side", () => {
	const a = captureA();
	const b = heardAgain([a[0], a[2]], 20_000_000);
	b.push(frame(300, 20_000_000 + 3_500_000, [0xaa]));
	const diff = diffCaptures(a, b);
	const rows = diffRows(a, b, diff);

	assert.equal(rows.length, 5); // 2 matched + 2 A-only + 1 B-only
	assert.deepEqual(
		rows.map((r) => r.kind),
		["both", "a-only", "both", "b-only", "a-only"],
	);
	// The clock starts at A's first frame and both sides land on it.
	assert.deepEqual(
		rows.map((r) => Number(r.timeS.toFixed(3))),
		[0, 1, 2, 2.5, 3],
	);
	assert.equal(rows[0].pair?.bIndex, 0);
	assert.equal(rows[3].bIndex, 2);
	assert.equal(rows[3].aIndex, null);
});

test("the summary line reports what the alignment rests on", () => {
	const a = captureA();
	const diff = diffCaptures(a, heardAgain(a, 12_500_000));
	const note = diffSummaryNote(diff);
	assert.match(note, /4 frame\(s\) heard by both/);
	assert.match(note, /clock offset \+12\.500 s estimated from 4 anchor\(s\)/);
	assert.match(note, /matched within ±1000 ms/);
	assert.equal(offsetLabel(-1_500_000), "−1.500 s");
});
