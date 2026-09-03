/**
 * UI-011 — user-supplied Meshtastic channel keys.
 *
 * Fixtures are built by encrypting known Data-message plaintext with the
 * lib's own cipher (aesCtrXcrypt is symmetric) over the exported
 * meshtasticNonce construction, and the CTR construction itself is
 * cross-checked against node:crypto and the FIPS-197 Appendix C block
 * vectors, so a bug in the cipher cannot silently cancel out of the tests.
 *
 * Contract under test:
 * - the published default PSK is tried first and its behavior is
 *   byte-identical with and without user keys in play;
 * - a correct user key (16- or 32-byte) decodes and every label names it;
 * - a wrong key fails closed to the existing opaque-ciphertext state;
 * - user keys are tried in the order given, after the default.
 */

import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	aesCtrXcrypt,
	dissectMeshtastic,
	MESHTASTIC_DEFAULT_PSK,
	meshtasticNonce,
	readMeshtasticPayload,
} from "./meshtastic";
import { dissectFrame } from "./registry";
import type { ChannelKey, DissectNode } from "./types";

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

function bytesFromHex(hex: string): Uint8Array {
	const clean = hex.replace(/\s+/g, "");
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

const utf8 = new TextEncoder();

/** A Data message: portnum (field 1 varint) + payload (field 2 bytes). */
function dataMessage(portnum: number, payload: Uint8Array): Uint8Array {
	assert.ok(portnum < 128 && payload.length < 128, "single-byte varints only");
	const out = new Uint8Array(4 + payload.length);
	out[0] = 0x08;
	out[1] = portnum;
	out[2] = 0x12;
	out[3] = payload.length;
	out.set(payload, 4);
	return out;
}

const SOURCE = 0x1a2b3c4d;
const PACKET_ID = 0x0badf00d;

/** Encrypt plaintext under `key` and wrap it in a valid 16-byte outer header. */
function buildFrame(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
	const nonce = meshtasticNonce(SOURCE, PACKET_ID);
	const ciphertext = aesCtrXcrypt(key, nonce, plaintext);
	const frame = new Uint8Array(16 + ciphertext.length);
	const view = new DataView(frame.buffer);
	view.setUint32(0, 0xffffffff, true); // destination: broadcast
	view.setUint32(4, SOURCE, true);
	view.setUint32(8, PACKET_ID, true);
	frame[12] = 0x63; // hop limit 3, hop start 3
	frame[13] = 0x2a; // channel hash (structural only)
	frame.set(ciphertext, 16);
	return frame;
}

function findNode(root: DissectNode, label: string): DissectNode | null {
	if (root.label === label) return root;
	for (const child of root.children) {
		const hit = findNode(child, label);
		if (hit) return hit;
	}
	return null;
}

const TEXT = "keys stay in this tab";
const PLAINTEXT = dataMessage(1, utf8.encode(TEXT));

const KEY_16 = bytesFromHex("00112233445566778899aabbccddeeff");
const KEY_32 = bytesFromHex(
	"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);
const WRONG_16 = bytesFromHex("deadbeefdeadbeefdeadbeefdeadbeef");

/* ────────────────────────────────────────────────────────────────────────────
 * Cipher golden vectors — FIPS-197 Appendix C. In CTR mode with the IV set
 * to the vector's plaintext block, encrypting 16 zero bytes yields exactly
 * E(K, plaintext), i.e. the pinned ciphertext block.
 * ──────────────────────────────────────────────────────────────────────── */

const FIPS_BLOCK = bytesFromHex("00112233445566778899aabbccddeeff");

test("AES-128 forward cipher matches FIPS-197 C.1", () => {
	const key = bytesFromHex("000102030405060708090a0b0c0d0e0f");
	const out = aesCtrXcrypt(key, FIPS_BLOCK, new Uint8Array(16));
	assert.deepEqual(out, bytesFromHex("69c4e0d86a7b0430d8cdb78070b4c55a"));
});

test("AES-256 forward cipher matches FIPS-197 C.3", () => {
	const out = aesCtrXcrypt(KEY_32, FIPS_BLOCK, new Uint8Array(16));
	assert.deepEqual(out, bytesFromHex("8ea2b7ca516745bfeafc49904b496089"));
});

test("aesCtrXcrypt rejects key lengths other than 16 and 32", () => {
	assert.throws(
		() => aesCtrXcrypt(new Uint8Array(24), new Uint8Array(16), PLAINTEXT),
		RangeError,
	);
});

test("CTR construction matches node:crypto over the meshtastic nonce", () => {
	const nonce = meshtasticNonce(SOURCE, PACKET_ID);
	const long = new Uint8Array(80).map((_, i) => (i * 37) & 0xff);
	for (const key of [KEY_16, KEY_32]) {
		const algo = key.length === 32 ? "aes-256-ctr" : "aes-128-ctr";
		const reference = new Uint8Array(
			createCipheriv(algo, key, nonce).update(long),
		);
		assert.deepEqual(aesCtrXcrypt(key, nonce, long), reference);
	}
});

/* ────────────────────────────────────────────────────────────────────────────
 * Default key first — and byte-identical keyless behavior.
 * ──────────────────────────────────────────────────────────────────────── */

test("default-PSK frame still decodes with no user keys", () => {
	const frame = buildFrame(MESHTASTIC_DEFAULT_PSK, PLAINTEXT);
	const d = dissectMeshtastic(frame);
	assert.equal(d.state, "payload-decoded");
	assert.ok(d.fields);
	assert.equal(d.fields.defaultKeyReadable, true);
	assert.equal(d.fields.userKey, null);
	assert.equal(d.fields.payload?.text, TEXT);
	const msg = findNode(d.root, "Data message");
	assert.ok(msg);
	assert.equal(
		msg.value,
		"decrypted with the published default channel key (traffic was never private)",
	);
});

test("empty channelKeys is byte-identical to omitting the option", () => {
	const frames = [
		buildFrame(MESHTASTIC_DEFAULT_PSK, PLAINTEXT),
		buildFrame(KEY_16, PLAINTEXT), // stays opaque either way
	];
	for (const frame of frames) {
		assert.deepEqual(
			dissectMeshtastic(frame, { channelKeys: [] }),
			dissectMeshtastic(frame),
		);
	}
});

test("golden fixtures are unchanged by an unrelated user key", () => {
	const raw = readFileSync(
		new URL("./fixtures/meshtastic.json", import.meta.url),
		"utf8",
	);
	const { fixtures } = JSON.parse(raw) as {
		fixtures: { name: string; hex: string }[];
	};
	const keys: ChannelKey[] = [{ name: "unrelated", key: WRONG_16 }];
	// The one permitted difference: an opaque payload's label honestly says
	// the supplied key was tried too. Everything else must match exactly.
	const normalize = (d: unknown): unknown =>
		JSON.parse(
			JSON.stringify(d)
				.split("the published default key or the 1 supplied channel key(s)")
				.join("the published default key"),
		);
	for (const f of fixtures) {
		const bytes = bytesFromHex(f.hex);
		assert.deepEqual(
			normalize(dissectFrame(bytes, "meshtastic", { channelKeys: keys })),
			normalize(dissectFrame(bytes, "meshtastic")),
			`fixture ${f.name} changed under a wrong user key`,
		);
	}
});

/* ────────────────────────────────────────────────────────────────────────────
 * User keys — decode, labeling, fail-closed, precedence.
 * ──────────────────────────────────────────────────────────────────────── */

test("correct 16-byte user key decodes and the labels name it", () => {
	const frame = buildFrame(KEY_16, PLAINTEXT);
	const d = dissectMeshtastic(frame, {
		channelKeys: [{ name: "ridge crew", key: KEY_16 }],
	});
	assert.equal(d.state, "payload-decoded");
	assert.equal(d.kind, "data");
	assert.ok(d.fields);
	assert.equal(d.fields.defaultKeyReadable, false);
	assert.deepEqual(d.fields.userKey, { name: "ridge crew", bits: 128 });
	assert.equal(d.fields.payload?.text, TEXT);
	const msg = findNode(d.root, "Data message");
	assert.ok(msg);
	// A user key must NOT get the "never private" phrasing.
	assert.equal(
		msg.value,
		'decrypted with channel key "ridge crew" (user-supplied, AES-128)',
	);
});

test("correct 32-byte user key decodes as AES-256", () => {
	const frame = buildFrame(KEY_32, PLAINTEXT);
	const d = dissectMeshtastic(frame, {
		channelKeys: [{ name: "private-256", key: KEY_32 }],
	});
	assert.equal(d.state, "payload-decoded");
	assert.deepEqual(d.fields?.userKey, { name: "private-256", bits: 256 });
	assert.equal(d.fields?.payload?.text, TEXT);
	const msg = findNode(d.root, "Data message");
	assert.equal(
		msg?.value,
		'decrypted with channel key "private-256" (user-supplied, AES-256)',
	);
});

test("wrong key fails closed to the opaque ciphertext state", () => {
	const frame = buildFrame(KEY_16, PLAINTEXT);
	const d = dissectMeshtastic(frame, {
		channelKeys: [{ name: "not it", key: WRONG_16 }],
	});
	assert.equal(d.state, "header-only");
	assert.equal(d.kind, "opaque-payload");
	assert.ok(d.fields);
	assert.equal(d.fields.defaultKeyReadable, false);
	assert.equal(d.fields.userKey, null);
	assert.equal(d.fields.payload, null);
	const payload = findNode(d.root, "Payload");
	assert.ok(payload);
	assert.equal(payload.tone, "opaque");
	// The opaque label stays honest about what was tried.
	assert.match(payload.value ?? "", /1 supplied channel key/);
	assert.equal(findNode(d.root, "Data message"), null);
});

test("default PSK takes precedence over a user copy of it", () => {
	const frame = buildFrame(MESHTASTIC_DEFAULT_PSK, PLAINTEXT);
	const d = dissectMeshtastic(frame, {
		channelKeys: [
			{ name: "my copy of the default", key: MESHTASTIC_DEFAULT_PSK },
		],
	});
	assert.ok(d.fields);
	assert.equal(d.fields.defaultKeyReadable, true);
	assert.equal(d.fields.userKey, null);
});

test("user keys are tried in the order given", () => {
	const frame = buildFrame(KEY_16, PLAINTEXT);
	const wrongThenRight = dissectMeshtastic(frame, {
		channelKeys: [
			{ name: "wrong", key: WRONG_16 },
			{ name: "right", key: KEY_16 },
		],
	});
	assert.equal(wrongThenRight.fields?.userKey?.name, "right");

	// Two names for the same bytes: the first listed wins.
	const duplicates = dissectMeshtastic(frame, {
		channelKeys: [
			{ name: "alpha", key: KEY_16 },
			{ name: "beta", key: KEY_16 },
		],
	});
	assert.equal(duplicates.fields?.userKey?.name, "alpha");
});

test("invalid-length user keys are skipped, never fatal", () => {
	const frame = buildFrame(KEY_16, PLAINTEXT);
	const d = dissectMeshtastic(frame, {
		channelKeys: [
			{ name: "too short", key: new Uint8Array(8) },
			{ name: "24 bytes is not a meshtastic size", key: new Uint8Array(24) },
			{ name: "right", key: KEY_16 },
		],
	});
	assert.equal(d.fields?.userKey?.name, "right");
});

test("readMeshtasticPayload reports the decrypt source directly", () => {
	const nonce = meshtasticNonce(SOURCE, PACKET_ID);
	const ciphertext = aesCtrXcrypt(KEY_32, nonce, PLAINTEXT);
	const parse = readMeshtasticPayload(ciphertext, SOURCE, PACKET_ID, [
		{ name: "vault", key: KEY_32 },
	]);
	assert.ok(parse);
	assert.deepEqual(parse.source, { kind: "user", name: "vault", bits: 256 });
	assert.equal(parse.fields.text, TEXT);
	// Without the key the same ciphertext stays unreadable.
	assert.equal(readMeshtasticPayload(ciphertext, SOURCE, PACKET_ID), null);
});

test("dissectFrame threads channel keys through the registry", () => {
	const frame = buildFrame(KEY_16, PLAINTEXT);
	const { primary } = dissectFrame(frame, "meshtastic", {
		channelKeys: [{ name: "via registry", key: KEY_16 }],
	});
	assert.equal(primary.protocol, "Meshtastic");
	assert.equal(primary.state, "payload-decoded");
	assert.ok(primary.protocol === "Meshtastic" && primary.fields);
	assert.equal(primary.fields.userKey?.name, "via registry");
});
