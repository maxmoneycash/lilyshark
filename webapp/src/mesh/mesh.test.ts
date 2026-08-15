// Self-check: node --experimental-strip-types src/mesh.test.ts
import assert from "node:assert";
import { buildEdges, edgeKey, summarize } from "./mesh.ts";
import type { NodeEntry } from "./store.ts";

// undirected key: (a,b) and (b,a) are the same link
assert.equal(edgeKey(2, 1), edgeKey(1, 2));

// traceroute me(1) → 2 → 3: two segments, firmware SNR comes in dB×4
const tr = buildEdges([], [{ node: 3, route: [2], snr: [20, 8] }], 1);
assert.equal(tr.length, 2);
assert.deepEqual(
	tr.map((e) => [e.a, e.b, e.snr]),
	[
		[1, 2, 5],
		[2, 3, 2],
	],
);
assert.ok(tr.every((e) => e.src === "traceroute"));

// NeighborInfo overrides the same pair seen by traceroute (it measures the real link)
const both = buildEdges(
	[{ node: 2, neighbor: 1, snr: -3 }],
	[{ node: 3, route: [2], snr: [20, 8] }],
	1,
);
assert.equal(both.length, 2, "el par 1-2 no debe duplicarse");
const link12 = both.find((e) => edgeKey(e.a, e.b) === edgeKey(1, 2));
assert.equal(link12?.src, "vecinos");
assert.equal(link12?.snr, -3);

// a segment without SNR stays undefined, not 0 (0 dB is a legitimate value)
const [noSnr] = buildEdges([], [{ node: 2, route: [], snr: [] }], 1);
assert.equal(noSnr.snr, undefined);

// self-links discarded
assert.equal(buildEdges([{ node: 5, neighbor: 5, snr: 9 }], []).length, 0);

// ── summarize ────────────────────────────────────────────────────────────
const NOW = 1_700_000_000_000;
const hAgo = (h: number) => Math.floor((NOW - h * 3_600_000) / 1000);
const nd = (p: Partial<NodeEntry>): NodeEntry => ({
	num: 1,
	longName: "N",
	shortName: "N",
	lastHeard: hAgo(0.1),
	...p,
});

const sum = summarize(
	[
		nd({ num: 1, lastHeard: hAgo(0.5), hopsAway: 0, lat: 39.5, lon: 2.6 }),
		nd({ num: 2, lastHeard: hAgo(5), hopsAway: 2, type: 2, publicKey: "ab" }),
		nd({ num: 3, lastHeard: hAgo(50), hopsAway: 2, batteryLevel: 15 }),
		nd({ num: 4, lastHeard: 0 }), // in the NodeDB but never heard
		nd({ num: 5, lastHeard: hAgo(2), lat: 0, lon: 0 }), // GPS basura
	],
	NOW,
);
assert.equal(sum.total, 5);
assert.equal(sum.activos1h, 1);
assert.equal(sum.activos24h, 3, "1, 2 y 5 están dentro de 24 h");
assert.equal(sum.nuncaOidos, 1);
assert.equal(sum.conPosicion, 1, "(0,0) no cuenta como posición");
assert.equal(sum.repetidores, 1);
assert.equal(sum.conPki, 1);
assert.equal(sum.bateriaBaja, 1);
assert.equal(sum.saltos.get(2), 2);
assert.equal(sum.saltos.get("?"), 2, "sin hopsAway van al cubo '?'");

// battery >100 = external power, not a low battery
assert.equal(summarize([nd({ batteryLevel: 101 })], NOW).bateriaBaja, 0);

// silent: favorites past 24 h only, the quietest first
const mudos = summarize(
	[
		nd({ num: 1, fav: true, lastHeard: hAgo(30) }),
		nd({ num: 2, fav: true, lastHeard: hAgo(80) }),
		nd({ num: 3, fav: true, lastHeard: hAgo(2) }), // talking, not silent
		nd({ num: 4, lastHeard: hAgo(90) }), // silent but not a favorite
	],
	NOW,
).mudos;
assert.deepEqual(
	mudos.map((n) => n.num),
	[2, 1],
);

console.log("mesh.test.ts OK");
