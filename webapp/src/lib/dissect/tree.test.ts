/**
 * Tests for the pure tree-pane logic (UI-004): profile→hint mapping,
 * flattening, keyboard navigation, and byte→row lookup — including on a
 * real dissection, so the view logic is exercised against the same shapes
 * the dissectors emit.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { dissectFrame } from "./registry";
import {
	byteRangeLabel,
	decodeSummary,
	deepestRowAt,
	type FlatTreeRow,
	flattenTree,
	frameProtocolHint,
	profileProtocolHint,
	rowTrail,
	treeKeyNav,
} from "./tree";
import type { DissectNode } from "./types";
import { node } from "./types";

/* ── profile → hint ─────────────────────────────────────────────────── */

test("profileProtocolHint mirrors the builtin profile table", () => {
	assert.equal(profileProtocolHint(null), "unknown"); // field never reported
	assert.equal(profileProtocolHint(0), "unknown");
	assert.equal(profileProtocolHint(1), "meshtastic");
	assert.equal(profileProtocolHint(2), "meshcore");
	assert.equal(profileProtocolHint(3), "meshcore");
	assert.equal(profileProtocolHint(4), "reticulum");
	assert.equal(profileProtocolHint(5), "reticulum");
	assert.equal(profileProtocolHint(6), "custom");
	assert.equal(profileProtocolHint(250), "custom");
});

/* ── flattening ─────────────────────────────────────────────────────── */

//  root [0,8)
//    header [0,4)
//      flags [3,1)   (leaf)
//    payload [4,4)   (leaf)
function sampleTree(): DissectNode {
	return node("root", 0, 8, undefined, [
		node("header", 0, 4, undefined, [node("flags", 3, 1, "0x01")]),
		node("payload", 4, 4, "4 bytes"),
	]);
}

const none: ReadonlySet<string> = new Set();

test("flattenTree walks depth-first with stable paths and depths", () => {
	const rows = flattenTree(sampleTree(), none);
	assert.deepEqual(
		rows.map((r) => [r.path, r.node.label, r.depth, r.parentPath]),
		[
			["0", "root", 0, null],
			["0.0", "header", 1, "0"],
			["0.0.0", "flags", 2, "0.0"],
			["0.1", "payload", 1, "0"],
		],
	);
	assert.equal(rows[0].hasChildren, true);
	assert.equal(rows[0].expanded, true);
	assert.equal(rows[2].hasChildren, false);
	assert.equal(rows[2].expanded, false);
});

test("flattenTree hides collapsed subtrees but keeps the collapsed row", () => {
	const rows = flattenTree(sampleTree(), new Set(["0.0"]));
	assert.deepEqual(
		rows.map((r) => r.path),
		["0", "0.0", "0.1"],
	);
	const header = rows[1];
	assert.equal(header.hasChildren, true);
	assert.equal(header.expanded, false);
});

test("collapsing the root leaves exactly one row", () => {
	const rows = flattenTree(sampleTree(), new Set(["0"]));
	assert.equal(rows.length, 1);
	assert.equal(rows[0].expanded, false);
});

/* ── keyboard navigation ────────────────────────────────────────────── */

test("arrow keys walk the visible rows and stop at the edges", () => {
	const rows = flattenTree(sampleTree(), none);
	assert.deepEqual(treeKeyNav(rows, "0", "ArrowDown"), { path: "0.0" });
	assert.deepEqual(treeKeyNav(rows, "0.1", "ArrowUp"), { path: "0.0.0" });
	assert.equal(treeKeyNav(rows, "0", "ArrowUp"), null);
	assert.equal(treeKeyNav(rows, "0.1", "ArrowDown"), null);
	assert.deepEqual(treeKeyNav(rows, "0.1", "Home"), { path: "0" });
	assert.deepEqual(treeKeyNav(rows, "0", "End"), { path: "0.1" });
});

test("ArrowRight expands then descends; ArrowLeft collapses then ascends", () => {
	const collapsed = flattenTree(sampleTree(), new Set(["0.0"]));
	assert.deepEqual(treeKeyNav(collapsed, "0.0", "ArrowRight"), {
		path: "0.0",
		toggle: "expand",
	});
	const open = flattenTree(sampleTree(), none);
	assert.deepEqual(treeKeyNav(open, "0.0", "ArrowRight"), { path: "0.0.0" });
	assert.equal(treeKeyNav(open, "0.0.0", "ArrowRight"), null); // leaf
	assert.deepEqual(treeKeyNav(open, "0.0", "ArrowLeft"), {
		path: "0.0",
		toggle: "collapse",
	});
	assert.deepEqual(treeKeyNav(open, "0.0.0", "ArrowLeft"), { path: "0.0" });
	assert.deepEqual(treeKeyNav(collapsed, "0", "ArrowLeft"), {
		path: "0",
		toggle: "collapse",
	});
});

test("Enter and Space toggle a branch and do nothing on a leaf", () => {
	const rows = flattenTree(sampleTree(), none);
	assert.deepEqual(treeKeyNav(rows, "0.0", "Enter"), {
		path: "0.0",
		toggle: "collapse",
	});
	assert.deepEqual(
		treeKeyNav(flattenTree(sampleTree(), new Set(["0.0"])), "0.0", " "),
		{
			path: "0.0",
			toggle: "expand",
		},
	);
	assert.equal(treeKeyNav(rows, "0.1", "Enter"), null);
	assert.equal(treeKeyNav(rows, "0.1", "x"), null); // unhandled key
	assert.equal(treeKeyNav(rows, "gone", "ArrowDown"), null); // stale path
});

/* ── byte → row lookup ──────────────────────────────────────────────── */

test("deepestRowAt finds the deepest visible node covering a byte", () => {
	const rows = flattenTree(sampleTree(), none);
	assert.equal(deepestRowAt(rows, 3)?.node.label, "flags");
	assert.equal(deepestRowAt(rows, 1)?.node.label, "header");
	assert.equal(deepestRowAt(rows, 6)?.node.label, "payload");
	assert.equal(deepestRowAt(rows, 8), null); // past the end
});

test("deepestRowAt respects collapse — hidden children cannot match", () => {
	const rows = flattenTree(sampleTree(), new Set(["0.0"]));
	assert.equal(deepestRowAt(rows, 3)?.node.label, "header");
});

test("identical sibling ranges (bit fields) resolve to the first at depth", () => {
	const tree = node("root", 0, 1, undefined, [
		node("bit a", 0, 1, "1"),
		node("bit b", 0, 1, "0"),
	]);
	const rows = flattenTree(tree, none);
	assert.equal(deepestRowAt(rows, 0)?.node.label, "bit a");
});

test("zero-length nodes (truncation markers) never cover a byte", () => {
	const tree = node("root", 0, 2, undefined, [
		node("truncated", 2, 0, "cut short"),
	]);
	const rows = flattenTree(tree, none);
	assert.equal(deepestRowAt(rows, 1)?.node.label, "root");
});

/* ── against a real dissection ──────────────────────────────────────── */

test("a real Meshtastic dissection flattens with every row inside the frame", () => {
	// 16-byte outer header + a few payload bytes; content is irrelevant to the
	// flattening — only the tree shape and ranges are under test here.
	const bytes = new Uint8Array(24);
	bytes.set([0xff, 0xff, 0xff, 0xff], 0); // broadcast destination
	bytes[4] = 0x01; // non-zero source so the frame is not malformed
	const d = dissectFrame(bytes, "meshtastic");
	const rows = flattenTree(d.primary.root, none);
	assert.ok(rows.length >= 5, "outer header should produce several rows");
	for (const row of rows) {
		assert.ok(row.node.byteOffset >= 0);
		assert.ok(row.node.byteOffset + row.node.byteLength <= bytes.length);
	}
	// Every byte of the frame is covered by some visible row.
	for (let i = 0; i < bytes.length; i++) {
		const hit: FlatTreeRow | null = deepestRowAt(rows, i);
		assert.ok(hit, `byte ${i} has no covering row`);
	}
});

/* ── labels the pane puts on screen ─────────────────────────────────── */

test("frameProtocolHint takes the profile whenever the device named one", () => {
	// A named profile decides, even when the protocol name disagrees with it.
	assert.equal(frameProtocolHint(1, "MeshCore"), "meshtastic");
	assert.equal(frameProtocolHint(3, "Unknown"), "meshcore");
	assert.equal(frameProtocolHint(4, ""), "reticulum");
	assert.equal(frameProtocolHint(200, "Meshtastic"), "custom");
});

test("frameProtocolHint falls back to the device's own protocol name", () => {
	// Profile 0 and a missing profile are the same thing: the firmware named
	// none, so the decoder's own verdict is the only answer on offer.
	for (const profile of [0, null] as const) {
		assert.equal(frameProtocolHint(profile, "Meshtastic"), "meshtastic");
		assert.equal(frameProtocolHint(profile, "MeshCore"), "meshcore");
		assert.equal(frameProtocolHint(profile, "Reticulum"), "reticulum");
		assert.equal(frameProtocolHint(profile, "Custom"), "custom");
		assert.equal(frameProtocolHint(profile, "Unknown"), "unknown");
	}
	// protocolName() in the firmware is capitalised; the link is not trusted
	// to keep that, but a name nothing recognises must never be decoded on spec.
	assert.equal(frameProtocolHint(0, " meshtastic "), "meshtastic");
	assert.equal(frameProtocolHint(0, "LoRaWAN"), "unknown");
	assert.equal(frameProtocolHint(0, ""), "unknown");
});

test("byteRangeLabel counts bytes the way a reader does", () => {
	assert.equal(byteRangeLabel(node("outer header", 0, 16)), "0–15");
	assert.equal(byteRangeLabel(node("flags", 12, 1)), "12");
	// A truncation marker sits past the last byte and covers nothing, so it
	// reads as a position rather than as a range.
	assert.equal(byteRangeLabel(node("truncated", 24, 0)), "@24");
});

test("decodeSummary says how far the decode got, in words", () => {
	const summary = (result: string, state: string) =>
		decodeSummary({
			protocol: "Meshtastic",
			result,
			state,
			kind: "data",
			root: node("root", 0, 0),
		} as Parameters<typeof decodeSummary>[0]);
	assert.equal(summary("matched", "payload-decoded"), "payload read");
	assert.equal(summary("matched", "header-only"), "header only");
	assert.match(summary("malformed", "malformed"), /^malformed/);
	// A frame nothing claimed has no meaningful state to report.
	assert.equal(summary("no-match", "unknown"), "nothing decoded it");
});

test("decodeSummary reads a real dissection of each shape", () => {
	const meshtastic = new Uint8Array(24);
	meshtastic[4] = 0x01; // non-zero source, but an unreadable payload
	assert.equal(
		decodeSummary(dissectFrame(meshtastic, "meshtastic").primary),
		"header only",
	);
	assert.equal(
		decodeSummary(dissectFrame(meshtastic, "unknown").primary),
		"nothing decoded it",
	);
	// Too short for the 16-byte outer header.
	assert.match(
		decodeSummary(dissectFrame(new Uint8Array(4), "meshtastic").primary),
		/^malformed/,
	);
});

test("rowTrail names every ancestor of a row, root first", () => {
	const rows = flattenTree(sampleTree(), none);
	const flags = rows.find((r) => r.node.label === "flags");
	assert.ok(flags);
	assert.equal(rowTrail(rows, flags), "root › header › flags");
	assert.equal(rowTrail(rows, rows[0]), "root");
});
