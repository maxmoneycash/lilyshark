/**
 * The net bridge's protocol boundary.
 *
 * Loop prevention is the part that must not regress: a frame enters the room
 * only from a device link, our own broker echoes drop by client id, and the
 * firmware's net-origin bit keeps injected frames from being re-published
 * when their serial echo comes back up the cable. Get any of those wrong and
 * three analyzers turn one beacon into a storm.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { HeardFrame, RawFrameFields } from "../lib/deviceLink";
import {
	NET_MAX_RAW_HEX,
	NET_ORIGIN_FLAG,
	bytesToHex,
	decodeEnvelope,
	encodeEnvelope,
	netTopic,
	shouldPublish,
} from "./netProtocol";

function heard(overrides: Partial<HeardFrame> = {}, rawFlags?: number): HeardFrame {
	const raw =
		rawFlags === undefined
			? undefined
			: ({ metadataFlags: rawFlags, bytes: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x44, 0x33, 0x22, 0x11]) } as RawFrameFields);
	return {
		src: 0x11223344,
		dst: 0xffffffff,
		proto: "meshtastic",
		port: 1,
		rssiX10: -651,
		snrX10: 42,
		kind: "TEXT",
		sim: false,
		text: "TRACK IS WASHED OUT",
		atMs: 1_772_000_000_000,
		raw,
		...overrides,
	} as HeardFrame;
}

test("a device-heard frame round-trips through the envelope", () => {
	const env = encodeEnvelope(heard({}, 0), "lsk-me", 1000);
	const back = decodeEnvelope(JSON.stringify(env), "lsk-other");
	assert.ok(back);
	assert.equal(back.frame.src, 0x11223344);
	assert.equal(back.frame.text, "TRACK IS WASHED OUT");
	assert.equal(back.raw, "ffffffff44332211");
});

test("our own broker echo drops by client id", () => {
	const env = encodeEnvelope(heard(), "lsk-me", 1000);
	assert.equal(decodeEnvelope(JSON.stringify(env), "lsk-me"), undefined);
});

test("net-injected serial echoes are never re-published", () => {
	assert.equal(shouldPublish(heard({}, NET_ORIGIN_FLAG)), false);
	assert.equal(shouldPublish(heard({}, 0)), true);
	// A summary-only frame from older firmware has no raw record and no way
	// to carry the bit; it publishes, which is correct — it cannot have come
	// from an injection, because injection requires the raw bytes.
	assert.equal(shouldPublish(heard()), true);
});

test("simulate-mode traffic never leaves the bench", () => {
	assert.equal(shouldPublish(heard({ sim: true }, 0)), false);
});

test("noise never becomes a node", () => {
	assert.equal(decodeEnvelope("not json", "me"), undefined);
	assert.equal(decodeEnvelope("{}", "me"), undefined);
	assert.equal(decodeEnvelope(JSON.stringify({ v: 2, from: "x", frame: { src: 1, dst: 2 } }), "me"), undefined);
	assert.equal(
		decodeEnvelope(JSON.stringify({ v: 1, from: "x", at: 1, frame: { src: "boom", dst: 2 } }), "me"),
		undefined,
	);
});

test("raw hex is validated and bounded to what the firmware accepts", () => {
	const base = { v: 1, from: "x", at: 1, frame: { src: 1, dst: 2, proto: "m", port: 1, kind: "K" } };
	assert.equal(decodeEnvelope(JSON.stringify({ ...base, raw: "zz" }), "me"), undefined);
	assert.equal(decodeEnvelope(JSON.stringify({ ...base, raw: "abc" }), "me"), undefined);
	assert.equal(decodeEnvelope(JSON.stringify({ ...base, raw: "" }), "me"), undefined);
	const tooLong = "ab".repeat(NET_MAX_RAW_HEX / 2 + 1);
	assert.equal(decodeEnvelope(JSON.stringify({ ...base, raw: tooLong }), "me"), undefined);
	const maximal = "ab".repeat(NET_MAX_RAW_HEX / 2);
	assert.ok(decodeEnvelope(JSON.stringify({ ...base, raw: maximal }), "me"));
});

test("rooms cannot escape the topic namespace", () => {
	assert.equal(netTopic("longfast"), "lilyshark/mesh/v1/longfast/frames");
	assert.equal(netTopic("../../evil/#"), "lilyshark/mesh/v1/______evil__/frames");
});

test("hex encoding is exact", () => {
	assert.equal(bytesToHex(new Uint8Array([0, 15, 16, 255])), "000f10ff");
});
