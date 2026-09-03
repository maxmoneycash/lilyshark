/**
 * The browser side of the Meshtastic BLE conversation, held to the same
 * hand-computed wire bytes the firmware's test/meshtastic_api pins. If either
 * end drifts, one of the two suites fails, and the pairing bug is caught on a
 * desk instead of over a Bluetooth link.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	BROADCAST,
	encodeTextPacket,
	encodeWantConfig,
	parseFromRadio,
} from "./meshtasticProto";

test("want_config encodes to the firmware's expected bytes", () => {
	// ToRadio.want_config_id (field 3 varint) = 42: 0x18 0x2a.
	assert.deepEqual(Array.from(encodeWantConfig(42)), [0x18, 0x2a]);
});

test("a text packet round-trips exactly like the firmware's vector", () => {
	// The firmware's parser test feeds these bytes; our encoder must produce
	// a message it accepts, so build the same packet and compare structure.
	const bytes = encodeTextPacket({
		to: 0x11223344,
		channel: 0,
		packetId: 0,
		text: "hi",
		wantAck: true,
	});
	assert.deepEqual(
		Array.from(bytes),
		[
			0x0a, 0x0f, // ToRadio.packet, 15 bytes
			0x15, 0x44, 0x33, 0x22, 0x11, // MeshPacket.to fixed32
			0x22, 0x06, // MeshPacket.decoded, 6 bytes
			0x08, 0x01, // Data.portnum = TEXT
			0x12, 0x02, 0x68, 0x69, // Data.payload "hi"
			0x50, 0x01, // MeshPacket.want_ack
		],
	);
});

test("my_info parses from the firmware's exact encoding", () => {
	// The firmware's encoder test pins these bytes for my_node_num=1.
	const bytes = new Uint8Array([0x1a, 0x06, 0x08, 0x01, 0x58, 0xf8, 0xeb, 0x01]);
	assert.deepEqual(parseFromRadio(bytes), { kind: "myInfo", num: 1 });
});

test("config_complete echoes its nonce", () => {
	assert.deepEqual(parseFromRadio(new Uint8Array([0x38, 0xa5, 0x01])), {
		kind: "configComplete",
		nonce: 0xa5,
	});
	assert.deepEqual(parseFromRadio(new Uint8Array([0x38, 0x00])), {
		kind: "configComplete",
		nonce: 0,
	});
});

test("a routing result carries the acked id and the error", () => {
	// FromRadio{packet{from,to,decoded{portnum=5,payload=Routing{err:0},
	// request_id},priority}} — as the firmware's encodeApiRoutingAck emits.
	const bytes = new Uint8Array([
		0x12, 0x19, // FromRadio.packet, 25 bytes
		0x0d, 0xe0, 0x72, 0xa1, 0xcd, // from
		0x15, 0xe0, 0x72, 0xa1, 0xcd, // to
		0x22, 0x0b, // decoded, 11 bytes
		0x08, 0x05, // portnum ROUTING
		0x12, 0x02, 0x18, 0x00, // payload Routing{error_reason: NONE}
		0x35, 0x44, 0x33, 0x22, 0x11, // request_id fixed32
		0x58, 0x78, // priority ACK
	]);
	assert.deepEqual(parseFromRadio(bytes), {
		kind: "routing",
		requestId: 0x11223344,
		error: 0,
	});
});

test("a heard broadcast text surfaces from, channel and body", () => {
	const echo = encodeTextPacket({
		to: BROADCAST,
		channel: 0,
		packetId: 77,
		text: "TRACK IS WASHED OUT",
		wantAck: false,
	});
	// Rewrite the outer tag from ToRadio.packet (field 1) to
	// FromRadio.packet (field 2) — same trick the firmware test uses.
	assert.equal(echo[0], 0x0a);
	echo[0] = 0x12;
	const parsed = parseFromRadio(echo);
	assert.ok(parsed && parsed.kind === "text");
	assert.equal(parsed.from, 0);
	assert.equal(parsed.to, BROADCAST);
	assert.equal(parsed.packetId, 77);
	assert.equal(parsed.text, "TRACK IS WASHED OUT");
});

test("a position packet resolves to signed degrees", () => {
	// Position{latitude_i=373952800, longitude_i=-1220841600} — the exact
	// little-endian bytes the firmware's testPositionExactBytes pins.
	const clean = new Uint8Array([
		0x12, 0x15,
		0x0d, 0x44, 0x1b, 0xf6, 0x96,
		0x22, 0x0e,
		0x08, 0x03,
		0x12, 0x0a,
		0x0d, 0x20, 0x11, 0x4a, 0x16,
		0x15, 0x80, 0x6f, 0x3b, 0xb7,
	]);
	const parsed = parseFromRadio(clean);
	assert.ok(parsed && parsed.kind === "position");
	assert.equal(parsed.from, 0x96f61b44);
	assert.ok(Math.abs(parsed.lat - 37.39528) < 1e-6);
	assert.ok(Math.abs(parsed.lon - -122.08416) < 1e-6);
});

test("malformed bytes return null, unknown messages return other", () => {
	assert.equal(parseFromRadio(new Uint8Array([0x0a, 0x7f, 0x15])), null);
	assert.deepEqual(parseFromRadio(new Uint8Array([0x40, 0x01])), { kind: "other" });
});
