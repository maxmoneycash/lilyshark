import assert from "node:assert/strict";
import test from "node:test";

import { buildTransitionGraph } from "./announceGraph";
import { summarizeAnnounces, type AnnounceSourceFrame } from "./announceView";

function ramp(start: number, count: number): Uint8Array {
	const out = new Uint8Array(count);
	for (let i = 0; i < count; i++) out[i] = (start + i) & 0xff;
	return out;
}

function announceBytes(opts: {
	destination: number;
	hops?: number;
	transport?: number | null;
}): Uint8Array {
	const headerTwo = opts.transport !== undefined && opts.transport !== null;
	const len = 1 + (headerTwo ? 35 : 19) + 148;
	const out = new Uint8Array(len);
	out[0] = 0x00;
	out[1] = headerTwo ? 0x41 : 0x01;
	out[2] = opts.hops ?? 0;
	if (headerTwo) {
		out.set(ramp(opts.transport ?? 0x70, 16), 3);
		out.set(ramp(opts.destination, 16), 19);
		out[35] = 0x00;
		out.set(ramp(0x10, 64), 36);
		out.set(ramp(0x20, 10), 100);
		out.set(ramp(0x30, 10), 110);
		out.set(ramp(0x40, 64), 120);
	} else {
		out.set(ramp(opts.destination, 16), 3);
		out[19] = 0x00;
		out.set(ramp(0x10, 64), 20);
		out.set(ramp(0x20, 10), 84);
		out.set(ramp(0x30, 10), 94);
		out.set(ramp(0x40, 64), 104);
	}
	return out;
}

function frameAt(seconds: number, bytes: Uint8Array): AnnounceSourceFrame {
	return {
		timestampUs: BigInt(Math.round(seconds * 1e6)),
		bytes,
		truncated: false,
		profileId: 5,
		airtimeUs: 150000,
	};
}

const T0 = 0n;

test("transition graph over steady single path has nodes but zero transitions", () => {
	const frames = [
		frameAt(0, announceBytes({ destination: 0xd0, hops: 1 })),
		frameAt(5, announceBytes({ destination: 0xd0, hops: 1 })),
		frameAt(10, announceBytes({ destination: 0xd0, hops: 1 })),
	];
	const overview = summarizeAnnounces(frames, T0);
	assert.equal(overview.destinations.length, 1);
	const dest = overview.destinations[0];
	const graph = buildTransitionGraph(dest);

	assert.equal(graph.totalTransitions, 0);
	assert.equal(graph.nodes.length, 1);
	assert.equal(graph.edges.length, 0);
	assert.match(graph.mermaid, /flowchart TD/);
	assert.match(graph.mermaid, /1 hop \(direct\)/);
});

test("transition graph tracks directed topology shifts across multiple announces", () => {
	// Destination 0xd0 shifts:
	// T=0:  1 hop (direct)
	// T=10: 2 hops (direct)
	// T=20: 3 hops via transport 0x70
	// T=30: 1 hop (direct)
	const frames = [
		frameAt(0, announceBytes({ destination: 0xd0, hops: 1 })),
		frameAt(10, announceBytes({ destination: 0xd0, hops: 2 })),
		frameAt(20, announceBytes({ destination: 0xd0, hops: 3, transport: 0x70 })),
		frameAt(30, announceBytes({ destination: 0xd0, hops: 1 })),
	];
	const overview = summarizeAnnounces(frames, T0);
	const dest = overview.destinations[0];
	const graph = buildTransitionGraph(dest);

	assert.equal(graph.totalTransitions, 3);
	assert.equal(graph.nodes.length, 3);
	assert.equal(graph.edges.length, 3);

	// Check transitions details
	const [t1, t2, t3] = graph.transitions;
	assert.equal(t1.fromHops, 1);
	assert.equal(t1.toHops, 2);
	assert.equal(t1.hopsDelta, 1);
	assert.equal(t1.atTimeS, 10);
	assert.equal(t1.deltaS, 10);

	assert.equal(t2.fromHops, 2);
	assert.equal(t2.toHops, 3);
	assert.equal(t2.hopsDelta, 1);
	assert.notEqual(t2.toTransportIdHex, null);

	assert.equal(t3.fromHops, 3);
	assert.equal(t3.toHops, 1);
	assert.equal(t3.hopsDelta, -2);
	assert.equal(t3.toTransportIdHex, null);

	// Verify Mermaid flowchart output
	assert.match(graph.mermaid, /flowchart TD/);
	assert.match(graph.mermaid, /P0\[".*"\]/);
	assert.match(graph.mermaid, /-->/);
	assert.match(graph.mermaid, /\+1 hops/);
	assert.match(graph.mermaid, /-2 hops/);
});
