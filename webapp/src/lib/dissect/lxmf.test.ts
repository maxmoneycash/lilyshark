import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lxmfSubtree, readLxmfMessage } from "./lxmf";
import { dissectRNode } from "./rnode";
import type { DissectNode } from "./types";

// One fixture source for both decoders. The generator uses LXMF 1.1.1 and
// RNS 1.5.2 to pack real LXMessage objects, including opportunistic packets.
const fixtureSource = readFileSync(new URL("../../../../test/lxmf/fixtures.h", import.meta.url), "utf8");
function fixture(name: string): Uint8Array {
	const body = fixtureSource.match(new RegExp(`${name}\\[\\] = \\{([\\s\\S]*?)\\};`))?.[1];
	assert.ok(body, `missing reference fixture ${name}`);
	return Uint8Array.from([...body.matchAll(/0x([0-9a-f]{2})/g)], (m) => Number.parseInt(m[1], 16));
}

function checkRanges(parent: DissectNode): void {
	for (const child of parent.children) {
		assert.ok(child.byteOffset >= parent.byteOffset, child.label);
		assert.ok(child.byteOffset + child.byteLength <= parent.byteOffset + parent.byteLength, child.label);
		checkRanges(child);
	}
}

test("reference LXMessage title and content keep the actual packing order", () => {
	const message = readLxmfMessage(fixture("kLxmfReference"));
	assert.ok(message);
	assert.equal(message.title.text, "Field note");
	assert.equal(message.content.text, "Heard on 913.125 MHz");
	assert.equal(message.timestamp.seconds, 1771200000.5);
	assert.equal(message.destination?.hex, "5d431b5b6734b43ec739192e701b3808");
	assert.equal(message.source.hex, "fae321c442e3c9bdcd7a3e79d850e03c");
	assert.equal(message.stamp, null);
});

for (const name of ["kLxmfRNodeReference", "kLxmfRNodeStamped"]) {
	test(`reference opportunistic packet: ${name}`, () => {
		const bytes = fixture(name);
		const decoded = dissectRNode(bytes);
		assert.equal(decoded.state, "payload-decoded");
		const message = decoded.fields?.lxmf;
		assert.ok(message);
		assert.equal(message.destination, null, "the destination is in the Reticulum header");
		assert.equal(message.source.offset, 0);
		assert.equal(message.signature.offset, 16);
		assert.equal(message.title.text, "Field note");
		assert.equal(message.content.text, "Heard on 913.125 MHz");
		assert.equal(message.stamp?.byteLength ?? null, name.endsWith("Stamped") ? 32 : null);
		checkRanges(decoded.root);
		const signature = lxmfSubtree(message, 20).find((n) => n.label === "Signature");
		assert.match(signature?.value ?? "", /not verified/);
		assert.equal(signature?.byteOffset, 36);
	});
}

test("stamped stored messages preserve the fifth field without claiming verification", () => {
	const message = readLxmfMessage(fixture("kLxmfStamped"));
	assert.ok(message);
	assert.equal(message.array.count, 5);
	assert.equal(message.stamp?.byteLength, 32);
	assert.match(lxmfSubtree(message, 0).find((n) => n.label === "Stamp")?.value ?? "", /not verified/);
});

test("empty and nil parts remain distinguishable, including a real zero timestamp", () => {
	const empty = readLxmfMessage(fixture("kLxmfEmpty"));
	const nil = readLxmfMessage(fixture("kLxmfNils"));
	assert.ok(empty && nil);
	assert.equal(empty.timestamp.seconds, 0);
	assert.equal(empty.title.text, "");
	assert.equal(empty.fields.count, 0);
	assert.equal(nil.title.text, null);
	assert.equal(nil.fields.count, null);
});

test("long and control-bearing text is bounded and its original byte length survives", () => {
	const long = readLxmfMessage(fixture("kLxmfLongContent"));
	assert.ok(long);
	assert.equal(long.content.text?.length, 192);
	assert.equal(long.content.byteLength, 300);
	assert.equal(long.content.truncated, true);
	assert.equal(long.title.text, "");
	assert.equal(readLxmfMessage(fixture("kLxmfControlBytes"))?.content.text, "A·B·C D");
	assert.equal(readLxmfMessage(fixture("kLxmfNestedFields"))?.fields.count, 2);
});

test("every truncated reference message is refused, as are trailing bytes", () => {
	for (const name of ["kLxmfReference", "kLxmfStamped", "kLxmfPlain", "kLxmfNestedFields"]) {
		const bytes = fixture(name);
		for (let n = 0; n < bytes.length; n++) {
			assert.equal(readLxmfMessage(bytes.subarray(0, n)), null, `${name} prefix ${n}`);
		}
		assert.equal(readLxmfMessage(Uint8Array.from([...bytes, 0])), null);
	}
	assert.equal(readLxmfMessage(fixture("kLxmfShortArray")), null);
});

test("encrypted, control, context-bearing and truncated RNS packets never become LXMF", () => {
	const bytes = fixture("kLxmfRNodeReference");
	const variants = [
		[1, 0], // SINGLE DATA: encrypted
		[1, 0x0a], // PLAIN LINKREQUEST: clear but not application DATA
		[1, 0x89], // IFAC ANNOUNCE: masked header
		[0, 0x41], // split continuation
		[19, 1], // RESOURCE context
	];
	for (const [offset, value] of variants) {
		const modified = bytes.slice();
		modified[offset] = value;
		assert.equal(dissectRNode(modified).fields?.lxmf ?? null, null);
	}
	assert.equal(dissectRNode(bytes, { truncated: true }).fields?.lxmf, null);
});

test("hostile lengths and nesting cannot throw or create a partial message", () => {
	const header = new Uint8Array(96);
	for (const suffix of [
		[0xdd, 255, 255, 255, 255],
		[0x94, 1, 0xc6, 255, 255, 255, 255],
		[0x94, 1, 0xc0, 0xc0, 0x81, 1, ...Array(20000).fill(0x91), 0],
	]) assert.equal(readLxmfMessage(Uint8Array.from([...header, ...suffix])), null);
	let state = 12345;
	for (let length = 0; length < 1024; length++) {
		const bytes = Uint8Array.from({ length }, () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state >>> 24;
		});
		assert.doesNotThrow(() => readLxmfMessage(bytes));
	}
});
