// Self-check: node --import tsx --test src/lib/conversation.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
	addressLabel,
	conversationCoverage,
	conversationExpression,
	conversationLabel,
	coverageNote,
	type FrameAddressing,
	frameAddressing,
	isAddressable,
	MESHTASTIC_BROADCAST_HEX,
	parseConversationExpression,
} from "./conversation";
import { dissectMeshtastic } from "./dissect/meshtastic";
import { type FilterFrame, parseFrameFilter } from "./frameFilter";

/* ── fixtures ────────────────────────────────────────────────────────── */

/** A Meshtastic frame: to[0..3], from[4..7], id[8..11], flags, hash, hops. */
function meshtasticBytes(destination: number, source: number): Uint8Array {
	const bytes = new Uint8Array(20);
	const le32 = (at: number, value: number) => {
		bytes[at] = value & 0xff;
		bytes[at + 1] = (value >>> 8) & 0xff;
		bytes[at + 2] = (value >>> 16) & 0xff;
		bytes[at + 3] = (value >>> 24) & 0xff;
	};
	le32(0, destination);
	le32(4, source);
	le32(8, 0x11223344);
	bytes[12] = 0x23;
	bytes[13] = 0x08;
	return bytes;
}

const RNS_HASH = "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf";

/** An RNode-framed Reticulum frame carrying a clear HEADER_1. */
function reticulumBytes(hashHex: string): Uint8Array {
	const hash = Uint8Array.from(hashHex.match(/../g) ?? [], (b) =>
		Number.parseInt(b, 16),
	);
	const bytes = new Uint8Array(20);
	bytes[0] = 0x00; // RNode shim, complete frame
	bytes[1] = 0x01; // HEADER_1, SINGLE destination, ANNOUNCE
	bytes[2] = 1; // hops
	bytes.set(hash, 3);
	return bytes;
}

/* ── what each protocol proves ───────────────────────────────────────── */

test("Meshtastic names both endpoints of a conversation", () => {
	const a = frameAddressing(meshtasticBytes(0x0badc0de, 0xa1b2c3d4), 1);
	assert.deepEqual(a, { src: "a1b2c3d4", dst: "0badc0de", reason: null });
	assert.equal(isAddressable(a), true);
});

test("a Meshtastic broadcast names the broadcast destination as such", () => {
	const a = frameAddressing(meshtasticBytes(0xffffffff, 0xa1b2c3d4), 1);
	assert.equal(a.dst, MESHTASTIC_BROADCAST_HEX);
	assert.equal(conversationLabel(a), "a1b2c3d4 → broadcast");
	// One-way: no node sources from the broadcast address, so the reverse
	// leg would be a filter term that can never match.
	assert.equal(conversationExpression(a), "src == a1b2c3d4 && dst == ffffffff");
});

test("Meshtastic addressing agrees with the dissector, byte for byte", () => {
	// Pinned against dissectMeshtastic over fixtures, every prefix of them,
	// and random bytes — the same discipline dissect.test.ts applies to the
	// Reticulum destination-hash reader.
	const cases: Uint8Array[] = [
		meshtasticBytes(0xffffffff, 0xa1b2c3d4),
		meshtasticBytes(0x00000001, 0x00000002),
		meshtasticBytes(0x0badc0de, 0x00000000), // zero sender: altered packet
	];
	let seed = 0x2f6e2b1;
	for (let i = 0; i < 200; i++) {
		const n = 1 + (i % 24);
		const bytes = new Uint8Array(n);
		for (let j = 0; j < n; j++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			bytes[j] = (seed >>> 16) & 0xff;
		}
		cases.push(bytes);
	}
	for (const full of cases) {
		for (let cut = 0; cut <= full.length; cut++) {
			const bytes = full.subarray(0, cut);
			const address = frameAddressing(bytes, 1);
			const dissected = dissectMeshtastic(bytes);
			const fields = dissected.result === "matched" ? dissected.fields : null;
			if (fields === null) {
				assert.equal(address.src, null);
				assert.equal(address.dst, null);
				assert.notEqual(address.reason, null);
				continue;
			}
			assert.equal(address.src, fields.source.toString(16).padStart(8, "0"));
			assert.equal(
				address.dst,
				fields.destination.toString(16).padStart(8, "0"),
			);
		}
	}
});

test("Reticulum names a destination and says it names no source", () => {
	const a = frameAddressing(reticulumBytes(RNS_HASH), 4);
	assert.equal(a.src, null);
	assert.equal(a.dst, RNS_HASH);
	assert.match(a.reason ?? "", /no sender address/);
	assert.equal(conversationExpression(a), `dst == ${RNS_HASH}`);
	assert.equal(conversationLabel(a), "→ d0d1d2d3…");
});

test("a Reticulum frame with no readable header names no address", () => {
	const split = reticulumBytes(RNS_HASH);
	split[0] = 0x01; // split continuation: no clear RNS header
	const a = frameAddressing(split, 4);
	assert.deepEqual({ src: a.src, dst: a.dst }, { src: null, dst: null });
	assert.match(a.reason ?? "", /split continuation/);
	assert.equal(conversationExpression(a), null);
	assert.equal(conversationLabel(a), null);
});

test("MeshCore is excluded explicitly — the dissector claims no address", () => {
	const a = frameAddressing(new Uint8Array([0x09, 0x00, 1, 2, 3]), 2);
	assert.equal(isAddressable(a), false);
	assert.match(a.reason ?? "", /MeshCore/);
	assert.equal(conversationExpression(a), null);
});

test("a frame whose profile named no protocol is excluded, not guessed", () => {
	for (const profile of [null, 0, 99]) {
		const a = frameAddressing(meshtasticBytes(0x0badc0de, 0xa1b2c3d4), profile);
		assert.equal(isAddressable(a), false, `profile ${profile}`);
		assert.notEqual(a.reason, null);
	}
});

test("an unreadable Meshtastic header is excluded, not zero-filled", () => {
	const short = frameAddressing(new Uint8Array([1, 2, 3]), 1);
	assert.equal(isAddressable(short), false);
	assert.match(short.reason ?? "", /outer header/);

	const zeroSender = frameAddressing(meshtasticBytes(0x0badc0de, 0), 1);
	assert.equal(isAddressable(zeroSender), false);
	assert.match(zeroSender.reason ?? "", /node 0/);
});

/* ── the expression is an ordinary display filter ────────────────────── */

function filterFrame(bytes: Uint8Array, profileId: number): FilterFrame {
	return {
		sequence: 1n,
		capturedLength: bytes.length,
		centerFrequencyHz: 906_875_000,
		bandwidthHz: 250_000,
		spreadingFactor: 11,
		codingRateDenominator: 5,
		rssiDbm: -97.5,
		snrDb: 4.2,
		profileId,
		direction: "rx",
		crc: "valid",
		synthetic: false,
		bytes,
	};
}

test("the pair expression compiles and matches both directions", () => {
	const a = frameAddressing(meshtasticBytes(0x0badc0de, 0xa1b2c3d4), 1);
	const text = conversationExpression(a);
	assert.equal(
		text,
		"(src == a1b2c3d4 && dst == 0badc0de) || (src == 0badc0de && dst == a1b2c3d4)",
	);
	const parsed = parseFrameFilter(text ?? "");
	assert.ok(parsed.ok && !parsed.empty);

	const forward = filterFrame(meshtasticBytes(0x0badc0de, 0xa1b2c3d4), 1);
	const reply = filterFrame(meshtasticBytes(0xa1b2c3d4, 0x0badc0de), 1);
	const other = filterFrame(meshtasticBytes(0x0badc0de, 0x00c0ffee), 1);
	assert.equal(parsed.predicate(forward), true);
	assert.equal(parsed.predicate(reply), true);
	assert.equal(parsed.predicate(other), false);
	// A MeshCore frame proves no address, so it can never join the pair.
	assert.equal(
		parsed.predicate(filterFrame(new Uint8Array([0x09, 0x00, 1, 2, 3]), 2)),
		false,
	);
});

test("a Reticulum conversation filter follows the destination hash", () => {
	const a = frameAddressing(reticulumBytes(RNS_HASH), 4);
	const parsed = parseFrameFilter(conversationExpression(a) ?? "");
	assert.ok(parsed.ok);
	assert.equal(
		parsed.predicate(filterFrame(reticulumBytes(RNS_HASH), 4)),
		true,
	);
	assert.equal(
		parsed.predicate(
			filterFrame(reticulumBytes("00112233445566778899aabbccddeeff"), 4),
		),
		false,
	);
	// The same 16 bytes `dest` names — one frame, one destination.
	assert.equal(
		parseFrameFilter(`dest == ${RNS_HASH}`).ok &&
			parsed.predicate(filterFrame(reticulumBytes(RNS_HASH), 4)),
		true,
	);
});

test("precomputed addressing reaches the predicate and wins", () => {
	const parsed = parseFrameFilter("src == a1b2c3d4 && dst == 0badc0de");
	assert.ok(parsed.ok);
	const frame = filterFrame(new Uint8Array([9, 9, 9]), 2); // MeshCore bytes
	const pretend: FrameAddressing = {
		src: "a1b2c3d4",
		dst: "0badc0de",
		reason: null,
	};
	assert.equal(parsed.predicate(frame, undefined, undefined, pretend), true);
	// An explicit null is the same claim `dest`'s null makes: no address.
	assert.equal(parsed.predicate(frame, undefined, undefined, null), false);
});

test("address literals must be whole addresses in hex", () => {
	for (const text of ["src == a1b2", "dst == zzzzzzzz", "src == 12345"]) {
		const parsed = parseFrameFilter(text);
		assert.ok(!parsed.ok, `expected "${text}" to be rejected`);
		assert.match(parsed.error.message, /matched whole/);
	}
	const ordered = parseFrameFilter("src < a1b2c3d4");
	assert.ok(!ordered.ok);
	assert.match(ordered.error.message, /no ordering/);
	// Case is not part of an address, and a Reticulum-width literal is legal.
	assert.ok(parseFrameFilter("src == A1B2C3D4").ok);
	assert.ok(parseFrameFilter(`dst == ${RNS_HASH}`).ok);
});

test("a conversation expression reads back as the conversation it follows", () => {
	for (const address of [
		frameAddressing(meshtasticBytes(0x0badc0de, 0xa1b2c3d4), 1),
		frameAddressing(meshtasticBytes(0xffffffff, 0xa1b2c3d4), 1),
		frameAddressing(reticulumBytes(RNS_HASH), 4),
	]) {
		const text = conversationExpression(address);
		assert.ok(text);
		const back = parseConversationExpression(text);
		assert.deepEqual(
			{ src: back?.src, dst: back?.dst },
			{ src: address.src, dst: address.dst },
		);
	}
});

test("any other filter is not read back as a conversation", () => {
	for (const text of [
		"",
		"snr > -5",
		`dest == ${RNS_HASH}`,
		"src == a1b2c3d4 && snr > 3",
		// A hand-edited pair is a filter again, not a conversation.
		"(src == a1b2c3d4 && dst == 0badc0de) || (src == 00c0ffee && dst == a1b2c3d4)",
	]) {
		assert.equal(parseConversationExpression(text), null, text);
	}
});

test("labels shorten a 16-byte hash and name the broadcast address", () => {
	assert.equal(addressLabel("a1b2c3d4"), "a1b2c3d4");
	assert.equal(addressLabel(RNS_HASH), "d0d1d2d3…");
	assert.equal(addressLabel(MESHTASTIC_BROADCAST_HEX), "broadcast");
});

/* ── the exclusion is reported, never silent ─────────────────────────── */

test("coverage counts the frames no conversation filter can reach", () => {
	const addressings = [
		frameAddressing(meshtasticBytes(0x0badc0de, 0xa1b2c3d4), 1),
		frameAddressing(reticulumBytes(RNS_HASH), 4),
		frameAddressing(new Uint8Array([0x09, 0x00, 1, 2, 3]), 2),
		frameAddressing(new Uint8Array([0x09, 0x00, 1, 2, 3]), 3),
		frameAddressing(new Uint8Array([1, 2, 3]), null),
	];
	const coverage = conversationCoverage(addressings);
	assert.equal(coverage.total, 5);
	assert.equal(coverage.addressable, 2);
	assert.equal(coverage.undecodable, 3);
	assert.equal(coverage.reasons.length, 2);
	assert.equal(coverage.reasons[0].count, 2); // the two MeshCore frames
	assert.match(coverage.reasons[0].reason, /MeshCore/);

	const note = coverageNote(coverage);
	assert.match(note, /3 of 5 frame\(s\) carry no decodable addressing/);
	assert.match(note, /excluded/);
	assert.match(note, /2 MeshCore/);
});

test("a fully addressable capture says so rather than nothing", () => {
	const note = coverageNote(
		conversationCoverage([
			frameAddressing(meshtasticBytes(1, 2), 1),
			frameAddressing(meshtasticBytes(2, 1), 1),
		]),
	);
	assert.match(note, /every one of the 2 frame\(s\)/);
});

test("an empty capture reports an empty coverage, not a division", () => {
	const coverage = conversationCoverage([]);
	assert.deepEqual(coverage, {
		total: 0,
		addressable: 0,
		undecodable: 0,
		reasons: [],
	});
});
