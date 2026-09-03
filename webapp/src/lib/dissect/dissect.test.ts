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
