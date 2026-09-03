import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildIoGraph,
	bucketAt,
	bucketRange,
	graphRange,
	IO_NODE_SLICES_MAX,
	IO_OTHER_KEY,
	IO_UNATTRIBUTED_KEY,
	type IoGraphFrame,
	type IoSlice,
	ioGraphNote,
	nodeLabel,
	slicesFor,
	stackDescending,
} from "./ioGraph";
import { profileProtocol } from "./profileProtocol";
import { applyBrush, chooseBucketS, IO_MAX_BUCKETS } from "./trafficView";

/** A frame at `tS` seconds on the capture clock. */
function frame(
	tS: number,
	opts: { profileId?: number; synthetic?: boolean } = {},
): IoGraphFrame {
	return {
		timestampUs: BigInt(Math.round(tS * 1e6)),
		profileId: opts.profileId ?? 1,
		synthetic: opts.synthetic ?? false,
	};
}

/** Frames every `stepS` seconds from 0 to `spanS`, inclusive. */
function evenly(spanS: number, stepS: number): IoGraphFrame[] {
	const out: IoGraphFrame[] = [];
	for (let t = 0; t <= spanS + 1e-9; t += stepS) out.push(frame(t));
	return out;
}

const sliceByKey = (slices: IoSlice[], key: string) =>
	slices.find((s) => s.key === key);

describe("buildIoGraph — the empty capture", () => {
	it("plots nothing rather than inventing a bucket", () => {
		const g = buildIoGraph({ frames: [], t0Us: 0n });
		assert.equal(g.frames, 0);
		assert.deepEqual(g.count, []);
		assert.deepEqual(g.byProtocol, []);
		assert.deepEqual(g.byNode, []);
		assert.equal(graphRange(g), null);
		assert.equal(bucketRange(g, 0), null);
		assert.equal(ioGraphNote(g), "no frames to plot");
	});
});

describe("buildIoGraph — silence", () => {
	// The property the whole module exists for: a bucket nothing landed in is
	// a zero reading, not a missing one. Dropping it would draw a line across
	// a dead stretch and claim traffic that never happened.
	it("emits every bucket between the first and last frame, at zero", () => {
		// Two bursts either side of a long gap.
		const frames = [frame(0), frame(0.05), frame(9.9), frame(10)];
		const g = buildIoGraph({ frames, t0Us: 0n });
		assert.equal(g.bucketS, chooseBucketS(10));
		// 0 .. 10 s at 0.1 s a bucket is 101 buckets, and only the two ends
		// hold anything.
		assert.equal(g.count.length, 101);
		assert.equal(
			g.count.reduce((a, b) => a + b, 0),
			4,
		);
		assert.equal(g.silentBuckets, 98);
		for (let b = 1; b < 99; b++) {
			assert.equal(g.count[b], 0, `bucket ${b} should read zero`);
			assert.equal(g.rate[b], 0);
		}
		// Never a hole: every slot is a real number, none undefined.
		assert.ok(g.count.every((v) => Number.isFinite(v)));
		assert.equal(g.edgeS.length, g.count.length);
		assert.equal(g.centerS.length, g.count.length);
	});

	it("counts a silent bucket in every slice too", () => {
		const g = buildIoGraph({ frames: [frame(0), frame(1)], t0Us: 0n });
		for (const slice of g.byProtocol)
			assert.equal(slice.counts.length, g.count.length);
		for (const slice of g.byNode)
			assert.equal(slice.counts.length, g.count.length);
	});
});

describe("buildIoGraph — the bucket adapts to the span", () => {
	it("widens as the capture lengthens, never exceeding the bucket budget", () => {
		const spans = [1, 30, 600, 7200, 86_400, 7 * 86_400];
		let previous = 0;
		for (const spanS of spans) {
			const g = buildIoGraph({
				frames: [frame(0), frame(spanS / 2), frame(spanS)],
				t0Us: 0n,
			});
			assert.equal(g.bucketS, chooseBucketS(spanS), `span ${spanS}`);
			assert.ok(
				g.bucketS > previous,
				`span ${spanS} must not reuse ${previous}`,
			);
			previous = g.bucketS;
			// One extra bucket is the partial one the span's own offset opens.
			assert.ok(
				g.count.length <= IO_MAX_BUCKETS + 1,
				`span ${spanS} produced ${g.count.length} buckets`,
			);
		}
	});

	it("gives a single-frame capture one bucket, not a divide by zero", () => {
		const g = buildIoGraph({ frames: [frame(4.2)], t0Us: 0n });
		assert.equal(g.count.length, 1);
		assert.equal(g.count[0], 1);
		assert.ok(Number.isFinite(g.rate[0]));
		assert.equal(g.silentBuckets, 0);
	});

	it("holds 5,000 frames to a plottable number of bars", () => {
		const frames = evenly(1200, 1200 / 4999);
		assert.equal(frames.length, 5000);
		const g = buildIoGraph({ frames, t0Us: 0n });
		assert.ok(g.count.length <= IO_MAX_BUCKETS + 1);
		assert.equal(g.frames, 5000);
		assert.equal(
			g.count.reduce((a, b) => a + b, 0),
			5000,
		);
	});
});

describe("buildIoGraph — the capture clock", () => {
	it("measures from the full capture's t0, so it agrees with the TIME column", () => {
		const t0 = 1_700_000_000_000_000n;
		const shifted = [frame(0), frame(1), frame(2)].map((f) => ({
			...f,
			timestampUs: f.timestampUs + t0,
		}));
		const g = buildIoGraph({ frames: shifted, t0Us: t0 });
		assert.equal(g.firstS, 0);
		assert.equal(g.lastS, 2);
		assert.equal(g.edgeS[0], 0);
	});

	it("starts the axis where the frames start, not at the capture's t0", () => {
		// A display filter that hides the opening minute must not make the
		// graph draw a minute of fabricated silence before the first match.
		const g = buildIoGraph({ frames: [frame(60), frame(61)], t0Us: 0n });
		assert.equal(g.firstS, 60);
		assert.ok(g.edgeS[0] >= 59.9 && g.edgeS[0] <= 60);
	});
});

describe("buildIoGraph — split by protocol", () => {
	// profileProtocol.ts is the only profile-id table. These expectations are
	// read from it rather than restated, so a change there fails here loudly
	// instead of leaving a fifth copy of the mapping in a test.
	it("names each profile the one table names", () => {
		const frames = [
			frame(0, { profileId: 1 }),
			frame(0.1, { profileId: 4 }),
			frame(0.2, { profileId: 2 }),
			frame(0.3, { profileId: 3 }),
			frame(0.4, { profileId: 5 }),
			frame(0.5, { profileId: 0 }),
			frame(0.6, { profileId: 99 }),
		];
		const g = buildIoGraph({ frames, t0Us: 0n });
		const wanted = new Map<string, number>();
		for (const f of frames) {
			const p = profileProtocol(f.profileId);
			wanted.set(p, (wanted.get(p) ?? 0) + 1);
		}
		assert.equal(g.byProtocol.length, wanted.size);
		for (const slice of g.byProtocol)
			assert.equal(slice.total, wanted.get(slice.key), slice.key);
		// Profile 4 is the Bay Area Medium Range Fast slot — Meshtastic, not
		// Reticulum, which is what three hand-written copies used to claim.
		assert.equal(profileProtocol(4), "meshtastic");
		assert.equal(sliceByKey(g.byProtocol, "meshtastic")?.total, 2);
		assert.equal(sliceByKey(g.byProtocol, "reticulum")?.total, 1);
		assert.equal(sliceByKey(g.byProtocol, "meshcore")?.total, 2);
	});

	it("omits a protocol the capture never carried", () => {
		const g = buildIoGraph({
			frames: [frame(0, { profileId: 1 }), frame(1, { profileId: 1 })],
			t0Us: 0n,
		});
		assert.deepEqual(
			g.byProtocol.map((s) => s.key),
			["meshtastic"],
		);
	});

	it("stacks the protocols in a fixed order whatever arrives first", () => {
		const order = (ids: number[]) =>
			buildIoGraph({
				frames: ids.map((id, i) => frame(i * 0.1, { profileId: id })),
				t0Us: 0n,
			}).byProtocol.map((s) => s.key);
		assert.deepEqual(order([5, 2, 1]), order([1, 2, 5]));
		assert.deepEqual(order([5, 2, 1]), ["meshtastic", "meshcore", "reticulum"]);
	});

	it("puts every frame in exactly one protocol slice, bucket by bucket", () => {
		const frames = [
			frame(0, { profileId: 1 }),
			frame(0, { profileId: 5 }),
			frame(5, { profileId: 2 }),
		];
		const g = buildIoGraph({ frames, t0Us: 0n });
		for (let b = 0; b < g.count.length; b++) {
			const summed = g.byProtocol.reduce((n, s) => n + s.counts[b], 0);
			assert.equal(summed, g.count[b], `bucket ${b}`);
		}
	});
});

describe("buildIoGraph — split by node", () => {
	it("counts a frame against the source its protocol proved", () => {
		const frames = [frame(0), frame(0.1), frame(0.2)];
		const g = buildIoGraph({
			frames,
			t0Us: 0n,
			sources: ["aabbccdd", "aabbccdd", "11223344"],
		});
		assert.equal(sliceByKey(g.byNode, "aabbccdd")?.total, 2);
		assert.equal(sliceByKey(g.byNode, "11223344")?.total, 1);
		assert.equal(g.unattributed, 0);
	});

	// The provenance rule: Reticulum names a destination and no sender,
	// MeshCore names neither. Those frames must not be attached to whichever
	// node happened to be talking nearby.
	it("never attributes a frame whose protocol proved no source", () => {
		const frames = [frame(0), frame(0.1), frame(0.2)];
		const g = buildIoGraph({
			frames,
			t0Us: 0n,
			sources: ["aabbccdd", null, null],
		});
		assert.equal(g.unattributed, 2);
		assert.equal(sliceByKey(g.byNode, IO_UNATTRIBUTED_KEY)?.total, 2);
		assert.equal(sliceByKey(g.byNode, "aabbccdd")?.total, 1);
		// Last in the stack, so it reads as its own layer rather than hiding
		// among the named nodes.
		assert.equal(g.byNode[g.byNode.length - 1].key, IO_UNATTRIBUTED_KEY);
	});

	it("treats a missing source entry as unattributed, not as node zero", () => {
		const g = buildIoGraph({
			frames: [frame(0), frame(0.1)],
			t0Us: 0n,
			sources: ["aabbccdd"], // deliberately short
		});
		assert.equal(g.unattributed, 1);
		assert.equal(sliceByKey(g.byNode, IO_UNATTRIBUTED_KEY)?.total, 1);
	});

	it("treats no source array at all as everything unattributed", () => {
		const g = buildIoGraph({ frames: [frame(0), frame(1)], t0Us: 0n });
		assert.equal(g.unattributed, 2);
		assert.deepEqual(
			g.byNode.map((s) => s.key),
			[IO_UNATTRIBUTED_KEY],
		);
	});

	it("folds the quiet tail into OTHER without losing a frame", () => {
		// IO_NODE_SLICES_MAX + 3 nodes; the busiest talk most.
		const nodes = Array.from({ length: IO_NODE_SLICES_MAX + 3 }, (_, i) =>
			i.toString(16).padStart(8, "0"),
		);
		const frames: IoGraphFrame[] = [];
		const sources: string[] = [];
		let t = 0;
		nodes.forEach((node, i) => {
			for (let n = 0; n < nodes.length - i; n++) {
				frames.push(frame(t));
				sources.push(node);
				t += 0.1;
			}
		});
		const g = buildIoGraph({ frames, t0Us: 0n, sources });
		assert.equal(g.byNode.length, IO_NODE_SLICES_MAX + 1); // + OTHER
		const other = sliceByKey(g.byNode, IO_OTHER_KEY);
		assert.ok(other);
		assert.equal(other.label, "OTHER NODES (3)");
		assert.equal(
			g.byNode.reduce((n, s) => n + s.total, 0),
			frames.length,
		);
		// Busiest first, so the biggest talker is the first layer.
		assert.equal(g.byNode[0].key, nodes[0]);
	});

	it("orders equal talkers by address, so the stack does not shuffle", () => {
		const build = (sources: string[]) =>
			buildIoGraph({
				frames: sources.map((_, i) => frame(i * 0.1)),
				t0Us: 0n,
				sources,
			}).byNode.map((s) => s.key);
		assert.deepEqual(build(["0000000b", "0000000a"]), ["0000000a", "0000000b"]);
		assert.deepEqual(build(["0000000a", "0000000b"]), ["0000000a", "0000000b"]);
	});

	it("puts every frame in exactly one node slice, bucket by bucket", () => {
		const g = buildIoGraph({
			frames: [frame(0), frame(0.3), frame(0.6)],
			t0Us: 0n,
			sources: ["aabbccdd", null, "11223344"],
		});
		for (let b = 0; b < g.count.length; b++) {
			const summed = g.byNode.reduce((n, s) => n + s.counts[b], 0);
			assert.equal(summed, g.count[b], `bucket ${b}`);
		}
	});
});

describe("nodeLabel", () => {
	it("writes a Meshtastic node number the way the rest of the app does", () => {
		assert.equal(nodeLabel("aabbccdd"), "!aabbccdd");
	});

	it("leaves an address that is not a node number alone", () => {
		const reticulumHash = "0123456789abcdef0123456789abcdef";
		assert.equal(nodeLabel(reticulumHash), reticulumHash);
	});

	it("names the two reserved slices in words, not as addresses", () => {
		assert.equal(nodeLabel(IO_UNATTRIBUTED_KEY), "UNATTRIBUTED");
		assert.equal(nodeLabel(IO_OTHER_KEY), "OTHER NODES");
	});
});

describe("buildIoGraph — synthetic frames", () => {
	it("keeps them countable per bucket instead of blending them in", () => {
		const frames = [
			frame(0),
			frame(0.1, { synthetic: true }),
			frame(5, { synthetic: true }),
		];
		const g = buildIoGraph({ frames, t0Us: 0n });
		assert.equal(g.syntheticFrames, 2);
		assert.equal(g.synthetic.length, g.count.length);
		assert.equal(
			g.synthetic.reduce((a, b) => a + b, 0),
			2,
		);
		assert.equal(g.synthetic[0], 0);
		assert.equal(g.synthetic[1], 1);
	});

	it("says so in the caption, always", () => {
		const g = buildIoGraph({
			frames: [frame(0, { synthetic: true }), frame(1)],
			t0Us: 0n,
		});
		assert.match(ioGraphNote(g), /1 SYNTHETIC · NOT OTA/);
	});

	it("says nothing about synthetic frames when there were none", () => {
		const g = buildIoGraph({ frames: [frame(0), frame(1)], t0Us: 0n });
		assert.doesNotMatch(ioGraphNote(g), /SYNTHETIC/);
	});
});

describe("ioGraphNote", () => {
	it("states the bar width and how much of the capture was silent", () => {
		const g = buildIoGraph({ frames: [frame(0), frame(10)], t0Us: 0n });
		assert.match(ioGraphNote(g), /2 frames/);
		assert.match(ioGraphNote(g), /1 bar = 100 ms/);
		assert.match(ioGraphNote(g), /99 of 101 bars silent/);
	});

	it("reports unattributed frames rather than letting them pass as nodes", () => {
		const g = buildIoGraph({
			frames: [frame(0), frame(1)],
			t0Us: 0n,
			sources: ["aabbccdd", null],
		});
		assert.match(ioGraphNote(g), /1 name no source their protocol proves/);
	});
});

describe("bucketAt", () => {
	it("resolves a click on the plot to the bar under it", () => {
		const frames = [frame(0), frame(0.05), frame(0.1), frame(0.15)];
		const g = buildIoGraph({ frames, t0Us: 0n });
		assert.equal(g.bucketS, 0.1);
		assert.equal(bucketAt(g, 0), 0);
		assert.equal(bucketAt(g, 0.099), 0);
		assert.equal(bucketAt(g, 0.1), 1);
		assert.equal(bucketAt(g, 0.15), 1);
	});

	it("refuses a time off either end rather than clamping into a bar", () => {
		const g = buildIoGraph({ frames: [frame(10), frame(11)], t0Us: 0n });
		assert.equal(bucketAt(g, 9.5), -1);
		assert.equal(bucketAt(g, 12), -1);
		assert.equal(bucketAt(g, Number.NaN), -1);
		assert.equal(bucketAt(buildIoGraph({ frames: [], t0Us: 0n }), 0), -1);
	});

	it("agrees with the bin the frame was actually counted in", () => {
		const frames = evenly(300, 3.7);
		const g = buildIoGraph({ frames, t0Us: 0n });
		const seen = new Array<number>(g.count.length).fill(0);
		for (const f of frames) {
			const i = bucketAt(g, Number(f.timestampUs) / 1e6);
			assert.notEqual(i, -1);
			seen[i]++;
		}
		assert.deepEqual(seen, g.count);
	});
});

describe("bucketRange", () => {
	it("selects exactly the frames the bar counted", () => {
		const frames = [frame(0), frame(0.05), frame(0.1), frame(0.15)];
		const g = buildIoGraph({ frames, t0Us: 0n });
		const all = frames.map((_, i) => i);
		for (let b = 0; b < g.count.length; b++) {
			const range = bucketRange(g, b);
			assert.ok(range);
			const kept = applyBrush(all, frames, 0n, range);
			assert.equal(kept.length, g.count[b], `bucket ${b}`);
		}
	});

	it("leaves the frame sitting on the next edge to the next bar", () => {
		// The brush is inclusive at both ends, so without the half-microsecond
		// pull-back a click would show one more frame than the bar drew.
		const frames = [frame(0), frame(0.1)];
		const g = buildIoGraph({ frames, t0Us: 0n });
		assert.equal(g.count[0], 1);
		assert.deepEqual(applyBrush([0, 1], frames, 0n, bucketRange(g, 0)), [0]);
		assert.deepEqual(applyBrush([0, 1], frames, 0n, bucketRange(g, 1)), [1]);
	});

	it("refuses an index off the end rather than inventing a range", () => {
		const g = buildIoGraph({ frames: [frame(0)], t0Us: 0n });
		assert.equal(bucketRange(g, -1), null);
		assert.equal(bucketRange(g, 1), null);
	});
});

describe("graphRange", () => {
	it("covers every frame the graph plotted — the way back to the whole capture", () => {
		const frames = [frame(0), frame(2.5), frame(9.9)];
		const g = buildIoGraph({ frames, t0Us: 0n });
		assert.deepEqual(
			applyBrush([0, 1, 2], frames, 0n, graphRange(g)),
			[0, 1, 2],
		);
	});
});

describe("stackDescending", () => {
	const slices: IoSlice[] = [
		{ key: "a", label: "A", counts: [1, 0, 2], total: 3 },
		{ key: "b", label: "B", counts: [2, 5, 0], total: 7 },
		{ key: "c", label: "C", counts: [0, 1, 1], total: 2 },
	];

	it("returns draw order — top of the stack first", () => {
		assert.deepEqual(
			stackDescending(slices).map((s) => s.slice.key),
			["c", "b", "a"],
		);
	});

	it("gives each bar the running total at its own level", () => {
		const stacked = stackDescending(slices);
		assert.deepEqual(stacked[0].cumulative, [3, 6, 3]); // a+b+c
		assert.deepEqual(stacked[1].cumulative, [3, 5, 2]); // a+b
		assert.deepEqual(stacked[2].cumulative, [1, 0, 2]); // a
	});

	it("never lets a later bar out-reach the one it paints over", () => {
		// This is what makes plain filled bars stack without bands: each drawn
		// series must be no taller than its predecessor, in every bucket.
		const stacked = stackDescending(slices);
		for (let i = 1; i < stacked.length; i++) {
			for (let b = 0; b < 3; b++) {
				assert.ok(
					stacked[i].cumulative[b] <= stacked[i - 1].cumulative[b],
					`series ${i} bucket ${b}`,
				);
			}
		}
	});

	it("tops out at the graph's own per-bucket count", () => {
		const g = buildIoGraph({
			frames: [
				frame(0, { profileId: 1 }),
				frame(0, { profileId: 5 }),
				frame(3),
			],
			t0Us: 0n,
		});
		const stacked = stackDescending(g.byProtocol);
		assert.deepEqual(stacked[0].cumulative, g.count);
	});

	it("handles an empty slice list", () => {
		assert.deepEqual(stackDescending([]), []);
	});
});

describe("slicesFor", () => {
	it("picks the split the screen is showing", () => {
		const g = buildIoGraph({
			frames: [frame(0)],
			t0Us: 0n,
			sources: ["aabbccdd"],
		});
		assert.equal(slicesFor(g, "protocol"), g.byProtocol);
		assert.equal(slicesFor(g, "node"), g.byNode);
	});
});
