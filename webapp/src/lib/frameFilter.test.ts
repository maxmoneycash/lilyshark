import assert from "node:assert/strict";
import test from "node:test";

import {
	type FilterFrame,
	parseFrameFilter,
	protoOfProfile,
} from "./frameFilter";

/* ── fixtures ────────────────────────────────────────────────────────── */

function frame(overrides: Partial<FilterFrame> = {}): FilterFrame {
	return {
		sequence: 7n,
		capturedLength: 42,
		centerFrequencyHz: 906_875_000,
		bandwidthHz: 250_000,
		spreadingFactor: 11,
		codingRateDenominator: 5,
		rssiDbm: -97.5,
		snrDb: 4.2,
		profileId: 1,
		direction: "rx",
		crc: "valid",
		synthetic: false,
		bytes: new Uint8Array([1, 2, 3]),
		...overrides,
	};
}

/** Parse, asserting success, and return the predicate. */
function compile(text: string) {
	const r = parseFrameFilter(text);
	assert.ok(
		r.ok,
		`expected "${text}" to parse, got: ${r.ok ? "" : r.error.message}`,
	);
	return r.predicate;
}

/** Parse, asserting failure, and return the structured error. */
function reject(text: string) {
	const r = parseFrameFilter(text);
	assert.ok(!r.ok, `expected "${text}" to be rejected`);
	return r.error;
}

/* ── grammar & fields ────────────────────────────────────────────────── */

test("blank input is an explicit match-everything, not an error", () => {
	const r = parseFrameFilter("   ");
	assert.ok(r.ok);
	assert.equal(r.empty, true);
	assert.equal(r.predicate(frame()), true);
});

test("numeric comparisons cover every operator", () => {
	const f = frame({ spreadingFactor: 9 });
	assert.equal(compile("sf == 9")(f), true);
	assert.equal(compile("sf != 9")(f), false);
	assert.equal(compile("sf < 10")(f), true);
	assert.equal(compile("sf <= 9")(f), true);
	assert.equal(compile("sf > 9")(f), false);
	assert.equal(compile("sf >= 9")(f), true);
});

test("every numeric field reads the right record member", () => {
	const f = frame({
		sequence: 1234n,
		capturedLength: 82,
		centerFrequencyHz: 915_000_000,
		bandwidthHz: 125_000,
		spreadingFactor: 8,
		codingRateDenominator: 6,
		rssiDbm: -120,
		snrDb: -7.5,
	});
	assert.equal(compile("seq == 1234")(f), true);
	assert.equal(compile("len == 82")(f), true);
	assert.equal(compile("freq == 915M")(f), true);
	assert.equal(compile("bw == 125k")(f), true);
	assert.equal(compile("sf == 8")(f), true);
	assert.equal(compile("cr == 6")(f), true);
	assert.equal(compile("rssi == -120")(f), true);
	assert.equal(compile("snr == -7.5")(f), true);
});

test("suffix numbers: 906.875M, 915M, 250k, 1G", () => {
	const f = frame();
	assert.equal(compile("freq == 906.875M")(f), true);
	assert.equal(compile("freq == 915M")(f), false);
	assert.equal(compile("bw >= 250k")(f), true);
	assert.equal(compile("freq < 1G")(f), true);
	// lowercase m / uppercase K work the same way
	assert.equal(compile("freq == 906.875m")(f), true);
	assert.equal(compile("bw == 250K")(f), true);
});

test("negative RSSI/SNR comparisons", () => {
	const f = frame({ rssiDbm: -97.5, snrDb: -3.25 });
	assert.equal(compile("rssi < -90")(f), true);
	assert.equal(compile("rssi > -100")(f), true);
	assert.equal(compile("rssi <= -97.5")(f), true);
	assert.equal(compile("snr < -3")(f), true);
	assert.equal(compile("snr >= -3.25")(f), true);
	assert.equal(compile("snr > 0")(f), false);
});

test("proto matches the firmware's builtin profile ids", () => {
	assert.equal(protoOfProfile(1), "meshtastic");
	assert.equal(protoOfProfile(2), "meshcore");
	assert.equal(protoOfProfile(3), "meshcore");
	assert.equal(protoOfProfile(4), "rnode");
	assert.equal(protoOfProfile(5), "rnode");
	assert.equal(protoOfProfile(0), "unknown");
	assert.equal(compile("proto == meshtastic")(frame({ profileId: 1 })), true);
	assert.equal(compile("proto == meshcore")(frame({ profileId: 3 })), true);
	assert.equal(compile("proto != rnode")(frame({ profileId: 4 })), false);
	assert.equal(compile("proto == unknown")(frame({ profileId: 99 })), true);
});

test("dir and crc enums, including ok/fail aliases", () => {
	assert.equal(compile("dir == rx")(frame({ direction: "rx" })), true);
	assert.equal(compile("dir != tx")(frame({ direction: "rx" })), true);
	assert.equal(compile("crc == ok")(frame({ crc: "valid" })), true);
	assert.equal(compile("crc == fail")(frame({ crc: "invalid" })), true);
	assert.equal(compile("crc != ok")(frame({ crc: "invalid" })), true);
	// the file's own words are accepted as aliases
	assert.equal(compile("crc == valid")(frame({ crc: "valid" })), true);
	assert.equal(compile("crc == invalid")(frame({ crc: "invalid" })), true);
	assert.equal(compile("crc == absent")(frame({ crc: "absent" })), true);
});

test("has:synthetic and has:pointer atoms", () => {
	assert.equal(compile("has:synthetic")(frame({ synthetic: true })), true);
	assert.equal(compile("has:synthetic")(frame({ synthetic: false })), false);
	assert.equal(compile("!has:synthetic")(frame({ synthetic: false })), true);
	// the precomputed flag wins over scanning the bytes
	assert.equal(compile("has:pointer")(frame(), true), true);
	assert.equal(compile("has:pointer")(frame(), false), false);
	// without the flag, the payload is scanned — 3 junk bytes hold no pointer
	assert.equal(compile("has:pointer")(frame()), false);
});

test("field and enum literals are case-insensitive", () => {
	const f = frame({ snrDb: 5, profileId: 1 });
	assert.equal(compile("SNR > 0")(f), true);
	assert.equal(compile("Proto == MESHTASTIC")(f), true);
	assert.equal(compile("HAS:POINTER")(f, true), true);
});

/* ── precedence & combinators ────────────────────────────────────────── */

test("&& binds tighter than ||", () => {
	// false || true && false → false unless || bound tighter
	const f = frame({ spreadingFactor: 11, snrDb: 5, crc: "invalid" });
	assert.equal(compile("sf == 7 || snr > 0 && crc == ok")(f), false);
	assert.equal(compile("(sf == 7 || snr > 0) && crc == fail")(f), true);
	// same shape, other side
	const g = frame({ spreadingFactor: 7 });
	assert.equal(compile("sf == 7 || snr > 999 && crc == fail")(g), true);
});

test("! and parentheses", () => {
	const f = frame({ crc: "invalid", snrDb: -9 });
	assert.equal(compile("!(crc == ok)")(f), true);
	assert.equal(compile("! crc == ok")(f), true);
	assert.equal(compile("!(crc == fail && snr < 0)")(f), false);
	assert.equal(compile("!!(crc == fail)")(f), true);
});

test("word operators and/or/not are aliases", () => {
	const f = frame({ spreadingFactor: 11, crc: "valid" });
	assert.equal(compile("sf == 11 and crc == ok")(f), true);
	assert.equal(compile("sf == 12 or crc == ok")(f), true);
	assert.equal(compile("not crc == fail")(f), true);
	// precedence carries over: and binds tighter than or
	const g = frame({ spreadingFactor: 7, crc: "invalid" });
	assert.equal(compile("sf == 7 or snr > 999 and crc == ok")(g), true);
});

test("a realistic compound filter over a small capture", () => {
	const frames = [
		frame({ sequence: 1, profileId: 1, snrDb: 6.5, crc: "valid" }),
		frame({ sequence: 2, profileId: 1, snrDb: -12, crc: "invalid" }),
		frame({ sequence: 3, profileId: 4, snrDb: 2, crc: "valid" }),
		frame({
			sequence: 4,
			profileId: 0,
			snrDb: 9,
			crc: "valid",
			synthetic: true,
		}),
	];
	const p = compile("proto == meshtastic && crc == ok || has:synthetic");
	assert.deepEqual(
		frames.filter((f) => p(f)).map((f) => Number(f.sequence)),
		[1, 4],
	);
});

/* ── structured errors ───────────────────────────────────────────────── */

test("unknown field: error spans the offending token", () => {
	const e = reject("bogus == 3");
	assert.equal(e.start, 0);
	assert.equal(e.end, 5);
	assert.match(e.message, /unknown field "bogus"/);
});

test("unknown field after a valid clause points past the &&", () => {
	const text = "sf == 7 && wat > 2";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), "wat");
});

test("enum fields refuse ordering, at the operator", () => {
	const text = "proto < meshcore";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), "<");
	assert.match(e.message, /no ordering/);
});

test("bad enum literal is named, at the literal", () => {
	const text = "crc == sideways";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), "sideways");
	assert.match(e.message, /ok, fail/);
});

test("numeric field compared to a word points at the word", () => {
	const text = "rssi > loud";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), "loud");
});

test("dangling operator reports at end of input", () => {
	const text = "snr > ";
	const e = reject(text);
	assert.equal(e.start, text.length);
	assert.equal(e.end, text.length);
});

test("unclosed parenthesis reports at end of input", () => {
	const text = "(sf == 7";
	const e = reject(text);
	assert.equal(e.start, text.length);
	assert.match(e.message, /\)/);
});

test("trailing garbage after a complete expression", () => {
	const text = "sf == 7 )";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), ")");
	assert.match(e.message, /unexpected/);
});

test("stray character is rejected with its position", () => {
	const text = "sf == 7 && #";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), "#");
});

test("bad has: atom points at the atom", () => {
	const text = "has:banana";
	const e = reject(text);
	assert.equal(text.slice(e.start, e.end), "banana");
	assert.match(e.message, /pointer or has:synthetic/);
});

test("errors are returned, never thrown", () => {
	// A pile of malformed inputs; none may throw.
	for (const text of [
		"==",
		"&&",
		"sf ==",
		"sf 7",
		"((",
		"!",
		"has:",
		"freq == 9x",
		"-",
		".",
	]) {
		assert.doesNotThrow(() => parseFrameFilter(text));
		assert.equal(
			parseFrameFilter(text).ok,
			false,
			`"${text}" should not parse`,
		);
	}
});

/* ── dest: the Reticulum destination hash (UI-013) ───────────────────── */

/**
 * A clear RNode/Reticulum HEADER_1 frame naming one destination hash:
 * shim, RNS flags, hops, the 16-byte hash, the context byte. Profile 4 is
 * the firmware's RNODE EXAMPLE profile, so the filter is allowed to read
 * the header at all.
 */
function rnodeFrame(hashHex: string, overrides: Partial<FilterFrame> = {}) {
	const hash = Uint8Array.from(hashHex.match(/../g) ?? [], (b) =>
		Number.parseInt(b, 16),
	);
	assert.equal(hash.length, 16, "a destination hash is 16 bytes");
	const bytes = new Uint8Array(20);
	bytes[0] = 0x00; // RNode shim, complete frame
	bytes[1] = 0x01; // HEADER_1, SINGLE destination, ANNOUNCE
	bytes[2] = 1; // hops
	bytes.set(hash, 3);
	return frame({ profileId: 4, bytes, ...overrides });
}

const HASH_A = "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf";
const HASH_B = "0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const HASH_DIGITS = "01234567890123456789012345678901";

test("dest matches a frame's whole destination hash", () => {
	const f = rnodeFrame(HASH_A);
	assert.equal(compile(`dest == ${HASH_A}`)(f), true);
	assert.equal(compile(`dest != ${HASH_A}`)(f), false);
	assert.equal(compile(`dest == ${HASH_B}`)(f), false);
	assert.equal(compile(`dest != ${HASH_B}`)(f), true);
});

test("dest reads hashes the tokenizer would otherwise split into pieces", () => {
	// "0a1b…" lexes as a number then an identifier; a hash is not a quantity.
	assert.equal(compile(`dest == ${HASH_B}`)(rnodeFrame(HASH_B)), true);
	assert.equal(
		compile(`dest == ${HASH_DIGITS}`)(rnodeFrame(HASH_DIGITS)),
		true,
	);
	// Case is not part of a hash.
	assert.equal(
		compile(`dest == ${HASH_A.toUpperCase()}`)(rnodeFrame(HASH_A)),
		true,
	);
});

test("dest reads no hash out of a frame that carries none", () => {
	const nonReticulum = rnodeFrame(HASH_A, { profileId: 1 }); // Meshtastic
	assert.equal(compile(`dest == ${HASH_A}`)(nonReticulum), false);
	assert.equal(compile(`dest != ${HASH_A}`)(nonReticulum), true);

	const split = rnodeFrame(HASH_A);
	split.bytes[0] = 0x01; // RNode split frame: no clear RNS header
	assert.equal(compile(`dest == ${HASH_A}`)(split), false);

	const ifac = rnodeFrame(HASH_A);
	ifac.bytes[1] |= 0x80; // IFAC masks the header
	assert.equal(compile(`dest == ${HASH_A}`)(ifac), false);

	const short = frame({ profileId: 4, bytes: new Uint8Array([0x00, 0x01]) });
	assert.equal(compile(`dest == ${HASH_A}`)(short), false);
});

test("a precomputed dest hash is used instead of re-reading the header", () => {
	// The caller's read wins: TrafficTab reads every frame's hash once.
	const f = rnodeFrame(HASH_A);
	assert.equal(compile(`dest == ${HASH_B}`)(f, undefined, HASH_B), true);
	assert.equal(compile(`dest == ${HASH_A}`)(f, undefined, null), false);
	// …and it reaches predicates nested under every combinator.
	assert.equal(
		compile(`!(dest == ${HASH_A}) && (dest == ${HASH_B} || sf == 11)`)(
			f,
			undefined,
			HASH_B,
		),
		true,
	);
});

test("dest composes with the rest of the language", () => {
	const f = rnodeFrame(HASH_A, { snrDb: 9 });
	assert.equal(compile(`dest == ${HASH_A} && snr > 5`)(f), true);
	assert.equal(compile(`dest == ${HASH_A} && snr > 20`)(f), false);
	assert.equal(compile(`proto == rnode and dest == ${HASH_A}`)(f), true);
});

test("dest refuses a prefix, an ordering, and a non-hash value", () => {
	const short = `dest == ${HASH_A.slice(0, 8)}`;
	let e = reject(short);
	assert.equal(short.slice(e.start, e.end), HASH_A.slice(0, 8));
	assert.match(e.message, /not a prefix/);

	e = reject(`dest < ${HASH_A}`);
	assert.match(e.message, /no ordering/);

	e = reject("dest == zzzz");
	assert.match(e.message, /hex hash/);

	assert.equal(parseFrameFilter("dest ==").ok, false);
	assert.doesNotThrow(() => parseFrameFilter("dest == ("));
});
