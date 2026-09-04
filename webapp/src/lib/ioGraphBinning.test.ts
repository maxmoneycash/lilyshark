/**
 * The one property the IO graph has to hold: a bar selects exactly the frames
 * it counted.
 *
 * The graph exists so an operator can point at a gap and say "nothing was
 * heard here". TrafficTab words it that strongly -- "Nothing was heard in
 * 0.600-0.700 s. That silence is the reading" -- so a bar that draws frames
 * and then selects none of them is the instrument lying in the exact register
 * it was built to be trusted in.
 *
 * It did. buildIoGraph binned with `Math.floor(t / bucketS)` while bucketRange
 * described the same bar as `(firstBucket + index) * bucketS` with the right
 * edge pulled back half a microsecond. Those agree only when bucketS is a
 * binary fraction. 0.3 / 0.1 is 2.9999999999999996, so a frame at 0.3 s was
 * counted into bar 2 and excluded by bar 2's range. chooseBucketS returns 0.1
 * for any span under 24 s and 0.2 under 48 s, so every short capture was
 * exposed -- and the bundled 68.8 s sample buckets at 0.5 s, which IS binary
 * exact, which is why a browser spot-check and forty existing tests all
 * missed it.
 *
 * These tests sweep the bucket widths chooseBucketS actually returns and
 * compare, for every bar, the count the graph drew against the number of
 * frames a click on that bar selects. Nothing here is hand-picked: the
 * failure was a float coincidence, so the check has to be exhaustive rather
 * than illustrative.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIoGraph, bucketAt, bucketRange } from "./ioGraph";
import { applyBrush, bucketIndexOf, chooseBucketS } from "./trafficView";

interface Frame {
	timestampUs: bigint;
	profileId: number;
	synthetic: boolean;
}

function framesAt(offsetsUs: number[]): Frame[] {
	return offsetsUs.map((us) => ({
		timestampUs: BigInt(us),
		profileId: 1,
		synthetic: false,
	}));
}

/** A capture of `n` frames at a fixed cadence, the reviewer's shape. */
function cadence(n: number, stepUs: number): Frame[] {
	return framesAt(Array.from({ length: n }, (_, i) => i * stepUs));
}

/**
 * For every bar: does clicking it select as many frames as it drew?
 * Returns the bars where it does not.
 */
function disagreeingBars(frames: Frame[]): string[] {
	const graph = buildIoGraph({ frames, t0Us: 0n });
	const all = frames.map((_, i) => i);
	const bad: string[] = [];
	for (let b = 0; b < graph.count.length; b++) {
		const range = bucketRange(graph, b);
		const selected = applyBrush(all, frames, 0n, range).length;
		if (selected !== graph.count[b]) {
			bad.push(`bar ${b}: counted ${graph.count[b]}, click selects ${selected}`);
		}
	}
	return bad;
}

describe("a bar selects the frames it counted", () => {
	it("holds for a 10 s capture at a 300 ms cadence", () => {
		// The reviewer's first measurement: 15 of 100 bars selected the wrong
		// frames, 14 of them selecting ZERO for a visibly non-empty bar.
		assert.deepEqual(disagreeingBars(cadence(34, 300_000)), []);
	});

	it("holds for a 2 s capture on a 100 ms grid", () => {
		// The reviewer's second: 7 of 21 bars wrong, including
		// "bar 6: counted 1, click selects 0".
		assert.deepEqual(disagreeingBars(cadence(21, 100_000)), []);
	});

	it("holds across every span chooseBucketS has a rung for", () => {
		// Spans chosen to land on both sides of each rung of the ladder, so a
		// bucket width that is not a binary fraction cannot hide between two
		// hand-picked cases.
		const spansS = [0.5, 1, 2, 5, 10, 23, 24, 30, 47, 48, 60, 120, 300, 600, 3600];
		const failures: string[] = [];
		for (const spanS of spansS) {
			for (const n of [7, 21, 100]) {
				const step = Math.max(1, Math.round((spanS * 1e6) / (n - 1)));
				const bad = disagreeingBars(cadence(n, step));
				if (bad.length > 0) {
					failures.push(`span ${spanS}s, ${n} frames, bucket ${chooseBucketS(spanS)}s: ${bad[0]}`);
				}
			}
		}
		assert.deepEqual(failures, []);
	});

	it("holds when frames land exactly on a bucket edge", () => {
		// t = 0.3 with a 0.1 s bucket is the specific float coincidence that
		// broke it: floor(0.3 / 0.1) is 2, not 3.
		const frames = framesAt([0, 100_000, 200_000, 300_000, 400_000, 500_000]);
		assert.deepEqual(disagreeingBars(frames), []);
		// And name the arithmetic outright, so a change to it fails here.
		assert.equal(bucketIndexOf(0.3, 0.1, 0), 2, "0.3 / 0.1 floors to 2 in IEEE 754");
	});
});

describe("the bar a click resolves to is the bar the frame is in", () => {
	it("agrees with the binning for every frame", () => {
		const frames = cadence(40, 250_000);
		const graph = buildIoGraph({ frames, t0Us: 0n });
		const firstBucket = Math.round(graph.edgeS[0] / graph.bucketS);
		for (let i = 0; i < frames.length; i++) {
			const tS = Number(frames[i].timestampUs) / 1e6;
			assert.equal(
				bucketAt(graph, tS),
				bucketIndexOf(tS, graph.bucketS, firstBucket),
				`frame ${i} at ${tS}s resolves to a different bar than it was binned into`,
			);
		}
	});
});

describe("an empty bar really is empty", () => {
	it("selects nothing where the graph drew zero, and draws zero where nothing was heard", () => {
		// A deliberate gap: frames either side of a silent stretch. The graph
		// must draw 0 across the gap AND select 0 there -- a bar that draws 0
		// but selects frames would be the same lie in the other direction.
		const frames = framesAt([0, 100_000, 200_000, 3_000_000, 3_100_000]);
		const graph = buildIoGraph({ frames, t0Us: 0n });
		const all = frames.map((_, i) => i);
		let sawEmpty = false;
		for (let b = 0; b < graph.count.length; b++) {
			const selected = applyBrush(all, frames, 0n, bucketRange(graph, b)).length;
			assert.equal(selected, graph.count[b], `bar ${b}`);
			if (graph.count[b] === 0) sawEmpty = true;
		}
		assert.ok(sawEmpty, "this capture is supposed to contain a silence");
		assert.equal(
			graph.count.reduce((a, b) => a + b, 0),
			frames.length,
			"every frame is counted in exactly one bar",
		);
	});
});

describe("a dragged brush is still a range, not a bucket", () => {
	it("selects by time when it carries no bin", () => {
		const frames = framesAt([0, 500_000, 1_000_000, 1_500_000]);
		const all = frames.map((_, i) => i);
		assert.deepEqual(applyBrush(all, frames, 0n, { startS: 0.4, endS: 1.1 }), [1, 2]);
	});

	it("keeps both edges, so brushing onto a frame keeps it", () => {
		const frames = framesAt([0, 500_000, 1_000_000]);
		const all = frames.map((_, i) => i);
		assert.deepEqual(applyBrush(all, frames, 0n, { startS: 0.5, endS: 1.0 }), [1, 2]);
	});
});
