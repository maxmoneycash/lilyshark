/**
 * Golden-vector and safety tests for the in-browser dissectors (UI-004).
 *
 * The fixture corpus under ./fixtures/ carries the same bytes the firmware
 * C++ tests pin (each entry names its source test), so the TypeScript
 * dissectors are provably field-for-field compatible with the C++ decoders.
 * On top of the golden vectors, every dissection — including dissections of
 * truncated prefixes and deterministic garbage — must uphold the tree
 * invariants documented in types.ts and must never throw.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	aesCtrXcrypt,
	MESHTASTIC_DEFAULT_PSK,
	MESHTASTIC_PORT,
	meshtasticNonce,
} from "./meshtastic";
import type { AnyDissection, ProtocolHint } from "./registry";
import { dissectFrame } from "./registry";
import type { ReticulumFields } from "./rnode";
import { reticulumDestinationHashHex } from "./rnode";
import type { DissectNode } from "./types";

/* ────────────────────────────────────────────────────────────────────────────
 * Fixture corpus
 * ──────────────────────────────────────────────────────────────────────── */

interface Fixture {
	name: string;
	source: string;
	hex: string;
	result: "matched" | "malformed" | "no-match";
	state: "unknown" | "header-only" | "payload-decoded" | "malformed";
	kind?: string;
	expect?: Record<string, unknown>;
	expectPayload?: Record<string, unknown>;
	/** Reticulum semantic announce tier (UI-013) — fields.announce. */
	expectAnnounce?: Record<string, unknown>;
	expectShelby?: Record<string, unknown>;
}

interface FixtureFile {
	comment: string;
	fixtures: Fixture[];
}

function loadFixtures(file: string): Fixture[] {
	const raw = readFileSync(
		new URL(`./fixtures/${file}`, import.meta.url),
		"utf8",
	);
	return (JSON.parse(raw) as FixtureFile).fixtures;
}

/** Fixture hex may carry whitespace separators; bytes are what count. */
function bytesFromHex(hex: string): Uint8Array {
	const compact = hex.replace(/\s+/g, "");
	assert.equal(compact.length % 2, 0, `odd hex length in fixture: ${hex}`);
	const out = new Uint8Array(compact.length / 2);
	for (let i = 0; i < out.length; i++) {
		const byte = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
		assert.ok(Number.isInteger(byte), `bad hex in fixture: ${hex}`);
		out[i] = byte;
	}
	return out;
}

/** Fixture expectation values: hex strings compare as numbers. */
function expected(value: unknown): unknown {
	if (typeof value === "string" && value.startsWith("0x"))
		return Number.parseInt(value, 16);
	return value;
}

const CORPUS: Array<{ file: string; hint: ProtocolHint; protocol: string }> = [
	{ file: "meshtastic.json", hint: "meshtastic", protocol: "Meshtastic" },
	{ file: "meshcore.json", hint: "meshcore", protocol: "MeshCore" },
	{ file: "rnode.json", hint: "reticulum", protocol: "Reticulum" },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Tree invariants (types.ts): every child's byte range lies within its
 * parent's; sibling ranges never partially overlap — an overlapping pair is
 * either identical (bit-fields) or one contains the other (an error or
 * pointer annotation over already-decoded bytes).
 * ──────────────────────────────────────────────────────────────────────── */

function contains(outer: DissectNode, inner: DissectNode): boolean {
	return (
		inner.byteOffset >= outer.byteOffset &&
		inner.byteOffset + inner.byteLength <= outer.byteOffset + outer.byteLength
	);
}

function overlaps(a: DissectNode, b: DissectNode): boolean {
	return (
		a.byteOffset < b.byteOffset + b.byteLength &&
		b.byteOffset < a.byteOffset + a.byteLength
	);
}

function assertTreeInvariants(
	root: DissectNode,
	frameLength: number,
	context: string,
): void {
	assert.equal(root.byteOffset, 0, `${context}: root must start at byte 0`);
	assert.equal(
		root.byteLength,
		frameLength,
		`${context}: root must span the whole frame`,
	);

	const walk = (parent: DissectNode): void => {
		for (const child of parent.children) {
			assert.ok(
				Number.isInteger(child.byteOffset) && child.byteOffset >= 0,
				context,
			);
			assert.ok(
				Number.isInteger(child.byteLength) && child.byteLength >= 0,
				context,
			);
			assert.ok(
				contains(parent, child),
				`${context}: "${child.label}" [${child.byteOffset}, +${child.byteLength}] escapes ` +
					`"${parent.label}" [${parent.byteOffset}, +${parent.byteLength}]`,
			);
		}
		for (let i = 0; i < parent.children.length; i++) {
			for (let j = i + 1; j < parent.children.length; j++) {
				const a = parent.children[i];
				const b = parent.children[j];
				if (!overlaps(a, b)) continue;
				assert.ok(
					contains(a, b) || contains(b, a),
					`${context}: siblings "${a.label}" and "${b.label}" partially overlap`,
				);
			}
		}
		for (const child of parent.children) walk(child);
	};
	walk(root);
}

function findNode(root: DissectNode, label: string): DissectNode | null {
	if (root.label === label) return root;
	for (const child of root.children) {
		const found = findNode(child, label);
		if (found) return found;
	}
	return null;
}

function hasTone(root: DissectNode, tone: string): boolean {
	if (root.tone === tone) return true;
	return root.children.some((child) => hasTone(child, tone));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Golden vectors: same bytes as the C++ tests, same fields.
 * ──────────────────────────────────────────────────────────────────────── */

for (const { file, hint, protocol } of CORPUS) {
	for (const fixture of loadFixtures(file)) {
		test(`${protocol} golden vector: ${fixture.name}`, () => {
			const bytes = bytesFromHex(fixture.hex);
			const { primary, shelby } = dissectFrame(bytes, hint);

			assert.equal(primary.protocol, protocol);
			assert.equal(primary.result, fixture.result);
			assert.equal(primary.state, fixture.state);
			if (fixture.kind !== undefined) assert.equal(primary.kind, fixture.kind);
			assertTreeInvariants(primary.root, bytes.length, fixture.name);

			// A malformed frame must say so explicitly in the tree.
			if (fixture.result === "malformed") {
				assert.ok(
					hasTone(primary.root, "error"),
					"malformed frames carry an error node",
				);
			}

			if (fixture.expect) {
				const fields = primary.fields as unknown as Record<
					string,
					unknown
				> | null;
				assert.ok(fields, `${fixture.name}: expected decoded fields`);
				for (const [key, value] of Object.entries(fixture.expect)) {
					assert.deepEqual(
						fields[key],
						expected(value),
						`${fixture.name}: field ${key}`,
					);
				}
			}

			if (fixture.expectPayload) {
				assert.equal(primary.protocol, "Meshtastic");
				const fields = primary.fields as unknown as {
					payload: Record<string, unknown> | null;
				} | null;
				assert.ok(
					fields?.payload,
					`${fixture.name}: expected a decoded payload`,
				);
				for (const [key, value] of Object.entries(fixture.expectPayload)) {
					assert.deepEqual(
						fields.payload[key],
						expected(value),
						`${fixture.name}: payload ${key}`,
					);
				}
			}

			if (fixture.expectAnnounce) {
				assert.equal(primary.protocol, "Reticulum");
				const fields = primary.fields as unknown as {
					announce: Record<string, unknown> | null;
				} | null;
				assert.ok(
					fields?.announce,
					`${fixture.name}: expected a decoded announce`,
				);
				for (const [key, value] of Object.entries(fixture.expectAnnounce)) {
					assert.deepEqual(
						fields.announce[key],
						expected(value),
						`${fixture.name}: announce ${key}`,
					);
				}
			}

			if (fixture.expectShelby) {
				assert.ok(
					shelby,
					`${fixture.name}: expected an embedded Shelby pointer`,
				);
				const { offset, ...pointerExpect } = fixture.expectShelby;
				assert.equal(
					shelby.offset,
					expected(offset),
					`${fixture.name}: pointer offset`,
				);
				const pointer = shelby.pointer as unknown as Record<string, unknown>;
				for (const [key, value] of Object.entries(pointerExpect)) {
					assert.deepEqual(
						pointer[key],
						expected(value),
						`${fixture.name}: pointer ${key}`,
					);
				}
				// The pointer subtree merges into the primary tree without
				// replacing the enclosing protocol's decode.
				const marker = findNode(primary.root, "Shelby pointer");
				assert.ok(marker, `${fixture.name}: pointer subtree attached`);
				assert.equal(marker.byteOffset, shelby.offset);
			} else {
				assert.equal(shelby, null, `${fixture.name}: no pointer expected`);
			}
		});
	}
}

test("Meshtastic default-key text bytes surface in the tree with their range", () => {
	const fixture = loadFixtures("meshtastic.json").find(
		(f) => f.name === "default-key-text",
	);
	assert.ok(fixture);
	const bytes = bytesFromHex(fixture.hex);
	const { primary } = dissectFrame(bytes, "meshtastic");
	const textNode = findNode(primary.root, "Text");
	assert.ok(textNode, "decrypted text shown as a tree node");
	assert.equal(textNode.value, JSON.stringify("radio check from the ridge"));
	// The node points into the ciphertext region after the 16-byte header.
	assert.ok(textNode.byteOffset >= 16);
	assert.ok(textNode.byteOffset + textNode.byteLength <= bytes.length);
});

test("undecodable payloads say so and stay available as raw bytes", () => {
	const opaque = loadFixtures("meshtastic.json").find(
		(f) => f.name === "outer-header",
	);
	assert.ok(opaque);
	const { primary } = dissectFrame(bytesFromHex(opaque.hex), "meshtastic");
	assert.ok(
		hasTone(primary.root, "opaque"),
		"unreadable payload marked opaque",
	);

	const unknown = dissectFrame(bytesFromHex(opaque.hex), "unknown").primary;
	assert.equal(unknown.protocol, "Unknown");
	assert.equal(unknown.result, "no-match");
	assert.ok(
		hasTone(unknown.root, "raw"),
		"unknown frames keep their raw bytes",
	);
});

test("a bare Shelby pointer with no outer protocol decodes as Custom", () => {
	const fixture = loadFixtures("meshcore.json").find(
		(f) => f.name === "shelby-pointer-payload",
	);
	assert.ok(fixture);
	// Strip the 2-byte MeshCore header, leaving the naked 82-byte pointer.
	const pointer = bytesFromHex(fixture.hex).subarray(2);
	const { primary, shelby } = dissectFrame(pointer, "unknown");
	assert.equal(primary.protocol, "Custom");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "payload-decoded");
	assert.ok(shelby);
	assert.equal(shelby.offset, 0);
	assertTreeInvariants(primary.root, pointer.length, "bare pointer");
});

/* ────────────────────────────────────────────────────────────────────────────
 * Reticulum announce, semantic tier (UI-013). The port must agree with
 * readReticulumAnnounce in src/core/reticulum_decoder.cpp field for field,
 * and must never claim more than length-and-flag arithmetic proves.
 * ──────────────────────────────────────────────────────────────────────── */

const RNODE_FIXTURES = loadFixtures("rnode.json");

function rnodeFixture(name: string): Fixture {
	const found = RNODE_FIXTURES.find((f) => f.name === name);
	assert.ok(found, `missing rnode fixture: ${name}`);
	return found;
}

function announceOf(name: string, truncated = false) {
	const bytes = bytesFromHex(rnodeFixture(name).hex);
	const { primary } = dissectFrame(bytes, "reticulum", { truncated });
	assert.equal(primary.protocol, "Reticulum");
	return {
		bytes,
		primary,
		fields: primary.fields as ReticulumFields | null,
	};
}

test("announce fields land in the tree at the C++ byte ranges", () => {
	const { primary } = announceOf("announce-header-one-minimal");
	const announce = findNode(primary.root, "Announce");
	assert.ok(announce, "the announce gets its own subtree");
	// The subtree spans exactly the payload the C++ reader walks.
	assert.equal(announce.byteOffset, 20);
	assert.equal(announce.byteLength, 148);

	const ranges: Array<[string, number, number]> = [
		["Public key", 20, 64],
		["Name hash", 84, 10],
		["Random hash", 94, 10],
		["Signature", 104, 64],
	];
	for (const [label, offset, length] of ranges) {
		const n = findNode(announce, label);
		assert.ok(n, `${label} node present`);
		assert.equal(n.byteOffset, offset, `${label} offset`);
		assert.equal(n.byteLength, length, `${label} length`);
	}
	// Neither optional tail is invented when the flags do not promise it.
	assert.equal(findNode(announce, "Ratchet key"), null);
	assert.equal(findNode(announce, "App data"), null);
});

test("announce key, ratchet and signature bytes are reported present, never verified", () => {
	const { primary } = announceOf("announce-ratchet-and-app-data");
	const announce = findNode(primary.root, "Announce");
	assert.ok(announce);
	for (const label of ["Public key", "Ratchet key", "Signature"]) {
		const n = findNode(announce, label);
		assert.ok(n, `${label} present`);
		assert.match(n.value ?? "", /present/, `${label} says present`);
		assert.match(
			n.value ?? "",
			/not validated|not verified/,
			`${label} refuses to claim the bytes are good`,
		);
	}
	// No cryptographic claim anywhere in the subtree.
	const said = JSON.stringify(announce);
	assert.doesNotMatch(said, /\bvalid signature|decrypt|verified ok/i);
});

test("an announce's ratchet is placed only when the context flag promises one", () => {
	const withRatchet = announceOf("announce-ratchet-and-app-data").fields;
	assert.ok(withRatchet?.announce);
	assert.deepEqual(withRatchet.announce.ratchetRange, {
		offset: 104,
		length: 32,
	});
	assert.equal(withRatchet.contextFlag, true);

	const without = announceOf("announce-header-one-minimal").fields;
	assert.ok(without?.announce);
	assert.equal(without.announce.ratchetRange, null);
	assert.equal(without.contextFlag, false);
});

test("announce app_data stays raw bytes, with a preview only when clearly printable", () => {
	const printable = announceOf("announce-printable-app-data-preview");
	assert.ok(printable.fields?.announce);
	assert.equal(printable.fields.announce.appDataPreview, "nomadnet.node");
	const appData = findNode(printable.primary.root, "App data");
	assert.ok(appData);
	assert.equal(appData.tone, "raw", "app_data is undecoded raw bytes");
	assert.match(appData.value ?? "", /never interpreted/);
	assert.match(appData.value ?? "", /msgpack/);
	assert.match(appData.value ?? "", /printable-ASCII preview only/);

	// The maximal ramp runs past 0x7e, so no preview is offered at all.
	const ramp = announceOf("announce-maximum-app-data");
	assert.ok(ramp.fields?.announce);
	assert.equal(ramp.fields.announce.appDataLength, 87);
	assert.equal(ramp.fields.announce.appDataPreview, null);
	const rampNode = findNode(ramp.primary.root, "App data");
	assert.ok(rampNode);
	assert.doesNotMatch(rampNode.value ?? "", /preview/);
});

test("announce exclusions stay structural, exactly as the C++ reader refuses them", () => {
	// Each of these is a C++ refusal path in readReticulumAnnounce.
	const excluded = [
		"announce-group-destination-structural", // non-SINGLE destination
		"announce-ratchet-promised-but-missing", // context flag with no room
		"announce-split-frame-rejected", // RNode split frame
		"announce-ifac-protected-rejected", // IFAC-masked header
		"announce-one-byte-short-of-fixed-layout", // payload too short
		"announce-payload-too-short",
		"announce-app-data-past-the-frame-arithmetic", // app_data past the cap
	];
	for (const name of excluded) {
		const { primary, fields } = announceOf(name);
		assert.equal(fields?.announce ?? null, null, `${name}: no announce`);
		assert.equal(
			findNode(primary.root, "Announce"),
			null,
			`${name}: no announce subtree`,
		);
		assert.notEqual(
			primary.state,
			"payload-decoded",
			`${name}: stays structural`,
		);
	}

	// A truncated capture of a perfectly-shaped announce is refused too: the
	// C++ reader rejects any packet whose state is Malformed.
	const cut = announceOf("announce-header-one-minimal", true);
	assert.equal(cut.primary.result, "malformed");
	assert.equal(cut.fields?.announce ?? null, null);
	assert.equal(findNode(cut.primary.root, "Announce"), null);
});

test("a structural announce says which arithmetic refused it", () => {
	for (const [name, pattern] of [
		["announce-group-destination-structural", /GROUP destination/],
		["announce-ratchet-promised-but-missing", /promises a ratchet/],
		["announce-payload-too-short", /shorter than the 148-byte/],
		[
			"announce-app-data-past-the-frame-arithmetic",
			/app_data exceeds the 87-byte frame arithmetic/,
		],
	] as const) {
		const { primary } = announceOf(name);
		const payload = findNode(primary.root, "Payload");
		assert.ok(payload, `${name}: payload node`);
		assert.match(payload.value ?? "", pattern, `${name}: refusal reason`);
	}
});

test("the header's path branch says how a frame got here, and what RNS never records", () => {
	const one = findNode(
		announceOf("announce-header-one-minimal").primary.root,
		"Path",
	);
	assert.ok(one, "a clear Reticulum header gets a path branch");
	assert.equal(one.byteOffset, 2);
	assert.equal(one.byteLength, 1, "HEADER_1 records only a hop count");
	assert.match(one.value ?? "", /^3 hops/);
	assert.match(one.value ?? "", /never the nodes in between/);
	assert.equal(findNode(one, "Hops")?.value, "3");
	assert.equal(findNode(one, "Transport id"), null);

	const two = findNode(
		announceOf("announce-header-two-transported").primary.root,
		"Path",
	);
	assert.ok(two);
	assert.equal(two.byteOffset, 2);
	assert.equal(
		two.byteLength,
		17,
		"the hop byte plus the 16-byte transport id",
	);
	assert.match(
		two.value ?? "",
		/7 hops via transport instance 707172737475767778797a7b7c7d7e7f/,
	);
	const transport = findNode(two, "Transport id");
	assert.ok(transport);
	assert.equal(transport.byteOffset, 3);
	assert.equal(transport.byteLength, 16);

	// The path is header evidence, so it is read for any packet type, not
	// only for announces.
	const data = findNode(
		announceOf("header-two-transport-single-data").primary.root,
		"Path",
	);
	assert.ok(data);
	assert.match(data.value ?? "", /^3 hops via transport instance/);

	// A hop count outside RNS limits describes no path at all: the malformed
	// hop byte is reported on its own, with nothing built on top of it.
	const excessive = announceOf("excessive-hops").primary.root;
	assert.equal(findNode(excessive, "Path"), null);
	assert.ok(findNode(excessive, "Hops"), "the refused hop byte is still shown");
});

test("selecting an announce shows the path it travelled", () => {
	const announce = findNode(
		announceOf("announce-header-two-transported").primary.root,
		"Announce",
	);
	assert.ok(announce);
	assert.match(
		announce.value ?? "",
		/destination d0d1d2d3d4d5d6d7d8d9dadbdcdddedf · 7 hops via transport instance 707172737475767778797a7b7c7d7e7f/,
	);
});

test("an announce's identity material reads as one branch, and stays unverified", () => {
	const identity = findNode(
		announceOf("announce-ratchet-and-app-data").primary.root,
		"Announced identity",
	);
	assert.ok(identity);
	// Public key, name hash, random hash and the promised ratchet are one
	// contiguous run: 64 + 10 + 10 + 32.
	assert.equal(identity.byteOffset, 20);
	assert.equal(identity.byteLength, 116);
	assert.match(identity.value ?? "", /not checked against d0d1d2d3/);
	for (const label of [
		"Public key",
		"Name hash",
		"Random hash",
		"Ratchet key",
	]) {
		assert.ok(findNode(identity, label), `${label} sits under the identity`);
	}
	assert.equal(
		findNode(identity, "Signature"),
		null,
		"the signature is evidence about the identity, not part of it",
	);

	// With no ratchet promised, the run ends at the random hash: 64 + 10 + 10.
	const minimal = findNode(
		announceOf("announce-header-one-minimal").primary.root,
		"Announced identity",
	);
	assert.ok(minimal);
	assert.equal(minimal.byteLength, 84);
});

test("reticulumDestinationHashHex never disagrees with the dissector", () => {
	const check = (bytes: Uint8Array, context: string) => {
		const { primary } = dissectFrame(bytes, "reticulum");
		const fields = primary.fields as {
			destinationHashHex: string | null;
		} | null;
		assert.equal(
			reticulumDestinationHashHex(bytes),
			fields?.destinationHashHex ?? null,
			context,
		);
	};
	for (const fixture of RNODE_FIXTURES) {
		const bytes = bytesFromHex(fixture.hex);
		for (let length = 0; length <= bytes.length; length++) {
			check(bytes.subarray(0, length), `${fixture.name} prefix ${length}`);
		}
	}
	const random = mulberry32(0x524e4453); // "RNDS"
	for (let round = 0; round < 400; round++) {
		const length = Math.floor(random() * 64);
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) bytes[i] = Math.floor(random() * 256);
		check(bytes, `garbage round ${round}`);
	}
});

/* ────────────────────────────────────────────────────────────────────────────
 * Safety: truncated captures, truncated bytes, and garbage never throw, and
 * always yield an honest tree spanning the frame.
 * ──────────────────────────────────────────────────────────────────────── */

const ALL_HINTS: ProtocolHint[] = [
	"meshtastic",
	"meshcore",
	"reticulum",
	"unknown",
	"custom",
];

function dissectSafely(
	bytes: Uint8Array,
	hint: ProtocolHint,
	truncated: boolean,
	context: string,
) {
	let dissection: { primary: AnyDissection };
	try {
		dissection = dissectFrame(bytes, hint, { truncated });
	} catch (error) {
		assert.fail(`${context}: dissectFrame threw: ${String(error)}`);
	}
	const { primary } = dissection;
	assert.ok(
		["matched", "malformed", "no-match"].includes(primary.result),
		context,
	);
	assertTreeInvariants(primary.root, bytes.length, context);
	return primary;
}

test("radio-truncated captures are reported honestly and never throw", () => {
	for (const { file, hint } of CORPUS) {
		for (const fixture of loadFixtures(file)) {
			const bytes = bytesFromHex(fixture.hex);
			const primary = dissectSafely(
				bytes,
				hint,
				true,
				`${file} ${fixture.name} truncated`,
			);
			assert.ok(
				hasTone(primary.root, "error"),
				`${fixture.name}: a truncated capture carries an error node`,
			);
			// MeshCore and Reticulum report truncated frames as malformed;
			// Meshtastic only flags them (DissectOptions in types.ts).
			if (hint !== "meshtastic" && fixture.result === "matched") {
				assert.equal(
					primary.result,
					"malformed",
					`${fixture.name}: truncated is malformed`,
				);
			}
			if (hint === "meshtastic") {
				assert.equal(
					primary.result,
					fixture.result,
					`${fixture.name}: result kept, flagged`,
				);
			}
		}
	}
});

test("every truncated prefix of every fixture dissects safely", () => {
	for (const { file, hint } of CORPUS) {
		for (const fixture of loadFixtures(file)) {
			const bytes = bytesFromHex(fixture.hex);
			for (let length = 0; length <= bytes.length; length++) {
				const prefix = bytes.subarray(0, length);
				for (const truncated of [false, true]) {
					dissectSafely(
						prefix,
						hint,
						truncated,
						`${fixture.name} prefix ${length}`,
					);
				}
			}
		}
	}
});

/** Deterministic PRNG (mulberry32) so a failure is reproducible. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

test("garbage bytes never throw under any protocol hint", () => {
	const random = mulberry32(0x4c494c59); // "LILY"
	for (let round = 0; round < 200; round++) {
		const length = Math.floor(random() * 96);
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) bytes[i] = Math.floor(random() * 256);
		for (const hint of ALL_HINTS) {
			dissectSafely(
				bytes,
				hint,
				round % 2 === 1,
				`garbage round ${round} hint ${hint}`,
			);
		}
	}
});

test("Reticulum announce with MessagePack app_data dissects structured fields", () => {
	// 1 shim (0x00) + 19 HEADER_1 + 148 announce fixed + 20 msgpack = 188 bytes
	const shim = [0x00];
	const flags = [0x01]; // HEADER_1, SINGLE, ANNOUNCE
	const hops = [0x02];
	const destHash = new Array(16).fill(0xd0);
	const context = [0x00];
	const pubKey = new Array(64).fill(0x11);
	const nameHash = new Array(10).fill(0x21);
	const randomHash = new Array(10).fill(0x31);
	const sig = new Array(64).fill(0x51);
	// MessagePack map: { "display_name": "Alice" }
	const key = new TextEncoder().encode("display_name");
	const val = new TextEncoder().encode("Alice");
	const msgpack = [0x81, 0xa0 | key.length, ...key, 0xa0 | val.length, ...val];

	const frame = new Uint8Array([
		...shim,
		...flags,
		...hops,
		...destHash,
		...context,
		...pubKey,
		...nameHash,
		...randomHash,
		...sig,
		...msgpack,
	]);

	const d = dissectFrame(frame, "reticulum");
	assert.equal(d.primary.protocol, "Reticulum");
	assert.equal(d.primary.result, "matched");
	assert.equal(d.primary.state, "payload-decoded");

	const appDataNode = findNode(d.primary.root, "App data");
	assert.ok(appDataNode, "App data node exists");
	assert.match(appDataNode.value ?? "", /MessagePack decoded/);

	const msgpackNode = findNode(appDataNode, "MessagePack");
	assert.ok(msgpackNode, "MessagePack child node exists");

	const fieldNode = findNode(msgpackNode, "display_name");
	assert.ok(fieldNode, "display_name key node exists");
	assert.equal(fieldNode.value, '"Alice"');
});

test("MeshCore advertisement unpacks public key, node ID, timestamp, and signature", () => {
	// Construct 100-byte advert
	const header = [0x11]; // route: flood, type: advert, v0
	const pathLen = [0x00]; // 0 hops
	const pubKey = new Uint8Array(32).fill(0xaa);
	pubKey[0] = 0x12;
	pubKey[1] = 0x34;
	pubKey[2] = 0x56;
	pubKey[3] = 0x78;
	const timestamp = [0x00, 0xf1, 0x53, 0x65]; // 1700000000
	const signature = new Uint8Array(64).fill(0xbb);

	const frame = new Uint8Array([
		...header,
		...pathLen,
		...pubKey,
		...timestamp,
		...signature,
	]);

	const { primary } = dissectFrame(frame, "meshcore");
	assert.equal(primary.protocol, "MeshCore");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "header-only");
	assertTreeInvariants(primary.root, frame.length, "meshcore-advert-100");

	const advert = primary.fields?.advertisement;
	assert.ok(advert);
	assert.equal(advert.nodeIdHex, "78563412");
	assert.equal(advert.timestamp, 1700000000);
	assert.equal(advert.hasLocation, false);
});

test("MeshCore advertisement with app data parses node type, position, and name", () => {
	const header = [0x11];
	const pathLen = [0x00];
	const pubKey = new Uint8Array(32).fill(0x01);
	pubKey[0] = 0xef;
	pubKey[1] = 0xbe;
	pubKey[2] = 0xad;
	pubKey[3] = 0xde;
	const timestamp = [0x00, 0xf1, 0x53, 0x65];
	const signature = new Uint8Array(64).fill(0x02);

	// App data: flags = 1 (Chat) | 0x10 (Location) | 0x20 (Feature 1) | 0x80 (Name)
	const flags = [0xb1];
	// Lat: 37.774929 -> 37774929 = 0x02406651
	const latBytes = [0x51, 0x66, 0x40, 0x02];
	// Lon: -122.419416 -> -122419416 = 0xf8b40728
	const lonBytes = [0x28, 0x07, 0xb4, 0xf8];
	const feat1Bytes = [0x34, 0x12];
	const nameBytes = new TextEncoder().encode("LilyDeck");

	const frame = new Uint8Array([
		...header,
		...pathLen,
		...pubKey,
		...timestamp,
		...signature,
		...flags,
		...latBytes,
		...lonBytes,
		...feat1Bytes,
		...nameBytes,
	]);

	const { primary } = dissectFrame(frame, "meshcore");
	assert.equal(primary.protocol, "MeshCore");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "payload-decoded");
	assertTreeInvariants(primary.root, frame.length, "meshcore-advert-appdata");

	const advert = primary.fields?.advertisement;
	assert.ok(advert);
	assert.equal(advert.nodeIdHex, "deadbeef");
	assert.equal(advert.nodeTypeLabel, "Chat");
	assert.equal(advert.hasLocation, true);
	assert.ok(
		advert.latitude !== undefined &&
			Math.abs(advert.latitude - 37.774929) < 0.00001,
	);
	assert.ok(
		advert.longitude !== undefined &&
			Math.abs(advert.longitude - -122.419416) < 0.00001,
	);
	assert.equal(advert.featureOne, 0x1234);
	assert.equal(advert.name, "LilyDeck");

	const nameNode = findNode(primary.root, "Name");
	assert.ok(nameNode);
	assert.equal(nameNode.value, "LilyDeck");

	const posNode = findNode(primary.root, "Position");
	assert.ok(posNode);
	assert.match(posNode.value ?? "", /37\.774929/);
});

function float32Bytes(value: number): number[] {
	const buf = new Uint8Array(4);
	new DataView(buf.buffer).setFloat32(0, value, true);
	return Array.from(buf);
}

function le32Bytes(value: number): number[] {
	return [
		value & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 24) & 0xff,
	];
}

function varintBytes(value: number): number[] {
	const out: number[] = [];
	let v = value >>> 0;
	while (v > 0x7f) {
		out.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	out.push(v & 0x7f);
	return out;
}

function signedVarintBytes(value: number): number[] {
	if (value >= 0) return varintBytes(value);
	let v = BigInt(value) & 0xffffffffffffffffn;
	const out: number[] = [];
	while (v > 0x7fn) {
		out.push(Number((v & 0x7fn) | 0x80n));
		v >>= 7n;
	}
	out.push(Number(v & 0x7fn));
	return out;
}

function buildMeshtasticTestFrame(
	fromNode: number,
	toNode: number,
	packetId: number,
	dataPayload: Uint8Array,
): Uint8Array {
	const nonce = meshtasticNonce(fromNode, packetId);
	const cipher = aesCtrXcrypt(MESHTASTIC_DEFAULT_PSK, nonce, dataPayload);
	const frame = new Uint8Array(16 + cipher.length);
	frame.set(le32Bytes(toNode), 0);
	frame.set(le32Bytes(fromNode), 4);
	frame.set(le32Bytes(packetId), 8);
	frame[12] = 0x63;
	frame[13] = 0x08;
	frame[14] = 0x00;
	frame[15] = 0x00;
	frame.set(cipher, 16);
	return frame;
}

test("Meshtastic telemetry payload unpacks device metrics, environmental metrics, and byte spans", () => {
	// Construct Telemetry submessages:
	// DeviceMetrics: battery 85%, voltage 4.12V, channel_utilization 14.5%, air_util_tx 1.2%, uptime 7200s
	const devMetricsBytes = [
		0x08,
		...varintBytes(85), // field 1 varint battery
		0x15,
		...float32Bytes(4.12), // field 2 fixed32 voltage
		0x1d,
		...float32Bytes(14.5), // field 3 fixed32 channel_utilization
		0x25,
		...float32Bytes(1.2), // field 4 fixed32 air_util_tx
		0x28,
		...varintBytes(7200), // field 5 varint uptime
	];

	// EnvironmentMetrics: temp 23.5°C, humidity 54.0%, pressure 1013.25 hPa
	const envMetricsBytes = [
		0x0d,
		...float32Bytes(23.5), // field 1 fixed32 temp
		0x15,
		...float32Bytes(54.0), // field 2 fixed32 humidity
		0x1d,
		...float32Bytes(1013.25), // field 3 fixed32 pressure
	];

	// Outer Telemetry message:
	// field 1 fixed32 time = 1774390000 (0x69c84970)
	// field 2 length-delimited DeviceMetrics
	// field 3 length-delimited EnvironmentMetrics
	const telemBytes = [
		0x0d,
		...le32Bytes(1774390000),
		0x12,
		...varintBytes(devMetricsBytes.length),
		...devMetricsBytes,
		0x1a,
		...varintBytes(envMetricsBytes.length),
		...envMetricsBytes,
	];

	// Wrap in Data protobuf (portnum = 67)
	const dataBytes = new Uint8Array([
		0x08,
		MESHTASTIC_PORT.telemetry,
		0x12,
		...varintBytes(telemBytes.length),
		...telemBytes,
	]);

	const frame = buildMeshtasticTestFrame(
		0x11223344,
		0xffffffff,
		101,
		dataBytes,
	);
	const { primary } = dissectFrame(frame, "meshtastic");

	assert.equal(primary.protocol, "Meshtastic");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "payload-decoded");
	assertTreeInvariants(primary.root, frame.length, "meshtastic-telemetry");

	const telem = primary.fields?.payload?.telemetry;
	assert.ok(telem);
	assert.equal(telem.time, 1774390000);

	assert.ok(telem.deviceMetrics);
	assert.equal(telem.deviceMetrics.batteryLevel, 85);
	assert.ok(Math.abs((telem.deviceMetrics.voltage ?? 0) - 4.12) < 0.01);
	assert.ok(
		Math.abs((telem.deviceMetrics.channelUtilization ?? 0) - 14.5) < 0.01,
	);
	assert.ok(Math.abs((telem.deviceMetrics.airUtilTx ?? 0) - 1.2) < 0.01);
	assert.equal(telem.deviceMetrics.uptimeSeconds, 7200);

	assert.ok(telem.environmentMetrics);
	assert.ok(
		Math.abs((telem.environmentMetrics.temperature ?? 0) - 23.5) < 0.01,
	);
	assert.ok(
		Math.abs((telem.environmentMetrics.relativeHumidity ?? 0) - 54.0) < 0.01,
	);
	assert.ok(
		Math.abs((telem.environmentMetrics.barometricPressure ?? 0) - 1013.25) <
			0.1,
	);

	// Verify tree nodes
	const devNode = findNode(primary.root, "Device metrics");
	assert.ok(devNode);
	const batNode = findNode(primary.root, "Battery level");
	assert.ok(batNode && batNode.value?.includes("85%"));
	const voltNode = findNode(primary.root, "Voltage");
	assert.ok(voltNode && voltNode.value?.includes("4.12 V"));

	const envNode = findNode(primary.root, "Environment metrics");
	assert.ok(envNode);
	const tempNode = findNode(primary.root, "Temperature");
	assert.ok(tempNode && tempNode.value?.includes("23.50 °C"));
	const pressNode = findNode(primary.root, "Barometric pressure");
	assert.ok(pressNode && pressNode.value?.includes("1013.25 hPa"));
});

test("Meshtastic traceroute payload unpacks route discovery hops and per-hop SNR measurements", () => {
	// RouteDiscovery: route [0x11223344, 0x55667788], snr_towards [34, -48], route_back [0x55667788], snr_back [28]
	// 34 / 4 = 8.5 dB, -48 / 4 = -12.0 dB, 28 / 4 = 7.0 dB
	const rdBytes = [
		0x0d,
		...le32Bytes(0x11223344), // route 1
		0x0d,
		...le32Bytes(0x55667788), // route 2
		0x10,
		...signedVarintBytes(34), // snr_towards 1 (+8.5 dB)
		0x10,
		...signedVarintBytes(-48), // snr_towards 2 (-12.0 dB)
		0x1d,
		...le32Bytes(0x55667788), // route_back 1
		0x20,
		...signedVarintBytes(28), // snr_back 1 (+7.0 dB)
	];

	// Wrap in Data protobuf (portnum = 70: TRACEROUTE)
	const dataBytes = new Uint8Array([
		0x08,
		MESHTASTIC_PORT.traceroute,
		0x12,
		...varintBytes(rdBytes.length),
		...rdBytes,
	]);

	const frame = buildMeshtasticTestFrame(
		0x11223344,
		0x55667788,
		202,
		dataBytes,
	);
	const { primary } = dissectFrame(frame, "meshtastic");

	assert.equal(primary.protocol, "Meshtastic");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "payload-decoded");
	assertTreeInvariants(primary.root, frame.length, "meshtastic-traceroute");

	const rd = primary.fields?.payload?.routeDiscovery;
	assert.ok(rd);
	assert.equal(rd.towardsHops.length, 2);
	assert.equal(rd.towardsHops[0].nodeHex, "!11223344");
	assert.equal(rd.towardsHops[0].snrDb, 8.5);
	assert.equal(rd.towardsHops[1].nodeHex, "!55667788");
	assert.equal(rd.towardsHops[1].snrDb, -12.0);

	assert.equal(rd.backHops.length, 1);
	assert.equal(rd.backHops[0].nodeHex, "!55667788");
	assert.equal(rd.backHops[0].snrDb, 7.0);

	const hop1 = findNode(primary.root, "Hop 1");
	assert.ok(hop1 && hop1.value?.includes("!11223344 (SNR: +8.5 dB)"));
	const hop2 = findNode(primary.root, "Hop 2");
	assert.ok(hop2 && hop2.value?.includes("!55667788 (SNR: -12.0 dB)"));
	const back1 = findNode(primary.root, "Return hop 1");
	assert.ok(back1 && back1.value?.includes("!55667788 (SNR: +7.0 dB)"));
});

test("Meshtastic routing payload unpacks routing error reason codes and request IDs", () => {
	// Routing with error_reason = 1 (NO_ROUTE)
	const routingBytes = [
		0x18,
		0x01, // field 3 varint = 1 (NO_ROUTE)
	];

	// Wrap in Data protobuf (portnum = 5: ROUTING, request_id = 0x12345678)
	const dataBytes = new Uint8Array([
		0x08,
		MESHTASTIC_PORT.routing,
		0x12,
		...varintBytes(routingBytes.length),
		...routingBytes,
		0x30,
		...varintBytes(0x12345678), // field 6 varint request_id
	]);

	const frame = buildMeshtasticTestFrame(
		0x11223344,
		0x55667788,
		303,
		dataBytes,
	);
	const { primary } = dissectFrame(frame, "meshtastic");

	assert.equal(primary.protocol, "Meshtastic");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "payload-decoded");
	assertTreeInvariants(primary.root, frame.length, "meshtastic-routing");

	assert.equal(primary.fields?.payload?.requestId, 0x12345678);
	const routing = primary.fields?.payload?.routing;
	assert.ok(routing);
	assert.equal(routing.errorReason, 1);
	assert.equal(routing.errorName, "NO_ROUTE");

	const reqIdNode = findNode(primary.root, "Request ID");
	assert.ok(reqIdNode && reqIdNode.value?.includes("0x12345678"));
	const errNode = findNode(primary.root, "Routing error");
	assert.ok(errNode && errNode.value?.includes("NO_ROUTE (1)"));
});

test("Meshtastic neighbor info payload unpacks reporting node, edges, SNR, and rx timestamps", () => {
	// Neighbor 1: node_id = 0x11223344, snr = 6.25 dB, last_rx_time = 1774392000, broadcast_interval = 900 s
	const neighbor1Bytes = [
		0x08,
		...varintBytes(0x11223344), // field 1: node_id
		0x15,
		...float32Bytes(6.25), // field 2: snr (wire 5)
		0x1d,
		...le32Bytes(1774392000), // field 3: last_rx_time (wire 5)
		0x20,
		...varintBytes(900), // field 4: broadcast_interval
	];

	// Neighbor 2: node_id = 0xaabbccdd, snr = -4.50 dB, last_rx_time = 1774392050, broadcast_interval = 1800 s
	const neighbor2Bytes = [
		0x08,
		...varintBytes(0xaabbccdd),
		0x15,
		...float32Bytes(-4.5),
		0x1d,
		...le32Bytes(1774392050),
		0x20,
		...varintBytes(1800),
	];

	// NeighborInfo: node_id = 0x12345678, last_sent_by_id = 0x87654321, interval = 900 s, repeated neighbors
	const niBytes = [
		0x08,
		...varintBytes(0x12345678), // field 1: node_id
		0x10,
		...varintBytes(0x87654321), // field 2: last_sent_by_id
		0x18,
		...varintBytes(900), // field 3: node_broadcast_interval_secs
		0x22,
		...varintBytes(neighbor1Bytes.length), // field 4: neighbor 1
		...neighbor1Bytes,
		0x22,
		...varintBytes(neighbor2Bytes.length), // field 4: neighbor 2
		...neighbor2Bytes,
	];

	// Wrap in Data protobuf (portnum = 71: NEIGHBORINFO)
	const dataBytes = new Uint8Array([
		0x08,
		MESHTASTIC_PORT.neighborinfo,
		0x12,
		...varintBytes(niBytes.length),
		...niBytes,
	]);

	const frame = buildMeshtasticTestFrame(
		0x12345678,
		0xffffffff,
		404,
		dataBytes,
	);
	const { primary } = dissectFrame(frame, "meshtastic");

	assert.equal(primary.protocol, "Meshtastic");
	assert.equal(primary.result, "matched");
	assert.equal(primary.state, "payload-decoded");
	assertTreeInvariants(primary.root, frame.length, "meshtastic-neighborinfo");

	const ni = primary.fields?.payload?.neighborInfo;
	assert.ok(ni);
	assert.equal(ni.nodeId, 0x12345678);
	assert.equal(ni.nodeHex, "!12345678");
	assert.equal(ni.lastSentById, 0x87654321);
	assert.equal(ni.lastSentByHex, "!87654321");
	assert.equal(ni.broadcastIntervalSecs, 900);
	assert.equal(ni.neighbors.length, 2);

	const n1 = ni.neighbors[0];
	assert.equal(n1.nodeId, 0x11223344);
	assert.equal(n1.nodeHex, "!11223344");
	assert.ok(Math.abs((n1.snrDb ?? 0) - 6.25) < 0.01);
	assert.equal(n1.lastRxTime, 1774392000);
	assert.equal(n1.broadcastIntervalSecs, 900);

	const n2 = ni.neighbors[1];
	assert.equal(n2.nodeId, 0xaabbccdd);
	assert.equal(n2.nodeHex, "!aabbccdd");
	assert.ok(Math.abs((n2.snrDb ?? 0) - -4.5) < 0.01);
	assert.equal(n2.lastRxTime, 1774392050);
	assert.equal(n2.broadcastIntervalSecs, 1800);

	const repNode = findNode(primary.root, "Reporting node ID");
	assert.ok(repNode && repNode.value?.includes("!12345678"));
	const lastSentNode = findNode(primary.root, "Last sent by ID");
	assert.ok(lastSentNode && lastSentNode.value?.includes("!87654321"));

	const n1Node = findNode(primary.root, "Neighbor 1");
	assert.ok(n1Node && n1Node.value?.includes("!11223344 · +6.3 dB"));
	const n2Node = findNode(primary.root, "Neighbor 2");
	assert.ok(n2Node && n2Node.value?.includes("!aabbccdd · -4.5 dB"));
});
