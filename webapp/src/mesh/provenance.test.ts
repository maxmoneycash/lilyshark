/**
 * A node built from an invented frame must never be drawn as a received one.
 *
 * The coverage map paints three provenances and says which is which in its
 * legend: `radio` means this deck's receiver decoded it and measured the
 * signal, `net` means the internet reported it and nobody here heard it,
 * `sim` means it was invented. The whole point of the view is to say where
 * signal was actually found, so mislabelling invented positions as received
 * ones is the worst thing it can do.
 *
 * It did. The map decided a contact was synthetic by asking the global
 * `isDemo()`, but `applyAnalyzerLink` calls `clearDemo()` the instant a deck
 * links -- and every path that builds a node from a frame calls
 * `applyAnalyzerLink` first. So a deck running SIMULATE would fill the store
 * with invented nodes, clear the demo flag by the act of linking, and have
 * every one of those nodes redrawn as `radio`. The firmware had stated `sim`
 * on each of those frames all along; the store simply dropped it.
 *
 * These tests pin the flag to the node, which is where provenance belongs:
 * it is a fact about how that node was learned, not about what mode the app
 * happens to be in when something asks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { HeardFrame } from "../lib/deviceLink";
import { applyHeardFrame } from "./analyzerMesh";
import { clearDemo, isDemo } from "./demo";
import { getSnapshot } from "./store";

function heard(over: Partial<HeardFrame> & { src: number; sim: boolean }): HeardFrame {
	return {
		dst: 0xffffffff,
		proto: "meshtastic",
		port: 1,
		hops: 0,
		rssiX10: -1010,
		snrX10: 55,
		kind: "text",
		lat: 37.911,
		lon: -122.018,
		atMs: 1_756_000_000_000,
		...over,
	} as HeardFrame;
}

function nodeIn(store: ReturnType<typeof getSnapshot>, num: number) {
	const n = store.nodes.get(num);
	assert.ok(n, `node ${num.toString(16)} is in the store`);
	return n;
}

test("a node built from a generated frame is marked as generated", () => {
	applyHeardFrame(heard({ src: 0x5151, sim: true }));
	assert.equal(nodeIn(getSnapshot(), 0x5151).viaSim, true);
});

test("a node built from a received frame is not", () => {
	applyHeardFrame(heard({ src: 0x8ea1, sim: false }));
	assert.equal(nodeIn(getSnapshot(), 0x8ea1).viaSim, false);
});

test("linking a deck does not turn invented nodes into received ones", () => {
	// The exact sequence that produced the leak: a SIMULATE frame arrives,
	// which links the deck, which clears the demo flag. Before this, the map
	// asked isDemo() -- now false -- and drew the invented node as `radio`.
	applyHeardFrame(heard({ src: 0x5152, sim: true }));
	assert.equal(isDemo(), false, "linking a deck clears the demo flag, as it always did");
	assert.equal(
		nodeIn(getSnapshot(), 0x5152).viaSim,
		true,
		"but the node still says it was invented, because that is a fact about the node",
	);
});

test("a real frame from the same deck is still marked received", () => {
	// SIMULATE and real reception can both occur in one session; the flag has
	// to follow the frame, not the session.
	clearDemo();
	applyHeardFrame(heard({ src: 0x6001, sim: true }));
	applyHeardFrame(heard({ src: 0x6002, sim: false }));
	const s = getSnapshot();
	assert.equal(nodeIn(s, 0x6001).viaSim, true);
	assert.equal(nodeIn(s, 0x6002).viaSim, false);
});

test("a node that starts invented and is later genuinely heard becomes received", () => {
	// If the radio really does decode this node, the later frame is the
	// better evidence and the node stops being marked invented.
	applyHeardFrame(heard({ src: 0x7001, sim: true }));
	assert.equal(nodeIn(getSnapshot(), 0x7001).viaSim, true);
	applyHeardFrame(heard({ src: 0x7001, sim: false, atMs: 1_756_000_001_000 }));
	assert.equal(
		nodeIn(getSnapshot(), 0x7001).viaSim,
		false,
		"a genuine reception overrides an earlier invented one",
	);
});
