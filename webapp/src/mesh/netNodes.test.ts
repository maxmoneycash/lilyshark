/**
 * The provenance rule of the rumour layer: internet rows arrive as viaNet,
 * and a node the radio has actually heard is never overwritten by the
 * internet's memory of it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { applyNetNodes } from "./netNodes";
import { getSnapshot, mutate } from "./store";

function reset(): void {
	mutate((s) => {
		s.nodes = new Map();
		s.myNodeNum = 0xcda172e0;
	});
}

test("internet rows land as amber rumour", () => {
	reset();
	const { applied } = applyNetNodes([
		{ num: 0x11, longName: "Roof", shortName: "ROOF", lat: 37.9, lon: -122.0, updatedAt: Date.now() },
	]);
	assert.equal(applied, 1);
	const node = getSnapshot().nodes.get(0x11);
	assert.ok(node?.viaNet);
	assert.equal(node?.longName, "Roof");
});

test("a node the radio heard is not overwritten", () => {
	reset();
	mutate((s) => {
		s.nodes = new Map(s.nodes).set(0x22, {
			num: 0x22,
			longName: "HEARD ON AIR",
			shortName: "AIR",
			lastHeard: 111,
			snr: -8.5,
		});
	});
	const { applied, radioWins } = applyNetNodes([
		{ num: 0x22, longName: "Internet Name", shortName: "NET", lat: 37.9, lon: -122.0, updatedAt: Date.now() },
	]);
	assert.equal(applied, 0);
	assert.equal(radioWins, 1);
	const node = getSnapshot().nodes.get(0x22);
	assert.equal(node?.longName, "HEARD ON AIR");
	assert.ok(!node?.viaNet);
	// ...except a position the radio never learned, which is filled in.
	assert.equal(node?.lat, 37.9);
});

test("our own node is never a rumour", () => {
	reset();
	const { applied } = applyNetNodes([
		{ num: 0xcda172e0, longName: "me-from-mqtt", shortName: "ME", lat: 1, lon: 2, updatedAt: Date.now() },
	]);
	assert.equal(applied, 0);
	assert.equal(getSnapshot().nodes.get(0xcda172e0), undefined);
});
