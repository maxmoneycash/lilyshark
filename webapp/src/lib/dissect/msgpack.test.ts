import assert from "node:assert/strict";
import test from "node:test";
import { dissectMsgpack, MsgpackReader } from "./msgpack";

test("MsgpackReader parses primitives", () => {
	// nil (0xc0)
	const nilBytes = new Uint8Array([0xc0]);
	const nilVal = new MsgpackReader(nilBytes).read();
	assert.equal(nilVal.kind, "nil");
	assert.equal(nilVal.display, "nil");
	assert.equal(nilVal.length, 1);

	// booleans (0xc2, 0xc3)
	const boolBytes = new Uint8Array([0xc2, 0xc3]);
	const r = new MsgpackReader(boolBytes);
	assert.equal(r.read().display, "false");
	assert.equal(r.read().display, "true");

	// positive fixint & negative fixint
	const intBytes = new Uint8Array([0x00, 0x2a, 0x7f, 0xe0, 0xff]);
	const rInt = new MsgpackReader(intBytes);
	assert.equal(rInt.read().display, "0");
	assert.equal(rInt.read().display, "42");
	assert.equal(rInt.read().display, "127");
	assert.equal(rInt.read().display, "-32");
	assert.equal(rInt.read().display, "-1");
});

test("MsgpackReader parses strings and binary", () => {
	// fixstr "hello" (0xa5 followed by ASCII)
	const strBytes = new Uint8Array([0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
	const strVal = new MsgpackReader(strBytes).read();
	assert.equal(strVal.kind, "string");
	assert.equal(strVal.display, '"hello"');
	assert.equal(strVal.length, 6);

	// bin 8 (0xc4, len 3, 0x01 0x02 0x03)
	const binBytes = new Uint8Array([0xc4, 0x03, 0x01, 0x02, 0x03]);
	const binVal = new MsgpackReader(binBytes).read();
	assert.equal(binVal.kind, "binary");
	assert.match(binVal.display, /3 byte\(s\) binary/);
});

test("MsgpackReader parses arrays and maps with byte accuracy", () => {
	// fixarray of 2 elements: ["test", 10]
	// 0x92, 0xa4, 't','e','s','t', 0x0a
	const arrBytes = new Uint8Array([0x92, 0xa4, 0x74, 0x65, 0x73, 0x74, 0x0a]);
	const arrVal = new MsgpackReader(arrBytes).read();
	assert.equal(arrVal.kind, "array");
	assert.equal(arrVal.children.length, 2);
	assert.equal(arrVal.children[0].display, '"test"');
	assert.equal(arrVal.children[1].display, "10");

	// fixmap with 2 pairs: { "n": "Node1", "t": 1 }
	// 0x82, 0xa1, 'n', 0xa5, 'N','o','d','e','1', 0xa1, 't', 0x01
	const mapBytes = new Uint8Array([
		0x82, 0xa1, 0x6e, 0xa5, 0x4e, 0x6f, 0x64, 0x65, 0x31, 0xa1, 0x74, 0x01,
	]);
	const mapVal = new MsgpackReader(mapBytes).read();
	assert.equal(mapVal.kind, "map");
	assert.equal(mapVal.children.length, 2);
	assert.equal(mapVal.children[0].keyText, "n");
	assert.equal(mapVal.children[0].display, '"Node1"');
	assert.equal(mapVal.children[1].keyText, "t");
	assert.equal(mapVal.children[1].display, "1");
});

test("dissectMsgpack returns DissectNode tree for valid app_data", () => {
	// Prefix with 10 dummy header bytes to test non-zero offset
	const prefix = new Uint8Array(10);
	// MessagePack payload: { "display_name": "Repeater" }
	// 0x81, 0xac, "display_name", 0xa8, "Repeater"
	const key = new TextEncoder().encode("display_name");
	const val = new TextEncoder().encode("Repeater");
	const payload = new Uint8Array([
		0x81,
		0xa0 | key.length,
		...key,
		0xa0 | val.length,
		...val,
	]);

	const fullFrame = new Uint8Array(prefix.length + payload.length);
	fullFrame.set(prefix, 0);
	fullFrame.set(payload, prefix.length);

	const nodes = dissectMsgpack(fullFrame, prefix.length, payload.length);
	assert.notEqual(nodes, null);
	assert.equal(nodes?.length, 1);
	const root = nodes?.[0];
	assert.equal(root?.label, "MessagePack");
	assert.equal(root?.byteOffset, prefix.length);
	assert.equal(root?.byteLength, payload.length);
	assert.equal(root?.children.length, 1);
	assert.equal(root?.children[0].label, "display_name");
	assert.equal(root?.children[0].value, '"Repeater"');
});

test("dissectMsgpack returns null for truncated or invalid MessagePack", () => {
	// Truncated array header
	const bad1 = new Uint8Array([0x95, 0x01, 0x02]); // promises 5 elements, only 2
	assert.equal(dissectMsgpack(bad1, 0, bad1.length), null);

	// Garbage trailing bytes (not fully consumed)
	const bad2 = new Uint8Array([0x01, 0xff, 0xff]);
	assert.equal(dissectMsgpack(bad2, 0, bad2.length), null);

	// Empty length
	assert.equal(dissectMsgpack(new Uint8Array([]), 0, 0), null);
});
