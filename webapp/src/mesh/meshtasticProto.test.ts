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
	routingErrorText,
} from "./meshtasticProto";

const radioConfig = (hex: string) => {
	const parsed = parseFromRadio(new Uint8Array(Buffer.from(hex, 'hex')));
	assert.equal(parsed?.kind, 'loraConfig');
	if (parsed?.kind !== 'loraConfig') throw new Error('Expected LoRa config');
	return parsed.config;
};
test('reported radio configs match the exact active-profile firmware vectors', () => {
	for (const [hex, frequency, bandwidth, sf, cr, tx, power] of [
		['2a16321418fa01200b2805380140034801500a7500b86244', 906.875, 250, 11, 5, true, 10],
		['2a18321618fa0120092805380140034801500a582d7500486444', 913.125, 250, 9, 5, true, 10],
		['2a163214183e200a28083801400350165889017500a26344', 910.53125, 62.5, 10, 8, false, 22],
	] as const) {
		const config = radioConfig(hex);
		assert.equal(config.usePreset, false);
		assert.equal(config.frequencyMHz, frequency);
		assert.equal(config.bandwidthKHz, bandwidth);
		assert.equal(config.spreadingFactor, sf);
		assert.equal(config.codingRate, cr);
		assert.equal(config.txEnabled, tx);
		assert.equal(config.txPower, power);
	}
});
test('preset and invalid config fields cannot invent active RF settings', () => {
	const preset = radioConfig('2a093207080118fa01200b');
	assert.equal(preset.usePreset, true);
	assert.equal(preset.frequencyMHz, undefined);
	assert.equal(preset.bandwidthKHz, undefined);
	assert.equal(preset.spreadingFactor, undefined);
	const invalid = radioConfig('2a0c320a20ff012809750000c07f');
	assert.equal(invalid.frequencyMHz, undefined);
	assert.equal(invalid.spreadingFactor, undefined);
	assert.equal(invalid.codingRate, undefined);
	assert.equal(parseFromRadio(new Uint8Array([0x2a, 0x03, 0x32, 0x01, 0x80])), null);
});
test('reported frequency offset and sign-extended negative TX power are exact', () => {
	const config = radioConfig('2a173215350000803e7500b8624450ffffffffffffffffff01');
	assert.equal(config.frequencyMHz, 907.125);
	assert.equal(config.txPower, -1);
});

test("routing errors preserve actionable reasons and unknown codes", () => {
	assert.match(routingErrorText(4), /no working radio/i);
	assert.match(routingErrorText(6), /channel is not on the deck/i);
	assert.match(routingErrorText(7), /too long/i);
	assert.match(routingErrorText(9), /duty cycle/i);
	assert.match(routingErrorText(33), /simulate mode/i);
	assert.match(routingErrorText(123), /routing error 123/);
});

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
